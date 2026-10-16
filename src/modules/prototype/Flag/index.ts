
import { extend } from '@/modules/prototype/registry'
import BaseFunction from '@/modules/prototype/Flag/function/baseFunction'
import WarSpawnFunction from '@/modules/prototype/Flag/function/warSpawn'
import LayoutVisualFunction from '@/modules/prototype/Flag/function/layoutVisual'

/** Flag 原型扩展注册表（顺序即挂载顺序） */
export default () => {
    extend(Flag, BaseFunction)
    extend(Flag, WarSpawnFunction)
    extend(Flag, LayoutVisualFunction)
}
