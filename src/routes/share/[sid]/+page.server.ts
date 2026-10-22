import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '#lib/server/db';
import { loadShare, type ShareView } from './open';

export const load: PageServerLoad = ({ params }) => {
	return loadShare(getDb(), params.sid, null);
};

export const actions = {
	default: async ({ request, params }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '').trim();
		const view = loadShare(getDb(), params.sid, password);
		if (view.kind === 'denied' || view.kind === 'locked') return fail(401, { message: '密码错误！' });
		if (view.kind === 'expired') return fail(403, { message: '链接已过期！' });
		if (view.kind === 'missing') return fail(404, { message: 'SID不存在！' });
		if (view.kind === 'invalid') return fail(400, { message: 'SID不合法！' });
		return view;
	}
} satisfies Actions;

export type { ShareView };
