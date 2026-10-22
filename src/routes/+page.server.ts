import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allCategoriesPrivate, getDb, queryUserCatalog, queryVisitorCatalog } from '#lib/server/db';
import { linkLimitFromSite, readSite } from '#lib/server/options';

export const load: PageServerLoad = ({ locals, url }) => {
	const db = getDb();
	if (!locals.isLogin && allCategoriesPrivate(db)) redirect(303, '/login');

	const site = readSite(db);
	const cid = parseCid(url.searchParams.get('cid'));
	const linkLimit = linkLimitFromSite(site);
	const categories = locals.isLogin
		? queryUserCatalog(db, { cid, linkLimit })
		: queryVisitorCatalog(db, { cid, linkLimit });

	return {
		loggedIn: locals.isLogin,
		user: locals.user,
		siteTitle: siteText(site?.title, 'OneNav'),
		siteSubtitle: siteText(site?.subtitle, ''),
		siteDescription: siteText(site?.description, ''),
		siteKeywords: siteText(site?.keywords, ''),
		cid,
		categories
	};
};

function siteText(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const text = value.trim();
	return text || fallback;
}

function parseCid(raw: string | null): number | null {
	if (raw == null || raw === '' || raw === '0') return null;
	if (!/^[1-9]\d*$/.test(raw)) return null;
	const cid = Number(raw);
	return Number.isSafeInteger(cid) ? cid : null;
}
