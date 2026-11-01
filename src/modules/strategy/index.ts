/**
 * 战略域: 姿态重估与政策下发。
 */
export { StrategyCore, strategySnapshot, type StrategySnapshot } from "@/modules/strategy/core";
export { directiveFor, type StrategyDirective } from "@/modules/strategy/directive";
export {
	resolveRoomMode,
	roomModeFor,
	roomModeProfileFor,
} from "@/modules/strategy/roomMode";

export {
	getRoomMode,
	getRoomModeProfile,
	isHighLikeMode,
	isSpecialRushActive,
	ROOM_MODE_PROFILES,
	type RoomModeName,
	type RoomModeProfile,
} from "@/modules/strategy/roomModeAccess";
