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

export const methods = [
	'add_link',
	'edit_link',
	'del_link',
	'link_list',
	'q_category_link',
	'get_a_link',
	'edit_link_row',
	'update_link_order'
];

const URL_PATTERN =
	/^(http:\/\/|https:\/\/|ftp:\/\/|ftps:\/\/|magnet:?|ed2k:\/\/|tcp:\/\/|udp:\/\/|thunder:\/\/|rtsp:\/\/|rtmp:\/\/|sftp:\/\/).+/;

function linkDescription(raw: string | undefined): string {
	return phpEmpty(raw) ? '' : htmlspecialchars(text(raw));
}

function checkLink(ctx: ApiContext, fid: number, title: string, url: string, standby: string): ApiResult | null {
	if (!fid) return err(-1007, 'The category id(fid) not exist!');
	const category = oneRow(ctx, 'SELECT id FROM on_categorys WHERE id = ?', fid);
	if (!category) return err(-1007, 'The category not exist!');
	if (phpEmpty(title)) return err(-1008, 'The title cannot be empty!');
	if (phpEmpty(url)) return err(-1009, 'URL cannot be empty!');
	if (!URL_PATTERN.test(url)) return err(-1010, 'URL is not valid!');
	if (standby && !URL_PATTERN.test(standby)) return err(-1010, 'URL is not valid!');
	return null;
}

function addLink(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const fid = intval(ctx.params.fid);
	const title = text(ctx.params.title);
	const url = text(ctx.params.url);
	const standby = text(ctx.params.url_standby);
	const invalid = checkLink(ctx, fid, title, url, standby);
	if (invalid) return invalid;
	const fontIcon = text(ctx.params.font_icon);
	const columns = ['fid', 'title', 'url', 'url_standby', 'description', 'add_time', 'weight', 'property'];
	const values: Array<string | number> = [
		fid,
		htmlspecialchars(title),
		url,
		standby,
		linkDescription(ctx.params.description),
		unixTime(),
		weightOf(ctx.params.weight),
		flag01(ctx.params.property)
	];
	if (fontIcon) {
		columns.push('font_icon');
		values.push(fontIcon);
	}
	const marks = columns.map(() => '?').join(', ');
	try {
		const result = ctx.db
			.prepare(`INSERT INTO on_links (${columns.join(', ')}) VALUES (${marks})`)
			.run(...values);
		const id = Number(result.lastInsertRowid);
		if (!result.changes || !id) return err(-1011, 'The URL already exists!');
		return { code: 0, id };
	} catch (error) {
		if (isUniqueError(error)) return err(-1011, 'The URL already exists!');
		throw error;
	}
}

function editLink(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const id = intval(ctx.params.id);
	const fid = intval(ctx.params.fid);
	const title = text(ctx.params.title);
	const url = text(ctx.params.url);
	const standby = text(ctx.params.url_standby);
	const storedTitle = htmlspecialchars(title);
	const invalid = checkLink(ctx, fid, storedTitle, url, standby);
	if (invalid) return invalid;
	const found = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_links WHERE id = ?', id);
	if (!id || !found) return err(-1012, 'link id not exists!');
	const fontIcon = text(ctx.params.font_icon);
	const fromConsole = (ctx.params.type ?? '').trim() === 'console';
	const assignments = [
		'fid = ?',
		'title = ?',
		'url = ?',
		'url_standby = ?',
		'description = ?',
		'up_time = ?',
		'weight = ?',
		'property = ?'
	];
	const values: Array<string | number> = [
		fid,
		storedTitle,
		url,
		standby,
		linkDescription(ctx.params.description),
		unixTime(),
		weightOf(ctx.params.weight),
		flag01(ctx.params.property)
	];
	if (fontIcon || fromConsole) {
		assignments.push('font_icon = ?');
		values.push(fontIcon);
	}
	values.push(id);
	try {
		const result = ctx.db
			.prepare(`UPDATE on_links SET ${assignments.join(', ')} WHERE id = ?`)
			.run(...values);
		if (!result.changes) return err(-1011, 'The URL already exists!');
		return { code: 0, msg: 'successful' };
	} catch (error) {
		if (isUniqueError(error)) return err(-1011, 'The URL already exists!');
		throw error;
	}
}

function delLink(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const id = intval(ctx.params.id);
	const found = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_links WHERE id = ?', id);
	if (!id || !found) return err(-1010, 'link id not exists!');
	const result = ctx.db.prepare('DELETE FROM on_links WHERE id = ?').run(id);
	if (!result.changes) return err(-1010, 'link id not exists!');
	return { code: 0, msg: 'successful' };
}

function linkList(ctx: ApiContext): ApiResult {
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
		`SELECT COUNT(*) AS n FROM on_links
		 WHERE (
		   ? = 1
		   OR (property = 0 AND fid IN (SELECT id FROM on_categorys WHERE property = 0))
		 )`,
		seesAll
	);
	const data = allRows(
		ctx,
		`SELECT on_links.*,
			(SELECT name FROM on_categorys WHERE id = on_links.fid) AS category_name
		 FROM on_links
		 WHERE (
		   ? = 1
		   OR (property = 0 AND fid IN (SELECT id FROM on_categorys WHERE property = 0))
		 )
		 ORDER BY weight DESC, id DESC
		 LIMIT ? OFFSET ?`,
		seesAll,
		limit,
		offset
	);
	return { code: 0, msg: '', count, data };
}

function categoryLinks(ctx: ApiContext): ApiResult {
	if (phpEmpty(ctx.params.category_id)) {
		return { code: -2000, msg: '分类ID不能为空！', count: 0, data: [] };
	}
	if (!ctx.authed && (ctx.params.token ?? '').trim()) {
		const denied = deny(ctx);
		if (denied) return denied;
	}
	const fid = intval(ctx.params.category_id);
	const page = pageOf(ctx.params.page);
	const limit = limitOf(ctx.params.limit);
	const offset = (page - 1) * limit;
	const seesAll = ctx.authed ? 1 : 0;
	const count = countRows(
		ctx,
		'SELECT COUNT(*) AS n FROM on_links WHERE fid = ? AND (? = 1 OR property = 0)',
		fid,
		seesAll
	);
	const data = allRows(
		ctx,
		`SELECT on_links.*,
			(SELECT name FROM on_categorys WHERE id = on_links.fid) AS category_name
		 FROM on_links
		 WHERE fid = ? AND (? = 1 OR property = 0)
		 ORDER BY weight DESC, id DESC
		 LIMIT ? OFFSET ?`,
		fid,
		seesAll,
		limit,
		offset
	);
	return { code: 0, msg: '', count, data };
}

function getLink(ctx: ApiContext): ApiResult {
	const id = intval(ctx.params.id);
	const link = oneRow(ctx, 'SELECT * FROM on_links WHERE id = ?', id);
	if (!link) return { code: 0, data: [] };
	if (Number(link.property) === 0) {
		const category = oneRow(ctx, 'SELECT property FROM on_categorys WHERE id = ?', Number(link.fid));
		if (category && Number(category.property) === 1) {
			const denied = deny(ctx);
			if (denied) return denied;
		}
		return { code: 0, data: link };
	}
	if (Number(link.property) === 1) {
		const denied = deny(ctx);
		if (denied) return denied;
		return { code: 0, data: link };
	}
	return { code: 0, data: [] };
}

async function readJson(ctx: ApiContext): Promise<unknown> {
	const body = await ctx.request.clone().text();
	if (!body.trim()) return null;
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return undefined;
	}
}

async function editLinkRow(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	let id = intval(ctx.params.id);
	let title = text(ctx.params.title).trim();
	let weight = intval(ctx.params.weight);
	if (!ctx.params.id) {
		const raw = await readJson(ctx);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err(-1012, 'link id not exists!');
		const obj = raw as Record<string, unknown>;
		id = intval(obj.id == null ? '' : String(obj.id));
		title = String(obj.title ?? '').trim();
		weight = intval(obj.weight == null ? '' : String(obj.weight));
	}
	const found = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_links WHERE id = ?', id);
	if (!id || !found) return err(-1012, 'link id not exists!');
	try {
		const result = ctx.db.prepare('UPDATE on_links SET title = ?, weight = ? WHERE id = ?').run(title, weight, id);
		if (!result.changes) return err(-1011, 'The URL already exists!');
		return { code: 0, msg: 'successful' };
	} catch (error) {
		if (isUniqueError(error)) return err(-1011, 'The URL already exists!');
		throw error;
	}
}

async function updateLinkOrder(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const cid = intval(ctx.params.category_id);
	const raw = await readJson(ctx);
	if (!Array.isArray(raw)) return { code: -2000, data: '', msg: 'JSON解析失败！' };
	const update = ctx.db.prepare('UPDATE on_links SET weight = ? WHERE fid = ? AND id = ?');
	const apply = ctx.db.transaction((items: unknown[]) => {
		for (const item of items) {
			if (!item || typeof item !== 'object') continue;
			const row = item as Record<string, unknown>;
			update.run(intval(row.weight == null ? '' : String(row.weight)), cid, intval(row.id == null ? '' : String(row.id)));
		}
	});
	apply(raw);
	return { code: 200, data: '', msg: 'success' };
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'add_link':
			return addLink(ctx);
		case 'edit_link':
			return editLink(ctx);
		case 'del_link':
			return delLink(ctx);
		case 'link_list':
			return linkList(ctx);
		case 'q_category_link':
			return categoryLinks(ctx);
		case 'get_a_link':
			return getLink(ctx);
		case 'edit_link_row':
			return editLinkRow(ctx);
		case 'update_link_order':
			return updateLinkOrder(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
