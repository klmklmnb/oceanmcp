import { OSSSDK } from "@dawn/oss-sdk";
import { portalApiClient } from "./api";

// OC 批量添加附件请求参数
export interface OcBatchAddFileItem {
  file_id: string;
  file_name: string;
}

// 文件信息类型
export interface FileInfo {
  bucket: string;
  created_at: string;
  file_size: string;
  id: string;
  name: string;
  object: string;
  preview_url: string;
  url: string;
  source?: string;
  file_id?: string;
}

// OC 批量添加附件响应
export type OcBatchAddResponse = {
  list: FileInfo[];
};

const OC_API_URL = {
  getUploadUrl: "/public/file/upload_url/get",
  batchGetByFileId: "/public/file/download_url/batch_get",
  batchGetById: "/public/attachment/batch_get",
  batchAddFile: "/public/attachment/batch_add",
};

interface GetUploadUrlResult {
  url?: string;
}

const getOcConfig = () => {
  return {
    upload: {
      delayDownLoad: true,
      getTmpUploadUrl: async () => {
        const result =
          (await portalApiClient.post(
            OC_API_URL.getUploadUrl,
            {}
          )) as GetUploadUrlResult | null | undefined;
        const { url } = result || {};
        if (!url) {
          console.error("获取上传链接失败");
          return { url: "" };
        }
        return { url };
      },
    },
    getFilesUrl: async (
      files: { id: string; fileId: string }[]
    ) => {
      const fetchResult = (await portalApiClient.post(
        OC_API_URL.batchGetByFileId,
        files.map((file) => ({ file_id: file.fileId }))
      )) as { list?: { file_id?: string; file_url?: string; file_name?: string }[] } | null | undefined;
      const { list } = fetchResult || {};
      if (!list || !Array.isArray(list)) {
        console.error("获取文件链接失败");
        return [];
      }
      return files
        .map((file) => {
          const fetchItem = list.find((item) => item?.file_id === file.fileId);
          if (fetchItem?.file_url) {
            return {
              id: file.id,
              fileId: file.fileId,
              fileUrl: fetchItem.file_url,
              fileName: fetchItem.file_name ?? null,
            };
          }
          return null;
        })
        .filter((item) => item !== null);
    },
  };
};

let ossInstance: OSSSDK | null = null;

export const getOssInstance = (): OSSSDK => {
  if (!ossInstance) {
    ossInstance = new OSSSDK(getOcConfig());
  }
  return ossInstance;
};

/**
 * 批量添加附件，获取附件 ID
 */
export const batchAddFile = async (
  files: OcBatchAddFileItem[]
): Promise<OcBatchAddResponse> => {
  return await portalApiClient.post(OC_API_URL.batchAddFile, { list: files });
};
