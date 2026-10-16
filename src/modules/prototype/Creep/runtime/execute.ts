
import { log } from '@/utils/log';
import { getRoleHandler } from '@/modules/prototype/Creep/runtime/registry';
import { ensureMemoryCache } from '@/modules/prototype/Creep/function/cacheFunction';
import { UnitData } from '@/constant/CreepConstant';

const creepExecuteErrorTickCache: Record<string, number> = {};

// 统一执行入口的错误日志：
// 同一类错误每 tick 只记一次，避免配置缺失时刷屏。
const reportExecuteIssue = (key: string, message: string) => {
    const tick = typeof Game !== 'undefined' && typeof Game.time === 'number' ? Game.time : -1;
    if (creepExecuteErrorTickCache[key] === tick) return;
    creepExecuteErrorTickCache[key] = tick;

    log(message);
};

export default class CreepExecute extends Creep {
    override exec() {
        const unit = this.memory.unit;
        if (!unit) return;
        const roledata = (UnitData as any) [unit];
        if (!roledata) {
            reportExecuteIssue(
                `missing-unit:${unit}`,
                `[CreepExecute] 未找到角色 ${unit} 的 UnitData 配置，当前 creep 将跳过执行。`
            );
            return;
        }

        // 新框架下，角色执行入口统一由 executor 字符串声明。
        // 这里不再区分旧的 work/action 模式，只根据统一 id 获取处理器。
        const executor = roledata.executor;
        if (!executor) {
            // 没有执行器绑定的角色直接跳过：
            return;
        }

        const handler = getRoleHandler(executor, (missingId) => {
            reportExecuteIssue(
                `missing-handler:${unit}:${missingId}`,
                `[CreepExecute] 角色 ${unit} 绑定的统一处理器 ${missingId} 不存在，请检查 UnitData.executor 与 roleRegistry 是否一致。`
            );
        });
        if (!handler) return;

        ensureMemoryCache(this.memory);

        // 前置阶段（boost / 绑定 / 前置校验）：返回 false 时本 tick 结束，不进入主流程。
        if (handler.prepare && !handler.prepare(this)) return;

        handler.run(this);
    }
}
