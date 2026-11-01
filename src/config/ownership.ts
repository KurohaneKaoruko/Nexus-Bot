/**
 * Actor 所有权机制配置 (api/16 actor-ownership spec / 任务 2.3)。
 * 三档模式与租约长度集中于此; 模式切换仅改配置, 不动代码。
 *
 * 模式语义:
 * - record: 冲突只记账, 行为零变化 (默认上线档);
 * - warn:   记账 + 限频告警日志;
 * - enforce: 低优先级 owner 的命令被拦截。
 */

export type OwnershipMode = "record" | "warn" | "enforce";

export interface OwnershipConfig {
	/** 渐进收紧的当前档位 */
	mode: OwnershipMode;
	/** 租约时长 (tick): 逾期未续期自动失效 (spec: 过期未续期自动失效) */
	leaseTicks: number;
	/** warn 档告警限频窗口 (tick): 同一冲突对窗口内只告警一次 */
	warnIntervalTicks: number;
}

export const OWNERSHIP_CONFIG: OwnershipConfig = {
	// 上线口径: warn (sim 已验证 enforce 稳定; 生产观察期后可切 enforce, 见任务 3.8)
	mode: "warn",
	leaseTicks: 5,
	warnIntervalTicks: 500,
};
