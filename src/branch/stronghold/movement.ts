import type { TickModule } from "@/core";
import { betterMoveApi } from "@/modules/movement";

/**
 * 要塞服 BetterMove 钩子: 编队行动前重置移动意图, 行动后统一结算。
 *
 * @remarks
 * 编队行动在 commit 段登记移动意图, 因此不能复用 Agents Broker 的
 * preTick/endTickResolve 组合——Broker 结算在 Teams 之前, 编队当 tick 的
 * 意图会落在结算之后。要塞服拆成前后两个钩子, 把结算放到 Teams 之后。
 */
export const StrongholdMoveStart: TickModule = {
    name: "stronghold-move-start",
    phase: "commit",
    band: "P0",
    run(): void {
        betterMoveApi.preTickBetterMove();
    },
};

/** 编队行动结束后统一结算移动 (含交通疏导); 无经济工位, 工位判定恒真 */
export const StrongholdMoveEnd: TickModule = {
    name: "stronghold-move-end",
    phase: "commit",
    band: "P3",
    run(): void {
        betterMoveApi.endTickResolve(() => true);
    },
};
