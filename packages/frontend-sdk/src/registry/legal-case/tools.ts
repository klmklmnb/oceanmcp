import React from 'react';
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type ExecutorFunctionDefinition,
  type FlowStep,
} from '@ocean-mcp/shared';
import {
  getQuery,
  searchCandidate,
  searchCaseLedger,
  batchSearchCaseLedger,
  captureError,
  type BatchQuery,
} from './services';
import { CHART_MAP, CHART_ENUM } from './chart';

const MAX_DISPLAY_COUNT = 20;

// ---------------------------------------------------------------------------
// Person cache (for query parameter resolution)
// ---------------------------------------------------------------------------

const PERSON_CACHE_MAX = 100;
const personCache = new Map<string, Record<string, any>>();

function cacheSet(domain: string, data: Record<string, any>) {
  if (personCache.size >= PERSON_CACHE_MAX) {
    const oldest = personCache.keys().next().value;
    if (oldest) personCache.delete(oldest);
  }
  personCache.set(domain, data);
}

// ---------------------------------------------------------------------------
// Tool 1: getCaseLedgerDictOptions
// ---------------------------------------------------------------------------

export const getDictOptionsTool: ExecutorFunctionDefinition = {
  id: 'getCaseLedgerDictOptions',
  name: 'Get Case Ledger Dict Options',
  description: '获取案件台账 Select/Cascader 表单字段的可选值列表，用于将用户描述匹配为实际的筛选值',
  type: FUNCTION_TYPE.EXECUTOR,
  operationType: OPERATION_TYPE.READ,
  executor: async (args: Record<string, any>) => {
    const { dictKeys } = args;
    if (!Array.isArray(dictKeys) || dictKeys.length === 0) {
      return { error: 'dictKeys 参数必须为非空数组' };
    }
    try {
      const res = await getQuery({ dictKeyList: dictKeys });
      const result: Record<string, any[]> = {};
      res.forEach((item) => {
        result[item.value] = (item.children || []).map((child) => ({
          label: child.label,
          value: child.value,
          ...(child.children?.length
            ? { children: child.children.map((c) => ({ label: c.label, value: c.value })) }
            : {}),
        }));
      });
      return result;
    } catch (error) {
      captureError(error, 'cl_dict_err');
      return { error: `获取字典选项失败: ${(error as Error).message}` };
    }
  },
  parameters: [
    {
      name: 'dictKeys',
      type: 'string_array',
      required: true,
      description: '要查询的字典 key 数组，如 ["CASESTAGE_MS", "STATUS_MS"]。可一次查询多个。',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool 2: resolvePerson
// ---------------------------------------------------------------------------

export const resolvePersonTool: ExecutorFunctionDefinition = {
  id: 'resolvePerson',
  name: 'Resolve Person',
  description:
    '根据中文姓名查询匹配的用户信息。用于 PersonSelect 类型字段（主办人、法务协办人、GR协办人）的筛选前置步骤。' +
    '返回匹配的完整用户对象数组（含 cn_name、domain、avatar_url 等），若有多个需让用户根据 domain 选择后再用于搜索。',
  type: FUNCTION_TYPE.EXECUTOR,
  operationType: OPERATION_TYPE.READ,
  executor: async (args: Record<string, any>) => {
    const { name } = args;
    if (!name || typeof name !== 'string') {
      return { error: 'name 参数必须为非空字符串' };
    }
    try {
      const accts = await searchCandidate(name.trim());
      if (accts.length === 0) {
        return { name, persons: [], message: `未找到姓名为「${name}」的人员` };
      }
      accts.forEach((a) => {
        if (a.domain) cacheSet(a.domain, a);
      });
      const persons = accts.map((a) => ({ ...a, label: `${a.cn_name} (${a.domain})` }));
      if (persons.length > 1) {
        const options = persons.map((p, i) => `${i + 1}. ${p.label}`).join('\n');
        return {
          needsDisambiguation: true,
          name,
          persons,
          message: `找到 ${persons.length} 位「${name}」，请选择：\n${options}`,
        };
      }
      return { name, persons };
    } catch (error) {
      captureError(error, 'skill_resolve_person');
      return { error: `查询人员失败: ${(error as Error).message}` };
    }
  },
  parameters: [
    {
      name: 'name',
      type: 'string',
      required: true,
      description: '人员中文姓名，如"潘婷"',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool 3: searchCaseLedger
// ---------------------------------------------------------------------------

export const searchCaseLedgerTool: ExecutorFunctionDefinition = {
  id: 'searchCaseLedger',
  name: 'Search Case Ledger',
  description: '搜索案件台账列表，直接返回结构化搜索结果（list 和 total）。',
  type: FUNCTION_TYPE.EXECUTOR,
  operationType: OPERATION_TYPE.READ,
  executor: async (args: Record<string, any>) => {
    const { tabType, filters = {}, filterType } = args;

    if (!tabType) {
      return {
        success: false,
        message: '必须指定 tabType（Civil/Criminal/Administration）',
      };
    }

    try {
      const result = await searchCaseLedger(tabType, filters, { filterType });
      return {
        success: true,
        total: result.total,
        list: result.list,
      };
    } catch (error) {
      captureError(error, 'skill_search_ledger');
      return { success: false, message: `搜索失败: ${(error as Error).message}` };
    }
  },
  parameters: [
    {
      name: 'tabType',
      type: 'string',
      required: true,
      description: '案件类型 Tab：Civil(民事) | Criminal(刑事) | Administration(行政)。',
      enumMap: {
        Civil: '民事案件',
        Criminal: '刑事案件',
        Administration: '行政案件',
      },
    },
    {
      name: 'filters',
      type: 'object',
      required: true,
      description:
        '筛选条件键值对。key 为字段名（参见 instructions 中的字段列表），value 为对应的值。日期范围用 ["YYYY-MM-DD","YYYY-MM-DD"] 数组。',
    },
    {
      name: 'filterType',
      type: 'string',
      required: false,
      description:
        '数据范围筛选，默认 ALL。枚举值：ALL(全部) | CREATED(我创建的) | EXECUTED(我主办的) | ASSOCIATED(我协办的)',
      enumMap: {
        ALL: '全部',
        CREATED: '我创建的',
        EXECUTED: '我主办的',
        ASSOCIATED: '我协办的',
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool 4: searchCaseLedgerBatch
// ---------------------------------------------------------------------------

export const searchCaseLedgerBatchTool: ExecutorFunctionDefinition = {
  id: 'searchCaseLedgerBatch',
  name: 'Search Case Ledger Batch',
  description:
    '处理需要多次独立查询的案件台账批量搜索场景（如不相邻的日期范围、多字段"或"关系、跨案件类型查询、分别统计等）。并行执行多组查询，返回合并结果和每组独立统计。',
  type: FUNCTION_TYPE.EXECUTOR,
  operationType: OPERATION_TYPE.READ,
  executor: async (args: Record<string, any>) => {
    const { tabType, queries, filterType } = args;

    if (!Array.isArray(queries) || queries.length === 0) {
      return { success: false, message: 'queries 参数必须为非空数组' };
    }

    const batchQueries: BatchQuery[] = queries.map((q: any) => ({
      tabType: q.tabType || undefined,
      filters: q.filters || {},
    }));

    const hasAnyTabType = tabType || batchQueries.some((q) => q.tabType);
    if (!hasAnyTabType) {
      return {
        success: false,
        message: '必须指定 tabType：在顶层指定默认值，或在每组 query 中单独指定',
      };
    }

    try {
      const result = await batchSearchCaseLedger(tabType, batchQueries, { filterType });

      const listWithUrl = result.list.slice(0, MAX_DISPLAY_COUNT).map((item: any) => ({
        caseName: item.caseName,
        caseNumber: item.caseNumber,
        detailUrl: `/case-detail?caseNo=${item.caseNo}&from=case-ledger`,
      }));

      const querySummaries = result.querySummaries.map((summary) => ({
        total: summary.total,
        list: summary.list.slice(0, MAX_DISPLAY_COUNT).map((item: any) => ({
          caseName: item.caseName,
          caseNumber: item.caseNumber,
          detailUrl: `/case-detail?caseNo=${item.caseNo}&from=case-ledger`,
        })),
      }));

      return {
        success: true,
        total: result.total,
        list: listWithUrl,
        querySummaries,
      };
    } catch (error) {
      captureError(error, 'skill_batch_search_ledger');
      return { success: false, message: `批量搜索失败: ${(error as Error).message}` };
    }
  },
  parameters: [
    {
      name: 'tabType',
      type: 'string',
      required: false,
      description:
        '默认案件类型 Tab：Civil(民事) | Criminal(刑事) | Administration(行政)。作为 queries 中未指定 tabType 的项的默认值。',
      enumMap: {
        Civil: '民事案件',
        Criminal: '刑事案件',
        Administration: '行政案件',
      },
    },
    {
      name: 'queries',
      type: 'object',
      required: true,
      description:
        '多组查询条件数组，各组之间为"或"关系。每项结构为 { tabType?: string, filters: object }。tabType 可选，未指定时使用顶层 tabType。示例：[{"tabType":"Civil","filters":{"prosecuteDate":["2024-01-01","2024-03-31"]}},{"tabType":"Criminal","filters":{"caseName":"xxx"}}]',
    },
    {
      name: 'filterType',
      type: 'string',
      required: false,
      description:
        '数据范围筛选，默认 ALL。枚举值：ALL(全部) | CREATED(我创建的) | EXECUTED(我主办的) | ASSOCIATED(我协办的)',
      enumMap: {
        ALL: '全部',
        CREATED: '我创建的',
        EXECUTED: '我主办的',
        ASSOCIATED: '我协办的',
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool 5: renderChart
// ---------------------------------------------------------------------------

function normalizeChartData(raw: unknown[]): Record<string, any>[] {
  return raw.reduce<Record<string, any>[]>((acc, item) => {
    let parsed = item;
    if (typeof item === 'string') {
      try {
        parsed = JSON.parse(item);
      } catch {
        return acc;
      }
    }
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      acc.push(parsed as Record<string, any>);
    }
    return acc;
  }, []);
}

export const renderChartTool: ExecutorFunctionDefinition = {
  id: 'renderChart',
  name: 'Render Chart',
  description:
    'Render query results as a chart visualization. ' +
    'Call this AFTER a query tool returns data. ' +
    'Choose the most appropriate chart type based on data characteristics and user intent.',
  type: FUNCTION_TYPE.EXECUTOR,
  operationType: OPERATION_TYPE.READ,

  executor: async (args: Record<string, any>) => ({
    chartType: args.chartType,
    dataPoints: Array.isArray(args.data) ? args.data.length : 0,
  }),

  showRender: (step: FlowStep) => {
    const { chartType, data: rawData, xField, yField, title } = step.arguments;

    const ChartComponent = CHART_MAP[chartType];
    if (!ChartComponent || !Array.isArray(rawData) || rawData.length === 0) return null;

    const data = normalizeChartData(rawData).filter(
      (d) => d[xField] !== undefined && d[yField] !== undefined,
    );
    if (data.length === 0) return null;

    return React.createElement(ChartComponent, { data, xField, yField, title });
  },

  parameters: [
    {
      name: 'chartType',
      type: 'string',
      description: 'Type of chart to render. Choose based on data shape and user intent.',
      required: true,
      enumMap: CHART_ENUM,
    },
    {
      name: 'data',
      type: 'object_array',
      description:
        'Array of data objects from the query result. ' +
        'Each object should have at least the fields specified by xField and yField.',
      required: true,
    },
    {
      name: 'xField',
      type: 'string',
      description: 'Field name used for X axis (bar/line/area), category label (pie), or X dimension (scatter).',
      required: true,
    },
    {
      name: 'yField',
      type: 'string',
      description: 'Field name used for Y axis (bar/line/area), slice value (pie), or Y dimension (scatter).',
      required: true,
    },
    {
      name: 'title',
      type: 'string',
      description: 'Chart title displayed above the chart.',
      required: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const tools = [
  getDictOptionsTool,
  resolvePersonTool,
  searchCaseLedgerTool,
  searchCaseLedgerBatchTool,
  renderChartTool,
];
