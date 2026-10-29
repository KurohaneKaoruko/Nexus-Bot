/**
 * TeamAction 命名空间装配层: 六对象合并为单一命名空间, 对外导出面不变 (调用方零改动)。
 */
import type { TeamActionApi } from './teamActionTypes';
import teamActionData from './teamActionData';
import teamActionGather from './teamActionGather';
import teamActionMove from './teamActionMove';
import teamActionDirection from './teamActionDirection';
import teamActionCostMatrix from './teamActionCostMatrix';
import teamActionPathCache from './teamActionPathCache';

const TeamAction = {
	...teamActionData,
	...teamActionGather,
	...teamActionMove,
	...teamActionDirection,
	...teamActionCostMatrix,
	...teamActionPathCache,
} satisfies TeamActionApi;

export default TeamAction;
