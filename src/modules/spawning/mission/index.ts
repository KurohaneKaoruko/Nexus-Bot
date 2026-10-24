
/**
 * 任务更新主模块
 * @description 以固定频率调度各类任务更新入口（spawn/transport/manage/work/mine 等）
 */
import { qos } from '@/core/qos';
import { getRoomPhase } from '@/utils/roomPhase';
import { getRoomModeProfile } from '@/modules/strategy';

export default class Mission extends Room {
    declare UpdateTransportMission: (offset?: number) => void;
    declare UpdateBoostMission: (offset?: number) => void;
    declare UpdateManageMission: (offset?: number) => void;
    declare UpdateBuildRepairMission: (offset?: number) => void;
    declare UpdateWallRepairMission: (offset?: number) => void;
    declare TransportMissionCheck: () => void;
    declare BuildRepairMissionCheck: () => void;

    /**
     * 任务更新主循环
     * @description 按 interval/offset 分帧调度各子模块更新，降低单 tick CPU 峰值
     */
    override MissionUpdate() {
        const profile = getRoomModeProfile(this);
        const transportInterval = profile.transportMissionInterval;

        const schedule: Array<{ interval: number; offset: number; run: (offset?: number) => void }> = [
            { interval: transportInterval, offset: 1, run: (offset) => this.UpdateTransportMission(offset) },
            { interval: 30, offset: 3, run: (offset) => this.UpdateManageMission(offset) },
            { interval: 50, offset: 4, run: (offset) => this.UpdateBuildRepairMission(offset) },
            { interval: 50, offset: 5, run: (offset) => this.UpdateWallRepairMission(offset) },
            { interval: 100, offset: 6, run: () => this.TransportMissionCheck() },
            { interval: 200, offset: 7, run: () => this.BuildRepairMissionCheck() },
        ];

        const roomPhase = getRoomPhase(this.name);
        for (const item of schedule) {
            // 相位叠加房间哈希：同频任务在房间之间天然错开
            const offset = (item.offset + roomPhase) % item.interval;
            if (qos.isTickAligned(item.interval, offset)) item.run(item.offset);
        }
    }
}
