
import { extend } from '@/proto/registry'
import RoomVisualExtension from '@/modules/visuals/proto/roomVisual'

/** RoomVisual 原型扩展注册表 */
export default () => {
    extend(RoomVisual, RoomVisualExtension)
}
