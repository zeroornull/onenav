import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { BUSY_MSG, claimExclusive } from '#lib/server/api/exclusive';
import {
	allRows,
	dataRoot,
	deny,
	err,
	fileSuffix,
	htmlEntityDecode,
	htmlspecialchars,
	intval,
	isUniqueError,
	resolveDataFile,
	resolveInside,
	ret,
	safeBaseName,
	text,
	unixTime
} from '#lib/server/api/util';

export const methods = ['upload', 'imp_link', 'import_link', 'export_link', 'export_json'];

const HTML_LIMIT = 8 * 1024 * 1024;

type LinkNode = { title: string; url: string; add_time: string; description?: string; url_standby?: string; weight?: number };
type CatNode = {
	id: number;
	fid: number;
	name: string;
	description: string;
	weight: number;
	add_time: string;
	links: LinkNode[];
	children: CatNode[];
};

async function readUpload(ctx: ApiContext): Promise<{ name: string; bytes: Buffer } | null> {
	try {
		const form = await ctx.request.clone().formData();
		const file = form.get('file');
		if (!file || typeof file === 'string') return null;
		return { name: file.name || 'upload.html', bytes: Buffer.from(await file.arrayBuffer()) };
	} catch {
		return null;
	}
}

async function uploadBookmark(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const upload = await readUpload(ctx);
	if (!upload || !upload.bytes.length) return err(-1015, 'File upload failed!');
	if (upload.bytes.length > HTML_LIMIT) return err(-2000, '文件过大');
	const base = safeBaseName(upload.name);
	if (!base || fileSuffix(base) !== 'html') return err(-1014, 'Unsupported file suffix name!');
	const relative = `data/${base}`;
	const destination = resolveInside(dataRoot(), path.resolve(process.cwd(), relative));
	if (!destination) return err(-2000, '上传失败，请检查data/目录权限！');
	try {
		mkdirSync(dataRoot(), { recursive: true });
		writeFileSync(destination, upload.bytes);
	} catch {
		return err(-2000, '上传失败，请检查data/目录权限！');
	}
	return { code: 0, file_name: relative };
}

function parseFlatLinks(content: string): Array<{ title: string; url: string }> {
	const blocks = content.match(/<A.*<\/A>/gi) ?? [];
	return blocks.map((link) => {
		const url = (link.match(/http.*"? ADD_DATE/i)?.[0] ?? '').replaceAll('" ADD_DATE', '');
		let title = link.match(/>.*<\/a>$/i)?.[0] ?? '';
		title = title.replaceAll('>', '').replaceAll('</A', '');
		return { title, url };
	});
}

function impLink(ctx: ApiContext): ApiResult {
	const filename = text(ctx.params.filename).trim();
	const suffix = fileSuffix(filename.replaceAll('../', '').replaceAll('./', ''));
	if (suffix !== 'html' && suffix !== 'htm') return err(-2000, '文件不合法!');
	const denied = deny(ctx);
	if (denied) return denied;
	const release = claimExclusive();
	if (!release) return err(-2000, BUSY_MSG);
	try {
		return importFlat(ctx);
	} finally {
		release();
	}
}

function importFlat(ctx: ApiContext): ApiResult {
	const filename = text(ctx.params.filename).trim();
	const target = resolveDataFile(filename);
	if (!target || !existsSync(target)) return err(-1016, 'File does not exist!');
	const content = readFileSync(target, 'utf8');
	const links = parseFlatLinks(content);
	const fid = intval(ctx.params.fid);
	const property = intval(ctx.params.property);
	let success = 0;
	let fail = 0;
	const insert = ctx.db.prepare(
		`INSERT INTO on_links (fid, title, url, description, add_time, weight, property)
		 VALUES (?, ?, ?, '', ?, 0, ?)`
	);
	for (const link of links) {
		if (!link.title || !link.url) {
			fail += 1;
			continue;
		}
		try {
			const result = insert.run(fid, link.title, link.url, unixTime(), property);
			if (result.changes) success += 1;
			else fail += 1;
		} catch {
			fail += 1;
		}
	}
	try {
		unlinkSync(target);
	} catch {
		// PHP 也会删文件；删不掉不影响已经写入的统计。
	}
	return { code: 0, msg: `总数：${links.length} 成功：${success} 失败：${fail}` };
}

function importLink(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const release = claimExclusive();
	if (!release) return err(-2000, BUSY_MSG);
	try {
		return importNested(ctx);
	} finally {
		release();
	}
}

function importNested(ctx: ApiContext): ApiResult {
	const filename = text(ctx.params.filename).trim();
	const target = resolveDataFile(filename);
	if (!target || !existsSync(target)) return err(-1016, 'File does not exist!');
	const property = intval(ctx.params.property);
	const lines = readFileSync(target, 'utf8').split('\n');
	const data: Array<{ category: string; title: string; url: string }> = [];
	const categoryNames: string[] = [];
	const stack: string[] = [];
	for (const line of lines) {
		const category = /<DT><H3.+>(.*)<\/H3>/i.exec(line);
		if (category) {
			categoryNames.push(category[1] ?? '');
			stack.push(category[1] ?? '');
			continue;
		}
		if (/<\/DL><p>/i.test(line)) {
			stack.pop();
			continue;
		}
		const urls = /<DT><A HREF="(.+)" ADD_DAT.+>(.+)<\/A>/i.exec(line);
		if (urls) {
			data.push({ category: stack.at(-1) ?? '', title: urls[2] ?? '', url: urls[1] ?? '' });
		}
	}
	const uniqueNames = [...new Set(categoryNames)];
	uniqueNames.push('默认分类');
	const insertCategory = ctx.db.prepare(
		`INSERT INTO on_categorys (name, add_time, weight, property, description, fid)
		 VALUES (?, ?, 0, 1, '书签导入时自动创建', 0)`
	);
	for (const name of uniqueNames) {
		const categoryName = name.trim() || '默认分类';
		try {
			insertCategory.run(categoryName, unixTime());
		} catch (error) {
			if (!isUniqueError(error)) throw error;
		}
	}
	const categories = allRows(ctx, 'SELECT name, id, fid FROM on_categorys');
	let success = 0;
	const insertLink = ctx.db.prepare(
		`INSERT INTO on_links (fid, title, url, add_time, weight, property)
		 VALUES (?, ?, ?, ?, 0, ?)`
	);
	for (const item of data) {
		const categoryName = item.category.trim() || '默认分类';
		const found = categories.find((category) => String(category.name ?? '').trim() === categoryName);
		const fid = found ? Number(found.id) : 0;
		try {
			const result = insertLink.run(fid, htmlspecialchars(item.title), htmlspecialchars(item.url), unixTime(), property);
			if (result.changes) success += 1;
		} catch (error) {
			if (!isUniqueError(error)) throw error;
		}
	}
	try {
		unlinkSync(target);
	} catch {
		// 文件可能已被删除。
	}
	return ret(200, 'success', { count: data.length, success, failed: data.length - success });
}

function positiveInt(value: unknown, fallback: number): number {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildTree(ctx: ApiContext): CatNode[] {
	const categories = allRows(
		ctx,
		'SELECT id, name, fid, description, weight, add_time FROM on_categorys ORDER BY fid ASC, weight DESC, id DESC'
	);
	const links = allRows(
		ctx,
		'SELECT id, fid, title, url, description, url_standby, add_time, weight FROM on_links ORDER BY weight DESC, id DESC'
	);
	const linksByCat = new Map<number, LinkNode[]>();
	for (const link of links) {
		const fid = Number(link.fid);
		const list = linksByCat.get(fid) ?? [];
		list.push({
			title: String(link.title ?? ''),
			url: String(link.url ?? ''),
			description: link.description == null ? '' : String(link.description),
			url_standby: link.url_standby == null ? '' : String(link.url_standby),
			add_time: String(link.add_time ?? ''),
			weight: Number(link.weight ?? 0)
		});
		linksByCat.set(fid, list);
	}
	const map = new Map<number, CatNode>();
	for (const category of categories) {
		const id = Number(category.id);
		map.set(id, {
			id,
			fid: Number(category.fid ?? 0),
			name: String(category.name ?? ''),
			description: category.description == null ? '' : String(category.description),
			weight: Number(category.weight ?? 0),
			add_time: String(category.add_time ?? ''),
			links: linksByCat.get(id) ?? [],
			children: []
		});
	}
	const tree: CatNode[] = [];
	for (const node of map.values()) {
		if (node.fid === 0) tree.push(node);
		else if (map.has(node.fid)) map.get(node.fid)?.children.push(node);
		else tree.push(node);
	}
	const sortNodes = (nodes: CatNode[]) => {
		nodes.sort((a, b) => b.weight - a.weight || b.id - a.id);
		for (const node of nodes) sortNodes(node.children);
	};
	sortNodes(tree);
	return tree;
}

function renderBookmarks(tree: CatNode[]): string {
	const now = Math.floor(Date.now() / 1000);
	const lines = [
		'<!DOCTYPE NETSCAPE-Bookmark-file-1>',
		'<!-- This is an automatically generated file.',
		'     It will be read and overwritten.',
		'     DO NOT EDIT! -->',
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
		'<TITLE>Bookmarks</TITLE>',
		'<H1>Bookmarks</H1>',
		'<DL><p>',
		`    <DT><H3 ADD_DATE="${now}" LAST_MODIFIED="${now}" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks</H3>`,
		'    <DL><p>'
	];
	const printCategory = (cat: CatNode, depth: number) => {
		const indent = '    '.repeat(depth);
		const inner = '    '.repeat(depth + 1);
		const name = htmlspecialchars(cat.name === '默认分类' ? 'OneNav默认分类' : cat.name);
		const addDate = positiveInt(cat.add_time, now);
		lines.push(`${indent}<DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${addDate}">${name}</H3>`);
		lines.push(`${indent}<DL><p>`);
		for (const child of cat.children) printCategory(child, depth + 1);
		for (const link of cat.links) {
			lines.push(
				`${inner}<DT><A HREF="${htmlspecialchars(link.url)}" ADD_DATE="${positiveInt(link.add_time, now)}">${htmlspecialchars(link.title)}</A>`
			);
		}
		lines.push(`${indent}</DL><p>`);
	};
	for (const category of tree) printCategory(category, 2);
	lines.push('    </DL><p>', '</DL><p>', '');
	return lines.join('\n');
}

function exportStamp(): string {
	const day = new Date();
	const month = String(day.getMonth() + 1).padStart(2, '0');
	const date = String(day.getDate()).padStart(2, '0');
	return `${day.getFullYear()}${month}${date}`;
}

function exportLink(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const html = renderBookmarks(buildTree(ctx));
	const filename = `OneNav_Export_${exportStamp()}.html`;
	return {
		code: 0,
		data: html,
		download: {
			filename,
			contentType: 'text/html; charset=UTF-8',
			body: html
		}
	};
}

function exportJson(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const tree = buildTree(ctx);
	const orphans = tree.filter((node) => node.fid !== 0);
	const tops = tree.filter((node) => node.fid === 0);
	const looseLinks = allRows(
		ctx,
		'SELECT title, url, description, url_standby, weight, fid FROM on_links ORDER BY weight DESC, id DESC'
	).filter((link) => {
		const fid = Number(link.fid);
		return ![...buildIdSet(tree)].includes(fid);
	});
	const stripLink = (link: LinkNode) => ({
		title: htmlEntityDecode(link.title),
		url: link.url,
		description: htmlEntityDecode(link.description ?? ''),
		backup_url: link.url_standby ?? '',
		sort_order: Number(link.weight ?? 0)
	});
	const stripChild = (node: CatNode) => ({
		name: htmlEntityDecode(node.name),
		description: htmlEntityDecode(node.description),
		links: node.links.map(stripLink)
	});
	const stripTop = (node: CatNode) => ({
		name: htmlEntityDecode(node.name),
		description: htmlEntityDecode(node.description),
		links: node.links.map(stripLink),
		children: node.children.map(stripChild)
	});
	const categories = tops.map(stripTop);
	if (orphans.length || looseLinks.length) {
		categories.push({
			name: '默认分类',
			description: '',
			links: looseLinks.map((link) =>
				stripLink({
					title: String(link.title ?? ''),
					url: String(link.url ?? ''),
					description: link.description == null ? '' : String(link.description),
					url_standby: link.url_standby == null ? '' : String(link.url_standby),
					weight: Number(link.weight ?? 0),
					add_time: ''
				})
			),
			children: orphans.map(stripChild)
		});
	}
	const filename = `OneNav_Export_${exportStamp()}.json`;
	const payload = { type: 'onenav.bookmarks', version: 1, categories };
	return {
		code: 0,
		data: payload,
		filename,
		download: {
			filename,
			contentType: 'application/json; charset=UTF-8',
			body: `${JSON.stringify(payload, null, 4)}\n`
		}
	};
}

function buildIdSet(nodes: CatNode[], ids = new Set<number>()): Set<number> {
	for (const node of nodes) {
		ids.add(node.id);
		buildIdSet(node.children, ids);
	}
	return ids;
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'upload':
			return uploadBookmark(ctx);
		case 'imp_link':
			return impLink(ctx);
		case 'import_link':
			return importLink(ctx);
		case 'export_link':
			return exportLink(ctx);
		case 'export_json':
			return exportJson(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
