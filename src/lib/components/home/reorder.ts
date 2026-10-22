export type RankedId = {
	id: number;
	weight: number;
};

function canMove(length: number, fromIndex: number, toIndex: number): boolean {
	if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false;
	if (fromIndex === toIndex) return false;
	if (fromIndex < 0 || toIndex < 0) return false;
	return fromIndex < length && toIndex < length;
}

/** 把 fromIndex 的一项放到 toIndex。越界或原位返回拷贝，不改入参。 */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
	const next = items.slice();
	if (!canMove(next.length, fromIndex, toIndex)) return next;
	const [item] = next.splice(fromIndex, 1);
	if (item === undefined) return items.slice();
	next.splice(toIndex, 0, item);
	return next;
}

export function idsAfterMove(ids: readonly number[], fromIndex: number, toIndex: number): number[] {
	return moveItem(ids, fromIndex, toIndex);
}

/**
 * 新权重全部高于原来的最大值，并且严格递减。
 * 首页按 weight DESC 排列，未参与这次排序的链接就不会插到前面。
 */
export function rankedWeights(weights: readonly number[]): number[] {
	const count = weights.length;
	let max = 0;
	for (const weight of weights) {
		if (Number.isFinite(weight) && weight > max) max = weight;
	}
	return Array.from({ length: count }, (_, index) => max + count - index);
}

export function orderPayload(
	links: readonly RankedId[],
	fromIndex: number,
	toIndex: number
): RankedId[] {
	const ids = idsAfterMove(
		links.map((link) => link.id),
		fromIndex,
		toIndex
	);
	const changed = ids.some((id, index) => id !== links[index]?.id);
	if (!changed) return links.map((link) => ({ id: link.id, weight: link.weight }));
	const weights = rankedWeights(links.map((link) => link.weight));
	return ids.map((id, index) => ({ id, weight: weights[index] ?? 0 }));
}
