// @ts-nocheck
/**
 * ros 动态布局规划器 ('auto'): 分块地形分析 + manor 布局主流程的组合入口。
 * 由 LayoutPlanner.buildDynamic (自动布局主线) 激活; 对外仅暴露 name 与 ManagerPlanner。
 */
import { ManagerPlanner as BlockManager } from './dynamic/rosBlock'
import { computeManor as computeManorImpl, MANOR_SPAWN_CHEBYSHEV } from './dynamic/rosManor'

export { MANOR_SPAWN_CHEBYSHEV };

const ManagerPlanner = {
	...BlockManager,
	computeManor: computeManorImpl,
};

export const rosPlanner = {
	name: 'auto',
	ManagerPlanner
};
