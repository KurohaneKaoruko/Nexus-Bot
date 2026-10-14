
import { extend } from '@/modules/agents/prototype/registry'
import RoomVisualExtension from '@/modules/agents/prototype/RoomVisual/roomVisual'

/** RoomVisual 原型扩展注册表 */
export default () => {
    extend(RoomVisual, RoomVisualExtension)
}
