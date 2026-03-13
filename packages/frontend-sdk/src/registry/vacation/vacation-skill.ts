import { vacationFunctions } from "./vacation-functions";
import type { SkillDefinition } from "../skill-registry";
import instructions from "./vacation-instructions.md?raw";

export const vacationSkill: SkillDefinition = {
  name: "vacation",
  cnName: "请假",
  description:
    "请假审批流程。获取请假表单详情、查看剩余假期余额、可选假期类型和审批链。用户想要请假、查看假期余额时使用。",
  instructions,
  tools: vacationFunctions,
};
