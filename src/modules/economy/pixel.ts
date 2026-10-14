/**
 * Pixel 生成 (bucket 溢出变现): 桶满且总闸开启时搓 pixel, 其余 Tick 零成本。
 * P3 档 + 配置默认关——GPL 是长线资产, 不与冲级/防御争桶。
 */
import { PIXEL_CONFIG } from "@/config/economy";
import type { TickModule } from "@/core";

export const Pixel: TickModule = {
	name: "pixel",
	phase: "commit",
	band: "P3",
	run(): void {
		if (!PIXEL_CONFIG.enabled) {
			return;
		}
		if (Game.cpu.bucket < 10000) {
			return;
		}
		Game.cpu.generatePixel();
	},
};
