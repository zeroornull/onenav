import { existsSync, copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiContext } from '#lib/server/api/context';
import { handle as categoryHandle } from '#lib/server/api/methods/category';
import { handle as linkHandle } from '#lib/server/api/methods/link';
import { handle as mediaHandle } from '#lib/server/api/methods/media';
import { handle as siteHandle } from '#lib/server/api/methods/site';
import { openDatabase } from '#lib/server/db';
import { getOption, readSite } from '#lib/server/options';

const failures: string[] = [];

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function ctx(db: ApiContext['db'], params: Record<string, string>, authed = true): ApiContext {
	const url = new URL('http://127.0.0.1/api/verify');
	return {
		db,
		request: new Request(url, { method: 'POST' }),
		url,
		userAgent: 'verify-api',
		authed,
		params
	};
}

const root = process.cwd();
const liveDb = path.join(root, 'data', 'onenav.db3');
const liveConfig = path.join(root, 'data', 'config.php');
const liveDbBefore = existsSync(liveDb) ? statSync(liveDb).mtimeMs : null;
const liveConfigBefore = existsSync(liveConfig) ? statSync(liveConfig).mtimeMs : null;

const dir = mkdtempSync(path.join(tmpdir(), 'onenav-api-'));
const dbFile = path.join(dir, 'onenav.db3');
copyFileSync(path.join(root, 'db', 'onenav.simple.db3'), dbFile);
const db = openDatabase(dbFile);

try {
	const denied = categoryHandle(ctx(db, { name: '不应写入' }, false), 'add_category');
	assert(denied.code === -1002, `未登录增加分类应返回 -1002，实际 ${denied.code}`);
	assert(denied.err_msg === 'Authorization failure!', '未登录错误文案不一致');

	const added = categoryHandle(
		ctx(db, {
			name: '验证分类',
			property: '0',
			fid: '0',
			weight: '7',
			description: 'A&B',
			font_icon: 'fa-flag'
		}),
		'add_category'
	);
	assert(added.code === 0, `增加分类失败：${JSON.stringify(added)}`);
	const categoryId = Number(added.id);
	assert(categoryId > 0, '增加分类没有返回 id');

	const category = categoryHandle(ctx(db, { id: String(categoryId) }), 'get_a_category');
	const categoryRow = category.data as { name?: string; font_icon?: string; description?: string; weight?: number };
	assert(category.code === 0, '查询分类失败');
	assert(categoryRow?.name === '验证分类', `分类名不一致：${categoryRow?.name}`);
	assert(categoryRow?.font_icon === 'fa fa-flag', `图标前缀不一致：${categoryRow?.font_icon}`);
	assert(categoryRow?.description === 'A&amp;amp;B', `描述转义不一致：${categoryRow?.description}`);
	assert(categoryRow?.weight === 7, `权重不一致：${categoryRow?.weight}`);

	const listed = categoryHandle(ctx(db, { page: '1', limit: '100' }), 'category_list');
	const rows = listed.data as Array<{ id?: number }>;
	assert(listed.code === 0, '分类列表失败');
	assert(Array.isArray(rows) && rows.some((row) => Number(row.id) === categoryId), '分类列表里没有新分类');

	const linked = await linkHandle(
		ctx(db, {
			fid: String(categoryId),
			title: 'A&B',
			url: 'https://example.com/verify-api',
			description: '链接描述',
			property: '0',
			weight: '4'
		}),
		'add_link'
	);
	assert(linked.code === 0, `增加链接失败：${JSON.stringify(linked)}`);
	const linkId = Number(linked.id);
	assert(linkId > 0, '增加链接没有返回 id');

	const link = await linkHandle(ctx(db, { id: String(linkId) }), 'get_a_link');
	const linkRow = link.data as { title?: string; url?: string; fid?: number; description?: string };
	assert(link.code === 0, '查询链接失败');
	assert(linkRow?.title === 'A&amp;B', `链接标题转义不一致：${linkRow?.title}`);
	assert(linkRow?.url === 'https://example.com/verify-api', `链接地址不一致：${linkRow?.url}`);
	assert(Number(linkRow?.fid) === categoryId, '链接没有挂到新分类');
	assert(linkRow?.description === '链接描述', `链接描述不一致：${linkRow?.description}`);

	const site = siteHandle(
		ctx(db, {
			title: '副本站',
			logo: '',
			subtitle: '副标题',
			keywords: 'k',
			description: 'd',
			custom_header: '',
			custom_footer: '',
			link_model: 'direct',
			link_num: '30'
		}),
		'set_site'
	);
	assert(site.code === 0, `保存站点失败：${JSON.stringify(site)}`);
	const raw = getOption(db, 's_site');
	assert(typeof raw === 'string' && raw.trim().startsWith('{'), `s_site 不是 JSON：${raw?.slice(0, 40)}`);
	const parsed = JSON.parse(raw ?? '') as { title?: string; link_num?: string };
	const round = JSON.parse(JSON.stringify(parsed)) as { title?: string; link_num?: string };
	assert(round.title === '副本站', `JSON 往返标题不一致：${round.title}`);
	assert(round.link_num === '30', `link_num JSON 往返后不一致：${String(round.link_num)}`);
	assert(readSite(db)?.title === '副本站', 'readSite 往返失败');
	assert(readSite(db)?.link_num === '30', 'readSite link_num 往返失败');

	const blocked = await mediaHandle(ctx(db, { url: 'http://127.0.0.1/' }), 'get_link_info');
	assert(blocked.code === -2000, `127.0.0.1 应拒绝，实际 ${blocked.code} ${JSON.stringify(blocked)}`);
	const lan = await mediaHandle(ctx(db, { url: 'http://192.168.1.1/admin' }), 'get_link_info');
	assert(lan.code === -2000, `内网地址应拒绝，实际 ${lan.code}`);
	const local = await mediaHandle(ctx(db, { url: 'http://localhost/secret' }), 'get_link_info');
	assert(local.code === -2000, `localhost 应拒绝，实际 ${local.code}`);
} finally {
	db.close();
	rmSync(dir, { recursive: true, force: true });
}

if (liveDbBefore != null) {
	assert(statSync(liveDb).mtimeMs === liveDbBefore, '现网 data/onenav.db3 被改动');
}
if (liveConfigBefore != null) {
	assert(statSync(liveConfig).mtimeMs === liveConfigBefore, '现网 data/config.php 被改动');
}

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}

console.log('verify-api ok');
console.log(`副本库：${dbFile}`);
console.log('增加分类、增加链接、查询、s_site JSON 往返、内网地址拒绝均通过');
