import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { LOGIN_COOKIE, attemptLogin } from '#lib/server/auth';
import { loadSiteConfig } from '#lib/server/config';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.isLogin) redirect(303, '/');
	return { installed: loadSiteConfig() !== null };
};

export const actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const result = attemptLogin({
			user: String(form.get('user') ?? ''),
			password: String(form.get('password') ?? ''),
			config: loadSiteConfig(),
			userAgent: request.headers.get('user-agent') ?? ''
		});
		if (!result.ok) return fail(401, { message: result.message });
		cookies.set(LOGIN_COOKIE.name, result.cookie, {
			path: LOGIN_COOKIE.path,
			httpOnly: LOGIN_COOKIE.httpOnly,
			secure: LOGIN_COOKIE.secure,
			maxAge: LOGIN_COOKIE.maxAge,
			sameSite: LOGIN_COOKIE.sameSite
		});
		redirect(303, '/');
	}
} satisfies Actions;
