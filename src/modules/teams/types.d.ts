
// Memory中保存的小队数据
interface TeamCacheMemory {
    /** 低于多少血量的建筑视为可以通行 */
    structHitLimit?: number
    /** spawn 是否危险（spawn 周围 1 格是否禁止通行） */
    isSpawnDanger?: boolean
    /** 四人小队卡位重定向节流 tick */
    blockedReorientTick?: number
    /** 小队推进目标点（以纯对象存储，运行时还原为 RoomPosition） */
    targetPos?: { x: number; y: number; roomName: string }
    /** targetPos 自动换点索引 */
    targetPosIndex?: number
    /** 同 tick 治疗下令幂等标记 */
    healOrdersTick?: number
    /** 最近一次进入 avoid/flee 的 tick */
    lastAvoidTime?: number
    /** 调试：虚拟承伤 */
    _virtual_damage?: number
    /** 强制优先打建筑 */
    forceStructure?: boolean
    [key: string]: any
}

interface TeamMemory {
    name: string,
    time: number, // 创建时间
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '↗' | '→' | '↘' | '↓' | '↙' | '←' | '↖',      // 朝向
    formation: 'line' | 'quad' | 'cross' | 'square3',  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom?: string,    // 目标房间
    creeps: Id<Creep>[],   // 成员数组
    num: number,         // 成员数量
    roomName: string,   // 小队当前所在房间
    spawnFlag?: string  // 该队伍由哪个孵化旗创建
    /** 结构优先集火: 房间内存在该类型可攻击建筑时只打这类 (如要塞塔) */
    structurePriority?: StructureConstant | undefined
    /** 集结期禁火: 不索敌, 推进点回落到指挥旗 (等数量够了再开火推进) */
    holdFire?: boolean | undefined
    /** 推进点锚定指挥旗: 只走到旗位, 攻击仍就地开火 (扇区站位靠旗控制) */
    anchorLock?: boolean | undefined
    cache?: TeamCacheMemory
}

interface Team {
    name: string;
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '↗' | '→' | '↘' | '↓' | '↙' | '←' | '↖';    // 朝向
    formation: 'line' | 'quad' | 'cross' | 'square3' | string;  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom: string;    // 目标房间
    creeps: Creep[],   // 成员数组(只包含存活的成员)
    cache: { [key: string]: any };    // 缓存
    flag: Flag;          // 小队指挥旗
    /** 行动模式（来源：指挥旗 secondaryColor，经 Team 解析为属性） */
    actionMode: 'normal' | 'rush' | 'press';
    /** 索敌模式（来源：指挥旗 color，经 Team 解析为属性） */
    targetMode: 'default' | 'structure' | 'creep' | 'flag';
    /** 结构优先集火类型 (房间内有该类型可攻击建筑时优先打它) */
    structurePriority?: StructureConstant | undefined;
    holdFire?: boolean | undefined;
    anchorLock?: boolean | undefined;
    /** 战斗决策缓存: 当前攻击目标集 */
    _targets?: (Creep | Structure | RoomPosition)[];
    /** 战斗决策缓存: 本 tick 已提交攻击的目标 */
    _attackTargets?: (Creep | Structure)[];
    /** 战斗决策缓存: 房间可攻击建筑 (含缓存) */
    _attackable_structures?: AnyOwnedStructure[];
    /** 战斗决策缓存: 房间可攻击单位 (含缓存) */
    _attackable_creeps?: Creep[];
    /** 战斗决策缓存: 集火用户名成本表 */
    _username_costs?: Record<string, number>;
}
