// @ts-nocheck
/**
 * lab 区锚点选址: 在 manor 评分图上为 3×3 lab 群找距 storage 最近的合法 4×4 承载区。
 */
import { squareDistance } from '../shared/plannerUtils'
import type { XY } from '../shared/plannerUtils'

/** 在 manorArr 中找 k>=2 且 4×4 全承载、距 (storageX-1.5, storageY-1.5) 最近的锚点 */
export const findLabAnchorByTs = (manorArr: (number | string)[], storageX: number, storageY: number): XY => {
	let bestX = 0;
	let bestY = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			const val = manorArr[x * 50 + y];
			if (typeof val !== 'number' || val < 2) continue;
			const distance = squareDistance(storageX - 1.5, storageY - 1.5, x, y);
			if (bestDistance <= distance) continue;
			let checkCnt = 0;
			let valid = true;
			for (let i = 0; i < 4 && valid; i++) {
				for (let j = 0; j < 4; j++) {
					const tx = x + i;
					const ty = y + j;
					const manorVal = tx >= 0 && tx < 50 && ty >= 0 && ty < 50 ? manorArr[tx * 50 + ty] : 0;
					if (typeof manorVal === 'number' && manorVal > 0 && Math.abs(tx - storageX) + Math.abs(ty - storageY) > 2) {
						checkCnt += 1;
					} else {
						valid = false;
						break;
					}
				}
			}
			if (checkCnt == 16) {
				bestDistance = distance;
				bestX = x;
				bestY = y;
			}
		}
	}

	return { x: bestX + 1, y: bestY + 1 };
};
