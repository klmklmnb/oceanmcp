import { setEnv } from './request';
import { tools } from './tools';
import type { SkillDefinition } from '../skill-registry';
import instructions from './legal-case-instructions.md?raw';

export function initLegalCase(config?: { env?: 'test' | 'uat' | 'prod' }) {
  if (config?.env) setEnv(config.env);
}

export { initLegalCase as configureLegalCase };

export const legalCaseSkill: SkillDefinition = {
  name: 'legal-case',
  cnName: '案件台账',
  description:
    '案件台账搜索、数据分析与可视化：支持民事/刑事/行政案件查询、多条件批量搜索、图表渲染。' +
    '当用户想要搜索案件、查询台账、按条件过滤案件、统计案件数据、以图表展示案件数据时使用。',
  instructions,
  tools,
};
