/**
 * Memory.b2b 根的全局声明:
 * b2b 通讯模块持久状态 (名单/收发件箱/组密钥), 详见 modules/comms/channel.ts。
 */
import type { B2BState } from "@/modules/comms/channel";

declare global {
	interface Memory {
		b2b?: B2BState | undefined;
	}
}

/** 显式导出使本文件成为模块（保证 declare global 生效） */
export type B2BMemoryRoot = B2BState;
