import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';

/**
 * 控制器周边补给域：按 RCL 放置 storage/terminal 缓冲工地。
 */
export default class ControllerBufferFunction extends Room {
    /**
     * 确保控制器旁有能量缓冲工地（冲级/常驻升级的「围在周边秒取能」配套）。
     * RCL4-7 且控制器 3 格内无 storage/terminal 建筑与同类工地时，
     * 在控制器 2 格内找一个可建位放置 terminal（RCL6+）或 storage 工地。
     * RCL8 不放：升级吞吐已封顶（15e/t）、link 体系接管供能，
     * 且会挤占 layout 正位的 storage/terminal 名额（每类全房只有 1 个）。
     * 建造由 worker 自然完成，本方法只负责放工地（低频调用）。
     */
    override ensureControllerBufferSite() {
        if (this.level < 4 || this.level >= 8) return;
        const controller = this.controller;
        if (!controller?.my) return;

        const hasBuffer =
            (this.storage && this.storage.pos.inRangeTo(controller.pos, 3)) ||
            (this.terminal && this.terminal.pos.inRangeTo(controller.pos, 3));
        if (hasBuffer) return;

        const wanted = this.level >= 6 ? STRUCTURE_TERMINAL : STRUCTURE_STORAGE;
        const existingSite = controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 2)
            .find(s => s.structureType === wanted);
        if (existingSite) return;

        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (this.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
                const pos = new RoomPosition(x, y, this.name);
                const blocked = pos.lookFor(LOOK_STRUCTURES).some(s =>
                    s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART);
                if (blocked) continue;
                if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
                // 工地创建经 broker construction 管线 (原生调用收编 api/17)
                const r = sharedBrokerForDirectCommands().executeNow({
                    id: `cc-buffer-site:${this.name}:${Game.time}:${x},${y}`,
                    tick: Game.time,
                    actorName: this.name,
                    kind: 'createSite',
                    pipeline: 'construction',
                    priority: 40,
                    targetPos: { x, y, roomName: this.name },
                    payload: { structureType: wanted },
                    dedupeKey: `cc-buffer-site:${this.name}:${Game.time}:${x},${y}`,
                });
                if (r.accepted) return;
            }
        }
    }
}
