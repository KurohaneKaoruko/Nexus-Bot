/**
 * Memory.Nexus 根的全局声明 (唯一声明):
 * schema 校准系统写入, 各子系统经类型层读写。
 */
import type { NexusMemory } from "./memorySchema";

declare global {
	interface Memory {
		Nexus?: NexusMemory | undefined;
	}
}

export {};
