
import { extend } from '@/modules/prototype/registry'
import BaseFunction from '@/modules/prototype/Room/function/baseFunction'
import { OutMine } from '@/modules/external'



import {
    BoostMission,
    ManageMission,
    ManageTaskGetter,
    MineMission,
    Mission,
    MissionSubmit,
    SpawnMission,
    TransportMission,
    TransportTaskGetter,
    WorkMission,
    WorkTaskGetter,
} from '@/modules/spawning'

/**
 * Room 原型扩展注册表（顺序即挂载顺序）
 */
export default () => {
    extend(Room, BaseFunction)             // 基础工具
    extend(Room, OutMine)                  // 外矿采集



    extend(Room, Mission)                  // 任务模块
    extend(Room, TransportTaskGetter)      // 获取 transport 任务
    extend(Room, WorkTaskGetter)           // 获取 build/repair/wall 任务
    extend(Room, ManageTaskGetter)         // 获取 terminal 任务
    extend(Room, MissionSubmit)            // 提交任务
    extend(Room, ManageMission)            // 管理任务
    extend(Room, WorkMission)              // 工作任务
    extend(Room, MineMission)              // 采矿任务
    extend(Room, SpawnMission)             // 孵化任务
    extend(Room, BoostMission)             // 强化任务
    extend(Room, TransportMission)         // 运输任务
}
