import type Database from 'better-sqlite3';
import { getDb } from './db';
import { getSite, readLinkNum } from './options';
import type { Category, Link } from './types';

const CATEGORY_COLUMNS =
	'id, name, add_time, up_time, weight, property, description, font_icon, fid';
const LINK_COLUMNS =
	'id, fid, title, url, description, add_time, up_time, weight, property, click, topping, url_standby, font_icon, check_status, last_checked_time';

export interface CatalogCategory extends Category {
	links: Link[];
}

export interface CatalogResult {
	categories: CatalogCategory[];
	/** 分类总数等于 property = 1 的数量（含两边都是 0）。未登录时应去登录。 */
	allPrivate: boolean;
	/** 站点 link_num；未配置时为 30。指定 cid 时链接不按此值截断。 */
	linkNum: number;
	/** 实际用来筛选的分类 id。未筛选时为 null。 */
	cid: number | null;
}

export interface LoadCatalogInput {
	loggedIn: boolean;
	cid?: unknown;
	db?: Database.Database;
}

/**
 * 未传、空串、0 视为不筛选。正整数或数字字符串返回该 id。
 * 其它值返回 undefined，调用方得到空分类，且不会把原文拼进 SQL。
 */
export function parseCid(cid: unknown): number | null | undefined {
	if (cid === undefined || cid === null || cid === '' || cid === 0 || cid === '0') return null;
	if (typeof cid === 'number' && Number.isInteger(cid) && cid > 0) return cid;
	if (typeof cid === 'string' && /^[1-9]\d*$/.test(cid)) return Number(cid);
	return undefined;
}

function useDb(db?: Database.Database): Database.Database {
	return db ?? getDb();
}

function categorySql(loggedIn: boolean): string {
	const visibility = loggedIn ? '' : ' AND property = 0';
	return `SELECT ${CATEGORY_COLUMNS} FROM on_categorys WHERE fid = ?${visibility} ORDER BY weight DESC`;
}

function linkSql(loggedIn: boolean, limited: boolean): string {
	const visibility = loggedIn ? '' : ' AND property = 0';
	const limit = limited ? ' LIMIT ?' : '';
	return `SELECT ${LINK_COLUMNS} FROM on_links WHERE fid = ?${visibility} ORDER BY weight DESC${limit}`;
}

function listCategories(db: Database.Database, fid: number, loggedIn: boolean): Category[] {
	return db.prepare(categorySql(loggedIn)).all(fid) as Category[];
}

export function categoriesAreAllPrivate(db: Database.Database): boolean {
	const row = db
		.prepare(
			`SELECT COUNT(*) AS total,
			        COUNT(CASE WHEN property = 1 THEN 1 END) AS private_count
			 FROM on_categorys`
		)
		.get() as { total: number; private_count: number };
	return row.total === row.private_count;
}

/** 未登录且全部分类私有时，调用方应转到登录。 */
export function guestMustLogin(result: Pick<CatalogResult, 'allPrivate'>, loggedIn: boolean): boolean {
	return result.allPrivate && !loggedIn;
}

/**
 * 对齐 controller/index.php：
 * 登录看全部分类和链接；访客只看 property = 0。
 * 先按 weight 取一级分类，再紧跟其二级分类。
 * 传入 cid 时只留该分类，且该分类链接不截断。
 */
export function loadCatalog(input: LoadCatalogInput): CatalogResult {
	const db = useDb(input.db);
	const loggedIn = input.loggedIn;
	const parsedCid = parseCid(input.cid);
	const site = getSite(db);
	const linkNum = readLinkNum(site);
	const allPrivate = categoriesAreAllPrivate(db);

	if (parsedCid === undefined) {
		return { categories: [], allPrivate, linkNum, cid: null };
	}

	const parents = listCategories(db, 0, loggedIn);
	const ordered: Category[] = [];
	for (const parent of parents) {
		ordered.push(parent);
		ordered.push(...listCategories(db, parent.id, loggedIn));
	}

	const selected =
		parsedCid === null ? ordered : ordered.filter((category) => category.id === parsedCid);
	const limited = parsedCid === null;
	const links = db.prepare(linkSql(loggedIn, limited));
	const categories: CatalogCategory[] = selected.map((category) => ({
		...category,
		links: (limited ? links.all(category.id, linkNum) : links.all(category.id)) as Link[]
	}));

	return {
		categories,
		allPrivate,
		linkNum,
		cid: parsedCid
	};
}
