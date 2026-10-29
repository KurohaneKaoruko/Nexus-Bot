/**
 * TeamAction 内部域模块的共享契约: 装配层合并后的方法面。
 * 各域模块以 Pick + ThisType 约束自身对象, 使跨域 this 互调可类型检查。
 */
export interface TeamActionApi {
	POS_MARK_MAP: Record<string, [number, number]>;
	structHitLimit: number;

	AdjustToward(team: Team): boolean;
	Gather(team: Team): boolean;
	GatherLine(team: Team): boolean;
	GatherQuad(team: Team): boolean;
	formLineToQuad(team: Team): boolean;
	GatherByTemplate(team: Team, shape: "cross" | "square3"): boolean;
	switchFormationPos(team: Team, targetPos: RoomPosition): boolean;
	switchTeam4Pos(team: Team): boolean;

	LinearMove(team: Team, pos?: RoomPosition, reverse?: boolean): void;
	move(team: Team, direction: DirectionConstant): void;
	QuadMoveTo(team: Team, targetPos: RoomPosition): void;
	touchableNTickInRange(
		creep: Creep,
		targetPos: RoomPosition,
		tick: number,
		range: number,
		plainCost?: number,
	): boolean;
	focusTarget(team: Team, originPos: RoomPosition): Creep | Structure | null;
	looseAdvance(team: Team, looseGoal: RoomPosition): void;
	noteStuck(team: Team): void;
	execMoveExtended(team: Team, anchor: RoomPosition | undefined): boolean;
	stagingAnchorOf(teamName: string, creeps: Creep[], targetRoom: string | undefined): RoomPosition;
	updateTargetPos(team: Team): void;

	getSamllMoveDirection(team: Team, targetPos: RoomPosition): DirectionConstant | undefined;
	getTeamMoveDirection(
		team: Team,
		goals: { pos: RoomPosition }[],
		pathMode?: "flee",
	): DirectionConstant | undefined;
	moveOuterBorder(creep: Creep, nearCreep: Creep): void;

	getMoveAbleCostMatrix(
		roomName: string,
		myCreeps: Creep[],
		avoidObjects?: { pos: RoomPosition; range: number }[],
		damageLimit?: number,
		damageRangePlus?: number,
		isFourTeam?: boolean,
		swampCost?: number,
		structHitLimit?: number,
		isSpawnDanger?: boolean,
	): CostMatrix;

	getDirectionByCachePath(team: Team): DirectionConstant | undefined;
	hasObstacleInPath(creeps: Creep[], nextPos: RoomPosition): boolean;
	checkCachePath(team: Team): boolean;
	clearPathCache(team: Team): void;
}
