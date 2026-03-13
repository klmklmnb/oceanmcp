import axios from "axios";
import type { AxiosInstance, AxiosResponse, AxiosError } from "axios";
// API响应类型
export interface ApiResponse<T = unknown> {
  retcode: number;
  message: string;
  data?: T;
  code: number;
} 

// 默认配置
const DEFAULT_TIMEOUT = 30000; // 30秒
const DEFAULT_UPLOAD_TIMEOUT = 120000; // 上传文件使用更长的超时时间：2分钟

// 创建通用的响应拦截器配置
const createResponseInterceptor = (serviceName: string) => ({
  success: (response: AxiosResponse<ApiResponse<unknown>>) => {
    if (response.status === 200) {
      const { data, message, code, retcode } = response.data;
      switch (retcode) {
        case 0:
          return data;
        default:
          throw new Error(message);
      }
    } else {
      throw new Error("服务异常");
    }
  },
  error: (error: AxiosError) => {

    return Promise.reject(error);
  },
});

// 创建通用的API客户端工厂函数
const createApiClient = (
  baseURL: string,
  serviceName: string,
  timeout: number = DEFAULT_TIMEOUT
): AxiosInstance => {
  const client = axios.create({
    baseURL,
    timeout,
    headers: {
      "Content-Type": "application/json",
      "x-mi-clientid": "a826a77372839de3",
    },
    withCredentials: true,
  });

  const interceptor = createResponseInterceptor(serviceName);

  client.interceptors.response.use(interceptor.success as any, interceptor.error);

  return client;
};

// 创建CPS服务实例 (neone-stl-svc)
const cpsApiClient: AxiosInstance = createApiClient(
  "https://api-test.agw.mihoyo.com/neone-cps-svc",
  "CPS",
  DEFAULT_TIMEOUT
);

// 创建 Portal 服务客户端（用于 OC 文件上传，使用更长的超时时间）
const portalApiClient: AxiosInstance = createApiClient(
  "https://api-test.agw.mihoyo.com/neone-portal-svc",
  "PORTAL",
  DEFAULT_UPLOAD_TIMEOUT
);

export {
  cpsApiClient, // CPS服务客户端
  portalApiClient, // Portal服务客户端（OC 文件上传）
  createApiClient, // 工厂函数，用于创建自定义配置的客户端
  DEFAULT_TIMEOUT, // 默认超时时间常量
  DEFAULT_UPLOAD_TIMEOUT, // 默认上传超时时间常量
};
