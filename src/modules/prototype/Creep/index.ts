
import { extend } from '@/modules/prototype/registry'
import BaseFunction from '@/modules/prototype/Creep/function/baseFunction'
import CacheFunction from '@/modules/prototype/Creep/function/cacheFunction'
import MoveFunction from '@/modules/prototype/Creep/function/moveFuntion'
import BoostFunction from '@/modules/prototype/Creep/function/boostFunction'
import WorkFunction from '@/modules/prototype/Creep/function/workFunction'
import SourceFunction from '@/modules/prototype/Creep/function/sourceFunction'
import DoubleAction from '@/modules/prototype/Creep/function/doubleAction'
import CollectFunction from '@/modules/prototype/Creep/function/collectFunction'
import CombatFunction from '@/modules/prototype/Creep/function/combatFunction'
import BuildFunction from '@/modules/prototype/Creep/function/buildFunction'
import HaulFunction from '@/modules/prototype/Creep/function/haulFunction'
import ControllerFunction from '@/modules/prototype/Creep/function/controllerFunction'
import CreepExecute from '@/modules/prototype/Creep/runtime/execute'

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
