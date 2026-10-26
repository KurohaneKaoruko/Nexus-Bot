/**
 * 通讯域模块: b2b 玩家间加密通信 (公开 segment 98 + ChaCha20/HMAC)。
 * crypto → wire → channel 三层纯函数; 游戏侧适配 (密钥/RawMemory/控制台) 在 b2bRuntime。
 * 状态存 Memory.b2b (含组密钥), 密钥由控制台 b2b.key() 手动设置, 不入库。
 */

export { Comms, b2b, b2bTick, setB2BKey } from "./b2bRuntime";
export { createB2BChannel, freshB2BState } from "./channel";
export type {
	B2BChannel,
	B2BIo,
	B2BState,
	B2BMember,
	ReceivedMessage,
	ChannelOptions,
} from "./channel";
export { deriveKeys, LIMITS, makeNonce, openWithNonce, parsePlain, seal, validName } from "./wire";
export type { B2BKeys, Plain, PlainMsg } from "./wire";
