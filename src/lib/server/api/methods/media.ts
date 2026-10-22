import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import {
	dataRoot,
	deny,
	err,
	formatLocal,
	htmlEntityDecode,
	isPrivateIp,
	publicHttpUrl,
	resolveInside,
	ret,
	safeBaseName,
	text
} from '#lib/server/api/util';

export const methods = ['uploadImages', 'del_link_icon', 'get_link_info'];

const IMAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_SUFFIXES = new Set(['ico', 'jpg', 'jpeg', 'png', 'bmp', 'gif', 'svg']);
const ICON_PATH = /^data\/upload\/[0-9]+\/[0-9a-zA-Z]+\.(jpg|jpeg|png|bmp|gif|svg)$/;

function looksLikeImage(suffix: string, bytes: Buffer): boolean {
	if (suffix === 'jpg' || suffix === 'jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (suffix === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	if (suffix === 'gif') return bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a';
	if (suffix === 'bmp') return bytes.subarray(0, 2).toString('ascii') === 'BM';
	if (suffix === 'ico') return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0;
	if (suffix === 'svg') {
		const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
		if (!(head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!doctype'))) return false;
		const body = bytes.toString('utf8').toLowerCase();
		if (!body.includes('<svg')) return false;
		if (/<script|javascript:|on[a-z]+\s*=/.test(body)) return false;
		return true;
	}
	return false;
}

async function readFileField(ctx: ApiContext): Promise<{ name: string; bytes: Buffer } | null> {
	try {
		const form = await ctx.request.clone().formData();
		const file = form.get('file');
		if (!file || typeof file === 'string') return null;
		const bytes = Buffer.from(await file.arrayBuffer());
		return { name: file.name || 'upload', bytes };
	} catch {
		return null;
	}
}

function removeOldIcon(oldPic: string) {
	if (!ICON_PATH.test(oldPic)) return;
	const target = resolveInside(dataRoot(), path.resolve(process.cwd(), oldPic));
	if (!target) return;
	try {
		unlinkSync(target);
	} catch {
		// 旧图标不存在时跟 PHP @unlink 一样继续。
	}
}

async function uploadImages(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const iconName = text(ctx.params.icon_name);
	removeOldIcon(text(ctx.params.old_pic));
	if (!iconName) return ret(-2000, '', '获取图标名称失败！');
	if (!/^[0-9a-zA-Z]+$/.test(iconName)) return ret(-2000, '', '获取图标名称失败！');
	const upload = await readFileField(ctx);
	if (!upload || !upload.bytes.length) return ret(-2000, '', 'File upload failed!');
	if (upload.bytes.length > IMAGE_LIMIT) return ret(-2000, '', '文件过大');
	const suffix = (safeBaseName(upload.name) ?? '').split('.').at(-1)?.toLowerCase() ?? '';
	if (!IMAGE_SUFFIXES.has(suffix) || !looksLikeImage(suffix, upload.bytes)) {
		return ret(-2000, '', 'Unsupported file suffix name!');
	}
	const relative = path.posix.join('data/upload', formatLocal(new Date(), 'Ym'), `${iconName}.${suffix}`);
	const destination = resolveInside(dataRoot(), path.resolve(process.cwd(), relative));
	if (!destination) return ret(-2000, '', '上传失败，请检查目录权限！');
	try {
		mkdirSync(path.dirname(destination), { recursive: true });
		writeFileSync(destination, upload.bytes);
	} catch {
		return ret(-2000, '', '上传失败，请检查目录权限！');
	}
	return ret(200, { file_name: relative }, 'success');
}

function delLinkIcon(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const iconPath = text(ctx.params.icon_path).trim();
	if (!ICON_PATH.test(iconPath)) return ret(-2000, '', '非法路径！');
	const target = resolveInside(dataRoot(), path.resolve(process.cwd(), iconPath));
	if (!target) return ret(-2000, '', '非法路径！');
	if (!existsSync(target)) return ret(-2000, '', '图标文件不存在，无需删除！');
	try {
		unlinkSync(target);
	} catch {
		return ret(-2000, '', '图标删除失败，请检查目录权限！');
	}
	return ret(200, '', 'success');
}

function metaContent(html: string, key: string): string {
	const attr = key.startsWith('og:') ? 'property' : 'name';
	const patterns = [
		new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
		new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["'][^>]*>`, 'i')
	];
	for (const pattern of patterns) {
		const found = pattern.exec(html);
		if (found?.[1]) return found[1];
	}
	return '';
}

function plainText(value: string): string {
	return htmlEntityDecode(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractLink(html: string): { title: string; description: string } {
	const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
	let title = plainText(titleTag);
	if (!title) title = plainText(metaContent(html, 'og:title'));
	if (!title) title = plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
	let description = plainText(metaContent(html, 'description'));
	if (!description) description = plainText(metaContent(html, 'og:description'));
	if (!description) {
		for (const match of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
			const paragraph = plainText(match[1] ?? '');
			if ([...paragraph].length > 30) {
				description = paragraph;
				break;
			}
		}
	}
	return { title, description };
}

function decodePage(bytes: Buffer, contentType: string): string {
	const headerCharset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? '';
	const preview = bytes.subarray(0, 4096).toString('latin1');
	const metaCharset =
		/<meta[^>]*charset=["']?([\w-]+)/i.exec(preview)?.[1]?.toLowerCase() ??
		/<meta[^>]*content=["'][^"']*charset=([\w-]+)/i.exec(preview)?.[1]?.toLowerCase() ??
		'';
	const encoding = (headerCharset || metaCharset || 'utf-8').replaceAll('_', '-');
	if (encoding === 'utf-8' || encoding === 'utf8') return bytes.toString('utf8');
	try {
		return new TextDecoder(encoding).decode(bytes);
	} catch {
		return bytes.toString('utf8');
	}
}

async function readLimited(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	const chunks: Buffer[] = [];
	let total = 0;
	while (total < limit) {
		if (signal.aborted) break;
		const { done, value } = await reader.read();
		if (done) break;
		const buf = Buffer.from(value);
		const room = limit - total;
		chunks.push(buf.length > room ? buf.subarray(0, room) : buf);
		total += Math.min(buf.length, room);
		if (buf.length > room) {
			await reader.cancel();
			break;
		}
	}
	return Buffer.concat(chunks);
}

async function assertResolvedPublic(href: string): Promise<ApiResult | null> {
	const host = new URL(href).hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) return isPrivateIp(host) ? err(-2000, '拒绝访问内网地址') : null;
	let records: { address: string }[] = [];
	try {
		records = await lookup(host, { all: true, verbatim: true });
	} catch {
		return err(-2001, '链接无法访问或超时: getaddrinfo');
	}
	if (!records.length || records.some((record) => isPrivateIp(record.address))) {
		return err(-2000, '拒绝访问内网地址');
	}
	return null;
}

async function getLinkInfo(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const raw = text(ctx.params.url).trim();
	if (!raw) return err(-2000, 'URL不能为空!');
	const checked = publicHttpUrl(raw);
	if ('error' in checked) return checked.error;
	const blocked = await assertResolvedPublic(checked.href);
	if (blocked) return blocked;
	const signal = AbortSignal.timeout(5000);
	let current = checked.href;
	try {
		for (let hop = 0; hop < 5; hop += 1) {
			const hopCheck = publicHttpUrl(current);
			if ('error' in hopCheck) return hopCheck.error;
			const again = await assertResolvedPublic(hopCheck.href);
			if (again) return again;
			const response = await fetch(hopCheck.href, {
				redirect: 'manual',
				signal,
				headers: {
					'user-agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
					range: 'bytes=0-512000'
				}
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				if (!location) return err(-2002, `链接返回无效的HTTP状态码: ${response.status}`);
				current = new URL(location, hopCheck.href).href;
				continue;
			}
			if (response.status < 200 || response.status >= 400) {
				return err(-2002, `链接返回无效的HTTP状态码: ${response.status}`);
			}
			const bytes = await readLimited(response, 512000, signal);
			if (!bytes.length) return { code: 0, data: { title: '', description: '' } };
			const html = decodePage(bytes, response.headers.get('content-type') ?? '');
			return { code: 0, data: extractLink(html) };
		}
		return err(-2002, '链接返回无效的HTTP状态码: 302');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'timeout';
		return err(-2001, `链接无法访问或超时: ${message}`);
	}
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'uploadImages':
			return uploadImages(ctx);
		case 'del_link_icon':
			return delLinkIcon(ctx);
		case 'get_link_info':
			return getLinkInfo(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
