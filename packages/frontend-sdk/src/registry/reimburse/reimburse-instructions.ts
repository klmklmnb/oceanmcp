export const instructions = `# Reimburse Skill

AI 辅助填写报销单。根据用户上传的发票图片,自动识别并填写报销明细。

## Capabilities

- **更新表单数据** — 创建报销单，填写报销标题、电子发票标识、明细行数据
- **imageOcr 识别发票** — 使用 AI 内置工具从上传的图片中提取发票信息
- **获取用户数据** — 读取报销用户的部门、公司等信息
- **获取费用项目** — 读取可用的费用项目列表（根据 URL 参数自动过滤日常/差旅）
- **获取员工收款信息** — 读取用户的收款信息列表

## Tool Call Sequence

**重要：必须按以下顺序调用工具**

1. **getUserData** — 首先获取用户信息（包含 company_code, department 等）
   - ⚠️ **必须向用户确认**: 报销公司、所属部门
2. **getBankAccountInfo** — 获取员工收款信息列表
   - ⚠️ **必须向用户确认**: 选择哪个收款账户
   - 保存选中账户的 payee、bank_no、bank_account（必填）
3. **getExpenseItems** — 获取费用项目列表（会根据 URL 的 rem_type 参数自动过滤）
4. **imageOcr** — 使用 AI 内置工具识别发票图片（如果用户上传了发票）
   - 建议对每张图片调用两次并比较结果
5. **updateFormValues** — 创建报销单
   - **必须填入**: payee、bank_no、bank_account（来自 Step 2）
   - ⚠️ **提交前必须再次向用户确认**: 报销公司、所属部门、收款账户（后四位）、报销明细、报销总额

## Available Tools

### 1. updateFormValues (write)

更新报销表单数据。只传入需要更新的字段,未传入的字段保持不变。

**返回结果包含:**
- \`success\`: 是否成功
- \`message\`: 完整的提示信息,包含:
  - ✅ 报销单已提交成功
  - 📋 报销单编号
- \`reimbursementCode\`: 报销单编号（code）

**返回消息示例:**
\`\`\`
✅ 报销单已提交成功！

📋 报销单编号：REM260304000023

\`\`\`

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`title\` | string | no | 报销标题 |
| \`has_electronic_certificate\` | string | no | 是否包含电子发票/电子凭证: \`"1"\` 是, \`"2"\` 否 |
| \`payee\` | string | **yes** | 收款方名称，从 getBankAccountInfo 获取 |
| \`bank_no\` | string | **yes** | 银行卡号，从 getBankAccountInfo 获取 |
| \`bank_account\` | string | **yes** | 收款方账号（开户名），从 getBankAccountInfo 获取 |
| \`bank_branch\` | string | no | 支行名称 |
| \`bank_clearing_code\` | string | no | 本地清算代码 |
| \`bank_province\` | string | no | 省州 |
| \`bank_city\` | string | no | 城市 |
| \`bank_nation\` | string | no | 收款行国家/地区 |
| \`bank_nation_code\` | string | no | 国家/地区代码 |
| \`rows\` | array | no | 报销明细行数组 |

**银行信息说明:** 
- **必填字段**: \`payee\`（收款方）、\`bank_no\`（银行卡号）、\`bank_account\`（开户名）
- 这些字段必须从 \`getBankAccountInfo\` 获取，用户确认后填入
- 其他银行字段为可选，建议一并填入以确保信息完整

**\`rows\` 数组中每项的字段:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`rowIndex\` | number | **yes** | 行索引(从 0 开始),指定要更新的行 |
| \`expense_item_code\` | string | **yes** | 费用项目编码(如 \`"EXP000101"\`),从 getExpenseItems 匹配 |
| \`expense_date\` | string | **yes** | 费用发生日期(\`yyyy-MM-dd\`),从 imageOcr 获取 |
| \`expense_amount\` | string | **yes** | 消费金额(字符串,避免精度丢失),从 imageOcr 获取 |
| \`expense_currency\` | string | **yes** | 消费币种(如 \`"CNY"\` / \`"USD"\` / \`"JPY"\`),从 imageOcr 获取 |
| \`description\` | string | **yes** | 行级报销事由,从 imageOcr 获取 |
| \`department_path_codes\` | string | **yes** | 所属部门路径编码,从 getUserData 的 \`main_department.code\` 获取 |
| \`expense_department_path_code\` | string | **yes** | 受益部门路径编码,从 getUserData 的 \`main_department.expense_department_path_code\` 获取 |
| \`attachments\` | array | **yes** | 该行对应的附件数组。**必须是上传文件时返回的完整对象,禁止删减任何字段,禁止自行构造** |

**Example:** 见下方 Step 6 示例

---

### 2. imageOcr (AI 内置工具)

使用 AI 内置的 \`imageOcr\` 工具识别上传的发票图片,提取发票信息。**建议对每张图片调用两次并比较结果**,如果日期、金额不一致应提醒用户仔细核对。

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`imageUrl\` | string | yes | 图片 URL |
| \`prompt\` | string | yes | OCR 提示词，指定要提取的信息 |

**推荐 Prompt:**
\`\`\`
请提取这张图片中的所有文字内容，识别发票信息并返回结构化 JSON。务必提取发票日期（date，格式 YYYY-MM-DD）、金额（amount）、商家名称（merchant）、发票类型（type）、项目名称(project_name)。
\`\`\`

**使用方式:**
1. 对每张发票图片调用 \`imageOcr\` 两次
2. 比较两次结果的 \`date\` 和 \`amount\` 字段
3. 如果不一致，提醒用户仔细核对

**Returns:** 
返回 JSON 字符串，包含提取的发票信息:
\`\`\`json
{
  "date": "2025-05-13",
  "amount": "1675.79",
  "merchant": "商家名称",
  "type": "vat_normal",
  "project_name": "项目名称"
}
\`\`\`

**重要**: 如果两次识别结果不一致,必须提醒用户仔细核对相关字段。

---

### 3. getUserData (read)

获取报销用户的基础信息,包括部门、公司、币种等。此数据在页面初始化时已通过 \`/user/detail\` 接口获取。

**Parameters:** 无

**Returns:**
\`\`\`json
{
  "company_code": "C001",
  "company_name": "示例公司",
  "main_currency": "CNY",
  "main_department": {
    "code": "D001",
    "name": "技术部",
    "expense_department_path_code": "D001-SUB",
    "expense_department_path_name": "技术部-研发组"
  }
}
\`\`\`

**Key Fields:**
- \`company_name\` + \`company_code\` → 报销公司（**需向用户确认**）
- \`main_department.name\` + \`main_department.code\` → 所属部门（**需向用户确认**）
- \`main_department.code\` → 用于填写 \`department_path_codes\`(所属部门)
- \`main_department.expense_department_path_code\` → 用于填写 \`expense_department_path_code\`(受益部门)

**重要**: 获取到用户信息后,必须向用户展示并确认:
1. 报销公司: \`company_name\`
2. 所属部门: \`main_department.name\`

---

### 4. getExpenseItems (read)

获取可用的费用项目列表,用于匹配 imageOcr 识别的发票内容到费用项目编码。此数据在页面初始化时已通过 \`/expense/item/list\` 接口获取。

**Parameters:** 无

**Returns:**
\`\`\`json
[
  {
    "code": "EXP0001",
    "name": "日常费用",
    "list": [
      { "code": "EXP000101", "name": "办公用品" },
      { "code": "EXP000102", "name": "差旅交通" },
      { "code": "EXP000103", "name": "业务招待" }
    ]
  },
  {
    "code": "EXP0002",
    "name": "差旅费用",
    "list": [
      { "code": "EXP000201", "name": "交通费" },
      { "code": "EXP000202", "name": "住宿费" }
    ]
  }
]
\`\`\`

**Structure:** 层级结构,一级费用项目包含 \`list\` 字段,内含二级费用项目。

---

### 5. getBankAccountInfo (read)

获取用户的员工收款信息列表,用于报销收款。

**Parameters:** 无

**Returns:**
\`\`\`json
{
  "list": [
    {
      "payee": "何飞翔",
      "bank_no": "6222021234567890",
      "bank_account": "何飞翔",
      "bank_branch": "中国工商银行上海分行",
      "bank_clearing_code": "102290000001",
      "bank_province": "上海市",
      "bank_city": "上海市",
      "bank_nation": "中国",
      "bank_nation_code": "CN"
    }
  ],
  "default": {
    "payee": "何飞翔",
    "bank_no": "6222021234567890",
    "bank_account": "何飞翔",
    "bank_branch": "中国工商银行上海分行",
    "bank_clearing_code": "102290000001",
    "bank_province": "上海市",
    "bank_city": "上海市",
    "bank_nation": "中国",
    "bank_nation_code": "CN"
  }
}
\`\`\`

**字段说明:**
- \`payee\`: 收款方名称（必填）
- \`bank_no\`: 银行卡号（必填）
- \`bank_account\`: 收款方账号/开户名（必填）
- \`bank_branch\`: 支行名称
- \`bank_clearing_code\`: 本地清算代码
- \`bank_province\`: 省州
- \`bank_city\`: 城市
- \`bank_nation\`: 收款行国家/地区
- \`bank_nation_code\`: 国家/地区代码

**重要**: 
1. 获取员工收款信息后,需要让用户确认使用哪个收款账户
2. 将选中账户的 \`payee\`、\`bank_no\`、\`bank_account\` 三个必填字段填入 updateFormValues
3. 其他字段建议一并填入以确保信息完整

---

## Row Splitting Rules (拆行规则)

当填写报销明细行时,必须遵循以下拆行规则:

### 何时需要拆分为多行

以下情况必须拆分为不同的明细行:

1. **不同币种 (expense_currency)**: 人民币(CNY)、美元(USD)、日元(JPY)等不同币种的费用必须分开填写
2. **不同费用项目 (expense_item_code)**: 办公用品(EXP000101)、差旅交通(EXP000102)等不同费用项目必须分开填写
3. **不同发生日期 (expense_date)**: 不同日期发生的费用必须分开填写

### 拆行示例

**错误示例 (不应合并):**
\`\`\`
❌ 将 2025-03-01 的办公用品(CNY 100) 和 2025-03-02 的差旅交通(CNY 200) 合并为一行
❌ 将 CNY 100 和 USD 50 合并为一行
❌ 将办公用品和差旅交通合并为一行
\`\`\`

**正确示例 (应拆分):**
\`\`\`
✓ Row 0: 2025-03-01, 办公用品(EXP000101), CNY 100
✓ Row 1: 2025-03-02, 差旅交通(EXP000102), CNY 200
✓ Row 2: 2025-03-01, 办公用品(EXP000101), USD 50
\`\`\`

### 何时可以合并

只有当以下三个条件**同时满足**时,才可以将多笔费用合并到同一行:
- 相同币种
- 相同费用项目
- 相同发生日期

在这种情况下,将金额相加后填入 \`expense_amount\` 字段。

---

## Recommended Workflow

AI 应按以下顺序调用工具,完成报销单的自动填写:

### Step 1: 用户上传发票图片

用户在页面上传发票附件(图片)。

上传成功后返回附件对象数组,**原样保存**用于 Step 6。

返回示例: \`[{id, uid, name, url, file_id, content_type, created_at, file_size, source, ...}]\`

其中 \`url\` 用于 Step 5 imageOcr 识别。

### Step 2: 调用 \`getUserData\` 获取用户信息

**必须首先调用此工具**,获取用户的部门、公司等基础信息。

返回数据包含:
- \`company_name\`: 报销公司名称
- \`company_code\`: 报销公司编码
- \`main_department.name\`: 所属部门名称
- \`main_department.code\`: 所属部门编码
- 其他字段...

**重要**: 在继续后续步骤前,**必须向用户确认**以下信息:
1. **报销公司**: 展示 \`company_name\`,确认是否正确
2. **所属部门**: 展示 \`main_department.name\`,确认是否正确

只有用户确认后才能继续下一步。

### Step 3: 调用 \`getBankAccountInfo\` 获取员工收款信息列表

获取用户的员工收款信息,展示给用户确认选择哪个收款账户。

**重要**: 用户选择后,将选中的银行信息保存,在 Step 6 调用 updateFormValues 时直接填入银行字段。

### Step 4: 调用 \`getExpenseItems\` 获取费用项目

获取可用的费用项目列表（已根据 URL 的 rem_type 自动过滤）。

### Step 5: 使用 \`imageOcr\` 识别发票

使用 AI 内置的 \`imageOcr\` 工具从上传的图片中提取发票信息,包括金额、日期、发票类型、商品名称等。

**重要**: 建议对每张图片调用 \`imageOcr\` 两次,比较两次结果的 \`date\` 和 \`amount\` 字段。如果不一致,需要提醒用户仔细核对。

**调用示例:**
\`\`\`json
{
  "imageUrl": "https://example.com/invoice.jpg",
  "prompt": "请提取这张图片中的所有文字内容，识别发票信息并返回结构化 JSON。务必提取发票日期（date，格式 YYYY-MM-DD）、金额（amount）、商家名称（merchant）、发票类型（type）、项目名称(project_name)。"
}
\`\`\`

**Returns:**
\`\`\`json
{
  "date": "2025-05-13",
  "amount": "1675.79",
  "merchant": "商家名称",
  "type": "vat_normal",
  "project_name": "项目名称"
}
\`\`\`

### Step 6: 调用 \`updateFormValues\` 创建报销单

将 Step 1-5 收集的数据合并,调用 \`updateFormValues\` 创建报销单。

**在调用前,必须再次向用户确认以下关键信息:**

1. **报销公司**: \`company_name\` (来自 Step 2 的 getUserData)
2. **所属部门**: \`main_department.name\` (来自 Step 2 的 getUserData)
3. **收款账户**: \`bank_no\` (来自 Step 3 的 getBankAccountInfo，用户选择的账户)
4. **报销明细**: 展示所有明细行的费用项目、金额、日期等
5. **报销总额**: 所有明细行的金额汇总

**银行信息必填提醒:**
- 必须填入 \`payee\`（收款方）、\`bank_no\`（银行卡号）、\`bank_account\`（开户名）
- 这三个字段从 Step 3 的 getBankAccountInfo 获取，用户确认后原样填入
- 缺少任何一个字段都会导致报销单创建失败

用户确认无误后,才调用 \`updateFormValues\` 提交。

**必须提取以下字段用于填写明细行:**
- \`main_department.code\` (从 Step 2) → 填写每行的 \`department_path_codes\` (所属部门)
- \`main_department.expense_department_path_code\` (从 Step 2) → **必须**填写到每行的 \`expense_department_path_code\` (受益部门)

**重要**: 这两个字段是必填项,每一行都必须包含这些部门信息。

**表头字段:**
- \`title\`: 报销标题
- \`has_electronic_certificate\`: 是否包含电子发票 ("1"是/"2"否,字符串类型)

**明细行必填字段:**
- \`rowIndex\`: 行索引(从0开始)
- \`expense_item_code\`: 费用项目(从 Step 4 的 getExpenseItems 匹配)
- \`expense_date\`: 日期 yyyy-MM-dd (imageOcr)
- \`expense_amount\`: 金额字符串 (imageOcr)
- \`expense_currency\`: 币种 CNY/USD/JPY (imageOcr)
- \`description\`: 事由 (imageOcr)
- \`department_path_codes\`: \`getUserData().main_department.code\`
- \`expense_department_path_code\`: \`getUserData().main_department.expense_department_path_code\`
- \`attachments\`: Step 1 上传返回的完整对象数组

**银行信息必填字段（从 Step 3 的 getBankAccountInfo 获取）:**
- \`payee\`: 收款方名称（必填）
- \`bank_no\`: 银行卡号（必填）
- \`bank_account\`: 收款方账号/开户名（必填）

**关键提醒:**
1. **银行信息必填**: payee、bank_no、bank_account 三个字段必须从 getBankAccountInfo 获取并填入
2. **attachments 原样传入**: 直接将 Step 1 上传返回的完整对象放入数组,不做任何修改
3. **expense_department_path_code 必填**: 从 Step 2 的 \`getUserData().main_department.expense_department_path_code\` 获取
4. **拆行规则**: 不同币种/费用项目/日期 → 拆分为不同行

**示例:** (假设上传返回了 uploadedFile1, uploadedFile2)

\`\`\`json
{
  "title": "2025年5月差旅费报销",
  "has_electronic_certificate": "1",
  "payee": "何飞翔",
  "bank_no": "6222021234567890",
  "bank_account": "何飞翔",
  "bank_branch": "中国工商银行上海分行",
  "bank_clearing_code": "102290000001",
  "bank_province": "上海市",
  "bank_city": "上海市",
  "bank_nation": "中国",
  "bank_nation_code": "CN",
  "rows": [
    {
      "rowIndex": 0,
      "expense_item_code": "EXP000102",
      "expense_date": "2025-05-13",
      "expense_amount": "3404.69",
      "expense_currency": "CNY",
      "description": "通行费",
      "department_path_codes": "0780>0787>0953",
      "expense_department_path_code": "0780>0787>0953>1234",
      "attachments": [uploadedFile1]  // 原样传入上传返回的完整对象
    },
    {
      "rowIndex": 1,
      "expense_item_code": "EXP000103",
      "expense_date": "2025-05-14",
      "expense_amount": "200.00",
      "expense_currency": "CNY",
      "description": "餐饮费",
      "department_path_codes": "0780>0787>0953",
      "expense_department_path_code": "0780>0787>0953>1234",
      "attachments": [uploadedFile2]
    }
  ]
}
\`\`\`

---

## Attachments 关键规则

\`attachments\` 必须是上传返回的**完整原始对象**:

❌ **禁止**: 只取部分字段、从 URL 提取 id、用其他字段推断、做任何变换
✅ **正确**: 直接使用上传返回的完整对象,不做任何修改

---

## Notes

- **金额字段必须为字符串**: \`expense_amount\` 必须以字符串形式传入(如 \`"1234.56"\`),避免浮点精度丢失。
- **日期格式**: \`expense_date\` 必须为 \`yyyy-MM-dd\` 格式。
- **费用项目编码**: 必须从 \`getExpenseItems\` 返回的列表中选取有效的 \`code\`。
- **部门编码**: \`department_path_codes\` 和 \`expense_department_path_code\` 应从 \`getUserData\` 获取,确保与用户所属部门一致。
- **表头字段限制**: \`updateFormValues\` 只允许更新 \`title\` 和 \`has_electronic_certificate\`,其他表头字段(公司、部门、报销人、币种)由用户手动选择,AI 不可修改。

---

## Invoice Submission Guidelines (发票提交指南)

在填写报销单时,请注意以下发票提交要求:

### 纸质发票处理规则
- **无需粘贴**: 纸质发票不需要粘贴在报销单上
- **投递要求**: 将纸质发票和报销单(请勿折叠)装入自封袋内投递即可
- **投递时机**: 请打印已到达"多米投单"节点的报销单,并附上相关纸质报销发票,前往所在楼层的财务箱放置点扫码投递

### 电子发票处理规则
- **文件格式**: 电子发票请上传 **PDF** 或 **OFD** 格式的文件
- **无需打印**: 电子发票无需打印纸质版本

### 加班打车报销规则
- **可报销时间**: 加班打车可报销时间为 **21:30 以后**
- **时间依据**: 财务将以发票时间为准
- **网约车平台**: 网约车平台打车除电子发票外,另需在系统中附上**行程单**

### 团建费用报销规则
- **人数超过三名**: 需列出至少三名参与人员名字以及总参与人数
- **人数少于三名**: 照实填写参与人员名字和人数

**重要提醒**: 当用户上传发票或填写报销单时,AI 应根据发票类型和报销场景,主动提醒用户相关的提交要求。
`;
