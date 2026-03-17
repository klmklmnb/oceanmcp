type Env = 'test' | 'uat' | 'prod';

let currentEnv: Env = 'test';

const API_BASE: Record<Env, string> = {
  test: 'https://api-test.agw.mihoyo.com',
  uat: 'https://api-uat.agw.mihoyo.com',
  prod: 'https://api.agw.mihoyo.com',
};

export function setEnv(env: Env) {
  currentEnv = env;
}

export function getEnv(): Env {
  return currentEnv;
}

export function getApiBase(): string {
  return API_BASE[currentEnv];
}

const CLIENT_ID = import.meta.env.VITE_LEGAL_CLIENT_ID || '';

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-mi-clientid': CLIENT_ID,
  };
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

async function handleResponse(res: Response): Promise<any> {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  if (json.retcode !== undefined && json.retcode !== 0) {
    throw new Error(json.message || `retcode ${json.retcode}`);
  }
  return json.data;
}

/**
 * POST to legal-ipp-goapp service.
 * Full URL: ${API_BASE}/legal-ipp-goapp${path}
 */
export async function post<T = any>(path: string, data?: unknown): Promise<T> {
  const url = `${getApiBase()}/legal-ipp-goapp${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    credentials: 'include',
    body: data != null ? JSON.stringify(data) : undefined,
  });
  return handleResponse(res);
}

/**
 * POST to IAM service (no /legal-ipp-goapp prefix).
 * Full URL: ${API_BASE}${path}
 */
export async function iamPost<T = any>(
  path: string,
  data?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(extraHeaders),
    credentials: 'include',
    body: data != null ? JSON.stringify(data) : undefined,
  });
  return handleResponse(res);
}
