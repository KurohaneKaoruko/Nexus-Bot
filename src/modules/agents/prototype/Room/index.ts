
import { extend } from '@/modules/agents/prototype/registry'
import BaseFunction from '@/modules/agents/prototype/Room/function/baseFunction'
import OutMine from '@/modules/external/outMine'



import Mission from '@/modules/spawning/mission'
import MissionSubmit from "@/modules/spawning/mission/pool/MissionSubmit"
import ManageMission, { ManageTaskGetter } from "@/modules/spawning/mission/updaters/manageMission"
import WorkMission, { WorkTaskGetter } from "@/modules/spawning/mission/updaters/workMission"
import MineMission from "@/modules/spawning/mission/updaters/mineMission"
import SpawnControl from '@/modules/spawning/legacy/spawnControl'
import SpawnMission, { SpawnTaskGetter } from '@/modules/spawning/mission/updaters/spawnMission'
import BoostMission from "@/modules/spawning/mission/updaters/boostMission"
import TransportMission, { TransportTaskGetter } from "@/modules/spawning/mission/updaters/transportMission"

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
    extend(Room, SpawnControl)             // 孵化控制 (任务池孵化主链)
    extend(Room, SpawnTaskGetter)          // 获取孵化任务
    extend(Room, SpawnMission)             // 孵化任务
    extend(Room, BoostMission)             // 强化任务
    extend(Room, TransportMission)         // 运输任务
}
