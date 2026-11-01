
import { extend } from '@/proto/registry'
import BaseFunction from '@/proto/Creep/function/baseFunction'
import CacheFunction from '@/proto/Creep/function/cacheFunction'
import MoveFunction from '@/proto/Creep/function/moveFuntion'
import BoostFunction from '@/proto/Creep/function/boostFunction'
import CombatFunction from '@/proto/Creep/function/combatFunction'

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
    extend(Creep, CombatFunction)
}
