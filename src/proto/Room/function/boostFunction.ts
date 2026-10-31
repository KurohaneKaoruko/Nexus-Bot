import { assignBoost, submitBoost, removeBoostEntry } from '@/modules/economy/boostLedger';
import { getStructData } from '@/core/store/accessor';

/**
 * Boost 域：资源校验、体型分配与 lab 任务簿记。
 */
export default class BoostFunction extends Room {
    override CheckBoostRes(bodypart: any[], boostmap: any) {
        if (Object.keys(boostmap).length == 0) return true;
        const normalizeBoostList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            return [v];
        };

        // 支持 boostmap 的 value 为 string 或 string[]：按候选列表顺序，贪心选择可用资源
        const remaining: { [mineral: string]: number } = {};

        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;

            const boostList = normalizeBoostList(boostmap[bp[0]]);
            if (boostList.length <= 0) continue;

            const amount = bp[1] * 30;
            let selected: string | null = null;

            for (const mineral of boostList) {
                const available = remaining[mineral] ?? (this as unknown as Record<string, number>)[mineral] ?? 0;
                if (available >= amount) {
                    selected = mineral;
                    remaining[mineral] = available - amount;
                    break;
                }
            }

            if (!selected) return false;
        }

        return true;
    }

    /** 根据体型和boost配置分配boot任务 */
    override AssignBoostTaskByBody(bodypart: any[], boostmap: any = {}, ownerId?: string) {
        if (!this.CheckBoostRes(bodypart, boostmap)) return false;
        const normalizeBoostList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            return [v];
        };

        // 与 CheckBoostRes 使用同一套选择逻辑，避免检查通过但分配失败
        const remaining: { [mineral: string]: number } = {};

        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;

            const boostList = normalizeBoostList(boostmap[bp[0]]);
            if (boostList.length <= 0) continue;

            const amount = bp[1] * 30;
            let selected: ResourceConstant | null = null;

            for (const mineral of boostList as ResourceConstant[]) {
                const available = remaining[mineral] ?? (this as unknown as Record<string, number>)[mineral] ?? 0;
                if (available >= amount) {
                    selected = mineral;
                    remaining[mineral] = available - amount;
                    break;
                }
            }

            if (!selected) return false;
            if (!this.AssignBoostTask(selected, amount, ownerId)) return false;
        }

        return true;
    }

    /** 给lab分配boost任务 (预订写 economy/boostLedger 簿记) */
    override AssignBoostTask(mineral: ResourceConstant, amount: number, ownerId?: string): boolean {
        return assignBoost(this, mineral, amount, ownerId);
    }

    /** 提交lab boost已完成量 (簿记扣减) */
    override SubmitBoostTask(mineral: string, amount: number, ownerId?: string): ScreepsReturnCode {
        return submitBoost(mineral as ResourceConstant, amount, ownerId) as ScreepsReturnCode;
    }

    /**
     * 获取可用于 Boost 的 Lab
     * @description 优先返回存有该资源的 Lab，其次返回空闲 Lab
     */
    override getBoostLab(mineral: ResourceConstant): StructureLab | null {
        if (!this.lab || this.lab.length === 0) return null;

        const botmem = getStructData(this.name);

        // 1. 优先找已经有该资源的 Lab
        const readyLab = this.lab.find(l =>
            l.mineralType === mineral &&
            l.store[mineral] >= 30 &&
            l.store[RESOURCE_ENERGY] >= 20
        );
        if (readyLab) return readyLab;

        // 2. 找已经有该资源但可能能量不足或量不足的 Lab (正在准备中)
        const preparingLab = this.lab.find(l => l.mineralType === mineral);
        if (preparingLab) return preparingLab;

        // 3. 找被 boostLabs 预定给该资源的 Lab (即使它是空的，或者正在清理)
        if (botmem.boostLabs) {
            // task/fixed 都允许命中：这里仅负责“选中哪个 lab”，真正的填充/清理由 lab 管理与搬运任务板负责
            const reservedLabId = Object.keys(botmem.boostLabs).find(id => botmem.boostLabs![id]?.mineral === mineral);
            if (reservedLabId) {
                const reservedLab = Game.getObjectById(reservedLabId as Id<StructureLab>);
                if (reservedLab) return reservedLab;
            }
        }

        // 4. 找完全空闲且未被占用的 Lab (作为备选，但这通常由 Transport 模块分配)
        // Creep 不应该主动去一个没资源的空 Lab 等待，除非 Transport 已经分配了任务。
        // 所以这里主要返回已经有资源的 Lab。
        // 如果 Transport 还没运到，Creep 应该等待或者去排队。
        // 为了避免 Creep 找不到目标，我们可以返回一个“即将”拥有该资源的 Lab
        // 这需要 Transport 模块标记 Lab 的用途，目前我们简化为：只返回已有资源的 Lab
        return null;
    }

    /** 删除lab boost任务 (簿记条目移除) */
    override RemoveBoostTask(mineral: string) {
        const removed = removeBoostEntry(mineral as ResourceConstant);
        if (removed) {
            console.log(`删除boost任务: ${mineral}`);
            return OK;
        }
        return ERR_NOT_FOUND;
    }

}
