import { cpsApiClient } from "./api";

// 用户信息类型
export interface UserInfo {
  account: string;
  department: string;
  avatar: string;
  name: string;
  department_name: string;
}
/**
 * 获取用户信息
 */
export const getUserInfo = async (): Promise<UserInfo>  => {
  return await cpsApiClient.post("/public/user/check_login");
};

/**
 * 获取用户详情（报销相关：公司、部门、币种等）
 */
export const fetchUserDetail = async (account: string) => {
  return await cpsApiClient.get("/user/detail", { params: { account } });
};

/**
 * 获取用户银行卡信息
 */
export const fetchUserBankAccount = async (params: {
  company_code: string;
  account: string;
  doc_type: string;
}) => {
  return await cpsApiClient.get("/user/bank_account/user_company/list", { params });
};
