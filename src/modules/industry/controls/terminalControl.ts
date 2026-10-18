
import { updateMissionPool, deleteMissionFromPool } from '@/modules/spawning';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { log } from '@/utils/log';
import { THRESHOLDS } from "@/constant/Thresholds";
import { isRoomTickAligned } from '@/utils/roomPhase';
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';

/** 终端发送任务执行: 相位错峰 + 发送任务消费 (原 TerminalWork 改写) */
export function terminalWork(room: Room): void {
        // 每 30 tick 一检，叠加房间相位错峰（保持原 offset 的节奏位置，仅消除多房同 tick 共振）
        if (!isRoomTickAligned(room.name, THRESHOLDS.TERMINAL.CHECK_MOD, -THRESHOLDS.TERMINAL.CHECK_OFFSET)) return;
        const terminal = room.terminal;
        if (!terminal || terminal.cooldown > 0) return;

        const task = room.getSendMission();
        if (!task) return;

        const sendData = task.data as SendTask;
        const { targetRoom, resourceType, amount } = sendData;
        if (!targetRoom || !resourceType || !amount || amount <= 0) {
            deleteMissionFromPool(room.name, MISSION_POOLS.terminal, task.id);
            return;
        }

        const resourceInTerminal = terminal.store[resourceType] || 0;
        const energyInTerminal = terminal.store[RESOURCE_ENERGY] || 0;

        let sendAmount = Math.min(amount, resourceInTerminal);
        if (sendAmount <= 0) return;

        let cost = 0;
        if (resourceType === RESOURCE_ENERGY) {
            // 能量发送：需要满足 send + cost(send) <= energyInTerminal
            // 用 sampleAmount 估算 cost/amount（ratio）来近似求解最大可发送量，减少试探/反复 calc
            if (energyInTerminal <= 0) return;
            const sampleAmount = THRESHOLDS.TERMINAL.ENERGY_COST_SAMPLE_AMOUNT;
            const ratio = Game.market.calcTransactionCost(sampleAmount, room.name, targetRoom) / sampleAmount;
            sendAmount = Math.min(sendAmount, Math.floor(energyInTerminal / (1 + ratio)));
            if (sendAmount <= 0) return;
            cost = Game.market.calcTransactionCost(sendAmount, room.name, targetRoom);
            if (sendAmount + cost > energyInTerminal) return;
        } else {
            // 非能量发送：用 energyInTerminal 作为“手续费池”，不足则按比例缩小 sendAmount 并复算 cost
            if (energyInTerminal <= 0) return;
            cost = Game.market.calcTransactionCost(sendAmount, room.name, targetRoom);
            if (cost > energyInTerminal) {
                sendAmount = Math.floor(sendAmount * (energyInTerminal / cost));
                if (sendAmount <= 0) return;
                cost = Game.market.calcTransactionCost(sendAmount, room.name, targetRoom);
                if (cost > energyInTerminal) return;
            }
        }
        if (sendAmount <= 0) return;

        // 经命令边界同步执行 (api/17 market 管线): 原生调用权收编进 broker
        const sendResult = sharedBrokerForDirectCommands().executeNow({
            id: `terminal-send:${room.name}:${Game.time}:${resourceType}:${targetRoom}`,
            tick: Game.time,
            actorName: room.name,
            kind: "terminalSend",
            pipeline: "market",
            priority: 50,
            resourceType,
            amount: sendAmount,
            payload: { destinationRoom: targetRoom },
            dedupeKey: `terminal-send:${room.name}:${Game.time}:${resourceType}:${targetRoom}`,
        });
        const result = sendResult.accepted ? OK : (sendResult.nativeReturnCode ?? ERR_INVALID_ARGS);
        if (result === OK) {
            const remaining = amount - sendAmount;
            if (remaining > 0) {
                updateMissionPool(room.name, MISSION_POOLS.terminal, task.id, {data: {...sendData, amount: remaining}} as any);
            } else {
                deleteMissionFromPool(room.name, MISSION_POOLS.terminal, task.id);
            }
            log('资源发送', `${room.name} -> ${targetRoom}, ${sendAmount} ${resourceType}, 能量消耗: ${cost}`);
        } else {
            if (result === ERR_INVALID_ARGS) {
                deleteMissionFromPool(room.name, MISSION_POOLS.terminal, task.id);
            }
            log('资源发送', `${room.name} -> ${targetRoom}, ${sendAmount} ${resourceType} 失败，错误代码：${result}`);
        }
    }
