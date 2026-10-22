import { createHash } from 'node:crypto';
import { mkdtempSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attemptLogin, apiToken, authorize, loginCookieValue, md5, passwordMatches } from '../src/lib/server/auth';
import { installSite, parseConfigPhp } from '../src/lib/server/config';
import {
	DATABASE_DRIVER,
	allCategoriesPrivate,
	openDatabase,
	queryUserCatalog,
	queryVisitorCatalog
} from '../src/lib/server/db';
import {
	getOption,
	readSite,
	readTransitionPage,
	setOption,
	writeThemes
} from '../src/lib/server/options';
import { dataPaths } from '../src/lib/server/paths';

const root = process.cwd();
const live = dataPaths(root);
const failures: string[] = [];
const liveDbBefore = existsSync(live.database) ? statSync(live.database) : null;
const liveConfigJsonBefore = existsSync(live.configJson) ? statSync(live.configJson) : null;

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function independentMd5(value: string) {
	return createHash('md5').update(value, 'utf8').digest('hex');
}

const user = 'alice';
const plain = 's3cret';
const encrypted = independentMd5(user + plain);
const ua = 'OneNavPhase1/1.0';
const expectedCookie = independentMd5(user + encrypted + 'onenav' + ua);
assert(loginCookieValue(user, encrypted, ua) === expectedCookie, 'cookie 算法与独立 md5 不一致');
assert(passwordMatches(user, plain, encrypted), '正确密码未通过');
assert(!passwordMatches(user, 'wrong-pass', encrypted), '错误密码不应通过');
const wrong = attemptLogin({
	user,
	password: 'wrong-pass',
	config: { USER: user, ENCRYPTED_PASSWORD: encrypted },
	userAgent: ua
});
assert(!wrong.ok, '错误密码不应返回 cookie');
const right = attemptLogin({
	user,
	password: plain,
	config: { USER: user, ENCRYPTED_PASSWORD: encrypted },
	userAgent: ua
});
assert(right.ok && right.cookie === expectedCookie, '正确密码的 cookie 值不正确');

const secret = 'secret-key';
const token = apiToken(user, secret);
assert(token === independentMd5(user + secret), 'token 算法不正确');
assert(
	authorize({
		token,
		user,
		encryptedPassword: encrypted,
		secretKey: secret,
		userAgent: ua
	}),
	'token 应该通过'
);
assert(
	authorize({
		xToken: token,
		user,
		encryptedPassword: encrypted,
		secretKey: secret,
		userAgent: ua
	}),
	'X-Token 应该通过'
);
assert(
	authorize({
		cookie: expectedCookie,
		user,
		encryptedPassword: encrypted,
		secretKey: secret,
		userAgent: ua
	}),
	'没有 token 时应退回 cookie'
);
assert(
	!authorize({
		token: 'deadbeef',
		cookie: expectedCookie,
		user,
		encryptedPassword: encrypted,
		secretKey: secret,
		userAgent: ua
	}),
	'错误 token 不应退回 cookie'
);

const parsed = parseConfigPhp(`<?php
system('id');
define('USER','abc');
define('ENCRYPTED_PASSWORD','not-printed');
define('EMAIL','a@example.com');
`);
assert(parsed.USER === 'abc' && parsed.EMAIL === 'a@example.com', 'config.php 解析失败');
if (existsSync(live.configPhp)) {
	const liveConfig = parseConfigPhp(readFileSync(live.configPhp, 'utf8'));
	console.log(`本机 config.php 用户名: ${liveConfig.USER}`);
} else {
	console.log('本机没有 data/config.php');
}

const tempDb = path.join(tmpdir(), `onenav-phase1-${process.pid}.db3`);
copyFileSync(live.seedDatabase, tempDb);
const db = openDatabase(tempDb);
try {
	const siteRaw = getOption(db, 's_site');
	const transitionRaw = getOption(db, 's_transition_page');
	assert(siteRaw, '种子库缺少 s_site');
	assert(transitionRaw, '种子库缺少 s_transition_page');
	if (siteRaw && transitionRaw) {
		assert(siteRaw.trim().startsWith('{'), 's_site 不是 JSON');
		assert(transitionRaw.trim().startsWith('{'), 's_transition_page 不是 JSON');
		const siteParsed = JSON.parse(siteRaw) as { title?: string; link_num?: unknown };
		const siteAgain = JSON.parse(JSON.stringify(siteParsed)) as { title?: string; link_num?: unknown };
		assert(siteAgain.title === 'OneNav', 's_site.title JSON 往返后丢失');
		assert(siteAgain.link_num === siteParsed.link_num, 's_site.link_num JSON 往返后不一致');
		const transitionParsed = JSON.parse(transitionRaw) as {
			control?: string;
			visitor_stay_time?: unknown;
			admin_stay_time?: unknown
		};
		const transitionAgain = JSON.parse(JSON.stringify(transitionParsed)) as typeof transitionParsed;
		assert(transitionAgain.control === 'off', 's_transition_page.control JSON 往返后丢失');
		assert(
			transitionAgain.visitor_stay_time === transitionParsed.visitor_stay_time,
			's_transition_page.visitor_stay_time JSON 往返后不一致'
		);
		const site = readSite(db);
		assert(site?.title === 'OneNav', 's_site.title 解析不正确');
		assert(site?.link_num === siteParsed.link_num, 'readSite link_num 与原文不一致');
		assert(readTransitionPage(db)?.control === 'off', 's_transition_page.control 解析不正确');
		setOption(db, 'phase1_probe', siteRaw);
		writeThemes(db, { pc_theme: 'default2', mobile_theme: 'default2' });
		assert(getOption(db, 's_site') === siteRaw, '探测写入改动了 s_site');
		assert(getOption(db, 'phase1_probe') === siteRaw, 'setOption 读回不一致');
	}

	const publicCategory = db.prepare('SELECT id FROM on_categorys WHERE property = ? LIMIT 1').get(0) as {
		id: number;
	};
	db.prepare(
		'INSERT INTO on_categorys (name, add_time, weight, property, description, fid) VALUES (?, ?, ?, ?, ?, ?)'
	).run('p1-private', '1700000000', 1, 1, '', 0);
	const privateCategory = db.prepare('SELECT id FROM on_categorys WHERE name = ?').get('p1-private') as {
		id: number;
	};
	db.prepare(
		'INSERT INTO on_categorys (name, add_time, weight, property, description, fid) VALUES (?, ?, ?, ?, ?, ?)'
	).run('p1-private-child', '1700000000', 1, 1, '', publicCategory.id);
	db.prepare(
		'INSERT INTO on_links (fid, title, url, add_time, weight, property) VALUES (?, ?, ?, ?, ?, ?)'
	).run(publicCategory.id, '私有链接', 'https://example.test/phase1-private', '1700000000', 1, 1);
	db.prepare(
		'INSERT INTO on_links (fid, title, url, add_time, weight, property) VALUES (?, ?, ?, ?, ?, ?)'
	).run(privateCategory.id, '私有分类链接', 'https://example.test/phase1-private-cat', '1700000000', 1, 1);

	const visitor = queryVisitorCatalog(db);
	const userCatalog = queryUserCatalog(db);
	const visitorProps = visitor.flatMap((category) => [
		category.property,
		...category.links.map((link) => link.property)
	]);
	assert(!visitorProps.includes(1), '访客查询返回了 property = 1');
	assert(
		visitor.some((category) => category.id === publicCategory.id),
		'访客查询缺少公开分类'
	);
	assert(
		!visitor.some((category) => category.name === 'p1-private' || category.name === 'p1-private-child'),
		'访客查询返回了私有分类'
	);
	assert(
		userCatalog.some((category) => category.name === 'p1-private'),
		'登录查询没有返回私有分类'
	);
	assert(
		userCatalog.some((category) => category.name === 'p1-private-child'),
		'登录查询没有返回私有子分类'
	);
	const privateLinks = userCatalog
		.filter((category) => category.id === publicCategory.id || category.id === privateCategory.id)
		.flatMap((category) => category.links);
	assert(
		privateLinks.some((link) => link.property === 1),
		'登录查询没有返回私有链接'
	);
	assert(
		queryVisitorCatalog(db, { cid: privateCategory.id }).length === 0,
		'访客按私有 cid 过滤仍返回了分类'
	);
	const userFiltered = queryUserCatalog(db, { cid: privateCategory.id });
	assert(
		userFiltered.length === 1 && userFiltered[0]?.name === 'p1-private',
		'登录按 cid 过滤不正确'
	);
	assert(allCategoriesPrivate(db) === false, '仍有公开分类时不应判定为全私有');
} finally {
	db.close();
	rmSync(tempDb, { force: true });
}

const installRoot = mkdtempSync(path.join(tmpdir(), 'onenav-install-'));
try {
	mkdirSync(path.join(installRoot, 'data'));
	mkdirSync(path.join(installRoot, 'db'));
	copyFileSync(live.seedDatabase, path.join(installRoot, 'db', 'onenav.simple.db3'));
	const paths = dataPaths(installRoot);
	const existingDb = path.join(installRoot, 'data', 'onenav.db3');
	copyFileSync(live.seedDatabase, existingDb);
	const before = readFileSync(existingDb);
	const installed = installSite(
		{ username: 'abc', password: 'abc123', password2: 'abc123', email: 'a@example.com' },
		{ paths }
	);
	assert(installed.ok, `临时安装失败: ${installed.ok ? '' : installed.error}`);
	assert(existsSync(paths.configJson), '安装没有写出 config.json');
	assert(!existsSync(paths.configPhp), '安装不应写出 config.php');
	assert(readFileSync(existingDb).equals(before), '已存在的库文件被覆盖');
	const again = installSite(
		{ username: 'abc', password: 'abc123', password2: 'abc123', email: 'a@example.com' },
		{ paths }
	);
	assert(!again.ok, '重复安装不应成功');
} finally {
	rmSync(installRoot, { recursive: true, force: true });
}

const liveDbAfter = existsSync(live.database) ? statSync(live.database) : null;
const liveConfigJsonAfter = existsSync(live.configJson) ? statSync(live.configJson) : null;
assert(Boolean(liveDbBefore) === Boolean(liveDbAfter), '验证过程改动了 data/onenav.db3 是否存在');
if (liveDbBefore && liveDbAfter) {
	assert(
		liveDbBefore.size === liveDbAfter.size && liveDbBefore.mtimeMs === liveDbAfter.mtimeMs,
		'验证过程写入了 data/onenav.db3'
	);
}
assert(Boolean(liveConfigJsonBefore) === Boolean(liveConfigJsonAfter), '验证过程改动了 data/config.json 是否存在');
if (liveConfigJsonBefore && liveConfigJsonAfter) {
	assert(
		liveConfigJsonBefore.size === liveConfigJsonAfter.size &&
			liveConfigJsonBefore.mtimeMs === liveConfigJsonAfter.mtimeMs,
		'验证过程写入了 data/config.json'
	);
}

console.log(`数据库驱动: ${DATABASE_DRIVER}`);
if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}
console.log('verify-phase1: ok');
