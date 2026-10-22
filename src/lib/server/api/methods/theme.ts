import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { extractArchive } from '#lib/server/api/archive';
import { apiBase, BROWSER_UA } from '#lib/server/api/remote';
import { getOption, setOption } from '#lib/server/options';
import { dataRoot, deny, ret, text } from '#lib/server/api/util';

export const methods = ['down_theme', 'get_themes', 'set_theme'];

const THEME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-_]+[a-zA-Z0-9]$/;
const DEFAULT_THEMES = { pc_theme: 'default2', mobile_theme: 'default2' };

function themeNameOk(name: string): boolean {
	return THEME_NAME.test(name);
}

function alpineHost(): boolean {
	try {
		return /alpine/i.test(readFileSync('/etc/os-release', 'utf8'));
	} catch {
		return false;
	}
}

/** 容器里除 default2 外放到 data/templates，其余情况放到 templates。 */
function themeDirFor(name: string): string {
	if (alpineHost() && name !== 'default2') return path.join(dataRoot(), 'templates');
	return path.join(process.cwd(), 'templates');
}

function storedThemes(raw: string | null): unknown {
	if (raw == null || raw === '' || raw === '0') return DEFAULT_THEMES;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed == null || parsed === '' || parsed === 0 || parsed === false) return DEFAULT_THEMES;
		if (Array.isArray(parsed)) return parsed.length === 0 ? DEFAULT_THEMES : parsed;
		if (typeof parsed === 'object' && Object.keys(parsed).length === 0) return DEFAULT_THEMES;
		return parsed;
	} catch {
		return DEFAULT_THEMES;
	}
}

function getThemes(ctx: ApiContext): ApiResult {
	return ret(200, storedThemes(getOption(ctx.db, 's_themes')), '');
}

function setTheme(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const existed = getOption(ctx.db, 's_themes') != null;
	setOption(ctx.db, 's_themes', text(ctx.params.value));
	return { code: 0, data: existed ? '设置已更新！' : '设置成功！' };
}

async function downTheme(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const name = text(ctx.params.name).trim();
	if (!themeNameOk(name)) return ret(-2000, '', '主题名称不合法！');
	const key = text(ctx.params.key).trim();
	const value = text(ctx.params.value).trim();
	const type = text(ctx.params.type).trim();
	const builtin = path.join(process.cwd(), 'templates', name);
	const custom = path.join(dataRoot(), 'templates', name);
	if (type === 'download' && (existsSync(builtin) || existsSync(custom))) {
		return ret(-2000, '', '主题已存在，无需重复下载！');
	}
	const dir = themeDirFor(name);
	const dest = path.join(dir, name);
	try {
		const base = await apiBase();
		const url =
			`${base}/v1/down_theme.php?name=${encodeURIComponent(name)}` +
			`&key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`;
		const response = await fetch(url, {
			redirect: 'follow',
			signal: AbortSignal.timeout(120_000),
			headers: { 'user-agent': BROWSER_UA }
		});
		if (response.status === 404) return ret(-2000, '', '远程服务器上不存在此主题！');
		if (!response.ok) return ret(-2000, '', '主题下载失败，请检查目录权限！');
		const buf = Buffer.from(await response.arrayBuffer());
		mkdirSync(dir, { recursive: true });
		const placed = extractArchive(buf, dest);
		if (!placed.ok) {
			return ret(-2000, '', placed.entry ? '主题压缩包包含非法路径！' : '主题下载失败，请检查目录权限！');
		}
		return ret(200, '', '主题下载成功！');
	} catch {
		return ret(-2000, '', '主题下载失败，请检查目录权限！');
	}
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'down_theme':
			return downTheme(ctx);
		case 'get_themes':
			return getThemes(ctx);
		case 'set_theme':
			return setTheme(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
