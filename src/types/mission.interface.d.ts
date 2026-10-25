
/**
 * 任务系统接口定义
 * @description 定义房间任务池相关的所有接口和类型
 */
// 六池 (transport/build/repair/terminal/mine/boost) 已随域 3.4 退役; spawn 池为孵化队列基建驻留
type MissionPoolName = 'spawn';
type MissionTaskType = 'spawn';

interface Room {
    // ==================== 任务池基础操作 ====================
    /**
     * 添加任务到任务池
     * @param PoolName - 任务池名称，如'transport'、'spawn'、'build'等
     * @param type - 任务类型
     * @param level - 任务优先级，数值越小优先级越高
     * @param data - 任务数据，根据任务类型不同而不同
     * @returns OK表示添加成功，void表示失败
     * @example room.addMissionToPool('transport', 'transport', 0, { source: sourceId, target: targetId, resourceType: RESOURCE_ENERGY, amount: 1000 });
     */
    addMissionToPool(PoolName: MissionPoolName, type: Task["type"], level: Task["level"], data: Task["data"]): OK | void;

    /**
     * 获取任务池中的所有任务
     * @param PoolName - 任务池名称
     * @returns 任务数组，池不存在返回null
     * @example const tasks = room.getAllMissionFromPool('build');
     */
    getAllMissionFromPool(PoolName: MissionPoolName): Task[] | null;

    /**
     * 获取任务池中的任务数量
     * @param PoolName - 任务池名称
     * @returns 任务数量，池不存在返回0
     * @example const count = room.getMissionNumInPool('transport');
     */
    getMissionNumInPool(PoolName: MissionPoolName): number;

    // ==================== 任务添加方法 ====================


    /**
     * 添加/合并资源发送任务（用于资源管理的去重调度）
     * @param targetRoom - 目标房间名
     * @param resourceType - 资源类型，支持缩写
     * @param amount - 期望的任务amount（会与现有任务amount取较大值）
     * @param maxAmount - 可选，上限限制（防止对同一目标排队过多）
     * @returns OK表示成功，void表示操作完成，false表示参数无效
     * @description 若已存在相同 {targetRoom, resourceType} 的 send 任务，则 nextAmount = max(currentAmount, amount)，避免任务执行中被反复覆盖导致不收敛
     */
    SendMissionUpsertMax(targetRoom: string, resourceType: string | ResourceConstant, amount: number, maxAmount?: number): OK | void | false;



    /**
     * 添加孵化任务
     * @param name - creep名称
     * @param body - 体型配置，可以是压缩形式数组或字符串
     * @param level - 任务优先级，-1表示使用角色默认优先级
     * @param unit - 角色名称，如'harvester'、'upgrader'等
     * @param memory - 可选，creep初始memory
     * @param upbody - 可选，是否使用升级版体型
     * @returns OK(0)表示成功，-1表示失败（角色不存在或能量不足）
     * @example room.SpawnMissionAdd('harvester_1', [[WORK, 5], [CARRY, 1], [MOVE, 3]], 0, 'harvester');
     * @example room.SpawnMissionAdd('upgrader_1', 'w5c1m3', -1, 'upgrader', { targetRoom: 'W1N1' });
     */
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, unit: string, memory?: CreepMemory, upbody?: boolean): OK | -1;

    // ==================== 任务获取方法 ====================






    // ==================== 任务提交方法 ====================

    /**
     * 提交孵化任务完成信息
     * @param id - 任务ID
     * @returns OK表示成功，void表示任务不存在
     * @description 孵化完成后调用，删除对应任务
     * @example room.submitSpawnMission('task_123');
     */
    submitSpawnMission(id: Task['id']): OK | void;

    /**
     * 删除指定 unit 的孵化任务
     * @param units - 单个角色名或角色名数组
     * @returns 本次删除的任务数量
     * @description 常用于防御结束后撤销未孵化的防御兵孵化队列，避免继续出兵浪费能量。
     * @example room.deleteSpawnMissionsByRole(['defend-attack', 'defend-ranged']);
     */
    deleteSpawnMissionsByRole(units: string[] | string): number;
}


// ==================== 任务池接口 ====================
/**
 * 任务池接口
 * @description 存储不同类型的任务数组
 */
interface MissionPool {
    /** 任务类型 -> 任务数组 */
    [type: string]: Task[]
}

// ==================== 任务接口 ====================
/**
 * 任务基础接口
 * @description 所有任务类型的基础结构
 */
interface Task {
    /** 
     * 任务唯一ID
     * @description 由业务生成并保证唯一性，常见形如 'TYPE-XXXX'
     */
    id: string;
    
    /** 
     * 任务优先级
     * @description 数值越小优先级越高，0为最高优先级
     */
    level: number;
    
    /** 
     * 任务类型
     * @description 用于区分不同类型的任务处理逻辑
     */
    type: MissionTaskType;
    
    /**
     * 任务数据
     * @description 根据任务类型存储不同的数据结构
     */
    data: SpawnTask | PowerMineTask | DepositMineTask;
    
    /** 
     * 任务是否被锁定
     * @description 锁定后其他creep无法获取该任务
     */
    lock?: boolean;
    
    /** 
     * 绑定该任务的creep ID
     * @description 用于追踪任务执行者
     */
    bindCreep?: Id<Creep> | null;
}

/**
 * 孵化任务数据
 * @description 用于孵化creep的任务
 */
interface SpawnTask {
    /**
     * creep名称
     * @description 必须唯一，最大100字符
     */
    name: string;

    /**
     * 体型配置
     * @description 可以是压缩形式的体型数组（如[[WORK, 5], [CARRY, 1], [MOVE, 3]]）或压缩字符串
     */
    body: ((BodyPartConstant | number)[])[] | string;

    /**
     * creep初始memory
     * @description 包含role等基础信息
     */
    memory: CreepMemory;

    /**
     * 孵化所需能量
     * @description 预计算的能量消耗
     */
    energy: number;

    /**
     * 是否使用升级版体型
     * @description 某些角色有多种体型配置
     */
    upbody?: boolean;
}

/**
 * 矿场任务数据
 * @description 用于过道采集任务（PowerBank/Deposit）
 */
type MineTask = PowerMineTask | DepositMineTask;

/**
 * PowerBank采集任务数据
 */
interface PowerMineTask {
    /** 目标房间名 */
    targetRoom: string;
    /** 队伍数量 */
    creep: number;
    /** 最大孵化数量限制 */
    max: number;
    /** 强化等级 0/1/2 */
    boostLevel: number;
    /** Ranged数量 */
    prNum: number;
    /** Ranged最大孵化数 */
    prMax: number;
    /** 已孵化队伍计数 */
    count?: number;
    /** 已孵化Ranged计数 */
    prCount?: number;
}

/**
 * Deposit采集任务数据
 */
interface DepositMineTask {
    /** 目标房间名 */
    targetRoom: string;
    /** 需要的工作单位数量 */
    num: number;
    /** 任务是否激活 */
    active: boolean;
}
