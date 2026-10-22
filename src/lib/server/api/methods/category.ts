import type { ApiContext, ApiResult } from '#lib/server/api/context';
import {
	allRows,
	countRows,
	deny,
	err,
	flag01,
	htmlspecialchars,
	intval,
	isUniqueError,
	limitOf,
	oneRow,
	pageOf,
	phpEmpty,
	text,
	unixTime,
	weightOf
} from '#lib/server/api/util';

export const methods = ['add_category', 'edit_category', 'del_category', 'category_list', 'get_a_category'];

function categoryDescription(raw: string | undefined): string {
	const once = phpEmpty(raw) ? '' : htmlspecialchars(text(raw));
	return htmlspecialchars(once);
}

function fontIcon(raw: string | undefined): string {
	const escaped = htmlspecialchars(text(raw));
	return escaped.includes('fa ') ? escaped : `fa ${escaped}`;
}

function addCategory(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const name = text(ctx.params.name);
	if (phpEmpty(name)) return err(-2000, '分类名称不能为空！');
	const row = {
		name: htmlspecialchars(name),
		addTime: unixTime(),
		weight: weightOf(ctx.params.weight),
		property: flag01(ctx.params.property),
		description: categoryDescription(ctx.params.description),
		fontIcon: fontIcon(ctx.params.font_icon),
		fid: intval(ctx.params.fid)
	};
	try {
		const result = ctx.db
			.prepare(
				`INSERT INTO on_categorys (name, add_time, weight, property, description, font_icon, fid)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(row.name, row.addTime, row.weight, row.property, row.description, row.fontIcon, row.fid);
		const id = Number(result.lastInsertRowid);
		if (!id) return err(-1000, 'Categorie already exist!');
		return { code: 0, id };
	} catch (error) {
		if (isUniqueError(error)) return err(-1000, 'Categorie already exist!');
		throw error;
	}
}

function editCategory(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const id = intval(ctx.params.id);
	const fid = intval(ctx.params.fid);
	if (!id) return err(-1003, 'The category ID cannot be empty!');
	if (fid !== 0) {
		const parent = oneRow(ctx, 'SELECT id, fid FROM on_categorys WHERE id = ?', fid);
		if (!parent) return err(-2000, '父级ID不存在！');
		if (Number(parent.fid) !== 0) return err(-2000, '父分类不能是二级分类!');
	}
	const name = text(ctx.params.name);
	if (phpEmpty(name)) return err(-1004, 'The category name cannot be empty!');
	const children = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_categorys WHERE fid = ?', id);
	if (children > 0 && fid !== 0) return err(-2000, '修改失败，该分类下已存在子分类！');
	try {
		const result = ctx.db
			.prepare(
				`UPDATE on_categorys
				 SET name = ?, up_time = ?, weight = ?, property = ?, description = ?, font_icon = ?, fid = ?
				 WHERE id = ?`
			)
			.run(
				htmlspecialchars(name),
				unixTime(),
				weightOf(ctx.params.weight),
				flag01(ctx.params.property),
				categoryDescription(ctx.params.description),
				fontIcon(ctx.params.font_icon),
				fid,
				id
			);
		if (!result.changes) return err(-1005, 'The category name already exists!');
		return { code: 0, msg: 'successful' };
	} catch (error) {
		if (isUniqueError(error)) return err(-1005, 'The category name already exists!');
		throw error;
	}
}

function delCategory(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const id = intval(ctx.params.id);
	if (!id) return err(-1003, 'The category ID cannot be empty!');
	const category = oneRow(ctx, 'SELECT id, fid FROM on_categorys WHERE id = ?', id);
	if (!category) return err(-1007, 'The category does not exist!');
	const children = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_categorys WHERE fid = ?', id);
	if (children > 0) return err(-2000, '请先删除下面的子分类！');
	const links = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_links WHERE fid = ?', id);
	if (links > 0) return err(-1006, '此分类下存在链接，不允许删除！');
	const result = ctx.db.prepare('DELETE FROM on_categorys WHERE id = ?').run(id);
	if (!result.changes) return err(-1007, 'The category delete failed!');
	return { code: 0, msg: 'successful' };
}

function categoryList(ctx: ApiContext): ApiResult {
	if (!ctx.authed && (ctx.params.token ?? '').trim()) {
		const denied = deny(ctx);
		if (denied) return denied;
	}
	const page = pageOf(ctx.params.page);
	const limit = limitOf(ctx.params.limit);
	const offset = (page - 1) * limit;
	const seesAll = ctx.authed ? 1 : 0;
	const count = countRows(
		ctx,
		'SELECT COUNT(*) AS n FROM on_categorys WHERE (? = 1 OR property = 0)',
		seesAll
	);
	const rows = allRows(
		ctx,
		`SELECT a.*,
			(SELECT name FROM on_categorys WHERE id = a.fid LIMIT 1) AS fname,
			(SELECT COUNT(id) FROM on_links WHERE fid = a.id) AS link_num
		 FROM on_categorys AS a
		 WHERE (? = 1 OR a.property = 0)
		 ORDER BY a.fid ASC, a.weight DESC, a.id ASC`,
		seesAll
	);
	const parents = rows.filter((row) => Number(row.fid) === 0);
	const children = new Map<number, Record<string, unknown>[]>();
	for (const row of rows) {
		const fid = Number(row.fid);
		if (fid === 0) continue;
		const list = children.get(fid) ?? [];
		list.push(row);
		children.set(fid, list);
	}
	for (const list of children.values()) {
		list.sort((a, b) => Number(b.weight) - Number(a.weight) || Number(a.id) - Number(b.id));
	}
	const ordered: Record<string, unknown>[] = [];
	for (const parent of parents) {
		ordered.push(parent);
		const nested = children.get(Number(parent.id));
		if (nested) ordered.push(...nested);
	}
	return { code: 0, msg: '', count, data: ordered.slice(offset, offset + limit) };
}

function getCategory(ctx: ApiContext): ApiResult {
	const id = intval(ctx.params.id);
	const category = oneRow(ctx, 'SELECT * FROM on_categorys WHERE id = ?', id);
	if (!category) return { code: 0, data: [] };
	if (Number(category.property) === 0) return { code: 0, data: category };
	if (Number(category.property) === 1) {
		const denied = deny(ctx);
		if (denied) return denied;
		return { code: 0, data: category };
	}
	return { code: 0, data: [] };
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	switch (method) {
		case 'add_category':
			return addCategory(ctx);
		case 'edit_category':
			return editCategory(ctx);
		case 'del_category':
			return delCategory(ctx);
		case 'category_list':
			return categoryList(ctx);
		case 'get_a_category':
			return getCategory(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
