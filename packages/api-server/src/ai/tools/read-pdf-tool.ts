import { tool } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Polyfill DOMMatrix / ImageData / Path2D for non-browser environments.
// pdfjs-dist evaluates `new DOMMatrix()` at module scope, so these globals
// must exist *before* the library is imported.  In Docker / K8s the optional
// native package @napi-rs/canvas is typically unavailable, causing the
// pdfjs-dist built-in polyfill to fail and the process to crash.
//
// The stubs below are intentionally minimal — we only use pdfjs-dist for
// text extraction, so the canvas rendering paths that rely on real
// DOMMatrix / Path2D functionality are never exercised.
// ---------------------------------------------------------------------------
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;

    constructor(init?: any) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }

    scaleSelf(_sx?: number, _sy?: number) { return this; }
    translateSelf(_tx?: number, _ty?: number) { return this; }
    preMultiplySelf(_other?: any) { return this; }
    multiplySelf(_other?: any) { return this; }
    invertSelf() { return this; }
    translate(_tx?: number, _ty?: number) { return new DOMMatrixStub(); }
    scale(_sx?: number, _sy?: number) { return new DOMMatrixStub(); }
    multiply(_other?: any) { return new DOMMatrixStub(); }
    inverse() { return new DOMMatrixStub(); }
    transformPoint(_point?: any) { return { x: 0, y: 0, z: 0, w: 1 }; }
    toFloat64Array() { return new Float64Array(16); }
    toFloat32Array() { return new Float32Array(16); }
  }
  (globalThis as any).DOMMatrix = DOMMatrixStub;
}

if (typeof globalThis.Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    addPath(_path?: any, _transform?: any) {}
    closePath() {}
    moveTo(_x: number, _y: number) {}
    lineTo(_x: number, _y: number) {}
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
    arc(_x: number, _y: number, _r: number, _sa: number, _ea: number, _ccw?: boolean) {}
    arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _r: number) {}
    rect(_x: number, _y: number, _w: number, _h: number) {}
    ellipse(_x: number, _y: number, _rx: number, _ry: number, _rot: number, _sa: number, _ea: number, _ccw?: boolean) {}
  };
}

if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(swOrData: any, sh: number, maybeHeight?: number) {
      if (swOrData instanceof Uint8ClampedArray) {
        this.data = swOrData;
        this.width = sh;
        this.height = maybeHeight ?? (swOrData.length / (sh * 4));
      } else {
        this.width = swOrData;
        this.height = sh;
        this.data = new Uint8ClampedArray(swOrData * sh * 4);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Lazy-load pdfjs-dist to avoid executing module-scope code at server startup.
// The polyfills above are already in place, so when pdfjs-dist loads it will
// find DOMMatrix / Path2D / ImageData on globalThis and skip its own (failing)
// polyfill attempt.
// ---------------------------------------------------------------------------
let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-ignore - worker 文件没有类型定义
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  return pdfjsLib;
}

export const readPdf = tool({
  description: "解析 PDF 文件并提取文本内容。支持公开 URL 和内部 CDN URL。",
  inputSchema: z.object({
    url: z.string().url().describe("PDF 文件的 URL 地址"),
  }),
  execute: async ({ url }) => {
    try {
      const pdfjs = await getPdfjsLib();

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      // 使用 pdfjs-dist 加载 PDF（禁用 worker）
      const loadingTask = pdfjs.getDocument({
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
