import CryptoJS from "crypto-js";
import dayjs from "dayjs";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type ExecutorFunctionDefinition,
  type FunctionDefinition,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// AES-ECB encrypt / decrypt (matches infopass setAse / getAse)
// ---------------------------------------------------------------------------

const ASE_SALT = "GGmoA8GRSB=+mXaF";
const AES_KEY = CryptoJS.enc.Utf8.parse(ASE_SALT);
const AES_OPTS = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };

function decryptAES(ciphertext: string): string {
  return CryptoJS.enc.Utf8.stringify(
    CryptoJS.AES.decrypt(ciphertext, AES_KEY, AES_OPTS),
  );
}

function encryptAES(plaintext: string): string {
  return CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(plaintext),
    AES_KEY,
    AES_OPTS,
  ).toString();
}

// ---------------------------------------------------------------------------
// API endpoints & headers
// ---------------------------------------------------------------------------

const API_BASE =
  "https://api-test.agw.mihoyo.com/paas-business-svc/out/v1/customer";

const GET_DETAIL_URL = `${API_BASE}/initiate/center/get_detail_encrypt`;
const START_PROCESS_URL = `${API_BASE}/detail/process/start_encrypt`;

const HEADERS: Record<string, string> = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN",
  "application-code": "241586b99f914d11",
  "cache-control": "no-cache",
  "content-type": "application/json",
  "pragma": "no-cache",
  "tenant-code": "2350647b374248f9",
  "x-from-approval-center": "Y",
  "x-mi-clientid": "91a350998e5f94a4",
  "x-paas-client": "pc",
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fetchFormDetail(): Promise<{
  formData: Record<string, any>;
  raw: Record<string, any>;
}> {
  const res = await fetch(GET_DETAIL_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ globalDefKey: "vacationForm" }),
    credentials: "include",
  }).then((r) => r.json());

  if (res.code !== 0) throw new Error(res.message);

  const encrypted = res.data?.formData;
  const formData =
    typeof encrypted === "string" ? JSON.parse(decryptAES(encrypted)) : {};
  return { formData, raw: res.data };
}

// ---------------------------------------------------------------------------
// Leave type code → Chinese name mapping
// ---------------------------------------------------------------------------

const LEAVE_TYPE_NAME: Record<string, string> = {
  AnnL: "年假",
  SicLM: "带薪病假",
  SicL: "普通病假",
  SicLMC: "covid假",
  SiclMH: "带薪病假（住院）",
  PesL: "事假",
  PesLM: "带薪事假",
  MarL: "婚假",
  MacL: "产检假",
  MatL: "产假",
  PatL: "陪产假",
  Pal: "育儿假",
  FunL: "丧假",
  AbL: "流产假",
  adL: "领养假",
  JuL: "陪审团假",
  PhL: "生理假",
  FlHol: "Floating Holiday",
  DptL: "难孕治疗假",
  Msl: "兵役假",
  Ecl: "育儿假（延长）",
  ElCL: "陪护假",
  Other: "其他",
};

// ---------------------------------------------------------------------------
// Calculate leave days from start/end (each half-day slot = 0.5)
// Valid time points: 10:00, 15:00, 19:00
//   10:00→15:00 = morning slot (0.5)
//   15:00→19:00 = afternoon slot (0.5)
// Returns { weekday (excludes Sat/Sun), naturalDay (all days) }
// ---------------------------------------------------------------------------

function hourToSlot(h: number): number {
  if (h >= 19) return 2;
  if (h >= 15) return 1;
  return 0;
}

function calcLeaveDays(
  start: string,
  end: string,
): { weekday: number; naturalDay: number } {
  const s = dayjs(start, "YYYY-MM-DD HH:mm");
  const e = dayjs(end, "YYYY-MM-DD HH:mm");
  const startSlot = hourToSlot(s.hour());
  const endSlot = hourToSlot(e.hour());

  let naturalDay = 0;
  let weekday = 0;
  let cur = s.startOf("day");
  let curSlot = startSlot;
  const endDay = e.startOf("day");

  while (cur.isBefore(endDay) || cur.isSame(endDay, "day")) {
    const isEnd = cur.isSame(endDay, "day");
    const dayEnd = isEnd ? endSlot : 2;
    const slots = dayEnd - curSlot;

    if (slots > 0) {
      const half = slots * 0.5;
      naturalDay += half;
      const dow = cur.day();
      if (dow !== 0 && dow !== 6) weekday += half;
    }

    if (isEnd) break;
    cur = cur.add(1, "day");
    curSlot = 0;
  }

  return { weekday, naturalDay };
}

function collectUserList(form: Record<string, any>, extra: string[]): string[] {
  const set = new Set<string>();
  const pick = (v: unknown) => {
    if (typeof v === "string" && v) set.add(v);
    if (Array.isArray(v)) v.forEach((i) => typeof i === "string" && i && set.add(i));
  };
  pick(form.domain);
  pick(form.operator);
  pick(form.nextApprover);
  pick(form.reserveLeader);
  pick(form.parentDomain);
  pick(form.bp);
  pick(form.informedPerson);
  pick(form.actualNotify);
  extra.forEach((u) => set.add(u));
  return [...set];
}

// ---------------------------------------------------------------------------
// Tool: getVacationFormDetail
// ---------------------------------------------------------------------------

function makeGetVacationFormDetail(): ExecutorFunctionDefinition {
  return {
    id: "getVacationFormDetail",
    name: "Get Vacation Form Detail",
    cnName: "获取请假表单详情",
    description:
      "Fetch and decrypt the vacation (leave) form detail for the current user. Returns the decrypted form data including employee info, available leave types, remaining leave balances, and approval chain. Must be called before submitVacationRequest.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    autoApprove: true,
    parameters: [],
    executor: async () => {
      const { formData } = await fetchFormDetail();
      return formData;
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: submitVacationRequest
// ---------------------------------------------------------------------------

function makeSubmitVacationRequest(): ExecutorFunctionDefinition {
  return {
    id: "submitVacationRequest",
    name: "Submit Vacation Request",
    cnName: "提交请假申请",
    description:
      "Submit a vacation (leave) request. Encrypts the form data and sends it to the approval system. Must call getVacationFormDetail first to obtain leaveTypeList and balances, then ask the user for leaveType, dates, and reason before calling this tool.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    parameters: [
      {
        name: "leaveType",
        type: PARAMETER_TYPE.STRING,
        description:
          'Leave type code. Currently fixed to "AnnL" (年假). Pass "AnnL".',
        required: true,
      },
      {
        name: "leaveStartDate",
        type: PARAMETER_TYPE.STRING,
        description:
          'Leave start datetime in "YYYY-MM-DD HH:mm" format. Only three time points are valid: 10:00 (morning start), 15:00 (afternoon start), 19:00 (next-day start). Example: "2026-03-17 10:00".',
        required: true,
      },
      {
        name: "leaveEndDate",
        type: PARAMETER_TYPE.STRING,
        description:
          'Leave end datetime in "YYYY-MM-DD HH:mm" format. Only three time points are valid: 10:00 (before morning), 15:00 (morning end), 19:00 (full-day end). Must be after leaveStartDate. Example: "2026-03-18 19:00".',
        required: true,
      },
      {
        name: "leaveReason",
        type: PARAMETER_TYPE.STRING,
        description: "Reason for the leave request (max 400 characters).",
        required: true,
      },
      {
        name: "informedPerson",
        type: PARAMETER_TYPE.STRING,
        description:
          'Comma-separated domain names of people to notify (e.g. "alice.wang,bob.li"). Only required if getVacationFormDetail returned an empty informedPerson list.',
        required: false,
      },
    ],
    executor: async (args: Record<string, any>) => {
      const { formData } = await fetchFormDetail();

      let informed: string[];
      if (args.informedPerson) {
        informed = (args.informedPerson as string).split(",").map((s: string) => s.trim());
      } else if (Array.isArray(formData.informedPerson) && formData.informedPerson.length > 0) {
        informed = formData.informedPerson;
      } else {
        informed = formData.nextApprover ? [formData.nextApprover] : [];
      }

      const { weekday, naturalDay } = calcLeaveDays(args.leaveStartDate, args.leaveEndDate);
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);

      const merged: Record<string, any> = {
        ...formData,
        leaveType: args.leaveType,
        leaveTypeName: LEAVE_TYPE_NAME[args.leaveType] ?? args.leaveType,
        leaveTypeCode: args.leaveType,
        leaveStartDate: args.leaveStartDate,
        leaveEndDate: args.leaveEndDate,
        weekday,
        naturalDay,
        leaveReason: args.leaveReason,
        informedPerson: informed,
        actualNotify: informed.length > 0
          ? informed
          : formData.nextApprover ? [formData.nextApprover] : [],
        leaveDateHiddenField: `请假日期：${args.leaveStartDate}~${args.leaveEndDate}`,
        applyDate: now,
      };

      const FIELDS_TO_REMOVE = [
        "operator",
        "stash_manual_notify_list",
        "process_instance_id",
        "task_id",
        "time",
        "update_time",
        "is_deleted",
      ];
      for (const key of FIELDS_TO_REMOVE) delete merged[key];

      const encryptedFormData = encryptAES(JSON.stringify(merged));

      const userList = collectUserList(merged, informed);

      const body = {
        category: "",
        processInstanceName: "请假",
        globalDefKey: "vacationForm",
        globalVersion: 25,
        formData: encryptedFormData,
        extendIn: {
          orgList: formData.orgPath ? [formData.orgPath] : [],
          userList,
          fileIdMappingList: [],
        },
        manualNotifyList: [],
        startFieldConfig: "",
      };

      const res = await fetch(START_PROCESS_URL, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
        credentials: "include",
      }).then((r) => r.json());

      if (res.code !== 0) throw new Error(res.message);
      return res.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Export all vacation functions
// ---------------------------------------------------------------------------

export const vacationFunctions: FunctionDefinition[] = [
  makeGetVacationFormDetail(),
  makeSubmitVacationRequest(),
];
