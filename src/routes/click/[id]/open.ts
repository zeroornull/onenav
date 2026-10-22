import type Database from 'better-sqlite3';
import { readSite, readTransitionPage } from '#lib/server/options';

export type ClickLink = {
	id: number;
	title: string;
	description: string;
	url: string;
	urlStandby: string | null;
	siteTitle: string;
	ad1: string;
	ad2: string;
	/** 没有备用链接时才自动跳转，单位秒。有备用链接时为 null。 */
	refreshSeconds: number | null;
};

export type ClickResult = { kind: 'invalid' } | { kind: 'forbidden' } | { kind: 'redirect'; url: string } | ({ kind: 'transition' } & ClickLink);

type LinkHit = {
	id: number;
	fid: number;
	url: string;
	url_standby: string | null;
	property: number;
	title: string;
	description: string | null;
};

/**
 * 对齐 controller/click.php：
 * 链接和分类都是 property = 0，或已登录，才把 click 加 1。
 * 有备用链接，或过渡页 control = on，留下过渡页；否则 302 到 url。
 */
export function resolveClick(db: Database.Database, id: number, loggedIn: boolean): ClickResult {
	if (!Number.isSafeInteger(id) || id <= 0) return { kind: 'invalid' };

	const link = db
		.prepare(
			'SELECT id, fid, url, url_standby, property, title, description FROM on_links WHERE id = ?'
		)
		.get(id) as LinkHit | undefined;
	if (!link) return { kind: 'invalid' };

	const category = db.prepare('SELECT id, property FROM on_categorys WHERE id = ?').get(link.fid) as
		| { id: number; property: number }
		| undefined;
	const isPublic = Number(link.property) === 0 && Number(category?.property) === 0;
	if (!isPublic && !loggedIn) return { kind: 'forbidden' };

	const updated = db.prepare('UPDATE on_links SET click = click + 1 WHERE id = ?').run(id);
	if (updated.changes !== 1) return { kind: 'invalid' };

	const standby = phpEmpty(link.url_standby) ? '' : String(link.url_standby);
	const transition = readTransitionPage(db);
	const control = typeof transition?.control === 'string' ? transition.control : '';
	if (standby === '' && control !== 'on') {
		return { kind: 'redirect', url: link.url };
	}

	const site = readSite(db);
	const stayKey = loggedIn ? 'admin_stay_time' : 'visitor_stay_time';
	return {
		kind: 'transition',
		id: link.id,
		title: link.title,
		description: link.description ?? '',
		url: link.url,
		urlStandby: standby || null,
		siteTitle: textOr(site?.title, 'OneNav'),
		ad1: htmlField(transition?.a_d_1),
		ad2: htmlField(transition?.a_d_2),
		refreshSeconds: standby === '' ? staySeconds(transition?.[stayKey]) : null
	};
}

function phpEmpty(value: unknown): boolean {
	if (value == null || value === false) return true;
	if (typeof value === 'number') return value === 0;
	if (typeof value === 'string') return value === '' || value === '0';
	return false;
}

function textOr(value: unknown, fallback: string): string {
	if (typeof value !== 'string' || value.trim() === '') return fallback;
	return value;
}

function htmlField(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function staySeconds(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return Math.min(Math.trunc(parsed), 86400);
}
