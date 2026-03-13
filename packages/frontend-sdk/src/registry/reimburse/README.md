# AI 报销功能接入文档

## 概述

AI 报销功能通过 Workbench Agent 框架，实现用户上传发票图片后，AI 自动识别发票信息并填写报销表单的能力。

## 架构设计

### 核心组件

```
┌─────────────────┐
│  用户上传发票    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  hoyoWorkbench.agent.registerUploader│  ← 文件上传处理
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  AI Agent (Workbench)                │
│  - 调用 imageOcr 识别发票 (内置工具) │
│  - 调用 Skills 获取数据               │
│  - 调用 Skills 更新表单               │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Reimburse Skills (4个工具)          │
│  - getFormValues                     │
│  - updateFormValues                  │
│  - getUserData                       │
│  - getExpenseItems                   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  reimburseFormService (单例服务)     │
│  - 连接 Skills 和 Vue 组件           │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  reimburse-apply.vue (报销表单组件)  │
└─────────────────────────────────────┘
```

## 接入步骤

### 1. 创建 Skills 目录结构

```
skills/reimburse/
├── index.ts                    # 导出入口
├── reimburse-skill.ts          # Skill 定义
├── reimburse-functions.ts      # 工具函数定义
├── reimburse-instructions.ts   # AI 使用说明
└── reimburse-service.ts        # 单例服务
```

### 2. 定义 Skills 工具

在 `reimburse-functions.ts` 中定义 4 个工具：

#### 2.1 getFormValues (读取表单)

```typescript
{
  id: 'getFormValues',
  name: 'Get Form Values',
  description: '获取当前报销表单的完整数据',
  operationType: 'read',
  parameters: [],
  type: 'executor',
  executor: async () => {
    return reimburseFormService.getFormValues();
  }
}
```

#### 2.2 updateFormValues (更新表单)

```typescript
{
  id: 'updateFormValues',
  name: 'Update Form Values',
  description: '更新报销表单数据',
  operationType: 'write',  // write 操作需要用户审批
  parameters: [
    { name: 'title', type: 'string', required: false },
    { name: 'has_electronic_certificate', type: 'number', required: false },
    { name: 'rows', type: 'array', required: false }
  ],
  type: 'executor',
  executor: async (args) => {
    reimburseFormService.updateFormValues(args);
    return { success: true };
  }
}
```

#### 2.3 getUserData (获取用户信息)

```typescript
{
  id: 'getUserData',
  name: 'Get User Data',
  description: '获取报销用户的部门、公司等信息',
  operationType: 'read',
  parameters: [],
  type: 'executor',
  executor: async () => {
    return reimburseFormService.getUserData();
  }
}
```

#### 2.4 getExpenseItems (获取费用项目)

```typescript
{
  id: 'getExpenseItems',
  name: 'Get Expense Items',
  description: '获取可用的费用项目列表',
  operationType: 'read',
  parameters: [],
  type: 'executor',
  executor: async () => {
    return reimburseFormService.getExpenseItems();
  }
}
```

### 3. imageOcr (AI 内置工具)

使用 AI 内置的 `imageOcr` 工具识别上传的发票图片，提取发票信息。**建议对每张图片调用两次并比较结果**，如果日期、金额不一致应提醒用户仔细核对。

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `imageUrl` | string | yes | 图片 URL |
| `prompt` | string | yes | OCR 提示词，指定要提取的信息 |

**推荐 Prompt:**

```
请提取这张图片中的所有文字内容，识别发票信息并返回结构化 JSON。务必提取发票日期（date，格式 YYYY-MM-DD）、金额（amount）、商家名称（merchant）、发票类型（type）、项目名称(project_name)。
```

**使用方式:**

1. 对每张发票图片调用 `imageOcr` 两次
2. 比较两次结果的 `date` 和 `amount` 字段
3. 如果不一致，提醒用户仔细核对

**Returns:**

返回 JSON 字符串，包含提取的发票信息:

```json
{
  "date": "2025-05-13",
  "amount": "1675.79",
  "merchant": "商家名称",
  "type": "vat_normal",
  "project_name": "项目名称"
}
```

**重要**: 如果两次识别结果不一致，必须提醒用户仔细核对相关字段。

### 4. 创建单例服务

在 `reimburse-service.ts` 中创建 `reimburseFormService`：

```typescript
export interface ReimburseFormHandler {
  getFormValues: () => FormValues;
  updateFormValues: (data: UpdatePayload) => void;
  getUserData: () => UserData | null;
  getExpenseItems: () => ExpenseItem[];
}

let handler: ReimburseFormHandler | null = null;

export function register(h: ReimburseFormHandler): void {
  handler = h;
}

export function unregister(): void {
  handler = null;
}

export function getFormValues(): FormValues {
  if (!handler) throw new Error('No handler registered');
  return handler.getFormValues();
}

export function updateFormValues(data: UpdatePayload): void {
  if (!handler) throw new Error('No handler registered');
  handler.updateFormValues(data);
}

export function getUserData(): UserData | null {
  if (!handler) throw new Error('No handler registered');
  return handler.getUserData();
}

export function getExpenseItems(): ExpenseItem[] {
  if (!handler) throw new Error('No handler registered');
  return handler.getExpenseItems();
}
```

### 5. 在 Vue 组件中注册

在 `reimburse-apply.vue` 的 `onMounted` 中注册：

```typescript
import { hoyoWorkbench } from '@mihoyo-fe/workbench';
import { reimburseSkill, reimburseFormService } from '@/skills/reimburse';
import { getOssInstance } from '@shared/store/ocRequest';
import { AddAllAttachmentInfo } from '@shared/models/public';

onMounted(() => {
  // 1. 注册文件上传器
  hoyoWorkbench.agent.registerUploader(async (files: File[]) => {
    const ossInstance = getOssInstance();
    
    const uploadPromises = files.map((file) => {
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        
        ossInstance.upload({
          file,
          onSuccess: async (res: unknown) => {
            const { fileId } = res as { fileId: string };
            
            // 上传结果写入数据库
            const result = await AddAllAttachmentInfo([{
              file_id: fileId,
              file_name: file.name,
            }]);
            
            const attachmentInfo = result?.list?.[0];
            if (attachmentInfo) {
              resolve({
                id: attachmentInfo.id,
                uid: attachmentInfo.id,
                name: attachmentInfo.name || file.name,
                url: attachmentInfo.url ? `${attachmentInfo.url}?isPreview=true` : '',
                file_id: attachmentInfo.file_id || fileId,
                ...attachmentInfo
              });
            } else {
              reject(new Error('Failed to save attachment'));
            }
          },
          onError: (error: Error) => reject(error),
        }, controller);
      });
    });
    
    return await Promise.all(uploadPromises);
  });
  
  // 2. 注册 AI Skills
  hoyoWorkbench.agent.registerSkills([reimburseSkill]);
  
  // 3. 注册表单服务
  reimburseFormService.register({
    getFormValues: () => ({
      header: {
        title: applyInfo.title,
        has_electronic_certificate: applyInfo.has_electronic_certificate,
        // ... 其他表头字段
      },
      rows: reimburseDetailData.value.map((row) => ({
        expense_item_code: row.relatedProject,
        expense_date: translateDayTime(row.date),
        expense_amount: String(row.spendAmount || ''),
        expense_currency: row.spendAmountUnit,
        description: row.description,
        department_path_codes: row.department_path_codes,
        expense_department_path_code: row.expense_department_path_code,
        attachments: row.attachments,
      })),
    }),
    
    updateFormValues: (data) => {
      // 更新表头
      if (data.title !== undefined) {
        applyInfo.title = data.title;
      }
      if (data.has_electronic_certificate !== undefined) {
        applyInfo.has_electronic_certificate = String(data.has_electronic_certificate);
      }
      
      // 更新明细行
      if (data.rows && Array.isArray(data.rows)) {
        const updatePromises: Promise<void>[] = [];
        
        data.rows.forEach((rowUpdate) => {
          const rowIndex = rowUpdate.rowIndex;
          
          // 如果行索引超出，创建新行
          if (rowIndex >= reimburseDetailData.value.length) {
            const newRow = { ...emptyData.value };
            reimburseDetailData.value.push(newRow);
          }
          
          const row = reimburseDetailData.value[rowIndex];
          if (row) {
            let needRecalculateAmount = false;
            
            // 更新各字段
            if (rowUpdate.expense_item_code !== undefined) {
              row.relatedProject = rowUpdate.expense_item_code;
            }
            if (rowUpdate.expense_date !== undefined) {
              row.date = toTimeStamp(rowUpdate.expense_date);
              needRecalculateAmount = true;
            }
            if (rowUpdate.expense_amount !== undefined) {
              row.spendAmount = rowUpdate.expense_amount;
              needRecalculateAmount = true;
            }
            if (rowUpdate.expense_currency !== undefined) {
              row.spendAmountUnit = rowUpdate.expense_currency;
              needRecalculateAmount = true;
            }
            if (rowUpdate.description !== undefined) {
              row.description = rowUpdate.description;
            }
            if (rowUpdate.department_path_codes !== undefined) {
              row.department_path_codes = rowUpdate.department_path_codes;
            }
            if (rowUpdate.expense_department_path_code !== undefined) {
              row.expense_department_path_code = rowUpdate.expense_department_path_code;
            }
            if (rowUpdate.attachments && Array.isArray(rowUpdate.attachments)) {
              row.attachments = rowUpdate.attachments;
            }
            
            // 重新计算报销金额（汇率转换）
            if (needRecalculateAmount && row.spendAmount && row.spendAmountUnit) {
              const promise = getDateRatio({
                from: row.spendAmountUnit,
                to: sheetCurrencyUnit.value,
                date: translateDayTime(row.date)
              }).then((ratio) => {
                row.reimburseAmount = getRatioPrice({
                  amount: row.spendAmount,
                  ratio,
                  to: sheetCurrencyUnit.value,
                  strategy: 'round'
                });
                row._ratio = ratio;
              });
              updatePromises.push(promise);
            }
          }
        });
        
        // 等待所有异步更新完成后，触发响应式更新
        Promise.all(updatePromises).then(() => {
          reimburseDetailData.value = [...reimburseDetailData.value];
          nextTick(() => {
            listFormRef.value?.validate?.();
          });
        });
      }
    },
    
    getUserData: () => unref(userDetail),
    getExpenseItems: () => unref(expenseItems) || unref(feeProject)?.list || [],
  });
});

onUnmounted(() => {
  hoyoWorkbench.agent.unregisterUploader();
  hoyoWorkbench.agent.unregisterSkills();
  reimburseFormService.unregister();
});
```

### 6. 编写 AI 使用说明

在 `reimburse-instructions.ts` 中提供详细的使用说明，告诉 AI：

- 可用的工具及其参数
- 推荐的调用顺序（6 步工作流）
- 数据格式要求
- 拆行规则（不同币种/费用项目/日期需拆分）
- 附件处理规则（必须原样传入完整对象）

## 关键技术点

### 1. Executor 类型工具

使用 `type: 'executor'` 而非 `type: 'code'`，直接调用本地函数：

```typescript
{
  type: 'executor',
  executor: async (args) => {
    // 直接调用本地函数
    return reimburseFormService.getFormValues();
  }
}
```

### 2. 单例服务模式

通过 `reimburseFormService` 单例服务，解耦 Skills 和 Vue 组件：

```
Skills (executor) → reimburseFormService → Vue Component
```

好处：
- Skills 不直接依赖 Vue 组件
- 组件可以在 mount/unmount 时注册/注销
- 便于测试和维护

### 3. 文件上传处理

使用 OSS SDK 上传文件，并保存附件元数据：

```typescript
ossInstance.upload() → AddAllAttachmentInfo() → 返回完整附件对象
```

**关键**: 返回的附件对象必须包含所有字段（id, uid, name, url, file_id 等），AI 会原样传入 `attachments` 字段。

### 4. 响应式更新

由于 `reimburseDetailData` 是 `ref`，直接修改内部对象属性可能不触发更新。解决方案：

```typescript
// 等待所有异步更新完成
Promise.all(updatePromises).then(() => {
  // 创建新数组引用触发响应式
  reimburseDetailData.value = [...reimburseDetailData.value];
});
```

### 5. 汇率计算

更新金额/币种/日期后，需要重新计算 `reimburseAmount`：

```typescript
getDateRatio({ from, to, date }).then((ratio) => {
  row.reimburseAmount = getRatioPrice({ amount, ratio, to, strategy: 'round' });
});
```

这会触发 `totalReimburseAmount` 和 `payAmount` 的 computed 重新计算。

## 数据流

### 上传流程

```
用户选择文件
  ↓
registerUploader 回调
  ↓
OSS 上传 (ossInstance.upload)
  ↓
保存附件元数据 (AddAllAttachmentInfo)
  ↓
返回完整附件对象给 AI
  ↓
AI 保存附件对象
```

### 填写流程

```
AI 调用 imageOcr (识别发票，内置工具)
  ↓
AI 调用 getUserData (获取部门)
  ↓
AI 调用 getExpenseItems (匹配费用项目)
  ↓
AI 调用 updateFormValues (填写表单)
  ↓
reimburseFormService.updateFormValues
  ↓
更新 Vue 组件的 reactive 数据
  ↓
触发汇率计算
  ↓
触发金额合计重新计算
  ↓
页面更新
```

## 注意事项

### 1. 路径别名

项目中 `@/` 指向 `src/`，但 `skills` 在项目根目录，需要使用相对路径：

```typescript
// ❌ 错误
import { reimburseSkill } from '@/skills/reimburse';

// ✅ 正确
import { reimburseSkill } from '../../../../skills/reimburse';
```

### 2. Portal API 前缀

OC 相关接口需要添加 `portalApiBase` 前缀：

```typescript
import { portalApiBase } from 'appConfig';

export const OC_API_URL = {
  getUploadUrl: `${portalApiBase}/public/file/upload_url/get`,
  batchAddFile: `${portalApiBase}/public/attachment/batch_add`,
};
```

### 3. 附件 URL 预览参数

返回给 AI 的附件 URL 需要添加 `?isPreview=true`：

```typescript
url: attachmentInfo.url ? `${attachmentInfo.url}?isPreview=true` : ''
```

### 4. 类型转换

- `has_electronic_certificate`: AI 可能传 number，需转为 string
- `expense_amount`: 必须是 string 类型，避免精度丢失
- `expense_date`: 需要转为 timestamp

### 5. 表单验证

更新完成后触发表单验证：

```typescript
nextTick(() => {
  listFormRef.value?.validate?.();
});
```

## 测试要点

### 1. 单发票场景

- 上传 1 张发票
- AI 识别并填写 1 行
- 验证金额、日期、币种、费用项目、部门、附件

### 2. 多发票场景

- 上传多张发票
- AI 根据拆行规则拆分为多行
- 验证每行的附件关联正确

### 3. 拆行规则

- 不同币种 → 拆行
- 不同费用项目 → 拆行
- 不同日期 → 拆行

### 4. 金额计算

- 验证 `reimburseAmount` 正确计算（汇率转换）
- 验证 `totalReimburseAmount` 正确汇总
- 验证 `payAmount` 正确计算（扣除备用金）

### 5. 边界情况

- 空表单新增行
- 已有行更新
- 附件对象缺少字段
- imageOcr 识别失败
- 汇率获取失败

## 常见问题

### Q1: AI 卡住不响应

**原因**: Instructions 过于复杂或规则冲突

**解决**: 简化 instructions，减少重复说明，使用简洁的列表和示例

### Q2: 金额显示为 0.00

**原因**: 响应式更新未触发

**解决**: 
- 等待异步汇率计算完成
- 创建新数组引用 `reimburseDetailData.value = [...reimburseDetailData.value]`

### Q3: 附件未写入

**原因**: AI 传入的附件对象不完整

**解决**: 
- 在 instructions 中明确要求原样传入完整对象
- 添加示例说明
- 禁止 AI 只取部分字段或自行构造

### Q4: 部门信息未填写

**原因**: AI 未调用 getUserData 或未正确提取字段

**解决**: 
- 在 instructions 中明确标注必填
- 说明字段来源 `getUserData().main_department.expense_department_path_code`

## 扩展建议

### 1. 错误处理

在 executor 中添加详细的错误日志：

```typescript
executor: async (args) => {
  try {
    return reimburseFormService.getFormValues();
  } catch (error) {
    console.error('[getFormValues] Error:', error);
    throw error;
  }
}
```

### 2. 进度提示

在长时间操作（imageOcr、汇率计算）时显示进度：

```typescript
const loading = ref(false);

updateFormValues: (data) => {
  loading.value = true;
  // ... 更新逻辑
  Promise.all(updatePromises).finally(() => {
    loading.value = false;
  });
}
```

### 3. 数据校验

在 updateFormValues 中添加数据校验：

```typescript
if (!rowUpdate.expense_amount || isNaN(Number(rowUpdate.expense_amount))) {
  throw new Error('Invalid expense_amount');
}
```

### 4. 撤销功能

保存更新前的状态，支持撤销：

```typescript
const history = ref<FormValues[]>([]);

updateFormValues: (data) => {
  history.value.push(cloneDeep(getFormValues()));
  // ... 更新逻辑
}
```

## 总结

AI 报销功能通过 Workbench Agent 框架，结合 Skills、单例服务和 Vue 组件，实现了从文件上传、imageOcr 识别到表单填写的完整流程。关键点在于：

1. **解耦设计**: Skills → Service → Component
2. **Executor 模式**: 直接调用本地函数
3. **响应式更新**: 异步完成后创建新引用
4. **完整数据传递**: 附件对象原样传入
5. **清晰的 AI 指引**: 简洁的 instructions

通过这套架构，可以快速接入其他类似的 AI 辅助填单场景。
