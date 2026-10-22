import { idsAfterMove, orderPayload } from '../src/lib/components/home/reorder';

const failures: string[] = [];

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function sameIds(actual: readonly number[], expected: readonly number[], label: string) {
	assert(actual.join(',') === expected.join(','), `${label}：得到 ${actual.join(',')}，期望 ${expected.join(',')}`);
}

const source = [11, 22, 33, 44];
sameIds(idsAfterMove(source, 0, 2), [22, 33, 11, 44], '把第一项移到下标 2');
sameIds(idsAfterMove(source, 0, 3), [22, 33, 44, 11], '把第一项移到末尾');
sameIds(idsAfterMove(source, 3, 0), [44, 11, 22, 33], '把最后一项移到开头');
sameIds(idsAfterMove(source, 3, 1), [11, 44, 22, 33], '把最后一项移到下标 1');
sameIds(idsAfterMove(source, 1, 2), [11, 33, 22, 44], '把第二项下移一格');
sameIds(idsAfterMove(source, 2, 1), [11, 33, 22, 44], '把第三项上移一格');
sameIds(idsAfterMove(source, 1, 1), source, '原位不动');
sameIds(idsAfterMove(source, -1, 0), source, '下标越界');
sameIds(idsAfterMove(source, 0, 4), source, '目标下标越界');
sameIds(idsAfterMove([], 0, 0), [], '空列表');
assert(source.join(',') === '11,22,33,44', '移动不应改动原数组');

const tied = [
	{ id: 1, weight: 0 },
	{ id: 2, weight: 0 },
	{ id: 3, weight: 0 }
];
const tiedPayload = orderPayload(tied, 2, 0);
sameIds(
	tiedPayload.map((item) => item.id),
	idsAfterMove(
		tied.map((item) => item.id),
		2,
		0
	),
	'权重相同的项移动后 id 顺序'
);
assert(
	tiedPayload.every((item, index) => index === 0 || item.weight < tiedPayload[index - 1]!.weight),
	'新权重应严格递减'
);
assert(
	tiedPayload.every((item) => item.weight > 0),
	'新权重应高于原来的最大值，避免和其他 0 权重链接打平'
);
assert(tied.map((item) => item.weight).join(',') === '0,0,0', '计算权重不应改动原链接');

const ranked = [
	{ id: 7, weight: 9 },
	{ id: 8, weight: 4 },
	{ id: 9, weight: 1 }
];
const rankedPayload = orderPayload(ranked, 0, 2);
sameIds(
	rankedPayload.map((item) => item.id),
	[8, 9, 7],
	'已有权重的项移动后 id 顺序'
);
assert(
	rankedPayload.every((item) => item.weight > 9),
	'新权重应高于原来的最大权重'
);

const unchanged = orderPayload(ranked, 1, 1);
sameIds(
	unchanged.map((item) => item.id),
	[7, 8, 9],
	'未移动时 id 顺序保持不变'
);
assert(unchanged.every((item, index) => item.weight === ranked[index]?.weight), '未移动时不改权重');

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}

console.log('verify-reorder: ok');
console.log(`第一项移到下标 2：${idsAfterMove(source, 0, 2).join(',')}`);
console.log(`最后一项移到开头：${idsAfterMove(source, 3, 0).join(',')}`);
console.log(`权重相同，下标 2 移到 0：${tiedPayload.map((item) => item.id).join(',')}`);
