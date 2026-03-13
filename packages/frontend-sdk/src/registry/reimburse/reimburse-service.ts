/**
 * Reimburse Form Service
 * 
 * Singleton service for managing reimbursement form state.
 * Page component (reimburse-apply.vue) registers handlers on mount,
 * AI tools call service methods to read/write form data.
 */

import { fetchUserDetail, getUserInfo, fetchUserBankAccount } from './services/user';
import { fetchExpenseItems, addReimbursement, type ReimburseAddParams } from './services/reimburse';
import { cpsApiClient } from './services/api';

export interface FormHeader {
  title: string;
  has_electronic_certificate: number | null;
  remType: string;
  description: string;
  applicant: string;
  company_code: string;
  department_code: string;
  currency: string;
  [key: string]: any;
}

export interface FormRow {
  id?: string;
  row_code?: string;
  expense_item_code?: string;
  expense_date?: string;
  expense_amount?: string;
  expense_currency?: string;
  description?: string;
  department_path_codes?: string;
  expense_department_path_code?: string;
  benefit_center_code?: string;
  attachments?: any[];
  [key: string]: any;
}

export interface FormValues {
  header: FormHeader;
  rows: FormRow[];
}

export interface UpdatePayload {
  title?: string;
  has_electronic_certificate?: string | number;
  // 银行信息（从 getBankAccountInfo 获取，必填）
  payee: string; // 收款方名称（必填）
  bank_no: string; // 银行卡号（必填）
  bank_account: string; // 收款方账号/开户名（必填）
  bank_nation_code?: string; // 国家/地区代码
  rows?: Array<{
    rowIndex: number;
    expense_item_code?: string;
    expense_date?: string;
    expense_amount?: string;
    expense_currency?: string;
    description?: string;
    department_path_codes?: string;
    expense_department_path_code?: string;
    attachments?: any[];
  }>;
}

export interface UserData {
  company_code?: string;
  company_name?: string;
  main_currency?: string;
  main_department?: {
    code?: string;
    name?: string;
    benefit_center_code?: string;
    benefit_center_name?: string;
    expense_department_path_code?: string;
    expense_department_path_name?: string;
  };
  [key: string]: any;
}

export interface ExpenseItem {
  code: string;
  name: string;
  list?: ExpenseItem[];
  children?: ExpenseItem[];
}

export interface ReimburseFormHandler {
  getFormValues: () => FormValues;
  updateFormValues: (data: UpdatePayload) => void;
  getUserData: () => UserData | null;
  getExpenseItems: () => ExpenseItem[];
}

let handler: ReimburseFormHandler | null = null;

// Cache for user data (initialized by Chat page)
let cachedUserData: UserData | null = null;
// let cachedBankInfo: any = null; // Removed: bank info now passed directly to updateFormValues

/**
 * Register form handler (called by page component on mount)
 */
export function register(h: ReimburseFormHandler): void {
  if (handler) {
    console.warn('[reimburseFormService] Handler already registered, overwriting');
  }
  handler = h;
}

/**
 * Unregister form handler (called by page component on unmount)
 */
export function unregister(): void {
  handler = null;
}

/**
 * Initialize user data cache (called by Chat page on mount)
 */
export async function initializeUserData(): Promise<void> {
  try {
    const userInfo = await getUserInfo();
    const userDetail = await fetchUserDetail(userInfo.account);
    cachedUserData = userDetail as UserData;
    
    console.log('[reimburseFormService] User data initialized:', cachedUserData);
  } catch (error) {
    console.error('[reimburseFormService] Failed to initialize user data:', error);
    throw error;
  }
}

/**
 * Get bank account info (separate tool for user confirmation)
 */
export async function getBankAccountInfo() {
  try {
    if (!cachedUserData) {
      throw new Error('[reimburseFormService] User data not initialized');
    }
    
    const userInfo = await getUserInfo();
    const companyCode = cachedUserData.company_code || '';
    
    const bankResult = await fetchUserBankAccount({
      company_code: companyCode,
      account: userInfo.account,
      doc_type: 'reimbursement',
    });
    
    const bankList = (bankResult as any)?.list || [];
    return {
      list: bankList,
      default: bankList[0] || null,
    };
  } catch (error) {
    console.error('[reimburseFormService] Failed to fetch bank account:', error);
    throw error;
  }
}

/**
 * Set selected bank info (called by AI after user confirms)
 * @deprecated No longer needed - bank info is now passed directly to updateFormValues
 */
// export function setBankInfo(bankInfo: any): void {
//   cachedBankInfo = bankInfo;
//   console.log('[reimburseFormService] Bank info set:', cachedBankInfo);
// }

/**
 * Clear user data cache (called by Chat page on unmount)
 */
export function clearUserDataCache(): void {
  cachedUserData = null;
  // cachedBankInfo = null; // Removed: no longer used
}

/**
 * Get current form values (header + rows)
 * Returns empty form if no handler is registered (e.g., in Chat page)
 */
export function getFormValues(): FormValues {
  if (!handler) {
    console.warn('[reimburseFormService] No handler registered, returning empty form');
    return {
      header: {
        title: '',
        has_electronic_certificate: null,
        remType: '',
        description: '',
        applicant: '',
        company_code: '',
        department_code: '',
        currency: '',
      },
      rows: [],
    };
  }
  return handler.getFormValues();
}

/**
 * Update form values (header fields: title, has_electronic_certificate; row fields: all)
 * If no handler is registered (e.g., in Chat page), calls API directly to create/update reimbursement
 */
export async function updateFormValues(data: UpdatePayload): Promise<any> {
  if (handler) {
    // Traditional form mode: update via handler
    handler.updateFormValues(data);
    return;
  }
  
  // Chat mode: call API directly
  console.log('[reimburseFormService] No handler, calling API to save reimbursement:', data);
  
  try {
    // Use cached user data (initialized by Chat page)
    if (!cachedUserData) {
      throw new Error('[reimburseFormService] User data not initialized. Call initializeUserData() first.');
    }
    
    const userInfo = await getUserInfo();
    
    // Get rem_type from URL
    const urlParams = new URLSearchParams(window.location.search);
    const remType = urlParams.get('rem_type') || 'daily';
    
    // Convert has_electronic_certificate to string (AI might pass number)
    let hasCertificate: string | null = null;
    if (data.has_electronic_certificate !== undefined) {
      hasCertificate = String(data.has_electronic_certificate);
    }
    
    // Validate required bank info
    if (!data.payee || !data.bank_no || !data.bank_account) {
      throw new Error('[reimburseFormService] Missing required bank info: payee, bank_no, bank_account');
    }
    
    // Build API params
    const params: ReimburseAddParams = {
      title: data.title || '',
      offset_petty_cash: {},
      operate: 'submit',
      // 银行卡信息（从 AI 传入的 data 中获取，必填）
      payee: data.payee,
      bank_no: data.bank_no,
      bank_account: data.bank_account,
      bank_nation_code: data.bank_nation_code || '',
      // 报销信息
      applicant: userInfo.account,
      company_code: cachedUserData.company_code || '',
      department_code: cachedUserData.main_department?.code || '',
      rem_type: remType,
      has_electronic_certificate: hasCertificate,
      rows: (data.rows || []).map((row) => ({
        expense_item_code: row.expense_item_code,
        expense_date: row.expense_date,
        expense_amount: row.expense_amount,
        expense_currency: row.expense_currency,
        description: row.description,
        department_path_codes: row.department_path_codes,
        expense_department_path_code: row.expense_department_path_code,
        attachment_list: row.attachments?.map((attachment: any) => attachment.id) || [],
      })),
    };
    
    const result = await addReimbursement(params);
    console.log('[reimburseFormService] Reimbursement saved:', result);
    return result;
  } catch (error) {
    console.error('[reimburseFormService] Failed to save reimbursement:', error);
    throw error;
  }
}

/**
 * Get user data (from cache, initialized by Chat page)
 */
export async function getUserData(): Promise<UserData | null> {
  if (!cachedUserData) {
    console.error('[reimburseFormService] User data not initialized. Call initializeUserData() first.');
    return null;
  }
  return cachedUserData;
}

/**
 * Get expense items (from /expense/item/list API)
 * Filters by rem_type from URL query params:
 * - rem_type=daily -> returns EXP0001's children
 * - rem_type=travel -> returns EXP0002's children
 */
export async function getExpenseItems(): Promise<ExpenseItem[]> {
  try {
    const result = await fetchExpenseItems();
    const allItems = (result as any)?.list || [];
    
    // Get rem_type from URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const remType = urlParams.get('rem_type');
    
    if (!remType) {
      // If no rem_type, return all items
      return allItems;
    }
    
    // Filter by rem_type
    const targetCode = remType === 'daily' ? 'EXP0001' : remType === 'travel' ? 'EXP0002' : null;
    
    if (!targetCode) {
      return allItems;
    }
    
    // Find the target category and return its children
    const targetCategory = allItems.find((item: ExpenseItem) => item.code === targetCode);
    return targetCategory?.list || targetCategory?.children || [];
  } catch (error) {
    console.error('[reimburseFormService] Failed to fetch expense items:', error);
    return [];
  }
}

export interface TravelDocListParams {
  applicant: string;
  filter_valid_doc?: boolean;
  page?: number;
  page_size?: number;
}

export interface TravelDocument {
  doc_code: string;
  travel_date: string;
  travel_reason: string;
  travel_way?: string;
  state?: string;
  is_valid?: boolean;
  invalid_reason?: string;
  doc_applicant?: string;
  traveler?: string;
  apply_date?: string;
}

export interface TravelDocListResponse {
  list: TravelDocument[];
  total?: number;
  page?: number | string;
  page_size?: number | string;
}

/**
 * Fetch travel documents list for travel reimbursement
 */
export async function fetchTravelDocuments(params: TravelDocListParams): Promise<TravelDocListResponse> {
  return await cpsApiClient.post("/reimbursement/travel-doc/list", params);
}
