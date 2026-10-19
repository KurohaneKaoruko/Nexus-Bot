
import { extend } from '@/proto/registry'
import BaseFunction from '@/proto/Creep/function/baseFunction'
import CacheFunction from '@/proto/Creep/function/cacheFunction'
import MoveFunction from '@/proto/Creep/function/moveFuntion'
import BoostFunction from '@/proto/Creep/function/boostFunction'
import WorkFunction from '@/proto/Creep/function/workFunction'
import SourceFunction from '@/proto/Creep/function/sourceFunction'
import DoubleAction from '@/proto/Creep/function/doubleAction'
import CollectFunction from '@/proto/Creep/function/collectFunction'
import CombatFunction from '@/proto/Creep/function/combatFunction'
import BuildFunction from '@/proto/Creep/function/buildFunction'
import HaulFunction from '@/proto/Creep/function/haulFunction'
import ControllerFunction from '@/proto/Creep/function/controllerFunction'
import CreepExecute from '@/proto/Creep/runtime/execute'

/**
 * Creep 原型扩展注册表
 *
 * @remarks
 * 顺序即挂载顺序：基础设施 -> 行为扩展 -> 执行器
 */
export default () => {
    extend(Creep, BaseFunction)
    extend(Creep, CacheFunction)
    extend(Creep, MoveFunction)
    extend(Creep, BoostFunction)
    extend(Creep, WorkFunction)
    extend(Creep, SourceFunction)
    extend(Creep, DoubleAction)
    extend(Creep, CollectFunction)
    extend(Creep, CombatFunction)
    extend(Creep, BuildFunction)
    extend(Creep, HaulFunction)
    extend(Creep, ControllerFunction)
    extend(Creep, CreepExecute)
}
