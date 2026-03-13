import { cpsApiClient } from "./api";

export interface ReimburseListParams {
  amount_min?: string;
  amount_max?: string;
  apply_time_start?: string;
  apply_time_end?: string;
  applicant_list?: string[];
  created_by_list?: string[];
  code_list?: string[];
  travel_doc_code_list?: string[];
  state?: string;
  page: number;
  page_size: number;
}

export interface ReimburseItem {
  id: string;
  code: string;
  title: string;
  amount: string;
  currency: string;
  apply_time: string;
  state: string;
  state_name: string;
  [key: string]: unknown;
}

export interface ReimburseListResponse {
  list: ReimburseItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 获取报销单列表
 */
export const fetchReimburseList = async (
  params: ReimburseListParams
): Promise<ReimburseListResponse> => {
  return await cpsApiClient.post("/reimbursement/list", params);
};

/**
 * 获取费用项目列表
 */
export const fetchExpenseItems = async () => {
  return await cpsApiClient.get("/expense/item/list");
};

export interface ReimburseRow {
  expense_item_code?: string;
  expense_date?: string;
  expense_amount?: string;
  expense_currency?: string;
  description?: string;
  department_path_codes?: string;
  expense_department_path_code?: string;
  benefit_center_code?: string;
  attachments?: unknown[];
  [key: string]: unknown;
}

export interface ReimburseAddParams {
  title?: string;
  offset_petty_cash?: Record<string, unknown>;
  operate: 'save' | 'submit';
  // 银行卡信息
  payee: string; // 收款方（必填）
  bank_no: string; // 银行卡号（必填）
  bank_account: string; // 收款方账号/开户名（必填）
  bank_branch?: string; // 支行名称
  bank_clearing_code?: string; // 本地清算代码
  bank_province?: string; // 省州
  bank_city?: string; // 城市
  bank_nation?: string; // 收款行国家/地区
  bank_nation_code?: string; // 国家/地区代码
  // 报销信息
  applicant: string;
  company_code: string;
  department_code: string;
  description?: string;
  attachment_list?: unknown[];
  rem_type: string;
  travel_doc_code?: string;
  has_electronic_certificate?: string | null;
  rows: ReimburseRow[];
  inform_users?: string[];
}

/**
 * 创建/更新报销单
 */
export const addReimbursement = async (params: ReimburseAddParams) => {
  return await cpsApiClient.post("/reimbursement/add", params);
};
