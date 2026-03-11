import { tool } from "ai";
import { z } from "zod";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// Node.js 环境：直接 import worker，会在主线程作为 fallback 运行
// @ts-ignore - worker 文件没有类型定义
await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

export const readPdf = tool({
  description: "解析 PDF 文件并提取文本内容。支持公开 URL 和内部 CDN URL。",
  inputSchema: z.object({
    url: z.string().url().describe("PDF 文件的 URL 地址"),
  }),
  execute: async ({ url }) => {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      // 使用 pdfjs-dist 加载 PDF（禁用 worker）
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
      });
      const pdf = await loadingTask.promise;
      
      // 提取所有页面的文本
      const textParts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ");
        textParts.push(pageText);
      }
      
      const text = textParts.join("\n\n").trim();
      
      // 获取元数据
      const metadata = await pdf.getMetadata();
      
      // 如果文本为空或很少，说明是图片型 PDF
      if (text.length < 50) {
        return {
          success: true,
          pageCount: pdf.numPages,
          text: "",
          isImageBased: true,
          pdfUrl: url,
          suggestion: "该 PDF 文本内容为空或很少，可能是图片/扫描件。建议使用 imageOcr 工具识别内容。",
          metadata: metadata.info ? JSON.parse(JSON.stringify(metadata.info)) : {},
        };
      }
      
      return {
        success: true,
        pageCount: pdf.numPages,
        text: text,
        isImageBased: false,
        metadata: metadata.info ? JSON.parse(JSON.stringify(metadata.info)) : {},
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  },
});
