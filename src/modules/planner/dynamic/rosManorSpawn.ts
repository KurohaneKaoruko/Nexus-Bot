import type { PlannerPoint, StructMap, XY } from '../shared/plannerUtils'

type PutEntry = [number, number, string]
type SpawnCandidate = [number, number, number]

/**
 * spawn/extension 编排域：从道路距离场挑选编制位，并做手置 spawn 收编、
 * source 采集环保护与近 hub 钳制。直接写入 structMap，返回供后续道路连通的 putList。
 */
export function placeSpawnAndExtensions(
    structMap: StructMap,
    roomStructArr: (number | string)[],
    getNearMinCost: (x: number, y: number, idx: number) => number,
    sourcePois: PlannerPoint[],
    existSpawn: XY | undefined
): PutEntry[] {
	let spawnPos: SpawnCandidate[] = [];
	let extensionPos: SpawnCandidate[] = [];
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			const idx = x * 50 + y;
			const val = roomStructArr[idx];
			if (typeof val !== 'number' || val <= 0) continue;
			const dist = getNearMinCost(x, y, idx) || 100;
			// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
			if (val == 12) {
				// 8 && 12 上面有写，注意！！！
				spawnPos.push([x, y, dist]);
			} else {
				extensionPos.push([x, y, dist]);
			}
		}
	}
	const cmpFunc = (a: SpawnCandidate, b: SpawnCandidate) => (a[2] == b[2] ? (a[1] == b[1] ? a[0] - b[0] : a[1] - b[1]) : a[2] - b[2]);
	spawnPos = spawnPos.sort(cmpFunc);
	extensionPos = extensionPos.sort(cmpFunc);
	const putList: PutEntry[] = [];
	const structOrder = ['spawn', 'nuker', 'powerSpawn', 'tower', 'observer'];
	// 落地手置 spawn 收编：本体已在上方占位为 spawn 首位，这里把该格从其余结构规划中剔除
	// （撞上 lab/tower 等已规划位则移除原条目，下工地阶段按已有结构自然跳过）
	if (existSpawn) {
		const sx = existSpawn.x;
		const sy = existSpawn.y;
		for (const st in structMap) {
			if (st === 'road' || st === 'spawn') continue;
			const arr = structMap[st];
			for (let i = (arr?.length ?? 0) - 1; i >= 0; i--) {
				if (arr?.[i]?.[0] === sx && arr?.[i]?.[1] === sy) arr?.splice(i, 1);
			}
		}
		// 计划 spawn 与本体保持切比雪夫 ≥2（相邻格可、贴脸不可）
		spawnPos = spawnPos.filter((e) => Math.max(Math.abs(e[0]! - sx), Math.abs(e[1]! - sy)) >= 2);
		extensionPos = extensionPos.filter((e) => !(e[0] === sx && e[1] === sy));
		putList.push([sx, sy, 'spawn']);
	}
	// 计划 spawn 相互之间、以及与本体之间均保距 ≥2（贪心：距离序先到先得，贴脸候选让位）
	const spacedSpawnPos: SpawnCandidate[] = [];
	for (const cand of spawnPos) {
		const clash = (structMap['spawn'] ?? []).some((s) => Math.max(Math.abs(s[0] - cand[0]!), Math.abs(s[1] - cand[1]!)) < 2)
			|| spacedSpawnPos.some((s: SpawnCandidate) => Math.max(Math.abs(s[0] - cand[0]!), Math.abs(s[1] - cand[1]!)) < 2);
		if (!clash) spacedSpawnPos.push(cand);
	}
	spawnPos = spacedSpawnPos;
	let spawnIdx = 0;
	let extIdx = 0;
	for (let si = 0; si < structOrder.length; si++) {
		const struct = structOrder[si]!;
		const cnt = (CONTROLLER_STRUCTURES as Record<string, Record<number, number>>)[struct!]![8]! - (struct === 'spawn' && existSpawn ? 1 : 0);
		for (let i = 0; i < cnt; i++) {
			const e = spawnIdx < spawnPos.length ? spawnPos[spawnIdx++] : extensionPos[extIdx++];
			if (!e) continue;
			structMap[struct!]!.push([e[0], e[1]]);
			putList.push([e[0], e[1], struct]);
		}
	}
	const remainPos = extensionPos.slice(extIdx);
	for (let i = spawnIdx; i < spawnPos.length; i++) remainPos.push(spawnPos[i]!);
	extensionPos = remainPos.sort(cmpFunc);
	// 采集环保护 (boot 回归取证): source 8 邻是 miner 站位与源容器选址域——
	// ext 是硬占位建筑, 压环 = 采集面收窄 (boot 实证 source(18,22) 环被占 2/8,
	// L3 9177→12228 回退)。ext 候选剔除全部 source POI 的切比雪夫 1 环。
	// POI 序 [controller, mineral, source1, source2], mineral=index 1 (rosBlock 约定)
	if (sourcePois.length > 0) {
		const protectedIdx = new Set<number>();
		for (const s of sourcePois) {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					protectedIdx.add((s.x! + dx) * 50 + (s.y! + dy));
				}
			}
		}
		extensionPos = extensionPos.filter((e) => !protectedIdx.has(e[0]! * 50 + e[1]!));
	}
	// ext 近 hub 钳制 (批次 I 缺口 1, race 本体 L2@676 口径): ext 的价值 = 孵化
	// 攒能路程短——远离 spawn/hub 的 ext 每次填充多走十几格, L2 期建成也是负资产
	// (实证: 布局 ext 全压 x=43 远东一列, 离 spawn(25,25) 15+ 格, 中段塌方主因)。
	// 以 spawn 本体为圆心切比雪夫 ≤7 环带截断, 环带内不足再放远点兜底。
	if (existSpawn) {
		const sx = existSpawn.x;
		const sy = existSpawn.y;
		const near = extensionPos.filter((e) => Math.max(Math.abs(e[0]! - sx), Math.abs(e[1]! - sy)) <= 7);
		const far = extensionPos.filter((e) => Math.max(Math.abs(e[0]! - sx), Math.abs(e[1]! - sy)) > 7);
		extensionPos = near.length >= 10 ? near.concat(far.slice(0, Math.max(0, 60 - near.length))) : near.concat(far);
	}
	let extCnt = 60;
	for (let i = 0; i < extensionPos.length; i++) {
		const e = extensionPos[i];
		if (extCnt > 0) {
			structMap['extension']!.push([e![0]!, e![1]!]);
			putList.push([e![0]!, e![1]!, 'extension']);
			extCnt -= 1;
		}
	}
	return putList
}
