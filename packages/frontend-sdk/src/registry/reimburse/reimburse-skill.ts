import { reimburseFunctions } from './reimburse-functions';
import type { SkillDefinition } from '../skill-registry';
import { instructions } from './reimburse-instructions';

export const reimburseSkill: SkillDefinition = {
  name: 'reimburse',
  cnName: '报销小助理',
  description: 'AI 报销助手。辅助用户填写报销单，包括标题、事由、费用明细等字段。当用户需要创建或编辑报销单时使用。',
  instructions,
  tools: reimburseFunctions,
};
