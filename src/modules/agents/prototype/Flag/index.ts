
import { extend } from '@/modules/agents/prototype/registry'
import BaseFunction from '@/modules/agents/prototype/Flag/function/baseFunction'
import WarSpawnFunction from '@/modules/teams/flags/warSpawn'
import LayoutVisualFunction from '@/modules/agents/prototype/Flag/function/layoutVisual'

/** Flag 原型扩展注册表（顺序即挂载顺序） */
export default () => {
    extend(Flag, BaseFunction)
    extend(Flag, WarSpawnFunction)
    extend(Flag, LayoutVisualFunction)
}
