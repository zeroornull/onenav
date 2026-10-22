import { existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractArchive } from '#lib/server/api/archive';
import type { ApiContext } from '#lib/server/api/context';
import { handle as aiHandle } from '#lib/server/api/methods/ai';
import { handle as sqlHandle } from '#lib/server/api/methods/sql';
import { clearSubscribeCache, handle as subscribeHandle } from '#lib/server/api/methods/subscribe';
import { handle as themeHandle } from '#lib/server/api/methods/theme';
import { handle as upgradeHandle } from '#lib/server/api/methods/upgrade';
import { clearApiCache } from '#lib/server/api/remote';
import { openDatabase } from '#lib/server/db';
import { getOption, setOption } from '#lib/server/options';

const failures: string[] = [];

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function ctx(db: ApiContext['db'], params: Record<string, string>, authed = true): ApiContext {
	const url = new URL('http://127.0.0.1/api/verify-extra');
	return {
		db,
		request: new Request(url, { method: 'POST' }),
		url,
		userAgent: 'verify-extra-api',
		authed,
		params
	};
}

function storedZip(name: string, content: Buffer): Buffer {
	const nameBuf = Buffer.from(name, 'utf8');
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(nameBuf.length, 26);
	local.writeUInt32LE(content.length, 18);
	local.writeUInt32LE(content.length, 22);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(nameBuf.length, 28);
	central.writeUInt32LE(content.length, 20);
	central.writeUInt32LE(content.length, 24);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(46 + nameBuf.length, 12);
	eocd.writeUInt32LE(30 + nameBuf.length + content.length, 16);
	return Buffer.concat([local, nameBuf, content, central, nameBuf, eocd]);
}

const root = process.cwd();
const liveDb = path.join(root, 'data', 'onenav.db3');
const liveConfig = path.join(root, 'data', 'config.php');
const liveDbBefore = existsSync(liveDb) ? statSync(liveDb).mtimeMs : null;
const liveConfigBefore = existsSync(liveConfig) ? statSync(liveConfig).mtimeMs : null;
const originalFetch = globalThis.fetch;

const dir = mkdtempSync(path.join(tmpdir(), 'onenav-extra-'));
const dbFile = path.join(dir, 'onenav.db3');
copyFileSync(path.join(root, 'db', 'onenav.simple.db3'), dbFile);
const db = openDatabase(dbFile);

function currentVersion(): string {
	return readFileSync(path.join(root, 'version.txt'), 'utf8').split('-')[0]?.replaceAll('v', '') ?? '';
}

async function main() {
	assert(db.name.startsWith(dir), `测试库不在临时目录：${db.name}`);

	const deniedSql = sqlHandle(ctx(db, { sql: 'SELECT 1 AS ok' }, false), 'exe_sql');
	assert(deniedSql.code === -1002, `未登录 exe_sql 应返回 -1002，实际 ${deniedSql.code} ${JSON.stringify(deniedSql)}`);
	assert(deniedSql.err_msg === 'Authorization failure!', `未登录文案不一致：${String(deniedSql.err_msg)}`);

	const selected = sqlHandle(ctx(db, { sql: 'SELECT 1 AS ok' }, true), 'exe_sql');
	const rows = selected.data as Array<{ ok?: number }>;
	assert(selected.code === 0, `SELECT 1 失败：${JSON.stringify(selected)}`);
	assert(Array.isArray(rows) && Number(rows[0]?.ok) === 1, `SELECT 1 没有返回结果：${JSON.stringify(selected)}`);

	const outside = path.join(dir, 'attached.db');
	const attached = sqlHandle(
		ctx(db, { sql: `SELECT 1 AS ok; ATTACH DATABASE '${outside}' AS extra` }, true),
		'exe_sql'
	);
	assert(attached.code === -2000, `越界 ATTACH 应拒绝，实际 ${JSON.stringify(attached)}`);
	assert(!existsSync(outside), '越界 ATTACH 把数据库写到了 data 目录外');

	const traversed = sqlHandle(ctx(db, { name: '../../data/onenav.db3' }, true), 'exe_sql');
	assert(traversed.code === -2000, `SQL 文件名穿越应拒绝，实际 ${JSON.stringify(traversed)}`);

	const themes = await themeHandle(ctx(db, {}, false), 'get_themes');
	const themeData = themes.data as { pc_theme?: string; mobile_theme?: string };
	assert(themes.code === 200, `主题列表失败：${JSON.stringify(themes)}`);
	assert(themeData?.pc_theme === 'default2' && themeData.mobile_theme === 'default2', '空主题配置没有回退到 default2');

	const deniedTheme = await themeHandle(ctx(db, { value: '{"pc_theme":"default2"}' }, false), 'set_theme');
	assert(deniedTheme.code === -1002, `未登录切换主题应返回 -1002，实际 ${deniedTheme.code}`);
	const switched = await themeHandle(
		ctx(db, { value: JSON.stringify({ pc_theme: 'default2', mobile_theme: 'default2' }) }, true),
		'set_theme'
	);
	assert(switched.code === 0, `切换主题失败：${JSON.stringify(switched)}`);
	const savedThemes = getOption(db, 's_themes');
	assert(savedThemes?.includes('default2'), `s_themes 没有写入：${savedThemes}`);

	let fetched = 0;
	globalThis.fetch = async () => {
		fetched += 1;
		throw new Error('verify-extra-api 不应访问网络');
	};
	const badName = await themeHandle(ctx(db, { name: '../evil', type: 'download' }, true), 'down_theme');
	assert(badName.code === -2000 && badName.msg === '主题名称不合法！', `非法主题名：${JSON.stringify(badName)}`);
	const deniedDown = await themeHandle(ctx(db, { name: 'demo' }, false), 'down_theme');
	assert(deniedDown.code === -1002, `未登录下载主题应返回 -1002，实际 ${deniedDown.code}`);
	for (const method of ['up_updater', 'down_updater', 'check_version', 'getNextVersion', 'get_latest_version']) {
		const denied = await upgradeHandle(ctx(db, { version: '1.2.4' }, false), method);
		assert(denied.code === -1002, `未登录 ${method} 应返回 -1002，实际 ${denied.code}`);
	}
	const mismatched = await upgradeHandle(ctx(db, { version: '9.9.9' }, true), 'check_version');
	assert(mismatched.code === -2000, `版本不匹配应失败，实际 ${JSON.stringify(mismatched)}`);
	const matched = await upgradeHandle(ctx(db, { version: currentVersion() }, true), 'check_version');
	assert(matched.code === 200 && matched.msg === 'success', `当前版本校验失败：${JSON.stringify(matched)}`);
	const plain = await upgradeHandle(ctx(db, { version: 'v1.2.4' }, true), 'getNextVersion');
	assert(plain.data === '0.0.0', `非法版本应返回 0.0.0，实际 ${JSON.stringify(plain)}`);
	const needSub = await subscribeHandle(ctx(db, {}, true), 'check_subscribe');
	assert(needSub.code === -2000 && needSub.msg === '此功能需要订阅！', `空订阅：${JSON.stringify(needSub)}`);
	const inactive = await subscribeHandle(ctx(db, {}, true), 'is_subscribe');
	assert(inactive.code === 200 && inactive.data === false, `未订阅 is_subscribe：${JSON.stringify(inactive)}`);
	const deniedAi = await aiHandle(ctx(db, { content: '导航' }, false), 'ai_search');
	assert(deniedAi.code === -1002, `未登录 AI 检索应返回 -1002，实际 ${deniedAi.code}`);
	assert(fetched === 0, `本地校验访问了网络 ${fetched} 次`);
	globalThis.fetch = originalFetch;

	const themeDir = path.join(dir, 'theme');
	mkdirSync(themeDir);
	const evil = path.join(dir, 'evil.txt');
	const slipped = extractArchive(storedZip('../evil.txt', Buffer.from('pwned')), themeDir);
	assert(slipped.ok === false, 'zip 路径穿越没有被拒绝');
	if (!slipped.ok) assert(slipped.entry.includes('..'), `拒绝条目不是穿越路径：${slipped.entry}`);
	assert(!existsSync(evil), '恶意 zip 把文件写到了主题目录外');
	const safeDir = path.join(dir, 'safe-theme');
	const safe = extractArchive(storedZip('ok.txt', Buffer.from('hello')), safeDir);
	assert(safe.ok === true, `合法 zip 解压失败：${JSON.stringify(safe)}`);
	assert(readFileSync(path.join(safeDir, 'ok.txt'), 'utf8') === 'hello', '合法 zip 内容不一致');

	const deniedSub = await subscribeHandle(ctx(db, { order_id: '1', email: 'a@b.c' }, false), 'set_subscribe');
	assert(deniedSub.code === -1002, `未登录保存订阅应返回 -1002，实际 ${deniedSub.code}`);
	const saved = await subscribeHandle(
		ctx(db, { order_id: 'a<b', email: 'a@b.c', end_time: '9' }, true),
		'set_subscribe'
	);
	assert(saved.code === 0, `保存订阅失败：${JSON.stringify(saved)}`);
	const raw = getOption(db, 's_subscribe');
	assert(typeof raw === 'string' && raw.trim().startsWith('{'), `s_subscribe 不是 JSON：${raw?.slice(0, 40)}`);
	const subscribeParsed = JSON.parse(raw) as { order_id?: string; email?: string; end_time?: string };
	const subscribeRound = JSON.parse(JSON.stringify(subscribeParsed)) as typeof subscribeParsed;
	assert(subscribeRound.order_id === 'a&lt;b', `订阅 order_id JSON 往返后丢失：${subscribeRound.order_id}`);
	assert(subscribeRound.email === 'a@b.c', `订阅 email JSON 往返后丢失：${subscribeRound.email}`);
	assert(subscribeRound.end_time === '9', `订阅 end_time JSON 往返后丢失：${String(subscribeRound.end_time)}`);
	const loaded = await subscribeHandle(ctx(db, {}, true), 'get_subscribe');
	const subscribeRow = loaded.data as { order_id?: string; email?: string };
	assert(loaded.code === 200 && subscribeRow?.order_id === 'a&lt;b', `订阅回读不一致：${JSON.stringify(loaded)}`);

	const calls: string[] = [];
	globalThis.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? 'GET').toUpperCase();
		calls.push(`${method} ${url}`);
		if (method === 'HEAD') return new Response(null, { status: 200 });
		if (url.includes('/v1/check_subscribe.php')) {
			return new Response(JSON.stringify({ code: 200, data: { end_time: 4_000_000_000 }, msg: 'success' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw new Error(`unexpected fetch ${method} ${url}`);
	};
	clearSubscribeCache();
	clearApiCache();
	const missingAi = await aiHandle(ctx(db, { content: '导航' }, true), 'ai_search');
	assert(missingAi.code === -2000 && missingAi.msg === '获取参数失败！', `缺 AI 配置：${JSON.stringify(missingAi)}`);
	assert(!calls.some((call) => !call.includes('onenav.xiaoz.top') && !call.includes('check_subscribe.php')), `AI 检索打到了别的地址：${calls.join(' | ')}`);
	setOption(db, 'ai_setting', JSON.stringify({ status: 'off', url: 'https://ai.example.test/v1/chat/completions', sk: '' }));
	clearSubscribeCache();
	const disabled = await aiHandle(ctx(db, { content: '导航' }, true), 'ai_search');
	assert(disabled.code === -2000 && disabled.msg === 'AI功能未启用！', `AI 关闭：${JSON.stringify(disabled)}`);
	assert(!calls.some((call) => call.includes('ai.example.test')), '关闭 AI 时仍然请求了 AI 服务');
	globalThis.fetch = originalFetch;
}

try {
	await main();
} finally {
	globalThis.fetch = originalFetch;
	clearSubscribeCache();
	clearApiCache();
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

console.log('verify-extra-api ok');
console.log(`副本库：${dbFile}`);
console.log('未登录拒绝、SELECT 1、越界 ATTACH、主题路径穿越、缺 AI 配置均通过');
