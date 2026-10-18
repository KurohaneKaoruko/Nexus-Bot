
import { evaluateSourceWorkTiles } from '@/modules/prototype';
import { getProfilerReport } from '@/core/cpuProfiler';
import { invariantSummary } from '@/core/invariantWatch';
import { moveExecutionRate } from '@/modules/movement/trafficMonitor';
import { taskStatusCounts } from '@/modules/tasks/board';
import type { NexusTask } from '@/core/store/taskSchema';

/**
 * 采集/搬运决策诊断命令
 * @description 用法: diag.worktile('creep 名字')
 * 输出 creep 的绑定 source、moveHomeRoom 判定、以及 source 周边八个工作位的
 * 通行性/交通惩罚/评分与当前选中的最佳位——用于定位"采集工不去空位"类问题。
 */
export default {
    diag: {
        /** CPU 观测报告：开启采样 getStatsMemory().profiler = true 后等待 50 tick 再查看 */
        cpu() {
            return getProfilerReport();
        },
        /** 不变量监控摘要 (任务 9.4): 五项不变量的违例计数与最近摘要 */
        invariant() {
            return invariantSummary();
        },
        /** 移动执行率 (任务 5.7): 意图→实际位移的滚动累计口径, 契约基线 ≥97% */
        moveRate() {
            return moveExecutionRate() ?? '无样本 (尚无移动意图窗口)';
        },
        /** 任务账本 (任务 5.3): 各状态任务计数, 由 TaskIndex 状态桶 O(1) 直读 */
        tasks() {
            const nexus = (Memory as unknown as { Nexus?: { tasks?: Record<string, NexusTask> } }).Nexus;
            return taskStatusCounts(nexus?.tasks ?? {});
        },
        worktile(creepName: string) {
            const creep = Game.creeps[creepName] as any;
            if (!creep) return `未找到 creep: ${creepName}`;

            const report: Record<string, any> = {
                unit: creep.memory?.unit,
                home: creep.memory?.home,
                room: creep.room?.name,
                pos: `${creep.pos}`,
                fatigue: creep.fatigue,
                ticksToLive: creep.ticksToLive,
                targetSourceId: creep.memory?.targetSourceId,
                moveHomeRoom: typeof creep.moveHomeRoom === 'function' ? creep.moveHomeRoom() : '(无此方法)',
            };

            const source: Source | null =
                (typeof creep.getBoundSource === 'function' ? creep.getBoundSource() : null) ??
                (creep.memory?.targetSourceId ? Game.getObjectById(creep.memory.targetSourceId) : null);

            if (!source) {
                report.boundSource = null;
                report.note = '未绑定 source——采集工不会移动到任何工作位';
                return report;
            }

            report.boundSource = {
                pos: `${source.pos}`,
                energy: source.energy,
                regenIn: source.ticksToRegeneration,
            };

            const evaluation = evaluateSourceWorkTiles(creep, source);
            report.tiles = evaluation.tiles.map((t) => ({
                tile: `${t.pos.x},${t.pos.y}`,
                passable: t.passable,
                penalty: t.penalty,
                score: t.score,
            }));
            report.bestPos = evaluation.bestPos ? `${evaluation.bestPos.x},${evaluation.bestPos.y}` : null;
            report['已站在最佳位'] = evaluation.bestPos ? creep.pos.isEqualTo(evaluation.bestPos) : null;
            return report;
        },
    },
};
