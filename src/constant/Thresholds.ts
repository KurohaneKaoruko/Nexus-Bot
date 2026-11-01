export const THRESHOLDS = {
    ENERGY: {
        WALL_MIN: 50000,
        SEND_BATCH_ENERGY: 5000,
        SEND_BATCH_MINERAL: 100,
        SEND_REQUEST_MIN: 10000,
        TRANSPORT_MIN: 3000,
        TOWER_REPAIR_THRESHOLD: 200,
        LINK_MIN: 400,
        LAB_MIN_ENERGY: 2000,
        LAB_FILL: 3000,
        LAB_TRIGGER: 50,
        LAB_MIN_CAPACITY: 100,
    },
    UNIVERSAL: {
        CONTROLLER_CONTAINER_BUFFER_TARGET: 1200,
        CONTROLLER_LINK_BUFFER_TARGET: 400,
        CONTROLLER_DOWNGRADE_FORCE_TTD: 5000,
        CONTROLLER_DOWNGRADE_FORCE_TARGET: 2,
    },
    REPAIR: {
        NORMAL_STRUCTURE: 0.8,
        URGENT_WALL: 3000,
        URGENT_RAMPART: 50000,
        RAMPIRT_MAX_THRESHOLD: 0.9,
    },
    TICK: {
        NUKER_CHECK: 50,
        LAB_CHECK: 20,
    },
    TERMINAL: {
        CHECK_MOD: 30,
        CHECK_OFFSET: 2,
        ENERGY_COST_SAMPLE_AMOUNT: 1000,
    },
    RUSH: {
        // 分段目标：目标等级 → { achieve 达成线, pass 合格线（可省略） }；
        // 无 pass 的段，达成线即判废线；耗时单位为相对 lv1 基线的 tick
        SEGMENT_TARGETS: {
            2: { achieve: 500, pass: 1000 },
            3: { achieve: 3000, pass: 5000 },
            4: { achieve: 5000, pass: 10000 },
            5: { achieve: 15000, pass: 20000 },
            6: { achieve: 30000, pass: 40000 },
        },
    },
} as const;
