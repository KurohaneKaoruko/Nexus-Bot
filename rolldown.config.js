// rolldown 构建配置: 分支变体入口选择 + 串接既有 plugins/ 上传链
//   目标解析: DEST=服务器[@账号] (来自 scripts/submit.js), BRANCH=上传分支, VARIANT=构建入口变体
//   不带 DEST 直接运行 (npm run build) 时只构建不上传
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'rolldown';
import screeps from './plugins/plugin-screeps.js';
import { prepareSourceMap, deployToLocalClient } from './plugins/upload.js';
import { loadSecret, getBranches, resolveTarget } from './scripts/secret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = 'main.js';
const OUTPUT_PATH = path.join(__dirname, 'dist', OUTPUT_FILE);

const VARIANT = process.env.VARIANT || 'main';
const BRANCH = process.env.BRANCH || VARIANT;
const DEST = process.env.DEST;

// ── 变体 → 构建入口: .secret.json branches 表优先, 回退约定路径 ──

function listVariantDirs() {
	const branchDir = path.join(__dirname, 'src', 'branch');
	if (!fs.existsSync(branchDir)) return [];
	return fs
		.readdirSync(branchDir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && fs.existsSync(path.join(branchDir, e.name, 'main.ts')))
		.map((e) => e.name);
}

function resolveEntry() {
	const secret = loadSecret();
	const tablePath = getBranches(secret)[VARIANT]?.path;
	const candidates = [
		tablePath,
		VARIANT === 'main' ? 'src/main.ts' : `src/branch/${VARIANT}/main.ts`,
	].filter(Boolean);
	for (const candidate of candidates) {
		const absolute = path.resolve(__dirname, candidate);
		if (fs.existsSync(absolute)) return absolute;
	}
	const known = [...new Set(['main', ...Object.keys(getBranches(secret)), ...listVariantDirs()])];
	throw new Error(`未知变体 "${VARIANT}": 没有对应的入口文件 (可用: ${known.join(', ')})`);
}

// ── 部署目标: API 型服务器走 screeps 上传插件, 本地目录型走复制插件 ──

function resolveTargetPlugin() {
	if (!DEST) return null;
	const secret = loadSecret();
	if (!secret) throw new Error('需要上传但未找到 .secret.json');
	const [serverName, accountName] = DEST.split('@');
	const config = resolveTarget(secret, serverName, accountName);
	if (!config) throw new Error(`无效部署目标: ${DEST} (请检查 .secret.json 的 servers 配置)`);

	if (config.copyPath) {
		return {
			name: 'copy-to-local-client',
			writeBundle() {
				deployToLocalClient({ distDir: path.dirname(OUTPUT_PATH), outputFile: OUTPUT_FILE, copyPath: config.copyPath });
				console.log(`[rolldown] 已复制到本地客户端: ${config.copyPath}`);
			},
		};
	}
	// 上传分支以变体为准 (submit.js 语义: BRANCH = 选定的分支名)
	return screeps({ config: { ...config, branch: BRANCH } });
}

const targetPlugin = resolveTargetPlugin();

export default defineConfig({
	input: resolveEntry(),
	// 路径约定: @/ 绑定 src/, 源码内避免相对路径
	resolve: {
		alias: {
			"@": path.join(__dirname, 'src'),
		},
	},
	// 运行时由服务器模块系统提供 (errorMapper 经 require('main.js.map') 读取)
	external: ['main.js.map'],
	output: {
		file: OUTPUT_PATH,
		// Screeps 模块是 CJS: 主模块通过 exports.loop 暴露主循环
		format: 'cjs',
		sourcemap: true,
	},
	plugins: [
		{
			// 先把 <output>.map 整理成 main.js.map.js (剥 sourcesContent + 包 module.exports)
			name: 'prepare-sourcemap',
			writeBundle() {
				prepareSourceMap({ distDir: path.dirname(OUTPUT_PATH), outputFile: OUTPUT_FILE });
			},
		},
		...(targetPlugin ? [targetPlugin] : []),
	],
});
