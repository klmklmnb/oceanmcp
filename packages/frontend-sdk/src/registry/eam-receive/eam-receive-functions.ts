import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type ExecutorFunctionDefinition,
  type FunctionDefinition,
} from '@ocean-mcp/shared';
import { getUserInfo } from '../reimburse/services/user';

// ---------------------------------------------------------------------------
// Configurable runtime config
// ---------------------------------------------------------------------------

export const eamReceiveConfig = {
  /** hostname → API host 映射，由接入方注入 */
  hostMap: {} as Record<string, string>,
  /** 默认 API host */
  defaultHost: 'api-test.agw.mihoyo.com',
  /** IAM 选人接口的 x-select-scene */
  iamUserScene: 'EAM_B_NORMAL_USER',
  /**
   * EAM 应用的 x-mi-clientid。
   * 网关依赖此值识别调用方身份，缺失会报"该应用不存在"。
   * 接入方可在初始化时覆盖为对应环境的值。
   */
  clientId: 'cc15446acace0404',
  /**
   * EAM 前台域名，用于拼接单据详情链接。
   * test → eamtest.mihoyo.com
   * uat  → eamuat.mihoyo.com
   * pp   → eampp.mihoyo.com
   */
  eamHost: 'eamtest.mihoyo.com',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApiHost(): string {
  const { hostname } = window.location;
  return eamReceiveConfig.hostMap[hostname] ?? eamReceiveConfig.defaultHost;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'x-mi-clientid': eamReceiveConfig.clientId,
    ...extra,
  };
}

async function post(path: string, body?: Record<string, any>): Promise<any> {
  const url = `https://${getApiHost()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json?.retcode !== undefined && json.retcode !== 0) {
    throw new Error(json.message || `retcode=${json.retcode}`);
  }
  return json?.data ?? json;
}

// ---------------------------------------------------------------------------
// API wrappers
// ---------------------------------------------------------------------------

async function getGlobalUser(params: { domain: string }): Promise<any> {
  return post('/neone-eam-gosvc/out/global/user/get', params);
}

async function skuSearch(params: {
  domain: string;
  keyword: string;
  area_code?: string;
  purchase_type_path_code?: string;
  page?: number;
  size?: number;
}): Promise<any> {
  return post('/neone-eam-gosvc/out/baseData/sku/search', {
    area_code: '',
    purchase_type_path_code: '',
    page: 1,
    size: 100,
    ...params,
  });
}

async function purchaseTypeList(params: {
  domain: string;
  keyword: string;
  area_code?: string;
  parent_path_code?: string;
  page?: number;
  page_size?: number;
}): Promise<any> {
  return post('/neone-eam-gosvc/out/baseData/purchaseType/list', {
    area_code: '',
    parent_path_code: '',
    page: 1,
    page_size: 100,
    ...params,
  });
}

async function receiptPlaceList(params: {
  claim_by: string;
  use_scene_enum?: string;
}): Promise<any> {
  return post('/neone-eam-gosvc/baseData/receiptPlace/list', params);
}

async function listParentAsset(params: {
  domain: string;
  base_info_code: string;
  asset_status_enum: string[];
}): Promise<any> {
  return post('/neone-eam-gosvc/out/my_asset/asset/list_parent_asset', params);
}

async function addClaim(params: any): Promise<any> {
  return post('/neone-eam-gosvc/out/claim/document/add', params);
}

// ---------------------------------------------------------------------------
// IAM helpers
// ---------------------------------------------------------------------------

async function searchUsersByKeyword(keyword: string): Promise<Array<{
  domain: string;
  name: string;
  empNo: string;
  department?: string;
}>> {
  const url = `https://${getApiHost()}/iam/account/select/query/search_candidate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'x-select-scene': eamReceiveConfig.iamUserScene }),
    credentials: 'include',
    body: JSON.stringify({ keyword, scopes: [1, 2, 3] }),
  });
  if (!res.ok) return [];

  const json = await res.json();
  const accts: any[] = json?.data?.accts ?? [];
  return accts.map((a: any) => ({
    domain: a.domain ?? a.primary_key,
    name: a.cn_name ?? a.user_name,
    empNo: a.emp_no ?? '',
    department: a.display_dept_profile?.cn_name,
  }));
}

// ---------------------------------------------------------------------------
// Current user — 复用项目已有的 getUserInfo（/neone-cps-svc/public/user/check_login）
// ---------------------------------------------------------------------------

let cachedUser: { domain: string; name: string; department: string } | null = null;

async function getCurrentUser(): Promise<{ domain: string; name: string; department: string }> {
  if (cachedUser) return cachedUser;
  try {
    const data = await getUserInfo();
    cachedUser = {
      domain: data.account || '',
      name: data.name || '',
      department: data.department || '',
    };
    return cachedUser;
  } catch (err) {
    console.error('[eam-receive] getUserInfo failed', err);
    return { domain: '', name: '', department: '' };
  }
}

function toArray(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.list)) return res.list;
  if (Array.isArray(res?.data?.list)) return res.data.list;
  if (Array.isArray(res?.data)) return res.data;
  if (res && typeof res === 'object') {
    for (const val of Object.values(res)) {
      if (Array.isArray(val)) return val as any[];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Tool 1: searchUser — IAM 用户搜索（支持代提场景）
// ---------------------------------------------------------------------------

function makeSearchUser(): ExecutorFunctionDefinition {
  return {
    id: 'eamSearchUser',
    name: 'Search EAM User',
    description:
      '通过姓名、域账号或拼音搜索用户。代提申请时，先调用此工具解析被代提人的域账号，再传入 searchClaimAsset。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,

    executor: async (args: Record<string, unknown>) => {
      const keyword = String(args.keyword ?? '').trim();
      if (!keyword) {
        return { success: false, message: '请提供搜索关键字。' };
      }

      const users = await searchUsersByKeyword(keyword);

      if (users.length === 0) {
        return {
          success: true,
          count: 0,
          users: [],
          message: `未找到与「${keyword}」匹配的用户。`,
        };
      }

      const list = users.map(
        (u, i) =>
          `${i + 1}. ${u.name} (${u.domain})${u.department ? ` — ${u.department}` : ''}`,
      );

      return {
        success: true,
        count: users.length,
        users,
        message:
          users.length === 1
            ? `找到用户：${list[0]}`
            : `找到 ${users.length} 个匹配用户：\n${list.join('\n')}\n请回复序号或域账号以确认。`,
      };
    },

    parameters: [
      {
        name: 'keyword',
        type: PARAMETER_TYPE.STRING,
        description: '搜索关键词，支持中文姓名、域账号或拼音。如「张三」、「san.zhang」。',
        required: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool 2: searchClaimAsset — 搜索可申请的资产 & 收货地址
// ---------------------------------------------------------------------------

function makeSearchClaimAsset(): ExecutorFunctionDefinition {
  return {
    id: 'searchClaimAsset',
    name: 'Search Claim Asset',
    description:
      '根据关键词搜索系统中可申请的资产（SKU 单品 + 采购类别），同时获取基于资产用途的收货地址列表。代提时传入 claimByDomain。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,

    executor: async (args: Record<string, unknown>) => {
      const keyword = String(args.keyword || '').trim();
      if (!keyword) {
        return { success: false, message: '请提供搜索关键词。' };
      }

      const useCode = String(args.useCode || 'PERSONAL_OFFICE_EQUIPMENT');
      const currentUser = await getCurrentUser();
      const claimByDomain = String(args.claimByDomain || '').trim() || currentUser.domain;

      let claimByUser = { domain: claimByDomain, name: '', department: '' };
      if (claimByDomain !== currentUser.domain) {
        try {
          const userRes = await getGlobalUser({ domain: claimByDomain });
          claimByUser = {
            domain: claimByDomain,
            name: userRes?.name || userRes?.cn_name || claimByDomain,
            department: userRes?.department_code || userRes?.department || '',
          };
        } catch {
          console.warn(`[eam-receive] getGlobalUser failed for ${claimByDomain}`);
        }
      } else {
        claimByUser = currentUser;
      }

      try {
        const [skuRes, categoryRes, receiptRes] = await Promise.all([
          skuSearch({ domain: claimByDomain, keyword }).catch(() => [] as any[]),
          purchaseTypeList({ domain: claimByDomain, keyword }).catch(() => [] as any[]),
          receiptPlaceList({ claim_by: claimByDomain, use_scene_enum: useCode }).catch(() => [] as any[]),
        ]);

        const skuItems = toArray(skuRes).slice(0, 15).map((item: any) => ({
          skuCode: item.code || '',
          skuName: item.name || '',
          brand: item.brand || '',
          model: item.model || '',
          specification: item.specification || item.spec || '',
          purchaseTypePathCode: item.purchase_types?.[0]?.path_code || '',
          purchaseTypePathName: item.purchase_types?.[0]?.path_name || '',
        }));

        const categoryItems = toArray(categoryRes).slice(0, 15).map((item: any) => ({
          pathCode: item.path_code || '',
          pathName: item.path_name || item.name || '',
        }));

        const receiptPlaces = toArray(receiptRes).map((item: any) => ({
          name: item.receipt_place ?? item.name ?? '',
          code: item.receipt_place_code ?? item.code ?? '',
        }));

        return {
          success: true,
          currentUser,
          claimByUser,
          isProxy: claimByDomain !== currentUser.domain,
          skuItems,
          categoryItems,
          receiptPlaces,
          message:
            `搜索"${keyword}"完成：找到 ${skuItems.length} 个 SKU 单品、` +
            `${categoryItems.length} 个采购类别、${receiptPlaces.length} 个收货地址。`,
        };
      } catch (err) {
        console.error('[eam-receive] searchClaimAsset failed', err);
        return {
          success: false,
          message: `搜索失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    parameters: [
      {
        name: 'keyword',
        type: PARAMETER_TYPE.STRING,
        description: '搜索关键词，如「显示器」「笔记本」「键盘」「耳机」等。',
        required: true,
      },
      {
        name: 'useCode',
        type: PARAMETER_TYPE.STRING,
        description:
          '资产用途枚举值，用于获取对应的收货地址。可选：PERSONAL_OFFICE_EQUIPMENT（默认）、TEAM_EXCLUSIVE_EQUIPMENT、FUNCTIONAL_ROOM_EQUIPMENT、PUBLIC_AREA_EQUIPMENT。',
        required: false,
      },
      {
        name: 'claimByDomain',
        type: PARAMETER_TYPE.STRING,
        description:
          '领用人域账号。代提时必填（通过 eamSearchUser 解析后传入）。不传则默认为当前登录用户。',
        required: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool 3: queryParentAsset — 查询可绑定的主设备
// ---------------------------------------------------------------------------

function makeQueryParentAsset(): ExecutorFunctionDefinition {
  return {
    id: 'queryParentAsset',
    name: 'Query Parent Asset',
    description:
      '根据 SKU 编码查询领用人名下可绑定的主设备列表。选中 SKU 后必须调用此工具，如有主设备则让用户选择绑定哪一台。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,

    executor: async (args: Record<string, unknown>) => {
      const skuCode = String(args.skuCode || '').trim();
      const currentUser = await getCurrentUser();
      const domain = String(args.domain || '').trim() || currentUser.domain;

      if (!skuCode) {
        return { success: false, message: '缺少 SKU 编码（skuCode）。' };
      }

      try {
        const res = await listParentAsset({
          domain,
          base_info_code: skuCode,
          asset_status_enum: ['USING'],
        });

        const assets = toArray(res).map((item: any) => ({
          assetNumber: item.asset_number || '',
          configInfo: item.config_info || '',
        }));

        return {
          success: true,
          assets,
          message:
            assets.length > 0
              ? `找到 ${assets.length} 台可绑定的主设备。`
              : '该 SKU 无需绑定主设备。',
        };
      } catch (err) {
        console.error('[eam-receive] queryParentAsset failed', err);
        return {
          success: false,
          message: `查询主设备失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    parameters: [
      {
        name: 'skuCode',
        type: PARAMETER_TYPE.STRING,
        description: 'SKU 编码，来自 searchClaimAsset 返回的 skuItems[].skuCode。',
        required: true,
      },
      {
        name: 'domain',
        type: PARAMETER_TYPE.STRING,
        description: '领用人域账号，代提时传入被代提人域账号。不传则默认为当前用户。',
        required: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool 4: submitClaimApply — 提交领用申请
// ---------------------------------------------------------------------------

function makeSubmitClaimApply(): ExecutorFunctionDefinition {
  return {
    id: 'submitClaimApply',
    name: 'Submit Claim Apply',
    description:
      '提交资产领用申请单。代提时传入 claimByDomain 和 claimByDepartment。提交成功后返回单据编码和详情页链接。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,

    executor: async (args: Record<string, unknown>) => {
      const {
        useCode = 'PERSONAL_OFFICE_EQUIPMENT',
        quantity = 1,
        claimNote,
        receiptPlaceName = '',
        receiptPlaceCode = '',
        purchaseTypePathCode,
        skuCode,
        skuName,
        brand,
        model,
        specification,
        bindParentAssetNumber,
        claimByDomain,
        claimByDepartment,
      } = args as Record<string, any>;

      if (!claimNote) {
        return { success: false, message: '缺少领用说明（claimNote）。' };
      }

      const currentUser = await getCurrentUser();
      const domain = claimByDomain || currentUser.domain;
      const department = claimByDepartment || currentUser.department;

      const row: Record<string, any> = {
        quantity: Number(quantity),
        current_mode: 'ALL',
      };

      if (purchaseTypePathCode) {
        row.purchase_type_path_code = purchaseTypePathCode;
      }

      if (skuCode) {
        row.sku_info = [
          {
            brand: brand || '',
            model: model || '',
            sku_code: skuCode,
            sku_name: skuName || '',
            specification: specification || '',
          },
        ];
      }

      if (bindParentAssetNumber) {
        row.bind_parent_asset_number = bindParentAssetNumber;
      }

      try {
        const res = await addClaim({
          head: {
            claim_by: domain,
            department,
            use_code: useCode,
            receipt_place: receiptPlaceName,
            receipt_place_code: receiptPlaceCode,
            claim_note: claimNote,
            front_tag: 'NEW',
            code: null,
          },
          rows: [row],
        });

        const docCode = res?.code ?? res?.data?.code ?? res?.claim_apply_code ?? '';
        const detailUrl = `https://${eamReceiveConfig.eamHost}/eamReceive/receive/assetsApplyDetail?code=${docCode}`;

        return {
          success: true,
          code: docCode,
          detailUrl,
          message: `✅ 领用申请已提交成功！\n\n单据编码：${docCode}\n查看详情：${detailUrl}`,
        };
      } catch (err) {
        console.error('[eam-receive] submitClaimApply failed', err);
        return {
          success: false,
          message: `提交失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    parameters: [
      {
        name: 'useCode',
        type: PARAMETER_TYPE.STRING,
        description:
          '资产用途枚举值。PERSONAL_OFFICE_EQUIPMENT（默认）、TEAM_EXCLUSIVE_EQUIPMENT、FUNCTIONAL_ROOM_EQUIPMENT、PUBLIC_AREA_EQUIPMENT。',
        required: false,
      },
      {
        name: 'purchaseTypePathCode',
        type: PARAMETER_TYPE.STRING,
        description: '采购类别路径编码。来自 skuItems[].purchaseTypePathCode 或 categoryItems[].pathCode。',
        required: false,
      },
      {
        name: 'skuCode',
        type: PARAMETER_TYPE.STRING,
        description: 'SKU 编码。',
        required: false,
      },
      {
        name: 'skuName',
        type: PARAMETER_TYPE.STRING,
        description: 'SKU 名称。',
        required: false,
      },
      {
        name: 'brand',
        type: PARAMETER_TYPE.STRING,
        description: '品牌。',
        required: false,
      },
      {
        name: 'model',
        type: PARAMETER_TYPE.STRING,
        description: '型号。',
        required: false,
      },
      {
        name: 'specification',
        type: PARAMETER_TYPE.STRING,
        description: '规格。',
        required: false,
      },
      {
        name: 'quantity',
        type: PARAMETER_TYPE.NUMBER,
        description: '申请数量，默认为 1。',
        required: false,
      },
      {
        name: 'claimNote',
        type: PARAMETER_TYPE.STRING,
        description: '领用说明/申请原因。',
        required: true,
      },
      {
        name: 'receiptPlaceName',
        type: PARAMETER_TYPE.STRING,
        description: '收货地址名称。',
        required: false,
      },
      {
        name: 'receiptPlaceCode',
        type: PARAMETER_TYPE.STRING,
        description: '收货地址编码。',
        required: false,
      },
      {
        name: 'bindParentAssetNumber',
        type: PARAMETER_TYPE.STRING,
        description: '绑定的主设备资产编号，来自 queryParentAsset 返回的 assets[].assetNumber。',
        required: false,
      },
      {
        name: 'claimByDomain',
        type: PARAMETER_TYPE.STRING,
        description: '领用人域账号（代提时必填）。不传则默认为当前登录用户。',
        required: false,
      },
      {
        name: 'claimByDepartment',
        type: PARAMETER_TYPE.STRING,
        description: '领用人部门编码（代提时传入，来自 searchClaimAsset 返回的 claimByUser.department）。',
        required: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const eamReceiveFunctions: FunctionDefinition[] = [
  makeSearchUser(),
  makeSearchClaimAsset(),
  makeQueryParentAsset(),
  makeSubmitClaimApply(),
];
