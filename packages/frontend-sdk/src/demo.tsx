// Demo entry point - shows how to use the OceanMCP SDK
//
// This file demonstrates how to:
// 1. Import the SDK
// 2. Register pre-bundled skills and their tools
// 3. Mount the chat widget
//
// For production usage, you can:
// - Only import the SDK and use OceanMCPSDK.registerSkill() / registerTool()
// - Or skip this file entirely and use OceanMCPSDK in your own entry point

import React from "react";
import { createRoot } from "react-dom/client";
import OceanMCPSDK from "./main";
import { TestPanel } from "./components/TestPanel";
import { getOssInstance, batchAddFile } from './registry/reimburse/services/oc';
import { reimburseFormService } from './registry/reimburse';


// ─── Register skills ─────────────────────────────────────────────
import { devopsSkill } from "./registry/devops";
import { miCoffeeSkill } from "./registry/mi-coffee";
import { miFoodSkill } from "./registry/mi-food";
import { reimburseSkill } from "./registry/reimburse";
import { vacationSkill } from "./registry/vacation";
import { legalCaseSkill } from "./registry/legal-case";
import { eamReceiveSkill } from "./registry/eam-receive";
import { samSoftwareApplySkill } from "./registry/sam-software-apply";

const preregisteredSkills = [devopsSkill, miCoffeeSkill, miFoodSkill, reimburseSkill, vacationSkill, legalCaseSkill, eamReceiveSkill, samSoftwareApplySkill];
for (const skill of preregisteredSkills) {
  OceanMCPSDK.registerSkill(skill);
}

reimburseFormService.initializeUserData()

// // ─── Register skill from zip ────────────────────────────────────────────────
// OceanMCPSDK.registerSkillFromZip(
//   "https://fastcdn.mihoyo.com/static-resource-v2/2026/02/27/7cc1ae17ed278759a3ba318dafcecf27_7974366858840692508.zip"
// );

// ─── Register upload handler (demo mock) ────────────────────────────────────
OceanMCPSDK.registerUploader(async (files: File[]) => {
  const ossInstance = getOssInstance();

  const uploadPromises = files.map(
    (file) =>
      new Promise<{ url: string; name: string; [key: string]: any }>((resolve, reject) => {
        const controller = new AbortController();

        ossInstance.upload(
          {
            file,
            onSuccess: async (res: unknown) => {
              const { fileId } = res as { fileId: string };
              if (!fileId) {
                reject(new Error('Upload failed: no fileId returned'));
                return;
              }

              try {
                const result = await batchAddFile([
                  { file_id: fileId, file_name: file.name },
                ]);

                const info = result?.list?.[0];
                if (!info) {
                  reject(new Error('Failed to save attachment info'));
                  return;
                }

                const uploadedFile = {
                  ...info,
                  url: info.url ? `${info.url}?isPreview=true` : '',
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  uid: info.id,
                  file_id: info.file_id || fileId,
                };
                resolve(uploadedFile);
              } catch (error) {
                reject(error);
              }
            },
            onError: (error: Error) => reject(error),
            onProgress: (event: { percent: number }) => {
              console.log(`Uploading ${file.name}: ${event.percent}%`);
            },
          },
          controller,
        );
      }),
  );

  return Promise.all(uploadPromises);
});

// ─── Mount the chat widget ──────────────────────────────────────────────────
// OceanMCPSDK.mount({ locale: "zh-CN", model: { default: "z-ai/glm-4.6", maxTokens: 104800 } });
OceanMCPSDK.mount({
  locale: "zh-CN",
  theme: "auto",
  suggestions: [
    { label: "帮我填写报销单" },
    { label: "帮我在米咖点一杯拿铁" },
    { label: "帮我申请一台显示器" },
    { label: "帮我申请 GitLab" },
    { label: "米饭上今天的晚餐是什么？" },
    { label: "你能做什么？" },
    { label: "这个页面有什么？", text: "详细分析当前页面内容" },
  ]
});

// ─── Mount the test panel ───────────────────────────────────────────────────
const panelRoot = document.getElementById("demo-panel");
if (panelRoot) {
  createRoot(panelRoot).render(<TestPanel />);
}
