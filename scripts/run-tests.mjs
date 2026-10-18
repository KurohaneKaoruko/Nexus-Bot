#!/usr/bin/env node
/**
 * 单测运行器 (任务 5.3): 源码用 @/ 别名且为 TS, node 原生无法解析——
 * 用 rolldown (既有依赖) 打包 tests/ 下用例到系统临时目录, 再以 node:test 执行。
 * 用法: node scripts/run-tests.mjs [用例文件名 (缺省全跑)]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS_DIR = join(ROOT, "tests");
const OUT_DIR = join(tmpdir(), "nexus-unit-tests");

const arg = process.argv[2];
const files = arg
	? [join(TESTS_DIR, arg.endsWith(".test.ts") ? arg : `${arg}.test.ts`)]
	: readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts")).map((f) => join(TESTS_DIR, f));

if (files.length === 0) {
	console.error("未找到测试用例");
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
let failed = 0;
for (const entry of files) {
	const outFile = join(OUT_DIR, `${entry.split("/").pop()?.replace(/\.ts$/, ".cjs")}`);
	const bundle = await rolldown({
		input: entry,
		platform: "node",
		resolve: { alias: { "@": join(ROOT, "src") } },
		external: (id) => id.startsWith("node:"),
	});
	await bundle.write({ file: outFile, format: "cjs", sourcemap: false });
	await bundle.close();
	console.log(`▶ ${entry.replace(`${ROOT}/`, "")}`);
	try {
		execFileSync(process.execPath, ["--test", outFile], { stdio: "inherit" });
	} catch {
		failed += 1;
	}
}
process.exit(failed === 0 ? 0 : 1);
