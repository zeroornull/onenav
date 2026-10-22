import { isIP } from 'node:net';
import path from 'node:path';
import { readSecretKey } from '#lib/server/options';
import type { ApiContext, ApiResult } from '#lib/server/api/context';

/** PHP htmlspecialchars，ENT_QUOTES | ENT_HTML401：单引号变成 &#039;。 */
export function htmlspecialchars(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

export function htmlEntityDecode(value: string): string {
	return value
		.replaceAll('&#039;', "'")
		.replaceAll('&#39;', "'")
		.replaceAll('&apos;', "'")
		.replaceAll('&quot;', '"')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}

/** PHP empty()：未传、空串、字符串 "0"。 */
export function phpEmpty(value: string | undefined | null): boolean {
	return value == null || value === '' || value === '0';
}

/** PHP intval：取开头的整数。 */
export function intval(value: string | undefined | null): number {
	if (value == null) return 0;
	const match = String(value).trim().match(/^[+-]?\d+/);
	if (!match) return 0;
	const parsed = Number.parseInt(match[0], 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** controller 里 empty($property) ? 0 : 1。 */
export function flag01(value: string | undefined): number {
	return phpEmpty(value) ? 0 : 1;
}

export function weightOf(value: string | undefined): number {
	return phpEmpty(value) ? 0 : intval(value);
}

export function pageOf(value: string | undefined): number {
	const page = intval(value);
	return page < 1 ? 1 : page;
}

export function limitOf(value: string | undefined): number {
	const limit = intval(value);
	return limit < 1 ? 10 : limit;
}

export function idList(value: string | undefined): number[] {
	if (!value) return [];
	const ids: number[] = [];
	for (const part of value.split(',')) {
		const id = intval(part.trim());
		if (id > 0) ids.push(id);
	}
	return ids;
}

export function text(value: string | undefined | null): string {
	return value ?? '';
}

export function unixTime(): string {
	return String(Math.floor(Date.now() / 1000));
}

export function formatLocal(date: Date, kind: 'Ym' | 'Ymd' | 'YmdHi' | 'datetime'): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	if (kind === 'Ym') return `${year}${month}`;
	if (kind === 'Ymd') return `${year}${month}${day}`;
	if (kind === 'YmdHi') return `${year}${month}${day}${hour}${minute}`;
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 写操作鉴权失败。
 * token / X-Token 已传但 SecretKey 为空时，跟 Api::auth 一样返回 -2000。
 * 其余失败返回 -1002。判断本身用路由算好的 ctx.authed。
 */
export function deny(ctx: ApiContext): ApiResult | null {
	if (ctx.authed) return null;
	const token = (ctx.params.token ?? '').trim();
	const header = (ctx.request.headers.get('x-token') ?? '').trim();
	if ((token || header) && !readSecretKey(ctx.db)) {
		return { code: -2000, err_msg: '请先生成SecretKey！' };
	}
	return { code: -1002, err_msg: 'Authorization failure!' };
}

export function err(code: number, errMsg: string): ApiResult {
	return { code, err_msg: errMsg };
}

/** Api::return_json：code、data、msg 三个字段。 */
export function ret(code: number, data: unknown, msg: unknown = ''): ApiResult {
	return { code, data, msg };
}

export type SqlValue = string | number | bigint | null;

export function allRows(ctx: ApiContext, sql: string, ...params: SqlValue[]): Record<string, unknown>[] {
	return ctx.db.prepare(sql).all(...params) as Record<string, unknown>[];
}

export function oneRow(ctx: ApiContext, sql: string, ...params: SqlValue[]): Record<string, unknown> | undefined {
	return ctx.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
}

export function countRows(ctx: ApiContext, sql: string, ...params: SqlValue[]): number {
	const row = oneRow(ctx, sql, ...params);
	return Number(row?.n ?? 0);
}

export function isUniqueError(error: unknown): boolean {
	const code = (error as { code?: string }).code ?? '';
	return code.includes('SQLITE_CONSTRAINT') || (error instanceof Error && error.message.includes('UNIQUE'));
}

export function dataRoot(): string {
	return path.resolve(process.cwd(), 'data');
}

export function resolveInside(root: string, target: string): string | null {
	const base = path.resolve(root);
	const resolved = path.resolve(target);
	if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
	return null;
}

/** 上传和导入只允许落在 data/ 下面，并丢掉 ../。 */
export function resolveDataFile(filename: string): string | null {
	const cleaned = filename.replaceAll('../', '').replaceAll('./', '');
	if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) return null;
	return resolveInside(dataRoot(), path.resolve(process.cwd(), cleaned));
}

export function safeBaseName(name: string): string | null {
	const normalized = name.replaceAll('\\', '/');
	const base = path.posix.basename(normalized);
	if (!base || base === '.' || base === '..' || base.includes('..') || base.includes('/') || base.includes('\0')) {
		return null;
	}
	return base;
}

export function fileSuffix(name: string): string {
	const base = safeBaseName(name) ?? '';
	const parts = base.split('.');
	if (parts.length < 2) return '';
	return (parts.at(-1) ?? '').toLowerCase();
}

/** 备份名必须像 onenav_202610221430_1.2.4.db3，并且明确拒绝 ..。 */
export function backupNameOk(name: string): boolean {
	if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
	return /^onenav_[0-9-]+_[0-9.]+\.?db3$/.test(name) && /db3$/.test(name);
}

const BLOCKED_HOSTS = new Set([
	'localhost',
	'localhost.localdomain',
	'0.0.0.0',
	'metadata.google.internal',
	'metadata.google.internal.'
]);

export function isPrivateIp(address: string): boolean {
	const host = address.toLowerCase().replace(/^\[|\]$/g, '');
	if (host.startsWith('::ffff:')) return isPrivateIp(host.slice(7));
	const version = isIP(host);
	if (version === 4) {
		const parts = host.split('.').map((part) => Number(part));
		if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
		const [a, b] = parts;
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		if (a >= 224) return true;
		return false;
	}
	if (version === 6) {
		if (host === '::1' || host === '::') return true;
		if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
			return true;
		}
		return false;
	}
	return true;
}

/** 抓标题前拒绝内网、本机、云元数据地址。返回协议错误或内网错误。 */
export function publicHttpUrl(raw: string): { href: string } | { error: ApiResult } {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { error: err(-1010, '只支持识别http/https协议的链接!') };
	}
	if (url.username || url.password || url.protocol === 'file:') {
		return { error: err(-2000, '拒绝访问内网地址') };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { error: err(-1010, '只支持识别http/https协议的链接!') };
	}
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (
		BLOCKED_HOSTS.has(host) ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		/^\d+$/.test(host) ||
		/^0x[0-9a-f]+$/i.test(host)
	) {
		return { error: err(-2000, '拒绝访问内网地址') };
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		const parts = host.split('.');
		if (parts.some((part) => part.length > 1 && part.startsWith('0')) || parts.some((part) => Number(part) > 255)) {
			return { error: err(-2000, '拒绝访问内网地址') };
		}
	}
	if (isIP(host) && isPrivateIp(host)) return { error: err(-2000, '拒绝访问内网地址') };
	return { href: url.href };
}
