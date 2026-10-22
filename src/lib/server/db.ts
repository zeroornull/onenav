import { copyFileSync, constants, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dataPaths, type DataPaths } from './paths';

const pooled = new Map<string, Database.Database>();

export const DATABASE_DRIVER = 'better-sqlite3' as const;
const PUBLIC_PROPERTY = 0;

export type CategoryRow = {
	id: number;
	name: string;
	add_time: string;
	up_time: string;
	weight: number;
	property: number;
	description: string;
	font_icon: string | null;
	fid: number;
};

export type LinkRow = {
	id: number;
	fid: number;
	title: string;
	url: string;
	description: string | null;
	add_time: string;
	up_time: string | null;
	weight: number;
	property: number;
	click: number;
	topping: number;
	url_standby: string | null;
	font_icon: string | null;
	check_status: number;
	last_checked_time: string | null;
};

export type CategoryWithLinks = CategoryRow & { links: LinkRow[] };

export type OpenDatabaseOptions = {
	readonly?: boolean;
	fileMustExist?: boolean;
};

export function openDatabase(filename: string, options: OpenDatabaseOptions = {}): Database.Database {
	return new Database(filename, {
		readonly: options.readonly ?? false,
		fileMustExist: options.fileMustExist ?? true
	});
}

/**
 * 打开 data/onenav.db3。文件已在就直接打开；只有不存在时才复制种子库。
 * 传入 file 时只打开该文件，缺失则抛错，不会往别的路径复制。
 */
export function getDb(file?: string): Database.Database {
	const target = file ? path.resolve(file) : ensureDatabaseFile();
	if (!existsSync(target)) throw new Error('数据库文件不存在');
	const cached = pooled.get(target);
	if (cached?.open) return cached;
	const database = openDatabase(target, { fileMustExist: true });
	pooled.set(target, database);
	return database;
}

/** 库文件不存在时才从种子库复制，已存在绝不覆盖。 */
export function ensureDatabaseFile(paths: DataPaths = dataPaths()): string {
	if (existsSync(paths.database)) return paths.database;
	if (!existsSync(paths.seedDatabase)) throw new Error('种子库不存在，无法初始化数据库');
	mkdirSync(path.dirname(paths.database), { recursive: true });
	try {
		copyFileSync(paths.seedDatabase, paths.database, constants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') return paths.database;
		throw new Error('数据库复制失败，请检查目录权限！');
	}
	return paths.database;
}

/** 分类总数等于私有分类数时，访客应去登录。空库两边都是 0，同样为真。 */
export function allCategoriesPrivate(db: Database.Database): boolean {
	const total = count(db, 'SELECT COUNT(*) AS n FROM on_categorys');
	const privateCount = count(db, 'SELECT COUNT(*) AS n FROM on_categorys WHERE property = ?', 1);
	return total === privateCount;
}

export function listCategories(db: Database.Database, loggedIn: boolean): CategoryRow[] {
	const parents = loggedIn
		? db.prepare('SELECT * FROM on_categorys WHERE fid = ? ORDER BY weight DESC').all(0)
		: db
				.prepare('SELECT * FROM on_categorys WHERE fid = ? AND property = ? ORDER BY weight DESC')
				.all(0, PUBLIC_PROPERTY);
	const categories: CategoryRow[] = [];
	for (const parent of parents) {
		const row = mapCategory(parent);
		categories.push(row);
		const children = loggedIn
			? db.prepare('SELECT * FROM on_categorys WHERE fid = ? ORDER BY weight DESC').all(row.id)
			: db
					.prepare(
						'SELECT * FROM on_categorys WHERE fid = ? AND property = ? ORDER BY weight DESC'
					)
					.all(row.id, PUBLIC_PROPERTY);
		for (const child of children) categories.push(mapCategory(child));
	}
	return categories;
}

/** limit 为 null 时不附加 LIMIT，对应首页按 cid 查看全部分类链接。 */
export function listLinks(
	db: Database.Database,
	fid: number,
	loggedIn: boolean,
	limit: number | null
): LinkRow[] {
	if (limit == null) {
		const rows = loggedIn
			? db.prepare('SELECT * FROM on_links WHERE fid = ? ORDER BY weight DESC').all(fid)
			: db
					.prepare('SELECT * FROM on_links WHERE fid = ? AND property = ? ORDER BY weight DESC')
					.all(fid, PUBLIC_PROPERTY);
		return rows.map(mapLink);
	}
	const rows = loggedIn
		? db.prepare('SELECT * FROM on_links WHERE fid = ? ORDER BY weight DESC LIMIT ?').all(fid, limit)
		: db
				.prepare(
					'SELECT * FROM on_links WHERE fid = ? AND property = ? ORDER BY weight DESC LIMIT ?'
				)
				.all(fid, PUBLIC_PROPERTY, limit);
	return rows.map(mapLink);
}

export type CatalogQuery = {
	loggedIn: boolean;
	cid?: number | null;
	linkLimit?: number | null;
};

export function queryCatalog(db: Database.Database, query: CatalogQuery): CategoryWithLinks[] {
	let categories = listCategories(db, query.loggedIn);
	const byCategory = query.cid != null && query.cid !== 0;
	if (byCategory) {
		const found = categories.find((category) => category.id === query.cid);
		categories = found ? [found] : [];
	}
	const limit = byCategory ? null : normalizeLinkLimit(query.linkLimit);
	return categories.map((category) => ({
		...category,
		links: listLinks(db, category.id, query.loggedIn, limit)
	}));
}

export function queryVisitorCatalog(
	db: Database.Database,
	options: { cid?: number | null; linkLimit?: number | null } = {}
): CategoryWithLinks[] {
	return queryCatalog(db, { loggedIn: false, ...options });
}

export function queryUserCatalog(
	db: Database.Database,
	options: { cid?: number | null; linkLimit?: number | null } = {}
): CategoryWithLinks[] {
	return queryCatalog(db, { loggedIn: true, ...options });
}

function count(db: Database.Database, sql: string, ...params: Array<string | number>): number {
	const row = db.prepare(sql).get(...params) as { n: number };
	return Number(row.n);
}

function normalizeLinkLimit(limit: number | null | undefined): number {
	if (limit == null || !Number.isFinite(limit) || limit <= 0) return 30;
	return Math.trunc(limit);
}

function mapCategory(row: unknown): CategoryRow {
	const record = row as Record<string, unknown>;
	return {
		id: Number(record.id),
		name: String(record.name ?? ''),
		add_time: String(record.add_time ?? ''),
		up_time: String(record.up_time ?? ''),
		weight: Number(record.weight ?? 0),
		property: Number(record.property ?? 0),
		description: String(record.description ?? ''),
		font_icon: record.font_icon == null ? null : String(record.font_icon),
		fid: Number(record.fid ?? 0)
	};
}

function mapLink(row: unknown): LinkRow {
	const record = row as Record<string, unknown>;
	return {
		id: Number(record.id),
		fid: Number(record.fid),
		title: String(record.title ?? ''),
		url: String(record.url ?? ''),
		description: record.description == null ? null : String(record.description),
		add_time: String(record.add_time ?? ''),
		up_time: record.up_time == null ? null : String(record.up_time),
		weight: Number(record.weight ?? 0),
		property: Number(record.property ?? 0),
		click: Number(record.click ?? 0),
		topping: Number(record.topping ?? 0),
		url_standby: record.url_standby == null ? null : String(record.url_standby),
		font_icon: record.font_icon == null ? null : String(record.font_icon),
		check_status: Number(record.check_status ?? 0),
		last_checked_time: record.last_checked_time == null ? null : String(record.last_checked_time)
	};
}
