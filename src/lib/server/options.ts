import type Database from 'better-sqlite3';

export type PhpAssoc = Record<string, unknown>;

export type ThemesSetting = {
	pc_theme?: string;
	mobile_theme?: string;
};

export function getOption(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM on_options WHERE "key" = ?').get(key) as
		| { value: string | null }
		| undefined;
	if (!row || row.value == null) return null;
	return row.value;
}

export function setOption(db: Database.Database, key: string, value: string): void {
	db.prepare(
		'INSERT INTO on_options ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value'
	).run(key, value);
}

export function readSecretKey(db: Database.Database): string | null {
	const value = getOption(db, 'SecretKey');
	return value ? value : null;
}

function readJsonOption(db: Database.Database, key: string): PhpAssoc | null {
	const raw = getOption(db, key);
	if (raw == null || raw === '') return null;
	const value: unknown = JSON.parse(raw);
	if (!isAssoc(value)) throw new Error(`选项 ${key} 不是 JSON 对象`);
	return value;
}

function writeJsonOption(db: Database.Database, key: string, value: unknown): void {
	setOption(db, key, JSON.stringify(value));
}

export function readSite(db: Database.Database): PhpAssoc | null {
	return readJsonOption(db, 's_site');
}

export function readTransitionPage(db: Database.Database): PhpAssoc | null {
	return readJsonOption(db, 's_transition_page');
}

/** s_site.link_num 为空或 0 时，首页默认只取 30 条链接。与 PHP empty()/intval 一致。 */
export function linkLimitFromSite(site: PhpAssoc | null): number {
	if (!site || !Object.prototype.hasOwnProperty.call(site, 'link_num')) return 30;
	const raw = site.link_num;
	if (raw == null || raw === '' || raw === false) return 30;
	const limit = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
	if (!Number.isFinite(limit) || limit === 0) return 30;
	return Math.trunc(limit);
}

export const readLinkNum = linkLimitFromSite;

export function getSite(db: Database.Database): PhpAssoc | null {
	return readSite(db);
}

export function setSite(db: Database.Database, value: unknown): void {
	writeJsonOption(db, 's_site', value);
}

export function getTransitionPage(db: Database.Database): PhpAssoc | null {
	return readTransitionPage(db);
}

export function setTransitionPage(db: Database.Database, value: unknown): void {
	writeJsonOption(db, 's_transition_page', value);
}

export function getThemes(db: Database.Database): ThemesSetting | null {
	return readThemes(db);
}

export const setThemes = writeThemes;

export function readThemes(db: Database.Database): ThemesSetting | null {
	const raw = getOption(db, 's_themes');
	if (!raw) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (!isAssoc(parsed)) throw new Error('s_themes 不是 JSON 对象');
	return parsed as ThemesSetting;
}

export function writeThemes(db: Database.Database, themes: ThemesSetting): void {
	setOption(db, 's_themes', JSON.stringify(themes));
}

function isAssoc(value: unknown): value is PhpAssoc {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
