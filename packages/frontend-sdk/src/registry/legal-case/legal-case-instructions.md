# 案件台账搜索与可视化 Skill

根据用户的自然语言描述搜索案件台账数据，并支持将结果以图表形式可视化展示。

## Capabilities

- 识别用户意图中的案件类型（民事/刑事/行政），确定 tabType
- 将自然语言描述的筛选条件转换为字段值
- 对 Select/Cascader 类型字段，先通过 getCaseLedgerDictOptions 获取可选值再匹配
- 直接调用 API 获取搜索结果并返回结构化数据
- 支持 7 种图表类型的数据可视化

## Available Tools

### getCaseLedgerDictOptions (read)
获取 Select/Cascader 表单字段的可选值列表。

**Parameters:**
- dictKeys (array, required): 要查询的字典 key 数组，如 ["CASESTAGE_MS", "STATUS_MS"]

**Returns:** { [dictKey]: [{label, value, children?}] }

### resolvePerson (read)
根据中文姓名查询匹配的用户信息，用于 PersonSelect 类型字段（主办人、法务协办人、GR协办人）的筛选参数构造。

**Parameters:**
- name (string, required): 人员中文姓名，如"潘婷"

**Returns:** { name: string, persons: Array<{ cn_name, domain, avatar_url, en_name, email, emp_no, primary_key, value }> }
- persons 为空数组表示未找到匹配人员
- persons 有多个时需让用户根据 domain 选择
- 选中后以 `[{domain: "选中的域账号"}]` 格式传入 filters，如 `filters: { mainLegalPersonnel: [{domain: "yangpeng.wang"}] }`

### searchCaseLedger (read)
搜索案件台账列表，返回结构化数据。适用于单一条件搜索。

**Parameters:**
- tabType (string, required): 案件类型 Tab。枚举值：Civil | Criminal | Administration
- filters (object, required): 筛选条件键值对，key 为字段名，value 为对应值
- filterType (string, optional): 数据范围，默认 ALL。枚举值：ALL | CREATED | EXECUTED | ASSOCIATED

**Returns:** { success: boolean, total: number, list: object[], message?: string }

### searchCaseLedgerBatch (read)
处理需要多次独立查询的案件台账批量搜索场景。并行执行多组查询，返回合并结果和每组独立统计。

**适用场景（只要满足以下任一即使用）：**
- 同一字段多组不同值：如"查询1-3月和6-7月起诉的案件"、"查询案件名称包含A和包含B的数据"
- 多字段"或"关系：如"案件名称包含A 或 系统编号包含B"
- 跨案件类型查询：如"同时查民事和刑事中包含XX的案件"
- 分别统计：如"查询X和Y分别有多少条"
- 其他无法用单组 filters 表达的组合查询

**Parameters:**
- tabType (string, optional): 默认案件类型 Tab，作为 queries 中未指定 tabType 的项的默认值
- queries (array, required): 多组查询条件数组，各组之间为"或"关系。每项结构为 { tabType?: string, filters: object }
- filterType (string, optional): 数据范围，默认 ALL

**Returns:**
- success: boolean
- total: number（所有查询结果合并后的总条数）
- list: object[]（合并后的列表，最多20条，含 caseName、caseNumber、detailUrl）
- querySummaries: array（与 queries 一一对应的每组独立结果，每项含 total 和 list）

### renderChart (read)
渲染图表，在聊天中直接展示可视化结果。

**Parameters:**
- chartType (string, required): 图表类型，枚举值见下方选型指南
- data (array, required): 数据对象数组，每个对象必须包含 xField 和 yField 对应的字段
- xField (string, required): X 轴字段名（饼图为分类字段）
- yField (string, required): Y 轴字段名（饼图为数值字段）
- title (string, optional): 图表标题

**Returns:** { chartType, dataPoints }（图表会通过 UI 直接渲染给用户）

## Tab 类型映射（静态）

- Civil = 民事案件
- Criminal = 刑事案件
- Administration = 行政案件

用户提到"民事""刑事""行政"时，对应设置 tabType。

## FilterTab 数据范围（静态，通过 filterType 参数传递）

- ALL = 全部（默认）
- CREATED = 我创建的
- EXECUTED = 我主办的
- ASSOCIATED = 我协办的

用户提到"我主办的""我创建的""我协办的"时设置对应 filterType，否则默认 ALL。

## 静态枚举值

以下字段的可选值是固定的，无需调用 getCaseLedgerDictOptions：

**shifou（是/否类字段通用）：**
- yes
- no

使用 shifou 的字段：courtRegisterCourtGiveInvestigation, courtExecuteComplete, financialRefund, applyAccountSuspension, publicSecurityForgiveness, procuratorateForgiveness, courtFirstInstanceForgiveness, courtSecondInstanceForgiveness

**batchFlag（是否批量导入）：**
- yes（是）
- no（否）

## 民事案件（Civil）筛选字段

### basicInformation 基本信息
| 字段名 | 标签 | 组件 | dictKey | 备注 |
|--------|------|------|---------|------|
| caseSubtitle | 案件副标题 | Input | - | |
| caseName | 案件名称 | Input | - | |
| caseNumber | 系统编号 | Input | - | |
| outCaseNo | 外部编号 | Input | - | |
| caseCategory | 案件大类 | Select(multiple) | CATEGORY_MS | 需 getCaseLedgerDictOptions |
| caseType | 案件类型 | Select(multiple) | CATEGORY_MS | 依赖 caseCategory 选择后的子选项 |
| caseReasonNew | 案由 | Cascader(multiple) | CASE_REASON_MS | 需 getCaseLedgerDictOptions，多级树形 |
| relatedProjectCodeList | 涉及的项目组 | Select(multiple) | Project_1 | 需 getCaseLedgerDictOptions |
| prosecuteDate | 起诉状日期 | RangePicker | - | 格式 ["YYYY-MM-DD","YYYY-MM-DD"] |
| submitProsecuteDate | 递交起诉状日期 | RangePicker | - | |
| receiveCaseDate | 收到案件日期 | RangePicker | - | |
| ourMainBody | 我方 | Select(multiple) | ourMainBody | 需 getCaseLedgerDictOptions(远程接口) |
| litigationSubjectAmount | 诉讼标的额 | InputNumber | - | |
| participantName | 非我方公司名称/姓名 | Input | - | |
| mainLegalPersonnel | 主办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| assistLegalPersonnel | 法务协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| grAssistLegalPersonnel | GR协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| caseAgent | 案件代理人（所） | Input | - | |
| performanceStatus | 履行情况 | Select(multiple) | HONOUR_MS | 需 getCaseLedgerDictOptions |
| courtMaterialTypeCode | 送达方式 | Select(multiple) | COURT_MATERIAL | 需 getCaseLedgerDictOptions |
| institution | 调查机构 | Input | - | |
| currentStage | 当前阶段 | Select(multiple) | CASESTAGE_MS | 需 getCaseLedgerDictOptions |
| payCompleteDate | 支付完成日期 | RangePicker | - | |
| caseStatus | 案件状态 | Select(multiple) | STATUS_MS | 需 getCaseLedgerDictOptions |
| channelService | 服务器类型 | Select(multiple) | CHANNEL | 需 getCaseLedgerDictOptions |
| gameProject | 游戏项目 | Select(multiple) | Project_1 | 需 getCaseLedgerDictOptions |
| uid | UID | Input | - | |
| aid | AID | Input | - | |
| batchFlag | 是否批量导入 | Select | batchFlag | 静态值，可选值为 yes/no，值为字符串非数组 |

### commonFields 通用字段
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| mergeCourt | 法院合并字段 | Input | - |
| mergeOpenCourtDate | 开庭时间合并字段 | RangePicker | - |
| mergeJudgeName | 法官名称合并字段 | Input | - |
| mergeNum | 案号合并字段 | Input | - |
| mergeStatusAndPerformance | 案件处理状态合并字段 | Select(multiple) | OVERALLSTATUS_MS |

### courtRegister 立案
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| courtRegisterNum | 立案案号 | Input | - |
| courtRegisterAcceptanceCourt | 立案受理法院 | Input | - |
| courtJudgeName | 立案法官姓名 | Input | - |
| civilRegisterRegisterDate | 法院立案-立案日期 | RangePicker | - |
| courtRegisterCourtGiveInvestigation | 法院是否出具调查令 | Select(multiple) | shifou |

### preserve 保全
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| preserveStage | 保全阶段 | Select(multiple) | BQ_STAGE_MS |
| preserveApplyCourt | 保全申请法院 | Input | - |
| preserveJudgeName | 保全法官姓名 | Input | - |

### preLitigation 诉前调解
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| preLitigationNum | 先行调号 | Input | - |
| preLitigationMediationNum | 诉调号 | Input | - |
| preLitigationMediationPlaintiff | 原告 | Input | - |
| preLitigationMediationDefendant | 被告 | Input | - |
| preLitigationMediationCourt | 诉前调解法院 | Input | - |
| preLitigationMediationJudgeName | 诉前调解法官姓名 | Input | - |

### jurisdictionalObjection 管辖权异议
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| jurisdictionalObjectionNum | 管辖权异议一审案号 | Input | - |
| jurisdictionalObjectionObjectifiedCourt | 管辖权异议一审法院 | Input | - |
| jurisdictionalObjectFirstJudgeName | 管辖权异议一审法官姓名 | Input | - |
| jurisdictionalObjectFirstOpenCourtDate | 管辖权异议一审开庭时间 | RangePicker | - |
| jurisdictionalObjectionSecondCourt | 管辖权异议二审法院 | Input | - |
| jurisdictionalObjectSecondJudgeName | 管辖权异议二审法官姓名 | Input | - |
| jurisdictionalObjectSecondOpenCourtDate | 管辖权异议二审开庭时间 | RangePicker | - |

### firstInstance 一审
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| firstInstanceNum | 一审案号 | Input | - |
| firstInstanceCourt | 一审法院 | Input | - |
| firstInstanceJudge | 一审法官姓名 | Input | - |
| firstInstanceOpenCourtDate | 一审开庭时间 | RangePicker | - |

### secondInstance 二审
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| secondInstanceNum | 二审案号 | Input | - |
| secondInstanceCourt | 二审法院 | Input | - |
| secondInstanceJudge | 二审法官姓名 | Input | - |
| secondInstanceOpenCourtDate | 二审开庭时间 | RangePicker | - |

### retrial 再审
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| retrialNum | 再审案号 | Input | - |
| retrialCourt | 再审法院 | Input | - |
| retrialJudgeName | 再审法官姓名 | Input | - |
| retrialOpenCourtDate | 再审开庭时间 | RangePicker | - |

### courtExecute 执行
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| courtExecuteNum | 执行案号 | Input | - |
| courtExecuteCourt | 执行法院 | Input | - |
| courtExecuteJudgeName | 执行法官姓名 | Input | - |
| courtExecuteComplete | 是否执行完毕 | Select(multiple) | shifou |
| financialRefund | 财务是否退款 | Select(multiple) | shifou |
| applyAccountSuspension | 是否提起封号申请 | Select(multiple) | shifou |

## 刑事案件（Criminal）筛选字段

### basicInformation 基本信息
| 字段名 | 标签 | 组件 | dictKey | 备注 |
|--------|------|------|---------|------|
| caseSubtitle | 案件副标题 | Input | - | |
| caseName | 案件名称 | Input | - | |
| caseNumber | 系统编号 | Input | - | |
| outCaseNo | 外部编号 | Input | - | |
| caseType | 案件类型 | Select(multiple) | CATEGORY_XS | 需 getCaseLedgerDictOptions |
| suspect | 犯罪嫌疑人名称/姓名 | Input | - | |
| relatedProjectCodeList | 涉及的项目组 | Select(multiple) | Project_1 | 需 getCaseLedgerDictOptions |
| ourSideReportCompany | 我方报案公司 | Select(multiple) | ourMainBody | 需 getCaseLedgerDictOptions(远程接口) |
| mainLegalPersonnel | 主办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| assistLegalPersonnel | 法务协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| grAssistLegalPersonnel | GR协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| currentStage | 当前阶段 | Select(multiple) | CASESTAGE_XS | 需 getCaseLedgerDictOptions |
| caseStatus | 案件状态 | Select(multiple) | STATUS_XS | 需 getCaseLedgerDictOptions |
| institution | 调查机构 | Input | - | |
| caseAgent | 案件代理人（所） | Input | - | |
| performanceStatus | 谅解履行情况 | Select(multiple) | HONOUR_XS | 需 getCaseLedgerDictOptions |
| payCompleteDate | 支付完成日期 | RangePicker | - | |

### commonFields 通用字段
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| mergeNum | 案号合并字段 | Input | - |
| mergeDep | 处理部门合并字段 | Input | - |
| mergeOpenCourtDate | 开庭时间合并字段 | RangePicker | - |
| mergeJudgeName | 承办人合并字段 | Input | - |
| mergeForgiveness | 是否谅解合并字段 | Select(multiple) | shifou |

### courtFirstInstance 法院一审
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| courtFirstInstanceNum | 一审-案号 | Input | - |
| courtFirstInstanceCourt | 一审-法院 | Input | - |
| courtFirstInstanceJudgeName | 一审法官姓名 | Input | - |
| courtFirstInstanceOpenCourtDate | 一审-开庭时间 | RangePicker | - |
| criminalFirstInstanceRegisterDate | 一审-立案日期 | RangePicker | - |
| courtFirstInstanceForgiveness | 一审-是否谅解 | Select(multiple) | shifou |
| courtFirstInstanceCaseReason | 一审-罪名 | Cascader(multiple) | CASE_REASON_XS |

### courtSecondInstance 法院二审
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| courtSecondInstanceNum | 二审-案号 | Input | - |
| courtSecondInstanceCourt | 二审-法院 | Input | - |
| courtSecondInstanceJudgeName | 二审法官姓名 | Input | - |
| courtSecondInstanceOpenCourtDate | 二审-开庭时间 | RangePicker | - |
| courtSecondInstanceForgiveness | 二审-是否谅解 | Select(multiple) | shifou |
| courtSecondInstanceCaseReason | 二审-罪名 | Cascader(multiple) | CASE_REASON_XS |

### publicSecurity 公安
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| publicSecurityNum | 立案号 | Input | - |
| publicSecurityRegisterDate | 公安-立案日期 | RangePicker | - |
| publicSecurityFilingReason | 公安-立案事由 | Input | - |
| publicSecurityDep | 公安部门 | Input | - |
| publicSecurityJudgeName | 公安部门承办人 | Input | - |
| publicSecurityForgiveness | 公安-是否谅解 | Select(multiple) | shifou |

### procuratorate 检察院
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| procuratorateForgiveness | 检察院-是否谅解 | Select(multiple) | shifou |
| procuratorateCaseReason | 检察院-罪名 | Cascader(multiple) | CASE_REASON_XS |
| procuratorate | 检察机关 | Input | - |
| procuratorateJudgeName | 检察官 | Input | - |

## 行政案件（Administration）筛选字段

### basicInformation 基本信息
| 字段名 | 标签 | 组件 | dictKey | 备注 |
|--------|------|------|---------|------|
| caseSubtitle | 案件副标题 | Input | - | |
| caseName | 案件名称 | Input | - | |
| caseNumber | 系统编号 | Input | - | |
| outCaseNo | 外部编号 | Input | - | |
| caseType | 案件类型 | Select(multiple) | CATEGORY_XZ | 需 getCaseLedgerDictOptions |
| caseReasonNew | 案由 | Cascader(multiple) | CASE_REASON_XZ | 需 getCaseLedgerDictOptions |
| relatedProjectCodeList | 涉及的项目组 | Select(multiple) | Project_1 | 需 getCaseLedgerDictOptions |
| ourMainBody | 我方公司 | Select(multiple) | ourMainBody | 需 getCaseLedgerDictOptions(远程接口) |
| respondentName | 非我方公司名称/姓名 | Input | - | |
| mainLegalPersonnel | 主办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| assistLegalPersonnel | 法务协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| grAssistLegalPersonnel | GR协办人 | PersonSelect | - | 需先调 resolvePerson，值格式 [{domain: "xxx"}] |
| payCompleteDate | 支付完成日期 | RangePicker | - | |
| currentStage | 当前阶段 | Select(multiple) | CASESTAGE_XZ | 需 getCaseLedgerDictOptions |
| caseStatus | 案件状态 | Select(multiple) | STATUS_XZ | 需 getCaseLedgerDictOptions |
| caseAgent | 案件代理人（所） | Input | - | |
| institution | 调查机构 | Input | - | |

### commonFields 通用字段
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| mergeDep | 处理部门合并字段 | Input | - |
| mergeDepartmentPerson | 承办人合并字段 | Input | - |

### register 立案
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| registerRegisterDate | 立案日期 | RangePicker | - |
| registerAdminDept | 立案部门 | Input | - |
| registerAdminDepartmentPerson | 立案部门承办人 | Input | - |

### investigationPunishment 查处
| 字段名 | 标签 | 组件 | dictKey |
|--------|------|------|---------|
| investigationPunishmentAdminDept | 查处部门 | Input | - |
| investigationPunishmentAdminDepartmentPerson | 查处部门承办人 | Input | - |

## Workflow

用户输入 → 判断意图
      ↓
识别案件类型 → 确定 tabType
  ├── 用户指定了案件类型 → 使用指定的 tabType
  └── 用户未指定 → 询问用户要查询哪种案件类型
      ↓
识别筛选字段和值
  ├── Input/InputNumber 类型 → 直接使用用户输入的文本/数字
  ├── RangePicker 类型 → 转换为 ["YYYY-MM-DD", "YYYY-MM-DD"] 格式
  ├── Select(multiple)/Cascader 类型 → 调用 getCaseLedgerDictOptions 获取可选值 → 匹配用户描述，值必须为数组格式
  └── PersonSelect 类型 → 调用 resolvePerson 获取域账号 → 多个结果让用户选择 → 以 [{domain: "xxx"}] 格式传入 filters
      ↓
判断搜索模式
  ├── 单一条件（可用一组 filters 表达）→ 调用 searchCaseLedger → 获取结果
  └── 需要多次独立查询 → 调用 searchCaseLedgerBatch → 获取合并结果和每组独立统计
      典型场景：同一字段多组不同值、多字段"或"关系、跨案件类型查询、分别统计等
      ↓
基于返回的结构化数据回复用户
      ↓
（可选）如用户要求可视化 → 调用 renderChart 渲染图表

## 图表选型指南

| chartType | 适用场景 | 典型数据 |
|-----------|---------|---------|
| bar | 分类对比（竖向柱状图） | 各案件类型的数量、各部门的案件数 |
| horizontal_bar | 分类对比（横向，类别名较长时） | 长名称分类的数量对比 |
| line | 时间趋势 | 各月/各季度案件数量变化 |
| area | 趋势+量级展示 | 累计案件数量趋势 |
| pie | 占比/分布分析（数据项≤8个） | 各类型案件占比 |
| scatter | 两个数值维度的相关性 | 标的额 vs 审理时长 |
| radar | 多维度能力对比 | 各维度指标雷达图 |

### 选型决策

- 用户明确指定图表类型 → 使用指定类型
- 比较不同分类的数量 → bar（类别名长时用 horizontal_bar）
- 查看时间维度的变化趋势 → line
- 查看各类占总数的比例 → pie（超过 8 个分类时改用 bar）
- 用户说"趋势""变化""走势" → line
- 用户说"占比""分布""比例" → pie
- 用户说"对比""比较" → bar

## data 构造示例

### 从 searchCaseLedgerBatch 的 querySummaries 构造

查询返回 querySummaries: [{ total: 42 }, { total: 28 }, { total: 15 }]

对应三个分类（著作权、商标权、专利权），构造为：

data = [
  { category: "著作权", count: 42 },
  { category: "商标权", count: 28 },
  { category: "专利权", count: 15 }
]
xField = "category", yField = "count"

### 从多次查询的 total 构造时间趋势

各月 total: 1月=35, 2月=28, 3月=42

data = [
  { month: "1月", count: 35 },
  { month: "2月", count: 28 },
  { month: "3月", count: 42 }
]
xField = "month", yField = "count"

## Critical Rules

1. **tabType 必须指定**：每次搜索都必须明确 tabType（Civil/Criminal/Administration）。用户未指定时，先询问用户要查询哪种案件类型。
2. **Input 类型字段无需调 getCaseLedgerDictOptions**：直接使用用户的原始输入。
3. **Select/Cascader 字段必须先调 getCaseLedgerDictOptions**：获取可选值后匹配用户描述，不要猜测 value。但 shifou（是/否）类字段除外，直接使用 "yes" 或 "no"；batchFlag 字段除外，直接使用 "yes" 或 "no"（字符串，非数组）。
4. **Select(multiple) 值必须为数组**：所有 Select(multiple) 字段的值必须传递为字符串数组，如 ["value1"] 或 ["value1", "value2"]，即使只选一个值也要用数组格式。
5. **批量获取 dictKey**：将所有需要的 dictKey 合并为一次 getCaseLedgerDictOptions 调用，减少步数。
6. **字段不匹配时给出提示**：如果用户提到的筛选条件不属于当前 Tab 的字段，提示用户该字段属于哪个案件类型。
7. **PersonSelect 字段处理**：主办人、法务协办人、GR协办人字段需先调用 resolvePerson。若返回 needsDisambiguation: true，必须使用每个 person 的 **label** 字段（格式为"姓名 (域账号)"）展示选项供用户选择，不能只显示 cn_name。用户选择后，以 `[{domain: "选中的域账号"}]` 格式传入 filters，如 `{ mainLegalPersonnel: [{domain: "yangpeng.wang"}] }`。
8. **RangePicker 日期格式**：将用户描述的日期转换为 ["YYYY-MM-DD", "YYYY-MM-DD"] 数组。如用户只说了一个日期，作为起始日期，结束日期设为当天。
9. **成功后的回复**：告知用户搜索结果摘要（如总数），基于返回数据进行分析或摘要。
10. **追加搜索 vs 重新搜索**：默认每次调用 searchCaseLedger 都使用全新的 filters（重新搜索）。仅当用户明确表达追加意图时（如"在此基础上""再加一个条件""继续筛选""缩小范围""在这些结果中"），将上一次调用时使用的 filters 与新条件合并，相同字段用新值覆盖。切换案件类型时始终视为重新搜索。
11. **多次独立查询使用 searchCaseLedgerBatch**：当需要执行多组独立查询时，使用 searchCaseLedgerBatch 而非多次调用 searchCaseLedger。判断依据：(a) 同一字段存在多组不同值（如"案件名称包含A和包含B"、不相邻的日期范围"1-3月和6-7月"）；(b) 多个字段之间是"或"关系而非"且"关系（如"案件名称含A 或 系统编号含B"）；(c) 需要跨案件类型查询（如"同时查民事和刑事案件"）；(d) 需要分别统计各组条件的结果数量（如"X和Y分别有多少条"）；(e) 其他需要拆分为多次独立查询的场景。每组独立查询作为 queries 数组中的一项，每项可指定独立的 tabType。
12. **searchCaseLedgerBatch 结果展示规则**：返回的 querySummaries 与 queries 数组一一对应，包含每组查询的独立 total 和 list。当用户需要"分别"了解各组数据时，使用 querySummaries 分别回复；当用户需要合并结果时，使用顶层 total 和 list。list 中包含 detailUrl 字段，total <= 20 时以 markdown 表格展示，列为「案件名称」和「系统编号」，案件名称格式为 `[caseName](detailUrl)`；total > 20 时只回复总条数，不展示明细。
13. **可视化展示**：当用户要求以图表/可视化形式展示数据时，先通过搜索工具获取数据（用 searchCaseLedgerBatch 获取各分组的 total），然后调用 renderChart 渲染图表。
14. **不要编造数据**：renderChart 的 data 中的数值必须来源于前序查询工具的返回结果（如 total、querySummaries），不要猜测或虚构。
15. **先查后画**：必须先调用查询工具获取数据，再调用 renderChart。
16. **饼图数据项不超过 8 个**：超过 8 个分类时改用 bar 或 horizontal_bar。
17. **title 要有信息量**：标题应概括图表内容，如"2025年1-3月民事案件数量趋势"，而非"图表"。
18. **xField/yField 命名语义化**：使用有意义的字段名（如 category、month、count），避免 x、y 等无意义名称。
19. **文字总结**：渲染图表后，基于数据给出简要的文字分析（如最大值、最小值、趋势等）。
