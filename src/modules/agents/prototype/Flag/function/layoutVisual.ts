
import LayoutVisual from '@/modules/planner/layoutVisual';
import { getLayoutData } from '@/core/store/accessor';
import { decompressBatch } from '@/utils/compress';

export default class LayoutVisualFunction extends Flag {
    // layoutVisual 旗：持续显示所在房的布局预览（数据取自布局 memory，每 tick 重绘）
    override handleLayoutVisualFlag(): boolean {
        if (this.name !== 'layoutVisual') return false;

        const layoutMemory = getLayoutData(this.pos.roomName);
        if (!layoutMemory || typeof layoutMemory !== 'object' || Object.keys(layoutMemory).length === 0) return false;

        const structMap: Record<string, any[]> = {};
        for (const s in layoutMemory) {
            const values = (layoutMemory as any)[s];
            if (!Array.isArray(values)) continue;
            structMap[s] = decompressBatch(values);
        }
        if (Object.keys(structMap).length === 0) return false;
        LayoutVisual.showRoomStructures(this.pos.roomName, structMap);
        return true;
    }
}
