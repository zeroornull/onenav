import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { countRows, deny, err, idList, intval, phpEmpty, ret } from '#lib/server/api/util';

export const methods = ['batch_modify_category', 'set_link_attribute', 'set_cat_batch'];

function batchModifyCategory(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const ids = idList(ctx.params.id);
	const fid = intval(ctx.params.fid);
	const found = fid ? countRows(ctx, 'SELECT COUNT(*) AS n FROM on_categorys WHERE id = ?', fid) : 0;
	if (phpEmpty(ctx.params.fid) || !found) return err(-2000, '分类ID不存在！');
	if (!ids.length) return err(-2000, '更新失败！');
	const marks = ids.map(() => '?').join(', ');
	const result = ctx.db.prepare(`UPDATE on_links SET fid = ? WHERE id IN (${marks})`).run(fid, ...ids);
	if (!result) return err(-2000, '更新失败！');
	return { code: 0, msg: 'success' };
}

function setAttribute(ctx: ApiContext, table: 'on_links' | 'on_categorys'): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const ids = idList(ctx.params.ids);
	const property = intval(ctx.params.property);
	if (!ids.length) return ret(-2000, 'failed');
	const marks = ids.map(() => '?').join(', ');
	const result = ctx.db.prepare(`UPDATE ${table} SET property = ? WHERE id IN (${marks})`).run(property, ...ids);
	if (result.changes > 0) return ret(200, 'success');
	return ret(-2000, 'failed');
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	switch (method) {
		case 'batch_modify_category':
			return batchModifyCategory(ctx);
		case 'set_link_attribute':
			return setAttribute(ctx, 'on_links');
		case 'set_cat_batch':
			return setAttribute(ctx, 'on_categorys');
		default:
			return { code: -1, msg: '未实现' };
	}
}
