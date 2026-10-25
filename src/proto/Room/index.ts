
import { extend } from '@/proto/registry'
import BaseFunction from '@/proto/Room/function/baseFunction'
import { OutMine } from '@/modules/external'



import {
    MissionSubmit,
    SpawnMission,
} from '@/modules/spawning'

/**
 * Room 原型扩展注册表（顺序即挂载顺序）
 */
export default () => {
    extend(Room, BaseFunction)             // 基础工具
    extend(Room, OutMine)                  // 外矿采集



    extend(Room, MissionSubmit)            // 提交任务 (spawn 池链)
    extend(Room, SpawnMission)             // 孵化任务 (SpawnMissionAdd → spawn 池)
}
