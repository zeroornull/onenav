import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { allRows, deny, htmlspecialchars, ret } from '#lib/server/api/util';

export const methods = ['global_search'];

function byteLength(value: string): number {
	return Buffer.byteLength(value);
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	if (method !== 'global_search') return { code: -1, msg: '未实现' };
	const denied = deny(ctx);
	if (denied) return denied;
	const keyword = htmlspecialchars(ctx.params.keyword ?? '');
	if (byteLength(keyword) < 2) return ret(-2000, '', 'The length of the keyword is too short.');
	if (byteLength(keyword) > 32) return ret(-2000, '', 'The keyword length is too long');
	const like = `%${keyword}%`;
	const data = allRows(
		ctx,
		`SELECT * FROM on_links
		 WHERE title LIKE ? OR url LIKE ? OR IFNULL(url_standby, '') LIKE ? OR IFNULL(description, '') LIKE ?
		 ORDER BY weight DESC`,
		like,
		like,
		like,
		like
	);
	const names = new Map<number, string>();
	for (const category of allRows(ctx, 'SELECT id, name FROM on_categorys')) {
		names.set(Number(category.id), String(category.name ?? ''));
	}
	for (const row of data) {
		const name = names.get(Number(row.fid));
		row.category_name = name ?? null;
	}
	return { code: 0, msg: '', count: data.length, data };
}
