
/**
 * CPU 桶闭环调控（Tier 1-3）。
 *
 * 把 CPU 桶当作被控变量，用积分控制器实时调节「外矿活跃阈值」：
 * - 桶高于目标 → 阈值下降 → 更多外矿激活
 * - 桶低于目标 → 阈值上升 → 低性价比外矿按 score 挂起
 *
 * 消费方：原型系外矿链 (externalMine runEnergy/runCenter, score 对比阈值) 已随
 * legacy-consolidation-b C 波退役; threshold 当前无消费方, 模块处置待留档复核
 * (docs/bugs/legacy-consolidation-survey.md U.10)。
 *
 * 与 QoS 的分工：governor 管「业务开多少」（平滑可逆），QoS 管「单 tick 硬兜底」。
 */

const TARGET_BUCKET = 9000;      // 桶目标水位
const KI = 0.0008 / 1e6;         // 积分增益
const THRESHOLD_MAX = 2;         // 阈值钳制上限（score 量级 0.1~3）
const SYNC_INTERVAL = 300;       // 常态下 activeThreshold 的同步间隔
const BIG_MOVE_ERROR = 2000;     // 误差超过此值立即同步（快速收缩/扩张）

/** 每 tick 调用一次：更新外矿活跃阈值 */
export const updateBucketGovernor = (): void => {
    // 散键收口 (任务 7.6): 状态迁入 Nexus 命名空间 (Memory.Nexus.bucketGovernor),
    // 根散键只读迁移一次后不再写入——随 legacy 根清理自然消亡
    const root = Memory as any;
    root.Nexus ??= {};
    const mem = (root.Nexus.bucketGovernor ??= { threshold: 0, syncedAt: 0 });
    // legacy 迁移: 首次读取时接管根散键旧值 (口径延续, 不回退调控状态)
    if (mem.threshold === 0 && typeof root.remoteThreshold === 'number' && root.remoteThreshold > 0) {
        mem.threshold = root.remoteThreshold;
        // 旧键一次性清除 (7.6 双轨收敛): 值已接管, 根散键不再保留
        delete root.remoteThreshold;
        delete root.activeThreshold;
        delete root.activeThresholdUpdated;
    }

    const bucket = Game.cpu.bucket || 0;
    const error = bucket - TARGET_BUCKET;

    // 桶高 → 阈值降（扩外矿）；桶低 → 阈值升（挂起低性价比外矿）
    mem.threshold = Math.max(
        0,
        Math.min(THRESHOLD_MAX, mem.threshold - KI * error)
    );

    // 大幅变化立即生效；小幅变化 300 tick 冷却同步（防抖动）
    if (Math.abs(error) > BIG_MOVE_ERROR || Game.time - mem.syncedAt >= SYNC_INTERVAL) {
        mem.active = mem.threshold;
        mem.syncedAt = Game.time;
    }
    mem.updatedAt = Game.time;
};

/** 当前生效的外矿活跃阈值（score 低于此值的外矿应挂起） */
export const getActiveRemoteThreshold = (): number => {
    const gov = (Memory as any).Nexus?.bucketGovernor;
    if (gov && typeof gov.active === 'number') return gov.active;
    // legacy 回退 (迁移窗口): 根散键尚有值时沿用, 迁移后自然归零
    return (Memory as any).activeThreshold ?? 0;
};
