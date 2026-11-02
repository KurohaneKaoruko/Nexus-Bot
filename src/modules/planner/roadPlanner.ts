/**
 * 外矿路网干线规划 (docs/nexus-design/13 §24.2 二期, remote-roads 1.1)。
 *
 * active 外矿房 → 母房 storage 的 PathFinder 干线: 一次性规划 + 失效重规划,
 * 结果落 Memory.Nexus.layout.roads (跨房切段)。放量与维修不在此文件:
 * 放量经 intentQueue createSite 意图 (sitePlacement 同管线), 维修登记在
 * remote planner 巡查节拍。
 */
import type { TickContext } from "@/core";
import { REMOTE_CONFIG } from "@/config/remote";
import { layoutRoot } from "@/modules/planner/memory";
import type { RoadRecord, RoadSegment } from "@/core/store/memorySchema";

/** 干线失效重规划间隔 (tick): 地形不会变, 但容器位/storage 位可能挪 */
const REPLAN_INTERVAL = 20000;

/** 打包坐标 (x,y) → number */
function packXY(x: number, y: number): number {
	return x * 50 + y;
}

/** 路径按房切段: 相邻元素同房聚合, 保持顺序 */
function segmentsOf(path: { x: number; y: number; roomName: string }[]): RoadSegment[] {
	const out: RoadSegment[] = [];
	let current: RoadSegment | null = null;
	for (const pos of path) {
		if (!current || current.room !== pos.roomName) {
			current = { room: pos.roomName, xy: [] };
			out.push(current);
		}
		current.xy.push(packXY(pos.x, pos.y));
	}
	return out;
}

/** 干线记录查询 (coverage 计算/维修巡查共用) */
export function roadRecordOf(roomName: string): RoadRecord | undefined {
	return layoutRoot().roads?.[roomName];
}

/** 干线已建覆盖率 (0..1): counts 配比档的输入 */
export function roadCoverageOf(roomName: string): number {
	const rec = roadRecordOf(roomName);
	return rec?.coverage ?? 0;
}

/**
 * 规划单条干线: 外矿容器位 → 母房 storage 位。
 * CPU 保护: 复用 REMOTE_CONFIG.evalPerRun 的调用方限额 (本函数不自计数);
 * incomplete / 缺视野 / 缺 storage 返回 undefined 不落盘。
 */
export function planRemoteRoad(
	homeName: string,
	roomName: string,
	from: { x: number; y: number },
): RoadRecord | undefined {
	const home = Game.rooms[homeName];
	const storagePos = home?.storage?.pos ?? getLayoutCenter(homeName);
	if (!storagePos) return undefined;

	const result = PathFinder.search(
		new RoomPosition(storagePos.x, storagePos.y, homeName),
		{ pos: new RoomPosition(from.x, from.y, roomName), range: 1 },
		{
			plainCost: REMOTE_CONFIG.roads.plainCost,
			swampCost: REMOTE_CONFIG.roads.swampCost,
			maxOps: REMOTE_CONFIG.roads.maxOps,
			// 干线规划视角全通行 (空 CostMatrix; 返回 false 语义是「排除该房」,
			// 会把跨房 search 直接打成 incomplete)。已有结构不排斥——
			// road/rampart 可叠建, 占位判断由意图管线侧承担
			roomCallback: () => new PathFinder.CostMatrix(),
		},
	);
	if (result.incomplete) return undefined;

	const segments = segmentsOf(result.path);
	const total = segments.reduce((acc, seg) => acc + seg.xy.length, 0);
	if (total === 0) return undefined;
	return {
		home: homeName,
		segments,
		total,
		built: 0,
		coverage: 0,
		plannedAt: Game.time,
	};
}

/** 干线落盘 (新建或重规划) */
export function writeRoadRecord(roomName: string, record: RoadRecord): void {
	const roads = (layoutRoot().roads ??= {});
	roads[roomName] = record;
}

/** 干线是否需要 (重)规划: 无记录 / 超期 / 记录失效 (房失活后清理) */
export function roadNeedsPlanning(ctx: TickContext, roomName: string): boolean {
	const rec = roadRecordOf(roomName);
	if (!rec) return true;
	return ctx.tick - rec.plannedAt >= REPLAN_INTERVAL;
}

/** 母房布局中心兜底 (storage 未建成时取布局中心位) */
function getLayoutCenter(roomName: string): { x: number; y: number } | undefined {
	const center = layoutRoot().rooms[roomName]?.center;
	return center ? { x: center.x, y: center.y } : undefined;
}
