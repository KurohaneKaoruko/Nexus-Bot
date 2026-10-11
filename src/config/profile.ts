/**
 * 变体模块开关表。
 * 语义: modules[name] === false 表示禁用 (不注册、零 CPU); 其余情况一律启用。
 * 开关属于运行时行为, 随代码版本管理; 部署目标与凭据在 .secret.json (不入库)。
 */
export type ModuleSwitches = Readonly<Record<string, boolean>>;

export interface VariantProfile {
	/** 变体名, 与 .secret.json branches 的键一致 */
	readonly variant: string;
	readonly modules: ModuleSwitches;
}

/** 缺省变体: 全量基础模块 */
export const DEFAULT_PROFILE: VariantProfile = {
	variant: "main",
	modules: {},
};
