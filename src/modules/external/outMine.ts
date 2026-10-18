
import { qos } from '@/core/qos';
import { ExternalMine, type ExternalMineTiming } from '@/modules/external/externalMine';
import { getRoomModeProfile } from '@/modules/strategy';
// 外矿真实收入富口径注册（休眠 B 线）: roomWorkforce 退役后自持存根——
// 唤醒 (外矿任务化批次) 时接快照口径的收入估算。
export const registerOutMineIncomeProvider = (): void => {
    /* roomWorkforce 收入注册表已随 5.6 退役, 唤醒时重接 */
};

/** 外矿采集模块（休眠态：外矿活链是 economy/remoteMining 任务板的 planRemoteHarvest） */
export default class OutMine extends Room {
    override outMine() {
        const qosLevel = ExternalMine.prepareRoom(this);
        if (!qosLevel) return;

        if (qosLevel === 'normal' || qos.shouldRun({ every: 5, allowLevels: ['constrained'] })) {
            ExternalMine.runVisuals();
        }

        this.EnergyMine();
        this.CenterMine();
    }

    override EnergyMine() { // 能量矿
        const timing: ExternalMineTiming = {
            normalInterval: getRoomModeProfile(this).remoteEnergyInterval.normal,
            constrainedInterval: getRoomModeProfile(this).remoteEnergyInterval.constrained,
        };
        ExternalMine.runEnergy(this, timing);
    }

    override CenterMine() { // 中央九房
        const timing: ExternalMineTiming = {
            normalInterval: getRoomModeProfile(this).remoteCenterInterval.normal,
            constrainedInterval: getRoomModeProfile(this).remoteCenterInterval.constrained,
        };
        ExternalMine.runCenter(this, timing);
    }
}
