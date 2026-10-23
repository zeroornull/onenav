/** 同一进程里，备份、回滚、执行 SQL、解压、导入书签同时只做一件。 */
let busy = false;

export const BUSY_MSG = '已有维护操作正在进行，请稍后再试！';

export function claimExclusive(): (() => void) | null {
	if (busy) return null;
	busy = true;
	return () => {
		busy = false;
	};
}
