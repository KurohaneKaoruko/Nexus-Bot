/**
 * Nexus-Bot 缺省入口 (main 变体): 全量基础模块。
 * 上传目标: .secret.json branches.main → 官方/私服 main 分支。
 */
import { DEFAULT_PROFILE } from "@/config/profile";
import { bootNexus } from "@/core/boot";
import { createDefaultModules } from "@/modules/index";

export const loop = bootNexus({ profile: DEFAULT_PROFILE, modules: createDefaultModules() });
