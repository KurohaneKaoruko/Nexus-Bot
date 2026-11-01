// @ts-nocheck
/**
 * 车道路由偏置 (lane): 把本 creep 管线的 Memory.roads 车道格计入 moveTo 寻路代价,
 * 往返 hauler 的 moveTo 自然并到同一条线上 —— 对向必然相遇, swapLoad 接力才有意义。
 *
 * 不做逐格操舵 (followByPath 式): 偏航恢复之字走/房界入口错位会白耗 tick,
 * moveTo 的成熟寻路 (路径缓存/卡死重算/推挤) 本来就比手动操舵稳。
 *
 * 偏置幅度: 车道格 cost 1, 平原 2 沼泽 10 —— 平原上的车道优势刚好盖过 1 格绕行,
 * 大绕行不划算时仍走直线 (车道是"倾向"不是"铁轨")。
 */

function laneEntry(k) {
	return (Memory.roads || []).find((x) => x.k === k);
}

// 本 creep 管线是否已有车道 (moveTo 代价口径切换的门槛)
function hasLane(creep) {
	return !!(creep.memory && creep.memory.k && laneEntry(creep.memory.k));
}

// 本 tick 的房 → 车道格坐标表 (global 缓存, moveTo 每 creep 每次寻路都会回调)。
// 存数值 key (x<<6|y) 与每房包围盒: 回调里位运算判格免字符串构造, 包围盒
// 把 2500 格全扫收缩到车道实际占据的行列 (lane 集中在带状区域, 常为 1/5 面积)
function laneSets() {
	const g = (global.LANESETS = global.LANESETS && global.LANESETS.t === Game.time ? global.LANESETS : { t: Game.time });
	if (!g.m) {
		g.m = {};
		for (const r of Memory.roads || []) {
			for (const t of r.tiles) {
				const i = t.lastIndexOf(",");
				const rn = t.slice(0, i);
				const ci = t.lastIndexOf(",", i - 1);
				const x = +t.slice(ci + 1, i);
				const y = +t.slice(i + 1);
				const e = (g.m[rn] = g.m[rn] || { s: new Set(), x0: 49, x1: 0, y0: 49, y1: 0 });
				e.s.add(x * 64 + y);
				if (x < e.x0) e.x0 = x;
				if (x > e.x1) e.x1 = x;
				if (y < e.y0) e.y0 = y;
				if (y > e.y1) e.y1 = y;
			}
		}
	}
	return g.m;
}

/**
 * moveTo costCallback 钩子: 外矿 hauler 且其管线有车道时, 车道格 cost 降为 1。
 * 在 traffic.ts 的 moveTo 覆写里调用, 叠加在 KEEP_CLEAR 代价之后。
 */
export function laneBias(creep, roomName, matrix) {
	if (!creep.memory || creep.memory.type !== "hauler" || !creep.memory.k) return;
	if (!laneEntry(creep.memory.k)) return;
	const e = laneSets()[roomName];
	if (!e) return;
	for (let x = e.x0; x <= e.x1; x++)
		for (let y = e.y0; y <= e.y1; y++)
			if (e.s.has(x * 64 + y) && matrix.get(x, y) < 0xff) matrix.set(x, y, 1);
}

export { laneEntry, hasLane };
