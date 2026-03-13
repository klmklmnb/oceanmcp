import * as reimburseFormService from './reimburse-service';
import type { FunctionDefinition } from '../../types';
import type { TravelDocument } from './reimburse-service';

interface ImageInput {
  imageUrl: string;
  fileName: string;
}

interface OcrApiResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Tool 1: Update Form Values
 * 更新报销表单数据
 * 表头只允许更新: title, has_electronic_certificate
 * 明细行可更新: expense_item_code, expense_date, expense_amount, expense_currency, description, department_path_codes, expense_department_path_code, columns
 */
function makeUpdateFormValues(): FunctionDefinition {
  return {
    id: 'updateFormValues',
    name: 'Update Form Values',
    cnName: '更新表单数据',
    description: `更新报销表单数据。
表头字段(可选):
- title: 报销标题
- has_electronic_certificate: 是否包含电子发票/电子凭证(1是/2否)

银行信息字段(必填,从 getBankAccountInfo 获取):
- payee: 收款方名称（必填）
- bank_no: 银行卡号（必填）
- bank_account: 收款方账号/开户名（必填）
- bank_branch: 支行名称（可选）
- bank_clearing_code: 本地清算代码（可选）
- bank_province: 省州（可选）
- bank_city: 城市（可选）
- bank_nation: 收款行国家/地区（可选）
- bank_nation_code: 国家/地区代码（可选）

**重要**: payee、bank_no、bank_account 三个字段必须填写，否则报销单创建将失败。

明细行字段(rows数组,每项需包含rowIndex):
- rowIndex: 行索引(从0开始,必填)
- expense_item_code: 费用项目编码
- expense_date: 费用发生日期(yyyy-MM-dd)
- expense_amount: 消费金额(字符串,避免精度丢失)
- expense_currency: 消费币种(如CNY/USD/JPY)
- description: 行级报销事由
- department_path_codes: 所属部门路径编码
- expense_department_path_code: 受益部门路径编码
- attachments: 发票/凭证附件数组,必须是上传文件时返回的完整对象,不可删减任何字段

只传入需要更新的字段,未传入的字段保持不变。`,
    operationType: 'write',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: false,
        description: '报销标题',
        showName: '标题',
      },
      {
        name: 'has_electronic_certificate',
        type: 'string',
        required: false,
        description: '是否包含电子发票/电子凭证: 1 是, 2 否',
        showName: '是否包含电子发票',
      },
      {
        name: 'bank_no',
        type: 'string',
        required: true,
        description: '银行卡号（必填，从 getBankAccountInfo 获取）',
        showName: '银行卡号',
      },
      {
        name: 'bank_account',
        type: 'string',
        required: true,
        description: '收款方账号/开户名（必填，从 getBankAccountInfo 获取）',
        showName: '收款方账号',
      },
      {
        name: 'bank_nation_code',
        type: 'string',
        required: false,
        description: '国家/地区代码',
        showName: '国家/地区代码',
      },
      {
        name: 'rows',
        type: 'object_array',
        required: false,
        description: '报销明细行数组,每项需包含rowIndex(行索引,从0开始)',
        showName: '报销明细',
        columns: {
          expense_item_code: { label: '费用项目' },
          expense_date: { label: '费用日期' },
          expense_amount: { label: '金额' },
          expense_currency: { label: '币种' },
          description: { label: '事由' },
          department_path_codes: { label: '所属部门' },
          expense_department_path_code: { label: '受益部门' },
          attachments: {
            label: '发票与凭证',
            render: (value: Array<{ name: string }>) => {
              return value?.map((att) => att.name).join('、') || '';
            },
          },
        },
      },
    ],

    type: 'executor',
    executor: async (args) => {
      const result = await reimburseFormService.updateFormValues(args as any);
      const reimbursementCode = (result as { code?: string })?.code || '';
      
      const message = `✅ 报销单已保存成功！${reimbursementCode ? `📋 报销单编号：${reimbursementCode}\n\n` : ''}`;

      return { 
        success: true, 
        message,
        reimbursementCode,
        updated: args 
      };
    },
  };
}

/**
 * Tool 3: Get User Data
 * 获取报销用户数据(部门、公司、币种等)
 */
function makeGetUserData(): FunctionDefinition {
  return {
    id: 'getUserData',
    name: 'Get User Data',
    cnName: '获取用户信息',
    description: `获取报销用户的基础信息,包括:
- company_code: 公司编码
- company_name: 公司名称
- main_currency: 主结算币种
- main_department.name: 主岗部门名称
- main_department.code: 主岗部门编码(用于department_path_codes)
- main_department.benefit_center_code: 受益中心编码(旧字段)
- main_department.expense_department_path_code: 受益部门路径编码(新字段,用于expense_department_path_code)

**重要**: 获取到用户信息后,必须向用户展示并确认:
1. 报销公司: company_name
2. 所属部门: main_department.name

此数据通过调用 /user/detail 接口实时获取。`,
    operationType: 'read',
    parameters: [],
    type: 'executor',
    executor: async () => {
      return reimburseFormService.getUserData();
    },
  };
}

/**
 * Tool 4: Get Expense Items
 * 获取费用项目列表
 */
function makeGetExpenseItems(): FunctionDefinition {
  return {
    id: 'getExpenseItems',
    name: 'Get Expense Items',
    cnName: '获取费用项目',
    description: `获取可用的费用项目列表,用于匹配OCR识别的发票内容到费用项目编码(expense_item_code)。

根据URL参数rem_type自动过滤:
- rem_type=daily: 返回日常报销项目(EXP0001的子项目)
- rem_type=travel: 返回差旅报销项目(EXP0002的子项目)

数据结构:
[
  { code: "EXP000101", name: "加班打车费" },
  { code: "EXP000102", name: "其它交通费" },
  ...
]

此数据通过调用 /expense/item/list 接口实时获取并过滤。`,
    operationType: 'read',
    parameters: [],
    type: 'executor',
    executor: async () => {
      return reimburseFormService.getExpenseItems();
    },
  };
}

/**
 * Tool 5: Get Bank Account Info
 * 获取员工收款信息
 */
function makeGetBankAccountInfo(): FunctionDefinition {
  return {
    id: 'getBankAccountInfo',
    name: 'Get Bank Account Info',
    cnName: '获取员工收款信息',
    description: `获取用户的员工收款信息列表,用于报销收款。

返回数据包含:
- list: 收款信息列表
- default: 默认收款信息（列表第一个）

收款信息字段:
- payee: 收款方名称（必填）
- bank_no: 银行卡号（必填）
- bank_account: 收款方账号/开户名（必填）
- bank_branch: 支行名称
- bank_clearing_code: 本地清算代码
- bank_province: 省州
- bank_city: 城市
- bank_nation: 开户国家/地区
- bank_nation_code: 国家/地区代码

**重要**: 
1. 获取员工收款信息后,需要让用户确认使用哪个收款账户
2. 将选中账户的 payee、bank_no、bank_account 三个必填字段填入 updateFormValues
3. 其他字段建议一并填入以确保信息完整`,
    operationType: 'read',
    parameters: [],
    type: 'executor',
    executor: async () => {
      return reimburseFormService.getBankAccountInfo();
    },
  };
}

/**
 * Tool 7: Get Travel Documents
 * 获取差旅申请单列表(用于差旅报销单关联)
 */
function makeGetTravelDocuments(): FunctionDefinition {
  return {
    id: 'getTravelDocuments',
    name: 'Get Travel Documents',
    cnName: '获取差旅申请单',
    description: `获取差旅申请单列表,用于差旅报销单(rem_type=travel)关联。根据出行日期和申请人查询可关联的差旅单。

**使用场景:**
- 当报销类型为"差旅报销"(rem_type=travel)时,需要关联差旅申请单
- 根据费用发生日期(expense_date)查询对应的差旅申请单
- 返回的差旅单包含差旅单号(doc_code)、出行日期、出行事由等信息

**处理流程:**
1. 如果找到匹配的差旅单,自动选择is_valid=true的差旅单
2. 查找逻辑: 找到发票日期(expense_date)晚于差旅单出行日期(travel_date)的差旅单
3. 如果未找到匹配的差旅单,提示用户手动去关联
4. 向用户展示时使用格式: "出行事由 (出行日期) - 差旅单号"
   例如: "出差北京参加技术交流会 (2025-06-04) - CL20250606115559577777"

**重要提示:**
- 只有在报销类型为差旅报销时才需要调用此工具
- **必须传递applicant参数**,使用表单中的实际报销人(header.applicant)
- 使用费用发生日期(发票日期)作为travel_date参数
- 查找travel_date早于发票日期的差旅单(即发票是在出行之后开具的)
- 优先选择is_valid=true的差旅单
- 如果未找到匹配的差旅单,明确告知用户需要手动关联差旅单
- 如果需要用户选择,必须展示travel_reason(出行事由)和travel_date(出行日期)`,
    operationType: 'read',
    parameters: [
      {
        name: 'travel_date',
        type: 'string',
        required: false,
        description: '发票日期(yyyy-MM-dd格式),用于前端过滤travel_date早于此日期的差旅单',
        showName: '发票日期',
      },
      {
        name: 'applicant',
        type: 'string',
        required: true,
        description: '实际报销人域账号,从表单header.applicant获取',
        showName: '实际报销人',
      },
      {
        name: 'filter_valid_doc',
        type: 'boolean',
        required: false,
        description: '是否只返回可关联的有效差旅单,默认true',
        showName: '只返回有效差旅单',
      },
    ],
    type: 'executor',
    executor: async (args) => {
      const { travel_date, applicant, filter_valid_doc = true } = args;
      
      if (!applicant) {
        throw new Error('[getTravelDocuments] applicant parameter is required. Please get it from form header.applicant');
      }
      
      try {
        // 调用差旅单列表接口(不传travel_date参数)
        const response = await reimburseFormService.fetchTravelDocuments({
          applicant: applicant,
          filter_valid_doc,
          page: 1,
          page_size: 100, // 获取更多数据用于前端过滤
        });
        
        if (!response) {
          return {
            list: [],
            total: 0,
            message: '未找到相关差旅申请单',
          };
        }
        
        // 格式化返回结果
        let formattedList = (response.list || []).map((doc: TravelDocument) => ({
          doc_code: doc.doc_code,
          travel_date: doc.travel_date,
          travel_reason: doc.travel_reason,
          travel_way: doc.travel_way,
          state: doc.state,
          is_valid: doc.is_valid,
          invalid_reason: doc.invalid_reason,
          applicant: doc.doc_applicant,
          traveler: doc.traveler,
          apply_date: doc.apply_date,
        }));
        
        // 如果传了travel_date,前端过滤: 找到travel_date早于发票日期的差旅单
        if (travel_date) {
          const invoiceDate = new Date(travel_date);
          formattedList = formattedList.filter((doc: typeof formattedList[0]) => {
            if (!doc.travel_date) return false;
            const docTravelDate = new Date(doc.travel_date);
            return docTravelDate < invoiceDate; // travel_date早于发票日期
          });
        }
        
        // 处理可能是字符串的数字字段
        const page = typeof response.page === 'string' ? parseInt(response.page, 10) : (response.page || 1);
        const pageSize = typeof response.page_size === 'string' ? parseInt(response.page_size, 10) : (response.page_size || 10);
        
        const noteMessage = travel_date
          ? (formattedList.length > 0 
              ? `找到 ${formattedList.length} 个发票日期(${travel_date})晚于出行日期的差旅申请单,请选择合适的差旅单号(doc_code)关联到报销单`
              : `未找到发票日期(${travel_date})晚于出行日期的差旅单,请手动关联差旅单`)
          : (formattedList.length > 0
              ? `找到 ${formattedList.length} 个差旅申请单,请选择合适的差旅单号(doc_code)关联到报销单`
              : '未找到差旅申请单');
        
        return {
          list: formattedList,
          total: formattedList.length, // 返回过滤后的数量
          page,
          page_size: pageSize,
          _note: noteMessage,
        };
      } catch (error) {
        console.error('[getTravelDocuments] Failed to fetch travel documents:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`获取差旅申请单失败: ${errorMessage}`);
      }
    },
  };
}

export const reimburseFunctions: FunctionDefinition[] = [
  // makeGetFormValues(), // Removed: not needed in Chat mode
  makeUpdateFormValues(),
  // makeGetOcrData(), // Removed: now using AI built-in imageOcr tool
  makeGetUserData(),
  makeGetExpenseItems(),
  makeGetBankAccountInfo(),
  // makeSetBankInfo(), // Removed: bank info from AI context, passed directly to updateFormValues
  makeGetTravelDocuments(),
];
