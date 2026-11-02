/**
 * 外矿矿物链人操入口 (specs/dormant-code-retirement 人操豁免登记):
 * power / deposit 定编簿记 (OutMineData.powerMine/depositMine) 与过道监控开关
 * (RoomData.outminePower/outmineDeposit), 由 mineralWork 自动消费; 本入口无自动调用点。
 *
 * 外矿目标管理 (旧 energy/centerRoom 桶) 已由 Nexus.remote.pin/ban/clear/list 取代,
 * 旧入口与外矿道路 console 面随 external-legacy-retire 退役。
 */
import { HighwayMineVisual } from '@/modules/visuals';
import { getOutMineData, getRoomData } from '@/core/store/accessor';

export default {
    mine: {
        auto(sourceRoom: string, type: 'power' | 'deposit') {
            const BotMem = getRoomData()[sourceRoom];
            if (!BotMem) return ERR_NOT_FOUND;
            if (type === 'power') {
                BotMem['outminePower'] = !BotMem['outminePower'];
                console.log(`房间 ${sourceRoom} 的自动采集Power已设置为 ${BotMem['outminePower']}。`);
            } else if (type === 'deposit') {
                BotMem['outmineDeposit'] = !BotMem['outmineDeposit'];
                console.log(`房间 ${sourceRoom} 的自动采集Deposit已设置为 ${BotMem['outmineDeposit']}。`);
            }
            return OK;
        },
        mapShow(sourceRoom?: string) {
            if (sourceRoom) {
                HighwayMineVisual.enable(sourceRoom);
                HighwayMineVisual.visualizeOnMap(sourceRoom);
                console.log(`✓ 已启用 ${sourceRoom} 的 power/deposit 大地图可视化`);
                console.log(`  提示: 也可以创建 Flag "${sourceRoom}/mineMapVisual" 来触发可视化`);
                return OK;
            }

            HighwayMineVisual.enableAll();
            HighwayMineVisual.run();
            console.log('✓ 已启用所有房间的 power/deposit 大地图可视化');
            console.log('  提示: 也可以创建 Flag "ALL/mineMapVisual" 来触发可视化');
            return OK;
        },
        mapHide(sourceRoom?: string) {
            if (sourceRoom) {
                HighwayMineVisual.disable(sourceRoom);
                console.log(`✓ 已禁用 ${sourceRoom} 的 power/deposit 大地图可视化`);
                return OK;
            }

            HighwayMineVisual.disableAll();
            console.log('✓ 已禁用所有房间的 power/deposit 大地图可视化');
            return OK;
        },
        // 立即开始到指定房间开采power
        power(sourceRoom: string, targetRoom: string, num: number, boostLevel: number=0, prNum?: number) {
            if (!sourceRoom || !targetRoom || !num) return -1;
            const room = Game.rooms[sourceRoom];
            if (!room) return;

            // 使用新任务池方法
            if (boostLevel == 1) {
                const stores = [room.storage, room.terminal, ...(room.lab ?? [])]
                const GO_Amount = stores.reduce((a, b) => a + (b?.store['GO']||0), 0);
                const UH_Amount = stores.reduce((a, b) => a + (b?.store['UH']||0), 0);
                const LO_Amount = stores.reduce((a, b) => a + (b?.store['LO']||0), 0);
                if (GO_Amount < 3000 || UH_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${sourceRoom} 的仓库中GO/UH/LO数量不足，无法孵化T1 power开采队。`);
                    return -1;
                }
            } else if (boostLevel == 2) {
                const stores = [room.storage, room.terminal, ...(room.lab ?? [])]
                const GHO2_Amount = stores.reduce((a, b) => a + (b?.store['GHO2']||0), 0);
                const UH2O_Amount = stores.reduce((a, b) => a + (b?.store['UH2O']||0), 0);
                const LO_Amount = stores.reduce((a, b) => a + (b?.store['LO']||0), 0);
                if (GHO2_Amount < 3000 || UH2O_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${sourceRoom} 的仓库中GHO2/UH2O/LO数量不足，无法孵化T2 power开采队。`);
                    return -1;
                }
            }

            const data: PowerMineTask = {
                targetRoom: targetRoom,
                creep: num,                      // creep队伍数
                max: num,                        // 最大孵化数量
                boostLevel: boostLevel || 0,     // 强化等级
                prNum: prNum || 0,              // ranged孵化数量
                prMax: prNum || 0,     // ranged孵化上限
            };

            // 簿记写入 (原 mine 池 'power' 单, 域 3 池退役): mineralWork 定编续排
            // 消费 powerMineBookOf 同键覆盖, 重复下令天然幂等
            const book = getOutMineData(room.name);
            book.powerMine ??= {};
            book.powerMine[targetRoom] = data;
            console.log(`房间 ${sourceRoom} 即将向 ${targetRoom} 派出 ${num} 数量的T${boostLevel} Power开采队。`);
            return OK;
        },
        // 立即开始到指定房间开采deposit
        deposit(sourceRoom: string, targetRoom: string, num: number) {
            if (!sourceRoom || !targetRoom || !num) return -1;
            const room = Game.rooms[sourceRoom];
            if (!room) return;

            const data: DepositMineTask = {
                targetRoom: targetRoom,
                num: num,                      // creep队伍数
                active: true,                  // 是否激活
            }

            // 簿记写入 (原 mine 池 'deposit' 单, 域 3 池退役): 同键覆盖幂等
            const book = getOutMineData(room.name);
            book.depositMine ??= {};
            book.depositMine[targetRoom] = data;
            console.log(`房间 ${sourceRoom} 即将向 ${targetRoom} 派出 ${num} 数量的Deposit开采队。`);
            return OK;
        },
        // 取消指定房间的开采
        cancel(sourceRoom: string, targetRoom: string, type: 'power' | 'deposit') {
            const room = Game.rooms[sourceRoom];
            if (!room) return;

            // 簿记删除 (原 mine 池清理, 域 3 池退役): mineralWork 续排下一拍即止
            const book = getOutMineData(room.name);
            if (!type || type === 'power') delete book.powerMine?.[targetRoom];
            if (!type || type === 'deposit') delete book.depositMine?.[targetRoom];

            // power/deposit 件孵化已桥接 directSpawn 不入 spawn 池——
            // 在途蛋与活体无法取消孵化, 只移除后续轮次的派单 (上方簿记清理)
            console.log(`房间 ${sourceRoom} 的 ${targetRoom} 开采已取消 (已下蛋/在编个体不召回)。`);
            return OK;
        }
    },
}
