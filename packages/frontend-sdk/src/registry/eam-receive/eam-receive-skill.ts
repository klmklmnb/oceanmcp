import { eamReceiveFunctions } from './eam-receive-functions';
import type { SkillDefinition } from '../skill-registry';

const instructions = `
# Neone EAM — Claim Apply Skill（资产领用申请）

帮助用户通过自然语言快速发起资产领用申请。支持为自己申请，也支持代他人申请。

---

## 资产用途推导规则（use_code）

| use_code | 中文名 | 触发关键词 |
|----------|--------|-----------|
| PERSONAL_OFFICE_EQUIPMENT | 个人办公专用设备 | **默认值**。显示器、笔记本、键盘、鼠标、耳机、硬盘、数位板等 |
| TEAM_EXCLUSIVE_EQUIPMENT | 组内专属设备 | "组内"、"团队"、"共享"、"测试设备" |
| FUNCTIONAL_ROOM_EQUIPMENT | 功能房设备 | "功能房"、"机房"、"动捕房"、"录音棚" |
| PUBLIC_AREA_EQUIPMENT | 公共区域设备 | "公共区域"、"会议室"、"公共" |

---

## 处理流程

### Step 0：判断是否代提

- 如果用户说"帮 xxx 申请..."/"为 xxx 申请..."/"给 xxx 领..."，需要先解析 xxx 的域账号
- 调用 **eamSearchUser** 传入 xxx 的名字
  - 唯一匹配 → 拿到 domain，后续所有接口使用该 domain
  - 多个匹配 → 展示列表让用户选择
  - 无匹配 → 告知用户未找到
- 如果用户没提到他人，则默认为自己申请（跳过此步）

### Step 1：推导资产用途 + 搜索

调用 **searchClaimAsset**：
- keyword：设备关键词
- useCode：推导出的 use_code
- claimByDomain：代提时传入被代提人域账号，自己申请时不传

### Step 2：从搜索结果中选择资产

searchClaimAsset 返回 **skuItems**（SKU 单品）和 **categoryItems**（采购类别）。

1. **skuItems 有结果时（优先）**：仅 1 个 → 自动选中；多个 → 列出让用户选择
2. **skuItems 为空但 categoryItems 有结果**：仅 1 个 → 自动选中；多个 → 列出让用户选择
3. **都为空**：告知用户暂无匹配，建议换关键词

**任何列表有多个结果时，必须让用户选择。**

### Step 3：查询可绑定的主设备

选中 SKU 后，调用 **queryParentAsset**：
- skuCode：选中的 SKU 编码
- domain：领用人域账号（代提时传被代提人域账号）

如果 assets 列表：
- **为空** → 无需绑定，跳过
- **有 1 台** → 自动选中
- **有多台** → 列出让用户选择（展示 assetNumber 和 configInfo）

### Step 4：确定收货地址

searchClaimAsset 已返回 receiptPlaces：
- **1 个地址**：自动使用
- **多个地址**：列出让用户选择
- **0 个地址**：可不填

### Step 5：如有需要用户选择或确认的信息，一次性询问

将所有待确认项**合并为一次提问**：
- 多个 SKU / 类别 → 让用户选择
- 多个主设备 → 让用户选择
- 多个收货地址 → 让用户选择
- 领用说明 → 给出默认值（如"申请显示器用于日常办公"），让用户确认或修改

如果所有项都有唯一值，跳过本步直接进入 Step 6。

### Step 6：展示摘要并直接提交

展示申请摘要，然后 **立即调用 submitClaimApply**。
**不要要求用户回复文字确认**，系统弹窗会处理确认。

\`\`\`
📋 为您发起以下领用申请：

• 申请人：{claimByUser.name}（{claimByUser.domain}）{代提时标注"（由 xxx 代提）"}
• 资产用途：{use_code 中文名}
• 申请资产：{skuName / categoryName}
  {品牌 / 型号 / 规格}
• 绑定主设备：{assetNumber || "无"}
• 申请数量：{quantity}
• 收货地址：{receiptPlaceName || "未填写"}
• 领用说明：{claimNote}
\`\`\`

然后紧接着调用 submitClaimApply，代提时传入 claimByDomain 和 claimByDepartment。

### Step 7：返回结果

\`\`\`
✅ 领用申请已提交成功！

单据编码：{code}
查看详情：{detailUrl}
\`\`\`

---

## submitClaimApply 参数填写规则

**选择了 SKU 时**：
- purchaseTypePathCode、skuCode、skuName、brand、model、specification

**选择了采购类别时**：
- purchaseTypePathCode（仅此一项）

**代提时额外传**：
- claimByDomain = 被代提人域账号
- claimByDepartment = 被代提人部门编码（来自 searchClaimAsset → claimByUser.department）

**绑定主设备时**：
- bindParentAssetNumber = 选中的主设备 assetNumber

---

## 领用说明生成规则

- 给出默认值（如"申请显示器用于日常办公"），在 Step 5 展示让用户确认或修改
- 如果用户输入中已包含原因，用它作为默认值

---

## 消歧规则（Disambiguation Flow）

当 **eamSearchUser** 返回多个匹配时：

\`\`\`json
{
  "success": true,
  "count": 2,
  "users": [...],
  "message": "找到 2 个匹配用户：\\n1. 张三 (san.zhang) — 部门A\\n2. 张三 (san.zhang2) — 部门B\\n请回复序号或域账号以确认。"
}
\`\`\`

**收到多用户结果时，你必须：**
1. 将 \`message\` 内容原样展示给用户
2. 等待用户回复（序号或域账号）
3. 从 \`users\` 中取对应项的 \`domain\`，用**具体值**重新调用业务工具

---

## 规则

1. **必须先调 searchClaimAsset**，不可跳过。
2. **选中 SKU 后必须调 queryParentAsset** 检查是否需绑定主设备。
3. **不要要求用户回复文字确认**，展示摘要后直接调 submitClaimApply。
4. 不确定的字段主动询问，多项合并为一次提问。
5. 代提时，所有接口的 domain 参数都要传被代提人的域账号。

---

## 示例

### 示例 1：为自己申请

\`\`\`
用户：我要申请一台显示器
      ↓
searchClaimAsset({ keyword: "显示器", useCode: "PERSONAL_OFFICE_EQUIPMENT" })
      ↓
选中 SKU → queryParentAsset({ skuCode: "SKU700497465" })
      ↓
有 2 台主设备 → 列出让用户选择
收货地址 2 个 → 列出让用户选择
领用说明默认："申请显示器用于日常办公"
      ↓
用户：选主设备 1、地址 A、领用说明用默认的
      ↓
展示摘要 + 调用 submitClaimApply
\`\`\`

### 示例 2：代他人申请

\`\`\`
用户：帮张三申请一台笔记本
      ↓
调用 eamSearchUser({ keyword: "张三" })
      ↓
唯一匹配：张三 (san.zhang) — 前端研发组
      ↓
searchClaimAsset({ keyword: "笔记本", claimByDomain: "san.zhang" })
      ↓
选中 SKU → queryParentAsset({ skuCode: "...", domain: "san.zhang" })
      ↓
展示摘要（标注"由当前用户代提"）+ 调用 submitClaimApply({
  claimByDomain: "san.zhang", claimByDepartment: "...", ...
})
\`\`\`
`.trim();

export const eamReceiveSkill: SkillDefinition = {
  name: 'neone-eam-receive',
  cnName: 'EAM 资产领用',
  description:
    'Neone EAM — 资产领用申请。用户用自然语言描述想申请的设备，自动搜索匹配资产、推导用途、查询主设备绑定、获取收货地址，确认后提交单据。支持代他人申请。当用户需要申请/领用设备（如显示器、笔记本、键盘、耳机等）时使用。',
  instructions,
  tools: eamReceiveFunctions,
};
