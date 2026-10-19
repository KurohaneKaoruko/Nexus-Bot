
import { extend } from '@/proto/registry'
import BaseFunction from '@/proto/Flag/function/baseFunction'
import WarSpawnFunction from '@/proto/Flag/function/warSpawn'
import LayoutVisualFunction from '@/proto/Flag/function/layoutVisual'

/** Flag 原型扩展注册表（顺序即挂载顺序） */
export default () => {
    extend(Flag, BaseFunction)
    extend(Flag, WarSpawnFunction)
    extend(Flag, LayoutVisualFunction)
}
