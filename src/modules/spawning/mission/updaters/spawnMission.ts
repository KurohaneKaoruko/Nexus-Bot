
import { addMissionToPool, getAllMissionFromPool } from '@/modules/spawning/mission/pool/MissionPools';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { isUnitId, UNITS, UnitData, type UnitId } from '@/constant/CreepConstant';
import { decompressBodyConfig } from '@/utils/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { estimateRoomEnergyIncome, getUpgradeWorkTarget, isUpgraderSpawnUrgent, UPGRADE_URGENT_SPAWN_LEVEL, UPGRADE_NEEDED_TTD } from '@/modules/economy';
import { getRoomMode } from '@/modules/strategy';
import { buildRushBody } from '@/utils/rush';
import { isRoomProductionSecured, isRoomRemoteUnlocked } from '@/modules/economy';
import { isEnergyCheckEnabled, isRaceCompat } from '@/config/capabilities';

/** rush 期走容量现算体型的角色集合（其余角色维持动态取表路径） */
const RUSH_BODY_ROLES = new Set<string>([UNITS.harvester, UNITS.carrier, UNITS.upgrader, UNITS.worker]);
import { buildUpgraderBodyConfig } from '@/utils/upgradeBody';
import {
    pruneDelayedUpgraderSpawnMissions,
    pruneRushRemoteMissions,
    effectiveSpawnLevel,
    createSpawnCheckContext,
    getAdjustedSpawnRoleCurrent,
    shouldSpawnRole,
    UnitSpawnCheck,
    getDowngradeUniversalSpawnMissing,
    getMyConstructionSites,
    isRemotePoolTask,
    type SpawnCheckContext,
} from '@/modules/spawning/mission/updaters/spawnRules';

// 供测试与外部模块直接使用孵化判定入口（spawnMission 作为统一出口 re-export）
export {
    createSpawnCheckContext,
    getAdjustedSpawnRoleCurrent,
    shouldSpawnRole,
    UnitSpawnCheck,
    getDowngradeUniversalSpawnMissing,
    getMyConstructionSites,
    pruneDelayedUpgraderSpawnMissions,
    pruneRushRemoteMissions,
    effectiveSpawnLevel,
} from '@/modules/spawning/mission/updaters/spawnRules';

/**
 * rush 期体型现算（两个孵化落点统一入口）。
 *
 * - carrier：收口到 `GetUnitBodys` 的搬运动态体型特例——接力期 `maxCarry 4` 小体型快周转、
 *   lv7+ 直运放开 32、`forRoad` 按**建成的搬运路网覆盖率 ≥ 1/3**。与常规路径**同一口径**，
 *   消除「rush 走 `[C×2g, M×g]` 无上限组、绕开 hauler 口径」的双轨。
 * - harvester / upgrader / worker：走 rush 容量现算生成器（upgrader 传升级缺口与 carryRatio）。
 *
 * @returns 体型配置；null = 当前预算不足最小体型（调用方跳过，不发单）
 */
const buildRushSpawnBody = (
    room: Room,
    unit: UnitId,
    budget: number,
): ((BodyPartConstant | number)[])[] | null => {
    if (unit === UNITS.carrier) {
        const body = (room as any).GetUnitBodys?.(UNITS.carrier, undefined, budget) as
            ((BodyPartConstant | number)[])[] | undefined;
        return Array.isArray(body) && body.length > 0 ? body : null;
    }
    return buildRushBody(
        unit,
        budget,
        unit === UNITS.upgrader ? { maxWork: getUpgradeWorkTarget(room), carryRatio: 1 } : {},
    );
};

export default class SpawnMission extends Room {
    /**
     * rush spawn 平衡（水位门）：控制器容器水位低于升级抽水速率 × 10-tick
     * 缓冲时，暂停升级孵化并清掉升级挂单，把 spawn 让给物流/建造层；
     * 仓库续上后自动恢复。分级下探后的升级单随时能孵，不受此门影响。
     *
     * @returns true 表示本 tick 升级孵化被暂停。
     */
    /**
     * spawn 更新入口
     * @description 按角色规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */
    override UpdateSpawnMission(offset = 0) {
        void offset;
        if (!this.spawn || this.spawn.length === 0) return false;
        pruneDelayedUpgraderSpawnMissions(this);
        // rush 外矿受控让位：本矿编制未满足→外矿挂单清出；超上限→裁最低优先级
        if (getRoomMode(this) === 'rush') {
            pruneRushRemoteMissions(this, getAllMissionFromPool(this.name, MISSION_POOLS.spawn) as Task[]);
        }

        // 控制器容器水位的硬门/删单已移除：升级火力改由 roomWorkforce 的
        // 水位比例节流连续缩放（cc 低水位时火力平滑收缩至 25%，从不清零不删单——
        // 硬门+删单曾让升级单被反复删除、车队整装却无单可孵，RCL2 冻结 2k+ tick）。
        // cc 缺位的 boot 阶段由手填闭环（能量中枢 priority 5）接管供能。

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum();
        const context = createSpawnCheckContext(this, creepNum, spawnMissionNum);

        // 控制器容器的补给已并入 carrier 默认行为（cc 存量低于升级消耗节奏时，
        // carrier 自动把 extension 盈余搬去 cc——见 roomWorkforce.isControllerContainerThirsty
        // 与 carrier.ts 的取货分支），不再有专职涓流岗。
        // 历史教训：deficit 涓流不感知在途挂单，cc 长期空置 + 孵化忙碌时
        // 每轮 +1 永不封口，曾单局灌出 172 条 carrier 挂单。

        // 升级紧迫插队：
        // 实测收入超过在场升级火力（濒死个体不计）时，升级单插队到采集/搬运之前——
        // 收入涨火力涨的自适应闭环；控制器临近降级时无条件最优先（PREVENT_DOWNGRADE）。
        const unitOrder = Object.keys(UnitSpawnCheck);
        {
            const income = estimateRoomEnergyIncome(this);
            let upgradeFire = 0;
            for (const c of this.find(FIND_MY_CREEPS) as Creep[]) {
                if (c.memory.unit !== UNITS.upgrader || c.spawning) continue;
                if ((c.ticksToLive || 1500) <= c.body.length * 3) continue;
                upgradeFire += c.getActiveBodyparts(WORK);
            }
            const preventDowngrade = (this.controller?.ticksToDowngrade ?? 1e9) < UPGRADE_NEEDED_TTD;
            if (preventDowngrade || income > upgradeFire) {
                const i = unitOrder.indexOf(UNITS.upgrader);
                if (i > 0) {
                    unitOrder.splice(i, 1);
                    unitOrder.unshift(UNITS.upgrader);
                }
            }
        }

        for (const unit of unitOrder) {
            const adjusted = getAdjustedSpawnRoleCurrent(context, unit);
            if (unit === UNITS.universal) {
                const rescueMissing = getDowngradeUniversalSpawnMissing(this, adjusted);
                if (rescueMissing > 0) {
                    for (let i = 0; i < rescueMissing; i++) {
                        this.SpawnMissionAdd(
                            UnitData[unit].code,
                            '',
                            UnitData[unit].level,
                            unit,
                            { home: this.name } as CreepMemory
                        );
                    }
                    continue;
                }
            }
            this.checkAndQueueRoleMission(unit as UnitId, context, adjusted);
        }
        return false;
    }

    /** 单角色孵化判定与发单：rush 体型现算 / 缺口门 / 降级 L5 与加急分层 */
    private checkAndQueueRoleMission(unit: UnitId, context: SpawnCheckContext, adjusted: number): void {
        if (!shouldSpawnRole(unit, context, adjusted)) return;
        // rush 体型统一走容量现算（rushBody）：任意预算成本≤预算、分级下探防死锁；
        // 非 rush 维持原路径（upgrader 按定编缺口配体型，其余空 body 动态取表）
        const isRush = getRoomMode(this) === 'rush';
        let body: ((BodyPartConstant | number)[])[] | string = '';
        if (isRush && RUSH_BODY_ROLES.has(unit)) {
            const budget = unit === UNITS.harvester && this.level <= 3
                ? this.energyCapacityAvailable
                : this.energyAvailable;
            // 升级工按缺口封顶（carryRatio=1）；
            // harvester 走默认 maxWork（单矿再生上限）/needCarry=false（rush 低 RCL 无源链）；
            // carrier 收口到 GetUnitBodys 的搬运动态体型口径（见 buildRushSpawnBody）
            const rushBody = buildRushSpawnBody(this, unit, budget);
            // 预算不足最小体型：本轮不发单（空 body 会落到动态取表，且让后续统计踩空）
            if (!rushBody) return;
            body = rushBody as any;
        }
        if (!body && unit === UNITS.upgrader && !isRush) {
            body = buildUpgraderBodyConfig(this.energyCapacityAvailable, getUpgradeWorkTarget(this));
        }
        // 缺口门：WORK 缺口×2 都填不满一个身位时不发单（防小缺口反复孵化空转）。
        // 降级风险豁免：upgradeNeeded 时再小的缺口也孵
        if (unit === UNITS.upgrader && Array.isArray(body)) {
            const bodyWork = body.reduce((sum, [part, n]) => sum + (part === WORK ? Number(n) : 0), 0);
            const deficit = Math.max(0, getUpgradeWorkTarget(this) - adjusted);
            const upgradeNeeded = (this.controller?.ticksToDowngrade ?? 0) < UPGRADE_NEEDED_TTD;
            if (!upgradeNeeded && deficit * 2 < bodyWork) return;
        }
        // 升级任务分层：降级风险 → L5 预防降级（先于 worker L8）；
        // 加急（水位/收入口径） → L10 插到外矿流水线之前；常规 → L7
        const level = unit === UNITS.upgrader
            ? ((this.controller?.ticksToDowngrade ?? 0) < UPGRADE_NEEDED_TTD
                ? 5
                : isUpgraderSpawnUrgent(this)
                    ? UPGRADE_URGENT_SPAWN_LEVEL
                    : UnitData[unit].level)
            : UnitData[unit].level;
        this.SpawnMissionAdd(
            UnitData[unit].code,
            body,
            level,
            unit,
            { home: this.name } as CreepMemory
        );
    }

    /**
     * 添加孵化任务（spawn）
     * @param name - 孵化任务标识（常用 UnitData[unit].code）
     * @param body - 身体配置（数组或压缩字符串）
     * @param level - 任务优先级；<0 时使用默认等级
     * @param unit - creep 角色
     * @param memory - creep memory（会克隆并写入 unit）
     * @param upbody - 是否启用升级 body（可选）
     * @returns OK 表示入队成功，-1 表示失败
     */
    override SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, unit: string, memory?: CreepMemory, upbody?: boolean) {
        if (!(UnitData as any) [unit]) {
            console.log(`unit ${unit} 不存在`);
            return -1;
        }

        if (!memory) memory = {} as CreepMemory;
        else memory = { ...(memory as any) } as CreepMemory;
        memory.unit = unit;

        if (level < 0) level = (UnitData as Record<string, { level: number }>)[unit]?.level ?? 0;
        let bodypart: BodyPartConstant[];
        let energy = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), unit);
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, unit);
            energy = this.CalculateEnergy(bodypart);
        }

        if (energy > this.energyCapacityAvailable && isEnergyCheckEnabled()) return -1;

        if (upbody === undefined) {
            addMissionToPool(this.name, MISSION_POOLS.spawn, 'spawn', level, { name, body, memory, energy });
        } else {
            addMissionToPool(this.name, MISSION_POOLS.spawn, 'spawn', level, { name, body, memory, energy, upbody: !!upbody });
        }
        return OK;
    }
}

// ==================== Getter Helpers ====================
const SPAWN_GETTER_BUDGET_ROLES = new Set<string>([UNITS.harvester, UNITS.transporter, UNITS.carrier, UNITS.manager]);

const getSpawnTaskRole = (taskData?: SpawnTask): UnitId | null => {
    const unit = taskData?.memory?.unit;
    return isUnitId(unit) ? unit : null;
};

type SpawnMissionSelection = {
    highestPriority: number;
    firstAffordableAtHighestPriority: Task | null;
    cheapestBlockedAtHighestPriority: Task | null;
    cheapestBlockedEnergy: number;
    bestAffordableOverall: Task | null;
    bestAffordableOverallLevel: number;
};

const createSpawnMissionSelection = (): SpawnMissionSelection => ({
    highestPriority: Infinity,
    firstAffordableAtHighestPriority: null,
    cheapestBlockedAtHighestPriority: null,
    cheapestBlockedEnergy: Infinity,
    bestAffordableOverall: null,
    bestAffordableOverallLevel: Infinity,
});

const updateSpawnMissionSelection = (
    selection: SpawnMissionSelection,
    task: Task,
    requiredEnergy: number,
    availableEnergy: number,
    effectiveLevel: number = task.level
) => {
    const affordable = requiredEnergy <= availableEnergy;

    if (affordable && effectiveLevel < selection.bestAffordableOverallLevel) {
        selection.bestAffordableOverall = task;
        selection.bestAffordableOverallLevel = effectiveLevel;
    }

    if (effectiveLevel < selection.highestPriority) {
        selection.highestPriority = effectiveLevel;
        selection.firstAffordableAtHighestPriority = affordable ? task : null;
        selection.cheapestBlockedAtHighestPriority = affordable ? null : task;
        selection.cheapestBlockedEnergy = affordable ? Infinity : requiredEnergy;
        return;
    }

    if (effectiveLevel > selection.highestPriority) return;

    if (affordable) {
        selection.firstAffordableAtHighestPriority ??= task;
        return;
    }

    if (requiredEnergy < selection.cheapestBlockedEnergy) {
        selection.cheapestBlockedAtHighestPriority = task;
        selection.cheapestBlockedEnergy = requiredEnergy;
    }
};

/** pickSpawnMission 的可调参数（阈值来自 THRESHOLDS.SPAWN） */
type PickSpawnMissionOptions = {
    allowWaitForPriorityEnergy: boolean;
    queueJumpAllowBelowLevel: number;
};

const pickSpawnMission = (
    selection: SpawnMissionSelection,
    options: PickSpawnMissionOptions
) => {
    if (selection.highestPriority === Infinity) return null;

    if (!options.allowWaitForPriorityEnergy) {
        return selection.bestAffordableOverall || selection.cheapestBlockedAtHighestPriority;
    }

    if (selection.firstAffordableAtHighestPriority) {
        return selection.firstAffordableAtHighestPriority;
    }

    if (
        selection.bestAffordableOverall &&
        selection.bestAffordableOverallLevel < options.queueJumpAllowBelowLevel
    ) {
        return selection.bestAffordableOverall;
    }

    return selection.cheapestBlockedAtHighestPriority;
};

export class SpawnTaskGetter extends Room {
    private getSpawnTaskRequiredEnergy(task: Task, energyAvailable: number): number | null {
        const data = task.data as SpawnTask;
        const unit = getSpawnTaskRole(data);
        if (!unit) return null;

        let body = data.body as ((BodyPartConstant | number)[])[] | string;
        // rush 期本矿四职按当前可用能量现算体型（rushBody 容量现算）：
        // 固定满档体型会被建造/搬运的常态抽取压死——能量落在「够小体、不够大体」的区间时，
        // 动态角色（升级工）连续孵化而固定角色（采集工）永远付不起，滚成只孵一职的死循环。
        // 无稳定收入时矿工体型按当前能量取（income 口径）。
        // 外矿角色不在此处理：无等级表（GetUnitBodys 会返回空 → Infinity），
        // 其体型由派单侧每轮重铺时按预算现算（externalMine 的 buildRemoteMinerBody 口径）
        if (RUSH_BODY_ROLES.has(unit) && getRoomMode(this) === 'rush') {
            body = (buildRushSpawnBody(this, unit, energyAvailable) ?? '') as any;
        }
        const hasFixedBody = (typeof body === 'string' && !!body) || (Array.isArray(body) && body.length > 0);
        let requiredEnergy = Number(data.energy || 0);

        // 空 body 任务是动态体型，必须实时计算能耗；否则 energy=0 会错误抢占队首。
        if (!hasFixedBody) {
            const state = this.memory.energyState || this.updateEnergyState?.(false);
            // rush 期外矿角色恒按当前能量缩（hauler 体型按 energyAvailable 口径）：
            // 外矿单在 L9 等待位上不会卡本矿层，缩体型让外矿在 RCL2-3 就能以小队进场供能
            const allowBudgetSpawn =
                ((state === 'LOW' || state === 'CRITICAL') &&
                SPAWN_GETTER_BUDGET_ROLES.has(unit)) ||
                (unit === UNITS.worker && getMyConstructionSites(this).length > 0) ||
                (getRoomMode(this) === 'rush' && isRemotePoolTask(task));
            const budget = allowBudgetSpawn ? energyAvailable : undefined;
            body = this.GetUnitBodys(unit, data.upbody, budget);
            const bodypart = this.GenerateBodys(body as any[], unit);
            requiredEnergy = bodypart.length > 0 ? this.CalculateEnergy(bodypart) : Infinity;
        } else if (requiredEnergy <= 0) {
            const normalized = typeof body === 'string' ? decompressBodyConfig(body) : body;
            const bodypart = this.GenerateBodys(normalized as any[], unit);
            requiredEnergy = bodypart.length > 0 ? this.CalculateEnergy(bodypart) : Infinity;
            data.energy = requiredEnergy;
        }

        return Number.isFinite(requiredEnergy) && requiredEnergy > 0 ? requiredEnergy : null;
    }

    override getSpawnMission() {
        pruneDelayedUpgraderSpawnMissions(this);
        // energyCheck 关闭：选择器不做能量可行性筛选（大体型挂单不再被可用能量卡死），引擎裁决
        const availableEnergy = isEnergyCheckEnabled() ? (this.energyAvailable || 0) : 1e9;
        const pickOptions = {
            allowWaitForPriorityEnergy: THRESHOLDS.SPAWN.ALLOW_WAIT_FOR_PRIORITY_ENERGY,
            queueJumpAllowBelowLevel: THRESHOLDS.SPAWN.WAIT_ENERGY_QUEUE_JUMP_ALLOW_BELOW_LEVEL,
        };
        const tasks = getAllMissionFromPool(this.name, MISSION_POOLS.spawn);
        const selection = createSpawnMissionSelection();

        // 起步序列闸：解锁闩未开（本矿产出首次就绪前）只放行采集工/升级工/应急 UNIV，
        // 外矿收入线与 worker 全挡——参考 TASK_TYPES 序 OWNED_SOURCE 恒先于 REMOTE_SOURCE；
        // 解锁后外矿单按其档位（经济 L7 / 其他 L9）参与排队，永不再拦（链不断）
        const bootstrapHarvesterOnly = isRaceCompat() && !isRoomProductionSecured(this);

        for (const task of tasks ?? []) {
            if (!task || task.lock) continue;
            // 幻单重试冷却：引擎吞单的挂单退池后间隔重试，不做无效空转
            const phantomAt = (task as any).phantomRetryAt;
            if (phantomAt && Game.time < phantomAt) continue;
            if (bootstrapHarvesterOnly) {
                const taskRole = getSpawnTaskRole(task.data as SpawnTask);
                if (isRemotePoolTask(task)) {
                    // 外矿线：解锁闩未开前不出（本矿链饱和才轮到外矿），解锁后永不拦
                    if (!isRoomRemoteUnlocked(this)) continue;
                } else if (taskRole !== UNITS.harvester && taskRole !== UNITS.upgrader && taskRole !== UNITS.universal) {
                    continue;
                }
            }

            const requiredEnergy = this.getSpawnTaskRequiredEnergy(task, availableEnergy);
            if (requiredEnergy == null) continue;

            // rush 期外矿挂单的有效优先级被压到下限档（受控让位的排序落地）
            updateSpawnMissionSelection(selection, task, requiredEnergy, availableEnergy, effectiveSpawnLevel(this, task));
        }

        // 严格尊重优先级：只有最高优先级层没有能孵化的任务时，才等待该层；
        // 少数例外（例如停摆恢复 universal）仍由 SpawnControl 层处理。
        const picked = pickSpawnMission(selection, pickOptions);
        if (!picked) return null;

        // 收入链连跑保险：外矿 8 房的采集/搬运挂单每轮重铺（L4/L5 常驻海），
        // 升级单（L7）在严格优先级下永远轮不到——attempt 22 实测 RCL2 冻结 2k+ tick。
        // 连续 2 只收入链孵化后，升级单强制插队一次：收入链占 2/3 节拍，升级保 1/3，
        // 有界让位、双向不饿死（升级单不存在/孵不起时收入链照常连跑）。
        const memAny = this.memory as any;
        const pickedMem = (picked.data as any)?.memory;
        const pickedRole = pickedMem?.unit;
        const isRemoteEconomy = !!pickedMem?.sourceRoom && !!pickedMem?.targetRoom
            && (pickedRole === UNITS.harvester || pickedRole === UNITS.carrier);
        if (picked.level >= 4 && picked.level <= 6 && isRemoteEconomy) {
            memAny.incomeChainRun = (memAny.incomeChainRun || 0) + 1;
        } else {
            memAny.incomeChainRun = 0;
            return picked;
        }
        if (memAny.incomeChainRun < 2) return picked;

        for (const task of tasks ?? []) {
            if ((task.data as any)?.memory?.unit !== UNITS.upgrader) continue;
            const required = this.getSpawnTaskRequiredEnergy(task, availableEnergy);
            if (required != null && required <= availableEnergy) {
                memAny.incomeChainRun = 0;
                return task;
            }
        }
        return picked;
    }

    override getSpawnMissionNum() {
        const roomAny = this as any;
        if (roomAny._spawnMissionNumCacheTick === Game.time) {
            return roomAny._spawnMissionNumCache || {};
        }

        const tasks = getAllMissionFromPool(this.name, MISSION_POOLS.spawn);
        const spawnMissionNum: Record<string, number> = {};
        for (const task of tasks ?? []) {
            const data = task.data as SpawnTask;
            const unit = getSpawnTaskRole(data);
            if (!unit) continue;
            spawnMissionNum[unit] = (spawnMissionNum[unit] || 0) + 1;
        }

        roomAny._spawnMissionNumCache = spawnMissionNum;
        roomAny._spawnMissionNumCacheTick = Game.time;
        return spawnMissionNum;
    }

    override getSpawnMissionTotalByRoles(units: string[]) {
        const tasks = getAllMissionFromPool(this.name, MISSION_POOLS.spawn);
        let num = 0;
        for (const task of tasks ?? []) {
            const data = task.data as SpawnTask;
            const unit = getSpawnTaskRole(data);
            if (!unit) continue;
            if (units.includes(unit)) num++;
        }
        return num;
    }
}

