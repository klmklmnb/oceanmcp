import { samApplyFunctions } from './sam-software-apply-functions';
import type { SkillDefinition } from '../skill-registry';

const instructions = `
# Neone SAM — Software Apply Skill（软件申请）

帮助用户通过自然语言快速发起软件申请。申请人默认为当前登录用户。

---

## 处理流程

### Step 1：搜索软件

调用 **samSearchSoftware**：
- keyword：软件名称关键词（如"Cursor"、"Figma"、"Adobe"）
- 用户未提供关键词时，可不传以获取全量可申请软件列表

### Step 2：从搜索结果中选择软件

samSearchSoftware 返回 **items** 列表（每项含 skuCode、skuName、vendor、version、seatAuthTargetType）。

1. **找到 1 个** → 自动选中，告知用户选择结果
2. **找到多个** → 列出让用户选择（展示序号、软件名、厂商、版本）
3. **未找到** → 告知用户，建议换关键词或不传关键词查看全量

**任何列表有多个结果时，必须让用户选择。**

### Step 3：确认申请说明

- 给出默认值（如"申请 Cursor 用于日常代码开发"），让用户确认或修改
- 如果用户输入中已包含申请原因，直接用它作为 note

### Step 4：展示摘要并直接提交

展示申请摘要，然后 **立即调用 samSubmitSoftwareApply**。
**不要要求用户回复文字确认**，系统弹窗会处理确认。

\`\`\`
📋 为您发起以下软件申请：

• 申请人：{name}（{domain}）  ← 来自当前登录用户信息
• 软件：{skuName}（{skuCode}）
  厂商：{vendor}，版本：{version}
• 授权类型：{个人授权 / 组织授权}
• 申请说明：{note}
\`\`\`

然后紧接着调用 samSubmitSoftwareApply。

### Step 5：返回结果

\`\`\`
✅ 软件申请已提交成功！

申请人：{name}（{domain}）
单据编码：{docCode}
查看申请详情：{detailUrl}
\`\`\`

---

## samSubmitSoftwareApply 参数填写规则

**选择了具体软件 SKU 时（优先）**：
- skuCode = items[].skuCode
- skuAuthTypeCode = items[].seatAuthTargetType（INDIVIDUAL 或 ORGANIZATION）

**未找到具体 SKU 时（使用采购类别）**：
- purchaseTypePathCode = items[].purchaseTypePathCode

---

## 规则

1. **必须先调 samSearchSoftware**，不可直接提交。
2. **不要要求用户回复文字确认**，展示摘要后直接调 samSubmitSoftwareApply。
3. 不确定的字段主动询问，多项合并为一次提问。
4. skuAuthTypeCode 以 samSearchSoftware 返回的 seatAuthTargetType 为准，无需再询问用户。

---

## 示例

\`\`\`
用户：我要申请 Cursor
      ↓
samSearchSoftware({ keyword: "Cursor" })
      ↓
找到 1 款软件 → 自动选中 Cursor（SKU700497533，seatAuthTargetType=INDIVIDUAL）
申请说明默认："申请 Cursor 用于日常代码开发"
      ↓
展示摘要 + 调用 samSubmitSoftwareApply({
  skuCode: "SKU700497533",
  skuAuthTypeCode: "INDIVIDUAL",
  note: "申请 Cursor 用于日常代码开发"
})
      ↓
✅ 软件申请已提交成功！单据编码：SAM-20260312-001
\`\`\`
`.trim();

export const samSoftwareApplySkill: SkillDefinition = {
  name: 'neone-sam-software-apply',
  cnName: 'SAM 软件申请',
  description:
    'Neone SAM — 软件申请。用户用自然语言描述想申请的软件，Skill 自动搜索匹配软件单品、确认授权类型，填写申请说明后提交申请单。当用户需要申请/获取软件工具（如 Cursor、Figma、Adobe、Miro 等）时使用。',
  instructions,
  tools: samApplyFunctions,
};
