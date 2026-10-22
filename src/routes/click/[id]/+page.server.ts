import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db';
import { resolveClick } from './open';

const PRIVATE_MESSAGE =
	'很抱歉，该页面是私有的，您无权限访问此页面。\n如果您是管理员，请尝试登录OneNav后台并重新访问。';

export const load: PageServerLoad = ({ params, locals }) => {
	const id = parseLinkId(params.id);
	if (id == null) error(403, '无效ID！');

	const result = resolveClick(getDb(), id, locals.isLogin);
	if (result.kind === 'invalid') error(403, '无效ID！');
	if (result.kind === 'forbidden') error(403, PRIVATE_MESSAGE);
	if (result.kind === 'redirect') redirect(302, result.url, { external: true });
	return result;
};

function parseLinkId(raw: string): number | null {
	if (!/^[1-9]\d*$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) ? id : null;
}
