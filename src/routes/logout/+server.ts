import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LOGIN_COOKIE } from '#lib/server/auth';

const exit: RequestHandler = ({ cookies }) => {
	cookies.delete(LOGIN_COOKIE.name, {
		path: LOGIN_COOKIE.path,
		httpOnly: LOGIN_COOKIE.httpOnly,
		secure: LOGIN_COOKIE.secure,
		sameSite: LOGIN_COOKIE.sameSite
	});
	redirect(303, '/');
};

export const GET = exit;
export const POST = exit;
