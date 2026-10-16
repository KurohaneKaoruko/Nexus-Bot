
import { qos } from '@/core/qos';
import { ExternalMine, ExternalMineAnalysis, type ExternalMineTiming } from '@/modules/external/externalMine';
import { getRoomModeProfile } from '@/modules/strategy';
import { registerRemoteIncomeProvider } from '@/modules/economy';

// 外矿真实收入富口径注册：升级定编（estimateRoomEnergyIncome）由此读到
// 「净收入 × min(采集比, 搬运比)」的瓶颈口径——采集断档/运力不足时，
// 升级吞吐目标随真实到账收缩，不再孵出喂不饱的升级工。
// 本文件只在游戏运行时加载，单测的最小桩环境不 import 这里，
// roomWorkforce 保持零游戏依赖（未注册时回退人数估算口径）。
// 收入提供方注册：由组合根显式调用（registerOutMineIncomeProvider），
// 本文件不再在 import 期注册。externalMine 主模块随本文件加载。
export const registerOutMineIncomeProvider = (): void => {
    registerRemoteIncomeProvider((room) => ExternalMineAnalysis.getRoomRemoteIncome(room));
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
