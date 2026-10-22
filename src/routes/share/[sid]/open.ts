import type Database from 'better-sqlite3';

export type ShareLink = {
	id: number;
	title: string;
	url: string;
	description: string | null;
	urlStandby: string | null;
	href: string;
};

export type ShareView =
	| { kind: 'invalid' }
	| { kind: 'missing' }
	| { kind: 'expired'; expireTime: string }
	| { kind: 'locked'; categoryName: string; expireTime: string }
	| { kind: 'denied'; categoryName: string; expireTime: string }
	| { kind: 'ready'; categoryName: string; expireTime: string; links: ShareLink[] };

type ShareRow = {
	sid: string;
	expire_time: string;
	password: string | null;
	cid: number;
};

/**
 * 公开入口是 index.php?c=universal#/share/{sid}，数据来自 Api::get_sid_links。
 * 过期先于密码。密码为空（含 PHP empty 的 "0"）则直接打开。
 * 任务要求只返回该分类 property = 0 的公开链接。
 * password 为 null 表示访客还没提交密码。
 */
export function loadShare(db: Database.Database, sid: string, password: string | null): ShareView {
	if (!/^[A-Za-z0-9]{8}$/.test(sid)) return { kind: 'invalid' };

	const share = db
		.prepare('SELECT sid, expire_time, password, cid FROM on_shares WHERE sid = ?')
		.get(sid) as ShareRow | undefined;
	if (!share) return { kind: 'missing' };

	const expireTime = String(share.expire_time ?? '');
	if (isExpired(expireTime)) return { kind: 'expired', expireTime };

	const category = db.prepare('SELECT name, property FROM on_categorys WHERE id = ?').get(share.cid) as
		| { name: string; property: number }
		| undefined;
	const categoryName = category?.name?.trim() ? category.name : '未命名分类';

	if (!phpEmpty(share.password)) {
		if (password == null) return { kind: 'locked', categoryName, expireTime };
		if (password !== share.password) return { kind: 'denied', categoryName, expireTime };
	}

	const categoryPublic = Number(category?.property) === 0;
	const rows = db
		.prepare(
			`SELECT id, title, url, description, url_standby, property
			 FROM on_links
			 WHERE fid = ? AND property = ?
			 ORDER BY weight DESC, id DESC`
		)
		.all(share.cid, 0) as Array<{
		id: number;
		title: string;
		url: string;
		description: string | null;
		url_standby: string | null;
		property: number;
	}>;

	return {
		kind: 'ready',
		categoryName,
		expireTime,
		links: rows.map((link) => ({
			id: Number(link.id),
			title: String(link.title ?? ''),
			url: String(link.url ?? ''),
			description: link.description == null ? null : String(link.description),
			urlStandby: phpEmpty(link.url_standby) ? null : String(link.url_standby),
			href: categoryPublic ? `/click/${link.id}` : String(link.url ?? '')
		}))
	};
}

export function isExpired(expireTime: string, now = Date.now()): boolean {
	const expiresAt = phpTime(expireTime);
	if (expiresAt == null) return true;
	return Math.floor(now / 1000) > Math.floor(expiresAt / 1000);
}

function phpTime(value: string): number | null {
	const text = value.trim();
	const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
	if (match) {
		const time = new Date(
			Number(match[1]),
			Number(match[2]) - 1,
			Number(match[3]),
			Number(match[4]),
			Number(match[5]),
			Number(match[6])
		).getTime();
		return Number.isNaN(time) ? null : time;
	}
	if (/^\d{9,10}$/.test(text)) return Number(text) * 1000;
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? null : parsed;
}

function phpEmpty(value: unknown): boolean {
	if (value == null || value === false) return true;
	if (typeof value === 'number') return value === 0;
	if (typeof value === 'string') return value === '' || value === '0';
	return false;
}
