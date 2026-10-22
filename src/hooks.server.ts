import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { legacyRedirect } from '#lib/legacy-redirect';
import { isLogin } from '#lib/server/auth';
import { isInstalled, loadSiteConfig } from '#lib/server/config';
import { shouldRedirectToInstall } from '#lib/server/gate';

export const handle: Handle = async ({ event, resolve }) => {
	const legacy = legacyRedirect(event.url);
	if (legacy) redirect(301, legacy);

	const userAgent = event.request.headers.get('user-agent') ?? '';
	event.locals.userAgent = userAgent;
	const config = isInstalled() ? loadSiteConfig() : null;
	if (
		config &&
		isLogin(event.cookies.get('key'), config.USER, config.ENCRYPTED_PASSWORD, userAgent)
	) {
		event.locals.isLogin = true;
		event.locals.user = config.USER;
	} else {
		event.locals.isLogin = false;
		event.locals.user = null;
	}

	if (shouldRedirectToInstall(config !== null, event.url.pathname)) {
		redirect(303, '/install');
	}

	return resolve(event);
};
