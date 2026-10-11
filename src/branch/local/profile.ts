import type { VariantProfile } from "@/config/profile";

/**
 * local 变体: 面向本地客户端/私服环境。
 * Phase 0 与缺省变体一致; 具体私服规则对应的开关差异确定后在此收敛。
 */
export const LOCAL_PROFILE: VariantProfile = {
	variant: "local",
	modules: {},
};
