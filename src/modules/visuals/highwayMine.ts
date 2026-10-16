// @ts-nocheck

import { getOutMineData, getRoomData } from '@/core/store/accessor';

/** 高速公路矿可视化: 母房 → 公路矿房连线与开关状态 (地图层绘制) */
export const HighwayMineVisual = {
    MAP_DRAW_INTERVAL: 1,
    POWER_STYLE: {
        stroke: '#ff4d4d',
        strokeWidth: 0.9,
        opacity: 0.75,
        lineStyle: 'solid' as const,
    },
    DEPOSIT_STYLE: {
        stroke: '#4d79ff',
        strokeWidth: 0.8,
        opacity: 0.7,
        lineStyle: 'dashed' as const,
    },
    BOTH_STYLE: {
        stroke: '#a020f0',
        strokeWidth: 0.9,
        opacity: 0.75,
        lineStyle: 'solid' as const,
    },

    enabled: {} as Record<string, boolean>,
    globalEnabled: false,
    lastRunTick: -1,
    lastMapDrawTickBySource: {} as Record<string, number>,

    enable(sourceRoom: string): void {
        this.enabled[sourceRoom] = true;
    },

    disable(sourceRoom: string): void {
        delete this.enabled[sourceRoom];
    },

    enableAll(): void {
        this.globalEnabled = true;
    },

    disableAll(): void {
        this.globalEnabled = false;
        this.enabled = {};
    },

    toggle(sourceRoom: string): boolean {
        this.enabled[sourceRoom] = !this.enabled[sourceRoom];
        return this.enabled[sourceRoom] || false;
    },

    run(): void {
        if (this.lastRunTick === Game.time) return;
        this.lastRunTick = Game.time;

        const qosLevel =
            (globalThis as any).qos?.getQoS?.()?.level ||
            (globalThis as any).QoS?.level ||
            'normal';
        const bucket = Number(Game.cpu.bucket || 0);
        if (qosLevel === 'emergency' || bucket < 1000) return;
        const drawInterval = (qosLevel === 'constrained' || bucket < 5000)
            ? Math.max(5, this.MAP_DRAW_INTERVAL)
            : this.MAP_DRAW_INTERVAL;

        const sourceRoomsToDraw = new Set<string>();

        if (this.globalEnabled || Game.flags['ALL/mineMapVisual']) {
            const outMineData = getOutMineData();
            for (const sourceRoom in outMineData) {
                const highway = outMineData[sourceRoom]?.highway;
                if (highway && highway.length > 0) sourceRoomsToDraw.add(sourceRoom);
            }
        }

        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/mineMapVisual$/);
            if (match) sourceRoomsToDraw.add(match[1]);
        }

        for (const sourceRoom in this.enabled) {
            if (this.enabled[sourceRoom]) sourceRoomsToDraw.add(sourceRoom);
        }

        for (const sourceRoom of sourceRoomsToDraw) {
            const lastMap = this.lastMapDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastMap >= drawInterval) {
                this.lastMapDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeOnMap(sourceRoom);
            }
        }
    },

    visualizeOnMap(sourceRoom: string): void {
        const powerEnabled = !!getRoomData()?.[sourceRoom]?.outminePower;
        const depositEnabled = !!getRoomData()?.[sourceRoom]?.outmineDeposit;
        if (!powerEnabled && !depositEnabled) return;

        const highway = getOutMineData()?.[sourceRoom]?.highway || [];
        if (highway.length === 0) return;

        const sourceCenter = new RoomPosition(25, 25, sourceRoom);
        Game.map.visual.circle(sourceCenter, {
            radius: 1,
            fill: '#ffffff',
            opacity: 0.25,
            stroke: '#ffffff',
            strokeWidth: 0.15,
        });

        const bothEnabled = powerEnabled && depositEnabled;
        const targetDotColor = bothEnabled ? this.BOTH_STYLE.stroke : powerEnabled ? this.POWER_STYLE.stroke : this.DEPOSIT_STYLE.stroke;
        const lineStyle = bothEnabled ? this.BOTH_STYLE : powerEnabled ? this.POWER_STYLE : this.DEPOSIT_STYLE;

        for (const targetRoom of highway) {
            const targetCenter = new RoomPosition(25, 25, targetRoom);

            Game.map.visual.poly([sourceCenter, targetCenter], lineStyle);

            Game.map.visual.circle(targetCenter, {
                radius: 1.2,
                fill: targetDotColor,
                opacity: 0.7,
                stroke: '#ffffff',
                strokeWidth: 0.25,
            });
        }
    },
};
