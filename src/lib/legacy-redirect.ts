const MODERN_PREFIXES = ['/click', '/api', '/admin', '/login', '/install', '/logout', '/share', '/ico', '/bing'];

function isModern(pathname: string): boolean {
	return MODERN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** 只接受站内路径，拒绝协议相对地址和外站绝对 URL。 */
function localPath(target: string): string | null {
	if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\') || target.includes('://')) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(target, 'http://onenav.local');
	} catch {
		return null;
	}
	if (parsed.username || parsed.password || parsed.origin !== 'http://onenav.local') return null;
	const unsafe = parsed.pathname.split('/').some((segment) => segment === '.' || segment === '..');
	if (unsafe) return null;
	return target;
}

function safeSegment(value: string): string | null {
	if (!value || value.includes('\0') || value.includes('\\') || value.includes('..')) return null;
	return encodeURIComponent(value);
}

function adminPath(page: string | null): string {
	if (page && /^[A-Za-z0-9]+$/.test(page)) return `/admin/${page}`;
	return '/admin';
}

function apiPath(url: URL, method: string): string | null {
	const segment = safeSegment(method);
	if (!segment) return null;
	const params = new URLSearchParams(url.searchParams);
	params.delete('c');
	params.delete('method');
	const query = params.toString();
	return localPath(query ? `/api/${segment}?${query}` : `/api/${segment}`);
}

function fromController(url: URL, controller: string): string | null {
	if (controller.includes('./') || controller.includes('..')) return null;
	if (controller === '' || controller === 'index') return '/';
	if (controller === 'click') {
		const id = url.searchParams.get('id') ?? '';
		const segment = safeSegment(id);
		return segment ? localPath(`/click/${segment}`) : null;
	}
	if (controller === 'api') {
		const method = url.searchParams.get('method') ?? '';
		if (!method) return null;
		return apiPath(url, method);
	}
	if (controller === 'admin') return adminPath(url.searchParams.get('page'));
	if (controller === 'login') return '/login';
	if (controller === 'mobile') return '/admin';
	return null;
}

/**
 * 把 index.php?c= 旧入口收成现有路径。
 * 已经在新路由上，或控制器名带着 ./ / .. 时，返回 null。
 */
export function legacyRedirect(url: URL): string | null {
	if (isModern(url.pathname)) return null;
	const isFront = url.pathname === '/index.php';
	if (!isFront && !url.searchParams.has('c')) return null;
	return fromController(url, url.searchParams.get('c') ?? '');
}
