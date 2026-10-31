/**
 * movement 装配层: 只安装原型 patch 并导出 betterMoveApi。
 */
import { betterMove, betterCancelOrder, betterMoveApi, betterMoveTo, betterPull, findSquadPathTo, wrapFn } from "./movementApi";

Creep.prototype.move = wrapFn(betterMove as unknown as typeof Creep.prototype.move, "move");
PowerCreep.prototype.move = wrapFn(betterMove as unknown as typeof PowerCreep.prototype.move, "move");
Creep.prototype.moveTo = wrapFn(betterMoveTo as unknown as typeof Creep.prototype.moveTo, "moveTo");
PowerCreep.prototype.moveTo = wrapFn(betterMoveTo as unknown as typeof PowerCreep.prototype.moveTo, "moveTo");
Creep.prototype.cancelOrder = betterCancelOrder;
PowerCreep.prototype.cancelOrder = betterCancelOrder;
Creep.prototype.pull = wrapFn(betterPull, "pull");
(RoomPosition.prototype as unknown as { findSquadPathTo: typeof findSquadPathTo }).findSquadPathTo = wrapFn(findSquadPathTo as unknown as (...args: never[]) => number, "findSquadPathTo") as typeof findSquadPathTo;

export { betterMoveApi };
