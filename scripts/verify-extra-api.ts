import { existsSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { extractArchive } from '#lib/server/api/archive';
import type { ApiContext } from '#lib/server/api/context';
import { attachmentFrom } from '#lib/server/api/download';
import { BUSY_MSG, claimExclusive } from '#lib/server/api/exclusive';
import { AI_DESC_BUDGET, AI_DESC_CHARS, handle as aiHandle } from '#lib/server/api/methods/ai';
import { handle as backupHandle } from '#lib/server/api/methods/backup';
import { handle as sqlHandle } from '#lib/server/api/methods/sql';
import { clearSubscribeCache, handle as subscribeHandle } from '#lib/server/api/methods/subscribe';
import { handle as themeHandle } from '#lib/server/api/methods/theme';
import { handle as transferHandle } from '#lib/server/api/methods/transfer';
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

function makeZip(entries: Array<{ name: string; data: Buffer; method?: number; symlink?: boolean }>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const nameBuf = Buffer.from(entry.name, 'utf8');
		const method = entry.method ?? 0;
		const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(payload.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(entry.symlink ? (3 << 8) | 20 : 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(payload.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		if (entry.symlink) central.writeUInt32LE(0o120000 << 16, 38);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, payload);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + payload.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralBuf.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBuf, eocd]);
}

function tarHeader(name: string, opts: { size?: number; type?: string; link?: string } = {}): Buffer {
	const header = Buffer.alloc(512);
	header.write(name);
	header.write('0000777\0', 100);
	header.write('0000000\0', 108);
	header.write('0000000\0', 116);
	header.write(`${(opts.size ?? 0).toString(8).padStart(11, '0')}\0`, 124);
	header.write('00000000000\0', 136);
	header.fill(0x20, 148, 156);
	header[156] = (opts.type ?? '0').charCodeAt(0);
	if (opts.link) header.write(opts.link, 157);
	header.write('ustar\0', 257);
	header.write('00', 263);
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
	return header;
}

function tarPad(data: Buffer): Buffer {
	const pad = (512 - (data.length % 512)) % 512;
	return pad === 0 ? data : Buffer.concat([data, Buffer.alloc(pad)]);
}

const root = process.cwd();
const liveDb = path.join(root, 'data', 'onenav.db3');
const liveConfig = path.join(root, 'data', 'config.php');
const liveDbBefore = existsSync(liveDb) ? statSync(liveDb).mtimeMs : null;
const liveConfigBefore = existsSync(liveConfig) ? statSync(liveConfig).mtimeMs : null;
const repoBackup = path.join(root, 'data', 'backup');
const repoTemplates = path.join(root, 'data', 'templates');
const repoArchive = path.join(root, 'update.tar.gz');
const repoBackupBefore = existsSync(repoBackup) ? statSync(repoBackup).mtimeMs : null;
const repoTemplatesBefore = existsSync(repoTemplates) ? statSync(repoTemplates).mtimeMs : null;
const repoArchiveBefore = existsSync(repoArchive) ? statSync(repoArchive).mtimeMs : null;
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
	const slipped = await extractArchive(storedZip('../evil.txt', Buffer.from('pwned')), themeDir);
	assert(slipped.ok === false, 'zip 路径穿越没有被拒绝');
	if (!slipped.ok) assert(slipped.entry.includes('..'), `拒绝条目不是穿越路径：${slipped.entry}`);
	assert(!existsSync(evil), '恶意 zip 把文件写到了主题目录外');
	const safeDir = path.join(dir, 'safe-theme');
	const safe = await extractArchive(storedZip('ok.txt', Buffer.from('hello')), safeDir);
	assert(safe.ok === true, `合法 zip 解压失败：${JSON.stringify(safe)}`);
	assert(readFileSync(path.join(safeDir, 'ok.txt'), 'utf8') === 'hello', '合法 zip 内容不一致');

	const partialDir = path.join(dir, 'partial-theme');
	const partial = await extractArchive(
		makeZip([
			{ name: 'keep.txt', data: Buffer.from('keep') },
			{ name: '../evil.txt', data: Buffer.from('pwned') }
		]),
		partialDir
	);
	assert(partial.ok === false, '后出现的穿越路径应让整个压缩包失败');
	assert(!existsSync(path.join(partialDir, 'keep.txt')), '失败后没有清掉已写出的文件');
	assert(!existsSync(evil), '穿越路径仍然写出了目录外文件');

	const deflated = await extractArchive(
		makeZip([{ name: 'deflated.txt', data: Buffer.from('deflate-ok'), method: 8 }]),
		path.join(dir, 'deflate')
	);
	assert(deflated.ok === true, `deflate 流式解压失败：${JSON.stringify(deflated)}`);
	assert(readFileSync(path.join(dir, 'deflate', 'deflated.txt'), 'utf8') === 'deflate-ok', 'deflate 内容不一致');

	const linkOutside = path.join(tmpdir(), `onenav-escape-${process.pid}`);
	const escaped = await extractArchive(
		Buffer.concat([
			tarHeader('ok.txt', { size: 5 }),
			tarPad(Buffer.from('hello')),
			tarHeader('escape', { type: '2', link: linkOutside }),
			Buffer.alloc(512)
		]),
		path.join(dir, 'tar-escape')
	);
	assert(escaped.ok === false, '指向目录外的符号链接应被拒绝');
	assert(!existsSync(linkOutside), '符号链接把文件写到了目录外');
	assert(!existsSync(path.join(dir, 'tar-escape', 'ok.txt')), '符号链接失败后没有清理半成品');

	const linked = await extractArchive(
		Buffer.concat([
			tarHeader('sub/target.txt', { size: 2 }),
			tarPad(Buffer.from('hi')),
			tarHeader('jump', { type: '2', link: 'sub/target.txt' }),
			Buffer.alloc(512)
		]),
		path.join(dir, 'tar-link')
	);
	assert(linked.ok === true, `目录内符号链接解压失败：${JSON.stringify(linked)}`);
	assert(lstatSync(path.join(dir, 'tar-link', 'jump')).isSymbolicLink(), '目录内符号链接没有保留');
	assert(readlinkSync(path.join(dir, 'tar-link', 'jump')) === 'sub/target.txt', '符号链接目标不一致');

	const gzipped = gzipSync(
		Buffer.concat([tarHeader('gz.txt', { size: 2 }), tarPad(Buffer.from('gz')), Buffer.alloc(512)])
	);
	const gunzipped = await extractArchive(gzipped, path.join(dir, 'gzip'));
	assert(gunzipped.ok === true, `tar.gz 流式解压失败：${JSON.stringify(gunzipped)}`);
	assert(readFileSync(path.join(dir, 'gzip', 'gz.txt'), 'utf8') === 'gz', 'tar.gz 内容不一致');

	const chunkedZip = storedZip('chunk.txt', Buffer.from('chunk'));
	const chunked = Readable.from(
		(async function* () {
			for (let index = 0; index < chunkedZip.length; index += 3) {
				yield chunkedZip.subarray(index, index + 3);
			}
		})()
	);
	const chunkedDir = path.join(dir, 'chunked');
	const chunkedCopy = path.join(dir, 'chunked.zip');
	const chunkedResult = await extractArchive(chunked, chunkedDir, { copyTo: chunkedCopy });
	assert(chunkedResult.ok === true, `分块解压失败：${JSON.stringify(chunkedResult)}`);
	assert(readFileSync(path.join(chunkedDir, 'chunk.txt'), 'utf8') === 'chunk', '分块解压内容不一致');
	assert(readFileSync(chunkedCopy).equals(chunkedZip), '边下边解没有留下原始压缩包');
	const badCopy = path.join(dir, 'bad.zip');
	const badArchive = await extractArchive(
		makeZip([{ name: '/tmp/evil.txt', data: Buffer.from('no') }]),
		path.join(dir, 'absolute'),
		{ copyTo: badCopy }
	);
	assert(badArchive.ok === false, '绝对路径应被拒绝');
	assert(!existsSync(badCopy), '失败时没有删除半成品压缩包');

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

	const release = claimExclusive();
	try {
		let busyFetched = 0;
		globalThis.fetch = async () => {
			busyFetched += 1;
			throw new Error('占用互斥时不应访问网络');
		};
		const busySql = sqlHandle(ctx(db, { sql: "ATTACH DATABASE '/tmp/onenav-busy.db' AS extra" }, true), 'exe_sql');
		assert(busySql.code === -2000 && busySql.err_msg === BUSY_MSG, `exe_sql 没有互斥：${JSON.stringify(busySql)}`);
		const busyImport = await transferHandle(ctx(db, { filename: 'missing.html' }, true), 'import_link');
		assert(
			busyImport.code === -2000 && busyImport.err_msg === BUSY_MSG,
			`书签导入没有互斥：${JSON.stringify(busyImport)}`
		);
		const busyTheme = await themeHandle(ctx(db, { name: 'verifythemezz', type: 'download' }, true), 'down_theme');
		assert(busyTheme.code === -2000 && busyTheme.msg === BUSY_MSG, `主题下载没有互斥：${JSON.stringify(busyTheme)}`);
		const busyUpgrade = await upgradeHandle(ctx(db, {}, true), 'down_updater');
		assert(busyUpgrade.code === -2000 && busyUpgrade.msg === BUSY_MSG, `升级解压没有互斥：${JSON.stringify(busyUpgrade)}`);
		assert(busyFetched === 0, `互斥拒绝时访问了网络 ${busyFetched} 次`);
		assert(!existsSync(path.join(repoTemplates, 'verifythemezz')), '互斥拒绝时仍然创建了主题目录');
	} finally {
		release?.();
		globalThis.fetch = originalFetch;
	}

	const marker = 'DESC_TAIL_SHOULD_NOT_LEAK';
	const insertLink = db.prepare(
		`INSERT INTO on_links (fid, title, url, description, add_time, weight, property) VALUES (0, ?, ?, ?, '1', 0, 0)`
	);
	insertLink.run('探针', 'https://verify.example/desc-0', `${'描'.repeat(180)}${marker}`);
	for (let index = 1; index <= 60; index += 1) {
		insertLink.run(`d${index}`, `https://verify.example/desc-${index}`, '描'.repeat(AI_DESC_CHARS));
	}
	setOption(
		db,
		'ai_setting',
		JSON.stringify({ status: 'on', url: 'https://ai.example.test/v1/chat/completions', sk: 'local', model: 'demo' })
	);
	let aiBody = '';
	globalThis.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? 'GET').toUpperCase();
		if (method === 'HEAD') return new Response(null, { status: 200 });
		if (url.includes('/v1/check_subscribe.php')) {
			return new Response(JSON.stringify({ code: 200, data: { end_time: 4_000_000_000 }, msg: 'success' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.startsWith('https://ai.example.test/')) {
			aiBody = typeof init?.body === 'string' ? init.body : '';
			return new Response('ok', { status: 200 });
		}
		throw new Error(`unexpected fetch ${method} ${url}`);
	};
	clearSubscribeCache();
	const searched = await aiHandle(ctx(db, { content: '导航', feature: 'search' }, true), 'ai_search');
	assert(searched.code === 200 && searched.data === 'ok', `截断后的 AI 检索没有走本地桩：${JSON.stringify(searched)}`);
	assert(!aiBody.includes(marker), '过长描述的尾部进入了提示词');
	const prompt = (JSON.parse(aiBody) as { messages?: Array<{ content?: string }> }).messages?.find((item) =>
		item.content?.startsWith('JSON书签列表为：')
	)?.content;
	const bookmarks = JSON.parse(prompt?.slice('JSON书签列表为：'.length) ?? 'null') as Array<{ description?: string | null }>;
	const descriptions = bookmarks.map((item) => item.description ?? '');
	assert(descriptions.every((item) => item.length <= AI_DESC_CHARS), '单条描述没有截断');
	const described = descriptions.reduce((sum, item) => sum + item.length, 0);
	assert(described <= AI_DESC_BUDGET, `描述总量 ${described} 超过 ${AI_DESC_BUDGET}`);
	assert(descriptions.some((item) => item === ''), '预算用尽后仍把后续描述塞进了提示词');
	globalThis.fetch = originalFetch;

	const previous = process.cwd();
	const work = mkdtempSync(path.join(tmpdir(), 'onenav-backup-'));
	try {
		copyFileSync(path.join(root, 'version.txt'), path.join(work, 'version.txt'));
		process.chdir(work);
		const held = claimExclusive();
		try {
			const busyBackup = await backupHandle(ctx(db, {}, true), 'backup_db');
			assert(busyBackup.code === -2000 && busyBackup.msg === BUSY_MSG, `备份没有互斥：${JSON.stringify(busyBackup)}`);
		} finally {
			held?.();
		}
		setOption(db, 'verify_backup_probe', 'v1');
		const saved = await backupHandle(ctx(db, {}, true), 'backup_db');
		assert(saved.code === 200, `备份失败：${JSON.stringify(saved)}`);
		const backupName = String(saved.data ?? '');
		assert(existsSync(path.join(work, 'data', 'backup', backupName)), `备份没有写到临时目录：${backupName}`);
		setOption(db, 'verify_backup_probe', 'v2');
		const down = await backupHandle(ctx(db, { name: backupName }, true), 'down_db');
		const response = attachmentFrom(down);
		assert(response != null, `下载没有返回附件：${JSON.stringify(down)}`);
		const bytes = Buffer.from(await response!.arrayBuffer());
		const mirrored = path.join(work, 'down.db3');
		writeFileSync(mirrored, bytes);
		const opened = openDatabase(mirrored, { readonly: true, fileMustExist: true });
		try {
			const probe = opened.prepare('SELECT value FROM on_options WHERE "key" = ?').get('verify_backup_probe') as {
				value?: string;
			};
			assert(probe?.value === 'v1', `下载的库不是备份当时的内容：${probe?.value}`);
		} finally {
			opened.close();
		}
		const downloadPath = (down.download as { path?: string } | undefined)?.path;
		if (downloadPath && existsSync(downloadPath)) unlinkSync(downloadPath);
		const restored = await backupHandle(ctx(db, { name: backupName }, true), 'restore_db');
		assert(restored.code === 200, `恢复失败：${JSON.stringify(restored)}`);
		assert(getOption(db, 'verify_backup_probe') === 'v1', `恢复后读到 ${getOption(db, 'verify_backup_probe')}`);
		assert(!db.name.includes(`${path.sep}data${path.sep}onenav.db3`), `验证打开了现网库：${db.name}`);
	} finally {
		process.chdir(previous);
		rmSync(work, { recursive: true, force: true });
	}
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
const repoBackupAfter = existsSync(repoBackup) ? statSync(repoBackup).mtimeMs : null;
const repoTemplatesAfter = existsSync(repoTemplates) ? statSync(repoTemplates).mtimeMs : null;
const repoArchiveAfter = existsSync(repoArchive) ? statSync(repoArchive).mtimeMs : null;
assert(repoBackupAfter === repoBackupBefore, '仓库 data/backup 被改动');
assert(repoTemplatesAfter === repoTemplatesBefore, '仓库 data/templates 被改动');
assert(repoArchiveAfter === repoArchiveBefore, '仓库 update.tar.gz 被改动');

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}

console.log('verify-extra-api ok');
console.log(`副本库：${dbFile}`);
console.log('未登录拒绝、SELECT 1、越界 ATTACH、主题路径穿越、缺 AI 配置均通过');
