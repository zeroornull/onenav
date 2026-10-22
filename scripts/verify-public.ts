import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { openDatabase, queryUserCatalog, queryVisitorCatalog } from '../src/lib/server/db';
import { readTransitionPage, setTransitionPage } from '../src/lib/server/options';
import { dataPaths } from '../src/lib/server/paths';
import { resolveClick } from '../src/routes/click/[id]/open';
import { letterAvatarSvg, phpAdlerTotal, refererRejected } from '../src/routes/ico/avatar';
import { isExpired, loadShare } from '../src/routes/share/[sid]/open';

const root = process.cwd();
const live = dataPaths(root);
const failures: string[] = [];

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function stamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const liveBefore = existsSync(live.database) ? statSync(live.database) : null;
const tempDb = path.join('/tmp', `onenav-public-${process.pid}.db3`);
copyFileSync(live.seedDatabase, tempDb);
const db = openDatabase(tempDb);

try {
	const publicCategory = db.prepare('SELECT id FROM on_categorys WHERE property = ? LIMIT 1').get(0) as {
		id: number;
	};
	db.prepare(
		'INSERT INTO on_categorys (name, add_time, weight, property, description, fid) VALUES (?, ?, ?, ?, ?, ?)'
	).run('pub-private-cat', '1700000000', 1, 1, '', 0);
	const privateCategory = db.prepare('SELECT id FROM on_categorys WHERE name = ?').get('pub-private-cat') as {
		id: number;
	};
	db.prepare(
		'INSERT INTO on_links (fid, title, url, add_time, weight, property) VALUES (?, ?, ?, ?, ?, ?)'
	).run(publicCategory.id, '访客不可见', 'https://example.test/private-link', '1700000000', 9, 1);
	db.prepare(
		'INSERT INTO on_links (fid, title, url, add_time, weight, property) VALUES (?, ?, ?, ?, ?, ?)'
	).run(privateCategory.id, '私有分类链接', 'https://example.test/private-cat', '1700000000', 1, 0);
	db.prepare(
		'INSERT INTO on_links (fid, title, url, description, add_time, weight, property) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(
		publicCategory.id,
		'公开探针',
		'https://example.test/public-link',
		'探针描述',
		'1700000000',
		8,
		0
	);

	const visitor = queryVisitorCatalog(db);
	const visitorProps = visitor.flatMap((category) => [
		category.property,
		...category.links.map((link) => link.property)
	]);
	const visitorTitles = visitor.flatMap((category) => category.links.map((link) => link.title));
	assert(!visitorProps.includes(1), '访客查询返回了 property = 1');
	assert(!visitor.some((category) => category.name === 'pub-private-cat'), '访客看到了私有分类');
	assert(!visitorTitles.includes('访客不可见'), '访客看到了私有链接');
	assert(!visitorTitles.includes('私有分类链接'), '访客看到了私有分类里的链接');
	assert(visitorTitles.includes('公开探针'), '访客没有看到公开链接');
	assert(
		queryUserCatalog(db).some((category) => category.name === 'pub-private-cat'),
		'登录查询没有返回私有分类'
	);
	assert(
		queryUserCatalog(db)
			.flatMap((category) => category.links)
			.some((link) => link.title === '访客不可见'),
		'登录查询没有返回私有链接'
	);

	const publicLink = db.prepare('SELECT id, click FROM on_links WHERE title = ?').get('公开探针') as {
		id: number;
		click: number;
	};
	const privateLink = db.prepare('SELECT id, click FROM on_links WHERE title = ?').get('访客不可见') as {
		id: number;
		click: number;
	};
	const hidden = resolveClick(db, privateLink.id, false);
	const hiddenClick = db.prepare('SELECT click FROM on_links WHERE id = ?').get(privateLink.id) as {
		click: number;
	};
	assert(hidden.kind === 'forbidden', '未登录访问私有链接应拒绝');
	assert(hiddenClick.click === privateLink.click, '拒绝访问时不应增加点击');

	const opened = resolveClick(db, publicLink.id, false);
	const once = db.prepare('SELECT click FROM on_links WHERE id = ?').get(publicLink.id) as { click: number };
	assert(opened.kind === 'redirect', '过渡页关闭且没有备用链接时应跳转');
	assert(once.click === publicLink.click + 1, '公开链接点击没有加 1');

	db.prepare('UPDATE on_links SET url_standby = ? WHERE id = ?').run('https://example.test/standby', publicLink.id);
	const withStandby = resolveClick(db, publicLink.id, false);
	const twice = db.prepare('SELECT click FROM on_links WHERE id = ?').get(publicLink.id) as { click: number };
	assert(withStandby.kind === 'transition' && withStandby.urlStandby === 'https://example.test/standby', '备用链接应进入过渡页');
	assert(withStandby.kind === 'transition' && withStandby.refreshSeconds == null, '有备用链接时不应自动跳转');
	assert(twice.click === publicLink.click + 2, '过渡页点击没有加 1');

	db.prepare('UPDATE on_links SET url_standby = ? WHERE id = ?').run(null, publicLink.id);
	const current = readTransitionPage(db);
	assert(current, '种子库缺少过渡页设置');
	if (current) {
		setTransitionPage(db, { ...current, control: 'on', visitor_stay_time: '5', admin_stay_time: '1' });
	}
	const transition = resolveClick(db, publicLink.id, false);
	assert(
		transition.kind === 'transition' && transition.refreshSeconds === 5,
		'过渡页开启时访客停留时间不正确'
	);
	const adminTransition = resolveClick(db, publicLink.id, true);
	assert(
		adminTransition.kind === 'transition' && adminTransition.refreshSeconds === 1,
		'过渡页开启时管理员停留时间不正确'
	);

	const categoryLink = db.prepare('SELECT id, click FROM on_links WHERE title = ?').get('私有分类链接') as {
		id: number;
		click: number;
	};
	const blockedCategory = resolveClick(db, categoryLink.id, false);
	const blockedClick = db.prepare('SELECT click FROM on_links WHERE id = ?').get(categoryLink.id) as {
		click: number;
	};
	assert(blockedCategory.kind === 'forbidden', '公开链接位于私有分类时访客仍应被拒绝');
	assert(blockedClick.click === categoryLink.click, '私有分类拒绝时不应增加点击');
	const allowedCategory = resolveClick(db, categoryLink.id, true);
	const allowedClick = db.prepare('SELECT click FROM on_links WHERE id = ?').get(categoryLink.id) as {
		click: number;
	};
	assert(allowedCategory.kind === 'redirect' || allowedCategory.kind === 'transition', '登录后应能打开私有分类链接');
	assert(allowedClick.click === categoryLink.click + 1, '登录后点击私有链接应加 1');

	const past = stamp(new Date(Date.now() - 86_400_000));
	const future = stamp(new Date(Date.now() + 86_400_000));
	db.prepare(
		'INSERT INTO on_shares (sid, add_time, expire_time, password, cid, note) VALUES (?, ?, ?, ?, ?, ?)'
	).run('expired1', stamp(new Date()), past, '', publicCategory.id, '');
	db.prepare(
		'INSERT INTO on_shares (sid, add_time, expire_time, password, cid, note) VALUES (?, ?, ?, ?, ?, ?)'
	).run('lockpin1', stamp(new Date()), future, 'ab12', publicCategory.id, '');
	db.prepare(
		'INSERT INTO on_shares (sid, add_time, expire_time, password, cid, note) VALUES (?, ?, ?, ?, ?, ?)'
	).run('openlink', stamp(new Date()), future, '', publicCategory.id, '');

	assert(loadShare(db, 'expired1', null).kind === 'expired', '过期分享应返回过期');
	assert(loadShare(db, 'expired1', 'ab12').kind === 'expired', '过期分享不应先校验密码');
	assert(loadShare(db, 'no-such!', null).kind === 'invalid', '非法 SID 应被拒绝');
	assert(loadShare(db, 'missing1', null).kind === 'missing', '不存在的 SID 应被拒绝');
	assert(loadShare(db, 'lockpin1', null).kind === 'locked', '未提交密码应停留在密码页');
	assert(loadShare(db, 'lockpin1', 'wrong').kind === 'denied', '错误密码应被拒绝');
	const unlocked = loadShare(db, 'lockpin1', 'ab12');
	assert(unlocked.kind === 'ready', '正确密码应打开分享');
	if (unlocked.kind === 'ready') {
		assert(
			unlocked.links.some((link) => link.title === '公开探针'),
			'分享页没有公开链接'
		);
		assert(
			!unlocked.links.some((link) => link.title === '访客不可见' || link.title === '私有分类链接'),
			'分享页返回了非公开链接'
		);
		const probe = unlocked.links.find((link) => link.title === '公开探针');
		assert(probe?.href === `/click/${probe?.id}`, '公开分类的公开链接应走点击统计');
	}
	const openedShare = loadShare(db, 'openlink', null);
	assert(openedShare.kind === 'ready', '空密码分享应直接打开');

	const sameSecond = new Date();
	sameSecond.setMilliseconds(0);
	assert(!isExpired(stamp(sameSecond), sameSecond.getTime()), '到期时刻本身还没过期');
	assert(isExpired(stamp(sameSecond), sameSecond.getTime() + 1000), '超过到期时刻应过期');

	assert(phpAdlerTotal('空') === 1258472452, '空 的 Adler32 与 PHP 不一致');
	assert(phpAdlerTotal('A') === 1107313152, 'A 的 Adler32 与 PHP 不一致');
	assert(phpAdlerTotal('中') === 1241697284, '中 的 Adler32 与 PHP 不一致');
	assert(phpAdlerTotal('One') === 587280642, 'One 的 Adler32 与 PHP 不一致');
	const svg = letterAvatarSvg('空');
	assert(svg.includes('rgb(220,160,229)') && svg.includes('>空<'), '空 的 SVG 与 PHP 不一致');
	assert(letterAvatarSvg('One').includes('>O<'), '首字母应大写');
	assert(!refererRejected('', 'onenav.local'), '空 Referer 应放行');
	assert(refererRejected('https://evil.test/', 'onenav.local'), '外部 Referer 应拒绝');
	assert(!refererRejected('https://onenav.local/click/1', 'onenav.local'), '本站 Referer 应放行');
} finally {
	db.close();
	rmSync(tempDb, { force: true });
	rmSync(`${tempDb}-wal`, { force: true });
	rmSync(`${tempDb}-shm`, { force: true });
}

const liveAfter = existsSync(live.database) ? statSync(live.database) : null;
assert(Boolean(liveBefore) === Boolean(liveAfter), '验证过程改动了 data/onenav.db3 是否存在');
if (liveBefore && liveAfter) {
	assert(
		liveBefore.size === liveAfter.size && liveBefore.mtimeMs === liveAfter.mtimeMs,
		'验证过程写入了 data/onenav.db3'
	);
}

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}
console.log('verify-public: ok');
