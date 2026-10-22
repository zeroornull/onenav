import { legacyRedirect } from '#lib/legacy-redirect';

const failures: string[] = [];
let total = 0;

function assert(condition: unknown, message: string) {
	if (!condition) failures.push(message);
}

function at(path: string): string | null {
	return legacyRedirect(new URL(path, 'http://127.0.0.1'));
}

function check(path: string, expected: string | null) {
	total += 1;
	const actual = at(path);
	assert(actual === expected, `${path} → ${actual ?? 'null'}，期望 ${expected ?? 'null'}`);
	if (actual !== null) {
		assert(actual.startsWith('/') && !actual.startsWith('//'), `${path} 返回了非站内路径 ${actual}`);
		assert(!actual.includes('://'), `${path} 返回了绝对 URL ${actual}`);
	}
}

const modern = [
	'/click',
	'/click/12',
	'/api',
	'/api/category_list',
	'/admin',
	'/admin/link',
	'/admin?c=login',
	'/login',
	'/login/',
	'/install',
	'/install/',
	'/logout',
	'/share',
	'/share/abc',
	'/ico',
	'/ico/site.png',
	'/bing',
	'/bing/daily'
];
for (const path of modern) check(path, null);

check('/', null);
check('/other', null);
check('/index.php', '/');
check('/index.php?c=', '/');
check('/index.php?c=index', '/');
check('/?c=', '/');
check('/?c=index', '/');
check('/index.php?c=click&id=9', '/click/9');
check('/page?c=click&id=9', '/click/9');
check('/index.php?c=click', null);
check('/index.php?c=click&id=', null);
check('/index.php?c=api&method=category_list', '/api/category_list');
check('/index.php?c=api&method=category_list&page=2&token=abc', '/api/category_list?page=2&token=abc');
check('/index.php?page=2&c=api&method=export_link&token=abc', '/api/export_link?page=2&token=abc');
check('/index.php?c=api', null);
check('/index.php?c=api&method=', null);
check('/index.php?c=admin', '/admin');
check('/index.php?c=admin&page=link', '/admin/link');
check('/index.php?c=admin&page=Link1', '/admin/Link1');
check('/index.php?c=admin&page=setting/site', '/admin');
check('/index.php?c=admin&page=foo.bar', '/admin');
check('/index.php?c=admin&page=', '/admin');
check('/index.php?c=admin&page=a_b', '/admin');
check('/index.php?c=login', '/login');
check('/index.php?c=mobile', '/admin');
check('/index.php?c=mobile&page=link', '/admin');
check('/index.php?c=./admin', null);
check('/index.php?c=../admin', null);
check('/index.php?c=foo/../bar', null);
check('/index.php?c=foo/./bar', null);
check('/index.php?c=..', null);
check('/index.php?c=https://evil.example', null);
check('/index.php?c=api&method=https://evil.example', '/api/https%3A%2F%2Fevil.example');
check('/index.php?c=api&method=//evil.example', '/api/%2F%2Fevil.example');
check('/index.php?c=click&id=../admin', null);
check('/index.php?c=unknown', null);

const external = at('/index.php?c=api&method=https://evil.example');
assert(external?.startsWith('/api/'), `外站 method 应留在 /api 下，实际 ${external}`);

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}

console.log(`legacy redirect: ${total} passed`);
