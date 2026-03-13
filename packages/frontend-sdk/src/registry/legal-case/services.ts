import { post, iamPost } from './request';

// ---------------------------------------------------------------------------
// Error tracking (lightweight standalone replacement)
// ---------------------------------------------------------------------------

export function captureError(e: unknown, location?: string) {
  try {
    console.error(`[legal-case] ${location || 'unknown'}:`, e);
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Dict query
// ---------------------------------------------------------------------------

export interface DictKey {
  label: string;
  value: string;
  children?: DictKey[];
}

export function getQuery(params: { dictKeyList: string[] }): Promise<DictKey[]> {
  return post('/v1/ledger/dict/query', params);
}

// ---------------------------------------------------------------------------
// Person search (IAM)
// ---------------------------------------------------------------------------

const PERSON_SCENE_ID = 'IPP_PERSON_ALL';

export async function searchCandidate(keyword: string): Promise<Record<string, any>[]> {
  const json = await iamPost(
    '/iam/account/select/query/search_candidate',
    { keyword, scopes: [1, 2, 3] },
    { 'x-select-scene': PERSON_SCENE_ID },
  );
  return json?.accts || [];
}

// ---------------------------------------------------------------------------
// Case ledger APIs
// ---------------------------------------------------------------------------

type CaseType = 'Civil' | 'Criminal' | 'Administration';

const LEDGER_PATH: Record<CaseType, string> = {
  Civil: '/v1/case/ledger/civil',
  Criminal: '/v1/case/ledger/criminal',
  Administration: '/v1/case/ledger/administration',
};

interface SearchOptions {
  filterType?: string;
  page?: number;
  pageSize?: number;
}

interface SearchResult {
  total: number;
  list: any[];
}

async function executeSearch(
  tabType: CaseType,
  filters: Record<string, unknown>,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const path = LEDGER_PATH[tabType];
  if (!path) {
    throw new Error(`不支持的案件类型: ${tabType}`);
  }
  const result = await post(path, {
    ...filters,
    tabType,
    category: tabType,
    queryType: '2',
    filterType: options.filterType ?? 'ALL',
    page: options.page ?? 1,
    page_size: options.pageSize ?? 20,
  });
  return { total: result?.total ?? 0, list: result?.list ?? [] };
}

export async function searchCaseLedger(
  tabType: CaseType,
  filters: Record<string, unknown>,
  options?: SearchOptions,
): Promise<SearchResult> {
  try {
    return await executeSearch(tabType, filters, options);
  } catch (error) {
    captureError(error, 'skill_case_ledger');
    throw error;
  }
}

export interface BatchQuery {
  tabType?: CaseType;
  filters: Record<string, unknown>;
}

export interface BatchSearchResult {
  total: number;
  list: any[];
  querySummaries: { total: number; list: any[] }[];
}

export async function batchSearchCaseLedger(
  defaultTabType: CaseType | undefined,
  queries: BatchQuery[],
  options?: { filterType?: string },
): Promise<BatchSearchResult> {
  try {
    const tasks = queries.map(
      (query) => () => {
        const effectiveTabType = query.tabType || defaultTabType;
        if (!effectiveTabType) {
          throw new Error('每组查询必须指定 tabType，或提供默认 tabType');
        }
        return executeSearch(effectiveTabType, query.filters, {
          filterType: options?.filterType,
          pageSize: 0,
        });
      },
    );
    const results = await runWithConcurrency(tasks, 5);
    const allItems = results.flatMap((r) => r.list);

    return {
      total: allItems.length,
      list: allItems,
      querySummaries: results.map((r) => ({ total: r.total, list: r.list })),
    };
  } catch (error) {
    captureError(error, 'skill_batch_case_ledger');
    throw error;
  }
}
