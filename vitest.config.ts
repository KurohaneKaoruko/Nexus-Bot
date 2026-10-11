import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 测试统一放 tests/ (项目 .gitignore 排除的是 test/ 单数目录); @/ 绑定 src/
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
