/** 未安装时放行安装页、登录页、退出，以及开发服务器自己的资源。 */
export function allowsUnauthenticatedInstall(pathname: string): boolean {
	if (pathname === '/install' || pathname.startsWith('/install/')) return true;
	if (pathname === '/login' || pathname === '/logout') return true;
	if (pathname.startsWith('/_app')) return true;
	if (pathname === '/favicon.ico') return true;
	if (
		pathname.startsWith('/@') ||
		pathname.startsWith('/node_modules/') ||
		pathname.startsWith('/src/') ||
		pathname.startsWith('/.svelte-kit/')
	) {
		return true;
	}
	return false;
}

export function shouldRedirectToInstall(installed: boolean, pathname: string): boolean {
	return !installed && !allowsUnauthenticatedInstall(pathname);
}
