export interface UploadResult {
  url: string;
  name: string;
  size?: number;
  type?: string;
  [key: string]: any;
}

export type UploadHandler = (files: File[]) => Promise<UploadResult[]>;

let handler: UploadHandler | null = null;

export const uploadRegistry = {
  register(fn: UploadHandler) {
    handler = fn;
  },

  unregister() {
    handler = null;
  },

  get isRegistered() {
    return handler !== null;
  },

  async upload(files: File[]): Promise<UploadResult[]> {
    if (!handler) {
      throw new Error(
        "[OceanMCP] No upload handler registered. Call OceanMCPSDK.registerUploader() first.",
      );
    }
    return handler(files);
  },
};
