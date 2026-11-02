/**
 * 外矿房状态机纯函数 (docs/nexus-design/13 §24.7.1, phase4 4.3)。
 *
 * 六态: candidate → scouting → evaluated → active → (paused ⇄ evaluated) / rejected
 * 转移表 + 最小驻留 + 原因字符串; 纯函数可 node 直跑。
 * 威胁暂停不受驻留约束; pin 跳过净收益门槛与亏损剔除、不跳过安全规则;
 * ban 永不准入。
 */
import { REMOTE_CONFIG } from "@/config/remote";
import type { RemoteState, RemoteRoomRecord } from "@/core/store/memorySchema";

/** 转移输入: 状态机外的事实快照 (调用方现算, 状态机不读环境) */
export interface RemoteTransitionInput {
	/** 候选房 Intel 是否未知/过期 (需侦查) */
	intelStale: boolean;
	/** 侦察是否已到达 (Intel 新鲜) */
	scouted: boolean;
	/** 净收益估算 (能量/tick); scouting 态无值 */
	net?: number;
	/** 他人占有/预定、invader core、敌对结构等安全否决 (true = 不安全) */
	unsafe: boolean;
	/** 手动 pin/ban */
	manual?: "pin" | "ban";
	/** 威胁置信度 (0..1; 超暂停线上限即暂停) */
	threatConfidence: number;
	/** 实测净收入 EMA (active 态亏损剔除判据) */
	measuredNetEma?: number;
	/** 实测净收入连续为负的持续时长 (tick; 超过 lossWindow 才剔除) */
	lossDuration?: number;
	/** 亏损剔除豁免 (true = 亏损判据被外部条件冻结, 如 SK 房无覆盖期) */
	lossExempt?: boolean;
	/** spawn 预算是否有余 (evaluated → active 准入) */
	spawnBudgetAvailable: boolean;
}

/** 转移输出: 目标态 + 原因 (引用量化输入); null = 保持现态 */
export interface RemoteTransition {
	state: RemoteState;
	reason: string;
	/** 威胁暂停立即生效 (不受驻留约束) */
	immediate?: boolean;
}

/**
 * 单房状态转移判定 (§24.7.1 转移表逐条):
 * ```
 * candidate ──(Intel 未知/过期)──► scouting ──(侦察到达)──► evaluated
 * evaluated ──(净收益 > 0 或 pin, 且 spawn 预算有余)──► active
 * evaluated ──(净收益 ≤ 0 / ban / 他人占有或预定 / invader core / 敌对结构)──► rejected
 * active ──(威胁 / 连续死亡)──► paused ──(到期且威胁已衰减)──► evaluated
 * active ──(实测净收入持续 < 0, pin 除外)──► rejected
 * rejected ──(rejectedRetryTicks 后, ban 除外)──► candidate
 * ```
 */
export function remoteTransitionOf(
	record: Pick<RemoteRoomRecord, "state" | "since">,
	input: RemoteTransitionInput,
	now: number,
): RemoteTransition | null {
	// ban 永不准入: 任何态直接 rejected, 立即生效 (安全规则)
	if (input.manual === "ban") {
		return record.state === "rejected"
			? null
			: { state: "rejected", reason: "manual-ban", immediate: true };
	}
	// pin: 跳过净收益门槛与亏损剔除, 不跳过安全规则
	const pin = input.manual === "pin";
	const dwellPassed = now - record.since >= REMOTE_CONFIG.minDwellTicks;

	switch (record.state) {
		case "candidate": {
			if (input.unsafe) {
				return { state: "rejected", reason: "unsafe:occupied-or-hostile", immediate: true };
			}
			if (input.intelStale) {
				return { state: "scouting", reason: "intel:stale-or-unknown" };
			}
			// Intel 新鲜且未走过评估: 直接进 evaluated
			return { state: "evaluated", reason: "intel:fresh" };
		}
		case "scouting": {
			if (input.scouted) {
				return { state: "evaluated", reason: "scout:arrived" };
			}
			if (input.unsafe) {
				return { state: "rejected", reason: "unsafe:occupied-or-hostile", immediate: true };
			}
			return null;
		}
		case "evaluated": {
			if (input.unsafe) {
				return { state: "rejected", reason: "unsafe:occupied-or-hostile", immediate: true };
			}
			if (!dwellPassed) return null;
			if (pin) {
				return input.spawnBudgetAvailable
					? { state: "active", reason: "pin:skip-net-gate" }
					: null;
			}
			if (input.net === undefined) return null;
			if (input.net <= 0) {
				return { state: "rejected", reason: `net:${input.net.toFixed(2)}<=0` };
			}
			if (!input.spawnBudgetAvailable) return null;
			return { state: "active", reason: `net:${input.net.toFixed(2)}>0,budget-ok` };
		}
		case "active": {
			// 威胁暂停不受驻留约束 (immediate)
			if (input.threatConfidence > REMOTE_CONFIG.pauseThreat) {
				return {
					state: "paused",
					reason: `threat:${input.threatConfidence.toFixed(2)}>${REMOTE_CONFIG.pauseThreat}`,
					immediate: true,
				};
			}
			// 亏损剔除 (pin 除外): 持续 lossWindow 才剔 (docs/24 §24.10)
			if (
				!pin &&
				!input.lossExempt &&
				input.measuredNetEma !== undefined &&
				input.measuredNetEma < 0 &&
				(input.lossDuration ?? 0) >= REMOTE_CONFIG.lossWindow &&
				dwellPassed
			) {
				return {
					state: "rejected",
					reason: `measured:${input.measuredNetEma.toFixed(2)}<0 for ${Math.round(input.lossDuration ?? 0)}t`,
				};
			}
			// 安全否决随时生效
			if (input.unsafe) {
				return { state: "rejected", reason: "unsafe:occupied-or-hostile", immediate: true };
			}
			return null;
		}
		case "paused": {
			// 到期且威胁已衰减 → evaluated (重新评估准入)
			const pausedUntil = record.since + REMOTE_CONFIG.pauseTicks;
			if (now >= pausedUntil && input.threatConfidence < REMOTE_CONFIG.resumeThreat) {
				return {
					state: "evaluated",
					reason: `pause-expired,threat:${input.threatConfidence.toFixed(2)}<${REMOTE_CONFIG.resumeThreat}`,
				};
			}
			return null;
		}
		case "rejected": {
			if (pin) {
				// pin 从 rejected 直接回 candidate 重走流程 (跳过的只是净收益门)
				return { state: "candidate", reason: "pin:re-admit" };
			}
			if (!dwellPassed) return null;
			// rejectedRetryTicks 后回 candidate 重试
			if (now - record.since >= REMOTE_CONFIG.rejectedRetryTicks) {
				return { state: "candidate", reason: "retry-window-elapsed" };
			}
			return null;
		}
	}
}
