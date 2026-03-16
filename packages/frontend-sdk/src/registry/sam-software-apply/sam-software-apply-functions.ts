import React from 'react';
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type ExecutorFunctionDefinition,
  type FunctionDefinition,
  type FlowStep,
} from '@ocean-mcp/shared';
import { chatBridge } from '../../runtime/chat-bridge';

// ---------------------------------------------------------------------------
// Configurable runtime config — 接入方在初始化时注入
// ---------------------------------------------------------------------------

export const samApplyConfig = {
  /** hostname → SAM API host 映射，接入方按环境注入 */
  hostMap: {} as Record<string, string>,
  /** 默认 API host */
  defaultHost: 'api-test.agw.mihoyo.com',
  /**
   * SAM 应用的 x-mi-clientid。
   * 网关依赖此值识别调用方身份，接入方可按环境覆盖。
   */
  clientId: '2f3a1ad81ad8e231',
  /** IAM 选人接口 scene（内部用于解析当前用户 empNo，不对 AI 暴露） */
  iamUserScene: 'SAM_B_NORMAL_USER',
  /**
   * SAM 前台域名，用于拼接单据详情链接。
   * test → samtest.mihoyo.com
   * uat  → samuat.mihoyo.com
   * pp   → sampp.mihoyo.com
   */
  samHost: 'samtest.mihoyo.com',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApiHost(): string {
  const { hostname } = window.location;
  return samApplyConfig.hostMap[hostname] ?? samApplyConfig.defaultHost;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'x-mi-clientid': samApplyConfig.clientId,
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
  // 兼容 retcode 和 code 两种错误字段（不同服务约定不同）
  const errorCode = json?.retcode ?? json?.code;
  if (errorCode !== undefined && errorCode !== 0) {
    throw new Error(json.message || `code=${errorCode}`);
  }
  return json?.data ?? json;
}

// ---------------------------------------------------------------------------
// API wrappers
// ---------------------------------------------------------------------------

/** CPS 登录态：返回 account（domain）、name、department */
async function checkLogin(): Promise<{ account: string; name: string; department: string }> {
  return post('/neone-cps-svc/public/user/check_login');
}

/**
 * 内部通过 IAM 域账号搜索以获取 empNo。
 * 不对外暴露为 AI tool。
 */
async function iamResolveEmpNo(domain: string): Promise<string> {
  try {
    const url = `https://${getApiHost()}/iam/account/select/query/search_candidate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders({ 'x-select-scene': samApplyConfig.iamUserScene }),
      credentials: 'include',
      body: JSON.stringify({ keyword: domain, scopes: [1, 2, 3] }),
    });
    if (!res.ok) return '';
    const json = await res.json();
    const accts: any[] = json?.data?.accts ?? [];
    const matched = accts.find((a: any) => (a.domain ?? a.primary_key) === domain) ?? accts[0];
    return matched?.emp_no ?? '';
  } catch {
    return '';
  }
}

/**
 * Step 1: 获取软件采购类别树，递归提取所有叶子节点的 path_code
 * POST /neone-eam-data/out/v1/fms/purchase_type/tree
 */
async function fmsPurchaseTypeTree(skuAuthTypeCode: 'INDIVIDUAL' | 'ORGANIZATION'): Promise<string[]> {
  const url = `https://${getApiHost()}/neone-eam-data/out/v1/fms/purchase_type/tree`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      asset_types: ['SOFTWARE'],
      must_has_sku: true,
      user_apply_allowed: true,
      sku_auth_type_code: skuAuthTypeCode,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json?.retcode !== undefined && json.retcode !== 0) {
    throw new Error(json.message || `retcode=${json.retcode}`);
  }
  // 响应结构: { data: { list: [...], next_cursor: 0 } }
  const rootNodes: any[] = json?.data?.list ?? json?.data ?? [];
  return extractLeafCodes(Array.isArray(rootNodes) ? rootNodes : []);
}

/**
 * 递归收集叶子节点的 code（children 为 null / [] 的节点即叶子）。
 * 使用 node.code 字段作为 page 接口的 purchase_type_path_codes 入参。
 */
function extractLeafCodes(nodes: any[]): string[] {
  const codes: string[] = [];
  for (const node of nodes) {
    const children: any[] | null = node.children || node.child_list || null;
    if (!children || children.length === 0) {
      // 叶子节点：直接用 code 字段
      const code = node.code || '';
      if (code) codes.push(code);
    } else {
      codes.push(...extractLeafCodes(children));
    }
  }
  return codes;
}

/**
 * Step 2: 根据采购类别 codes 查询可申请的软件 SKU 列表
 * POST /neone-eam-data/out/v1/fms/sku/page
 */
async function fmsSkuPage(
  purchaseTypePathCodes: string[],
  skuAuthTypeCode: 'INDIVIDUAL' | 'ORGANIZATION',
): Promise<any[]> {
  if (purchaseTypePathCodes.length === 0) return [];

  const url = `https://${getApiHost()}/neone-eam-data/out/v1/fms/sku/page`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      purchase_type_path_codes: purchaseTypePathCodes,
      user_apply_allowed: true,
      asset_types: ['SOFTWARE'],
      sku_auth_type_code: skuAuthTypeCode,
      page: 1,
      page_size: 999,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json?.retcode !== undefined && json.retcode !== 0) {
    throw new Error(json.message || `retcode=${json.retcode}`);
  }
  const data = json?.data ?? json;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

/** 全量软件列表缓存，供 showRender 下拉框使用 */
let cachedAllSoftware: any[] | null = null;

/**
 * 获取所有可申请软件：tree → 叶子 codes → page → 合并去重
 * INDIVIDUAL 和 ORGANIZATION 并行执行
 */
async function getAllApplicableSoftware(): Promise<any[]> {
  // Step 1: 并行获取两种授权类型的叶子 codes
  const [individualCodes, orgCodes] = await Promise.all([
    fmsPurchaseTypeTree('INDIVIDUAL').catch(() => [] as string[]),
    fmsPurchaseTypeTree('ORGANIZATION').catch(() => [] as string[]),
  ]);

  // Step 2: 并行查询 SKU 列表
  const [individualSkus, orgSkus] = await Promise.all([
    fmsSkuPage(individualCodes, 'INDIVIDUAL').catch(() => [] as any[]),
    fmsSkuPage(orgCodes, 'ORGANIZATION').catch(() => [] as any[]),
  ]);

  // Step 3: 合并去重（INDIVIDUAL 优先，相同 code 不重复）
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const [items, authType] of [
    [individualSkus, 'INDIVIDUAL'],
    [orgSkus, 'ORGANIZATION'],
  ] as const) {
    for (const item of items) {
      const key = item.code || item.sku_code || item.id || '';
      if (!key || !seen.has(key)) {
        if (key) seen.add(key);
        merged.push({ ...item, _authType: authType });
      }
    }
  }
  cachedAllSoftware = merged;
  return merged;
}

// ---------------------------------------------------------------------------
// Software picker dropdown — rendered by showRender when no keyword match
// ---------------------------------------------------------------------------

interface SoftwareOption {
  skuCode: string;
  skuName: string;
  vendor: string;
  version: string;
}

function SoftwareSelectDropdown({ options }: { options: SoftwareOption[] }) {
  const [selected, setSelected] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = () => {
    const item = options.find((o) => o.skuCode === selected);
    if (!item || submitted) return;
    setSubmitted(true);
    chatBridge.call('chat', `我想申请 ${item.skuName}`).catch(console.error);
  };

  if (submitted) {
    const item = options.find((o) => o.skuCode === selected);
    return React.createElement(
      'p',
      { className: 'text-sm text-text-secondary mt-1' },
      `已选择：${item?.skuName ?? selected}`,
    );
  }

  return React.createElement(
    'div',
    { className: 'mt-2 flex flex-col gap-2' },
    React.createElement(
      'p',
      { className: 'text-xs text-text-secondary' },
      '未找到匹配软件，请从以下可申请软件中选择：',
    ),
    React.createElement(
      'select',
      {
        value: selected,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSelected(e.target.value),
        className:
          'w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-ocean-500',
      },
      React.createElement('option', { value: '' }, '-- 请选择软件 --'),
      ...options.map((opt) =>
        React.createElement(
          'option',
          { key: opt.skuCode, value: opt.skuCode },
          `${opt.skuName}${opt.vendor ? ` (${opt.vendor})` : ''}${opt.version ? ` ${opt.version}` : ''}`,
        ),
      ),
    ),
    selected &&
      React.createElement(
        'button',
        {
          onClick: handleSubmit,
          className:
            'self-start px-3 py-1.5 bg-ocean-600 hover:bg-ocean-700 text-white text-sm rounded-lg transition-colors cursor-pointer',
        },
        '申请选中的软件',
      ),
  );
}

/**
 * 提交软件申请单
 * POST /neone-sam-svc/v1/claim/info/apply
 */
async function claimInfoApply(params: {
  head: {
    note?: string;
    sku_auth_type_code: 'INDIVIDUAL' | 'ORGANIZATION';
    claim_emp_no: string;
    claim_org_code?: string;
  };
  rows: Array<{
    sku_code?: string;
    purchase_type_path_code?: string;
    saas_customer_fields?: Record<string, string>;
  }>;
}): Promise<any> {
  return post('/neone-sam-svc/v1/claim/info/apply', params);
}

// ---------------------------------------------------------------------------
// Current user cache
// ---------------------------------------------------------------------------

let cachedUser: { domain: string; name: string; empNo: string; department: string } | null = null;

async function getCurrentUser() {
  if (cachedUser) return cachedUser;
  try {
    const loginData = await checkLogin();
    const domain = loginData.account || '';
    const empNo = domain ? await iamResolveEmpNo(domain) : '';
    cachedUser = {
      domain,
      name: loginData.name || '',
      empNo,
      department: loginData.department || '',
    };
    return cachedUser;
  } catch (err) {
    console.error('[sam-software-apply] getCurrentUser failed', err);
    return { domain: '', name: '', empNo: '', department: '' };
  }
}

// ---------------------------------------------------------------------------
// Tool 1: samSearchSoftware
// ---------------------------------------------------------------------------

function makeSearchSoftware(): ExecutorFunctionDefinition {
  return {
    id: 'samSearchSoftware',
    name: 'Search SAM Software',
    description:
      '搜索 SAM 系统中可供用户申请的软件单品（SKU）列表，支持按关键词过滤软件名称、厂商或版本。不传关键词则返回全量可申请软件。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,

    executor: async (args: Record<string, unknown>) => {
      const keyword = String(args.keyword || '').trim().toLowerCase();

      try {
        const allSkus = await getAllApplicableSoftware();

        const filtered = keyword
          ? allSkus.filter(
              (s: any) =>
                String(s.name || s.sku_name || '').toLowerCase().includes(keyword) ||
                String(s.vendor_name || s.sw_vendor || s.brand || '').toLowerCase().includes(keyword) ||
                String(s.version || s.sw_version || s.model || '').toLowerCase().includes(keyword) ||
                String(s.code || s.sku_code || '').toLowerCase().includes(keyword),
            )
          : allSkus;

        const items = filtered.slice(0, 20).map((s: any) => ({
          skuCode: s.code || s.sku_code || '',
          skuName: s.name || s.sku_name || '',
          vendor: s.vendor_name || s.sw_vendor || s.brand || '',
          version: s.version || s.sw_version || s.model || '',
          unitPrice: s.unit_price || s.sw_unit_price || '',
          currency: s.currency || s.sw_currency || '',
          note: s.remark || s.sw_note || s.description || '',
          purchaseTypePathCode:
            s.purchase_type_path_code ||
            s._purchaseTypePathCode ||
            (Array.isArray(s.purchase_type_path_codes) ? s.purchase_type_path_codes[0] : '') ||
            '',
          purchaseTypePathName: s.purchase_type_path_name || '',
          /** 席位授权对象：INDIVIDUAL=个人, ORGANIZATION=组织 */
          seatAuthTargetType: s._authType || s.sku_auth_type_code || s.seat_auth_target_type || 'INDIVIDUAL',
        }));

        return {
          success: true,
          total: filtered.length,
          items,
          message:
            items.length > 0
              ? `找到 ${items.length} 款软件${keyword ? `（关键词：${keyword}）` : ''}。`
              : `未找到${keyword ? `含「${keyword}」的` : ''}可申请软件，请尝试其他关键词。`,
        };
      } catch (err) {
        console.error('[sam-software-apply] samSearchSoftware failed', err);
        return {
          success: false,
          message: `搜索失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    showRender: (step: FlowStep) => {
      if (step.status !== 'success') return null;
      const result = step.result as any;
      // 仅在有关键词搜索但未命中时显示下拉框
      if (!result || result.total !== 0) return null;
      const keyword = String((step.arguments as any)?.keyword || '').trim();
      if (!keyword) return null;

      const all = cachedAllSoftware;
      if (!all || all.length === 0) return null;

      const options: SoftwareOption[] = all.map((s: any) => ({
        skuCode: s.code || s.sku_code || '',
        skuName: s.name || s.sku_name || '',
        vendor: s.vendor_name || s.sw_vendor || s.brand || '',
        version: s.version || s.sw_version || s.model || '',
      })).filter((o: SoftwareOption) => o.skuCode && o.skuName);

      if (options.length === 0) return null;
      return React.createElement(SoftwareSelectDropdown, { options });
    },

    parameters: [
      {
        name: 'keyword',
        type: PARAMETER_TYPE.STRING,
        description: '搜索关键词，如「Cursor」「Adobe」「Figma」。不传则返回全量可申请软件列表。',
        required: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool 2: samSubmitSoftwareApply
// ---------------------------------------------------------------------------

function makeSubmitSoftwareApply(): ExecutorFunctionDefinition {
  return {
    id: 'samSubmitSoftwareApply',
    name: 'Submit SAM Software Apply',
    description:
      '提交软件申请单。传入 skuCode 或 purchaseTypePathCode 即可，申请人默认为当前登录用户。提交成功后返回单据编码和申请列表链接。',
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,

    executor: async (args: Record<string, unknown>) => {
      const { skuCode, purchaseTypePathCode, note = '', skuAuthTypeCode } = args as Record<string, any>;

      if (!skuCode && !purchaseTypePathCode) {
        return {
          success: false,
          message: '缺少必要参数：请提供 skuCode（软件编码）或 purchaseTypePathCode（采购类别编码）。',
        };
      }

      const currentUser = await getCurrentUser();
      if (!currentUser.empNo) {
        return {
          success: false,
          message: '无法获取当前用户工号，请确认登录状态。',
        };
      }

      const authType: 'INDIVIDUAL' | 'ORGANIZATION' =
        skuAuthTypeCode === 'ORGANIZATION' ? 'ORGANIZATION' : 'INDIVIDUAL';

      const row: Record<string, any> = { saas_customer_fields: {} };
      if (skuCode) row.sku_code = skuCode;
      if (purchaseTypePathCode) row.purchase_type_path_code = purchaseTypePathCode;

      try {
        const res = await claimInfoApply({
          head: {
            note: String(note),
            sku_auth_type_code: authType,
            claim_emp_no: currentUser.empNo,
          },
          rows: [row],
        });

        const docCode = res?.doc_code ?? res?.doc_codes?.[0] ?? res?.data?.doc_code ?? '';
        const detailUrl = docCode
          ? `https://${samApplyConfig.samHost}/sam/softwareApply/softwareApplyDetail/${docCode}`
          : `https://${samApplyConfig.samHost}/sam/softwareManagement/applyList`;

        return {
          success: true,
          docCode,
          detailUrl,
          message: `✅ 软件申请已提交成功！\n\n申请人：${currentUser.name}（${currentUser.domain}）\n单据编码：${docCode}\n查看申请详情：${detailUrl}`,
        };
      } catch (err) {
        console.error('[sam-software-apply] samSubmitSoftwareApply failed', err);
        return {
          success: false,
          message: `提交失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    parameters: [
      {
        name: 'skuCode',
        type: PARAMETER_TYPE.STRING,
        description: '软件单品编码，来自 samSearchSoftware 返回的 items[].skuCode。与 purchaseTypePathCode 二选一。',
        required: false,
      },
      {
        name: 'purchaseTypePathCode',
        type: PARAMETER_TYPE.STRING,
        description: '采购类别路径编码，来自 samSearchSoftware 返回的 items[].purchaseTypePathCode。与 skuCode 二选一。',
        required: false,
      },
      {
        name: 'note',
        type: PARAMETER_TYPE.STRING,
        description: '申请说明/申请理由，如「日常开发使用」。',
        required: false,
      },
      {
        name: 'skuAuthTypeCode',
        type: PARAMETER_TYPE.STRING,
        description:
          '席位授权对象。INDIVIDUAL=个人授权（默认），ORGANIZATION=组织授权。优先以 samSearchSoftware 返回的 seatAuthTargetType 为准。',
        required: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const samApplyFunctions: FunctionDefinition[] = [
  makeSearchSoftware(),
  makeSubmitSoftwareApply(),
];
