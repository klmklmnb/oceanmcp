# Vacation (请假) Skill

查询当前用户的请假表单信息并提交请假申请。

## Capabilities

- **获取请假表单详情** — 调用审批中心接口，解密并返回当前用户的请假表单数据（含假期余额、可选假期类型等）。
- **提交请假申请** — 加密表单数据并提交到审批系统。

## Available Tools

### getVacationFormDetail (read)

获取并解密当前用户的请假表单详情。无需任何参数，接口会根据当前登录用户的身份自动返回对应数据。

**Parameters:** None.

**Key response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | 申请人姓名 |
| `domain` | string | 申请人域账号 |
| `orgPathTitle` | string | 组织路径 |
| `annualLeaveTotalBals` | number | 剩余年假天数 |
| `sickLeaveBals` | number | 剩余病假天数 |
| `leaveTypeList` | string[] | 可选假期类型代码列表 |
| `nextApprover` | string | 下一个审批人域账号 |
| `informedPerson` | string[] | 默认通知人列表 |

### submitVacationRequest (write)

提交请假申请。自动获取表单基础数据、加密并发送到审批系统。

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `leaveType` | string | yes | 假期类型代码，当前固定为 `"AnnL"`（年假） |
| `leaveStartDate` | string | yes | 请假开始时间，格式 `YYYY-MM-DD HH:mm`，只能选 10:00 / 15:00 / 19:00 |
| `leaveEndDate` | string | yes | 请假结束时间，格式 `YYYY-MM-DD HH:mm`，只能选 10:00 / 15:00 / 19:00，必须晚于开始时间 |
| `leaveReason` | string | yes | 请假原因（最多 400 字） |

## Leave Type Codes

| Code | Type |
|------|------|
| `AnnL` | 年假 |
| `SicLM` | 带薪病假 |
| `SicL` | 普通病假 |
| `PesL` | 事假 |
| `MarL` | 婚假 |
| `MacL` | 产检假 |
| `MatL` | 产假 |
| `PatL` | 陪产假 |
| `Pal` | 育儿假 |
| `FunL` | 丧假 |
| `AbL` | 流产假 |
| `FlHol` | Floating Holiday |
| `PesLM` | 带薪事假 |
| `Other` | 其他 |

## Usage Flow

```
getVacationFormDetail → 获取表单详情（假期余额、可选类型）
      ↓
向用户展示假期余额，询问：假期类型、起止日期、原因
      ↓
submitVacationRequest(leaveType, leaveStartDate, leaveEndDate, leaveReason)
```

### Step 1 — 获取表单详情

**Function:** `getVacationFormDetail`

调用接口获取当前用户的请假表单数据。向用户展示：
- 剩余年假天数 (`annualLeaveTotalBals`)
- 剩余病假天数 (`sickLeaveBals`)
- 可选假期类型（将代码翻译为中文）
- 审批人信息 (`nextApprover`)

### Step 2 — 通过对话收集用户输入

**重要：通过自然语言对话直接询问用户，不要渲染表单组件。**

只需在对话中向用户确认以下两项：
1. **请假起止日期** — 直接用文字询问用户，如"请问您想请几号到几号的假？是上午还是下午还是全天？"。时间只有三个时间点可选：**10:00**（上午开始）、**15:00**（下午开始）、**19:00**（当天结束）
2. **请假原因** — 直接问"请假原因是什么？"

以下字段自动填充，不需要询问用户：
- **假期类型** — 固定为年假（`AnnL`）
- **通知人** — 自动填充，优先取 `informedPerson`，为空时取 `parentDomain`（直属上级），不需要询问用户

#### 时间段与天数计算规则

每天分为两个半天，各计 **0.5 天**：

| 时间段 | 含义 | 计为 |
|--------|------|------|
| 10:00 ~ 15:00 | 上午 | 0.5 天 |
| 15:00 ~ 19:00 | 下午 | 0.5 天 |
| 10:00 ~ 19:00 | 全天 | 1 天 |

示例：
- 请假 3月17日 10:00 ~ 3月17日 15:00 = **0.5 天**（上午半天）
- 请假 3月17日 10:00 ~ 3月17日 19:00 = **1 天**（全天）
- 请假 3月17日 15:00 ~ 3月18日 15:00 = **1 天**（下午 + 次日上午）
- 请假 3月17日 10:00 ~ 3月19日 19:00 = **3 天**

在提交前需要向用户确认请假天数是否符合预期。

#### 余额校验

计算出请假天数后，**必须与对应假期类型的剩余余额进行比较**：

| 假期类型 | 余额字段 |
|----------|----------|
| 年假 (`AnnL`) | `annualLeaveTotalBals` |
| 病假 (`SicL` / `SicLM` / `SiclMH` / `SicLMC`) | `sickLeaveBals` |

- 如果请假天数 **超过** 剩余余额，必须**警告用户余额不足**，询问是否仍要提交。
- 示例：剩余年假 2 天，用户想请 3 天年假 → 告知用户"剩余年假仅 2 天，本次申请 3 天将超出余额，是否继续？"

### Step 3 — 提交申请

**Function:** `submitVacationRequest`

将用户输入作为参数调用此工具，自动完成加密和提交。

## Critical Rules

1. **必须先调用 `getVacationFormDetail`**，再调用 `submitVacationRequest`。需要先获取假期余额和可选类型。
2. **假期类型固定为 `AnnL`（年假）**，直接传入即可，无需询问用户。
3. **通过对话文字直接询问用户日期和原因，不要渲染表单组件**。假期类型固定为 `AnnL`，通知人自动填充（`informedPerson` 或 `parentDomain`），不需要询问用户。
4. **日期时间只有三个可选时间点**：10:00、15:00、19:00。10:00~15:00 为上午（0.5天），15:00~19:00 为下午（0.5天）。提交前需向用户确认请假天数。
5. **余额校验**：计算请假天数后，必须与对应假期类型的剩余余额对比。超出时警告用户并确认是否继续。
5. 假期类型代码需要翻译为中文展示给用户，参考上方 Leave Type Codes 表格。
6. 向用户展示假期余额时，重点展示**年假**和**病假**的剩余天数。
