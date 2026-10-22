import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDatabaseFile, openDatabase } from './db';
import { dataPaths, type DataPaths } from './paths';

export function md5(value: string): string {
	return createHash('md5').update(value, 'utf8').digest('hex');
}

export type SiteConfig = {
	USER: string;
	ENCRYPTED_PASSWORD: string;
	EMAIL: string;
};

const DEFINE_KEYS = ['USER', 'ENCRYPTED_PASSWORD', 'EMAIL'] as const;
const USER_PATTERN = /^[0-9a-z]{3,32}$/;
const PASSWORD_PATTERN = /^[0-9a-zA-Z!@#%^*.()]{6,16}$/;

export function configSource(paths: DataPaths = dataPaths()): 'php' | 'json' | null {
	if (existsSync(paths.configPhp)) return 'php';
	if (existsSync(paths.configJson)) return 'json';
	return null;
}

export function isInstalled(paths: DataPaths = dataPaths()): boolean {
	return configSource(paths) !== null;
}

/** 只解析 define 的三个常量，不执行 PHP。已有 config.php 时忽略 config.json。 */
export function loadSiteConfig(paths: DataPaths = dataPaths()): SiteConfig | null {
	const source = configSource(paths);
	if (source === 'php') return parseConfigPhp(readFileSync(paths.configPhp, 'utf8'));
	if (source === 'json') return parseConfigJson(readFileSync(paths.configJson, 'utf8'));
	return null;
}

export type AppConfig = SiteConfig & {
	username: string;
	encryptedPassword: string;
	email: string;
	source: 'php' | 'json';
};

/** 给路由用的配置。PHP 常量名和 JSON 字段名都映射到同一组值。 */
export function loadConfig(paths: DataPaths = dataPaths()): AppConfig | null {
	const site = loadSiteConfig(paths);
	const source = configSource(paths);
	if (!site || !source) return null;
	return {
		...site,
		username: site.USER,
		encryptedPassword: site.ENCRYPTED_PASSWORD,
		email: site.EMAIL,
		source
	};
}

export function parseConfigPhp(source: string): SiteConfig {
	const found: Partial<SiteConfig> = {};
	const pattern =
		/define\s*\(\s*(['"])(USER|ENCRYPTED_PASSWORD|EMAIL)\1\s*,\s*(['"])([\s\S]*?)\3\s*\)/g;
	for (const match of source.matchAll(pattern)) {
		const key = match[2] as (typeof DEFINE_KEYS)[number];
		found[key] = match[4];
	}
	return requireConfigFields(found);
}

export function parseConfigJson(source: string): SiteConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error('data/config.json 不是合法 JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('data/config.json 格式不正确');
	}
	const record = parsed as Record<string, unknown>;
	return requireConfigFields({
		USER: stringField(record.USER) ?? stringField(record.username),
		ENCRYPTED_PASSWORD:
			stringField(record.ENCRYPTED_PASSWORD) ?? stringField(record.encrypted_password),
		EMAIL: stringField(record.EMAIL) ?? stringField(record.email)
	});
}

export type EnvCheck = { ok: boolean; errors: string[] };

export function checkInstallEnvironment(
	paths: DataPaths = dataPaths(),
	basePath = ''
): EnvCheck {
	const errors: string[] = [];
	if (!process.versions.node) errors.push('Node 不可用');
	if (basePath !== '') errors.push('暂不支持二级目录安装');
	try {
		accessSync(paths.dataDir, constants.W_OK);
	} catch {
		errors.push('data/ 目录不可写');
	}
	try {
		const db = openDatabase(paths.seedDatabase, { readonly: true, fileMustExist: true });
		try {
			db.prepare('SELECT 1 AS ok').get();
		} finally {
			db.close();
		}
	} catch {
		errors.push('数据库无法打开');
	}
	return { ok: errors.length === 0, errors };
}

export type InstallInput = {
	username: string;
	password: string;
	password2: string;
	email: string;
};

export type InstallResult = { ok: true } | { ok: false; error: string };

export function installSite(
	input: InstallInput,
	options?: { paths?: DataPaths; basePath?: string }
): InstallResult {
	const paths = options?.paths ?? dataPaths();
	const username = input.username.trim();
	const password = input.password.trim();
	const password2 = input.password2.trim();
	const email = input.email.trim();

	if (!username || !password) return { ok: false, error: '用户名或密码不能为空！' };
	if (!USER_PATTERN.test(username)) return { ok: false, error: '用户名格式不正确！' };
	if (!PASSWORD_PATTERN.test(password)) return { ok: false, error: '密码格式不正确！' };
	if (password !== password2) return { ok: false, error: '两次密码不一致！' };
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '邮箱格式不正确！' };

	const env = checkInstallEnvironment(paths, options?.basePath ?? '');
	if (!env.ok) return { ok: false, error: env.errors[0] ?? '环境检查未通过' };
	if (existsSync(paths.configPhp) || existsSync(paths.configJson)) {
		return { ok: false, error: '配置文件已存在，无需再次初始化！' };
	}

	const config = {
		username,
		encrypted_password: md5(`${username}${password}`),
		email
	};
	mkdirSync(paths.dataDir, { recursive: true });
	const tmp = path.join(paths.dataDir, `.config.json.${process.pid}.tmp`);
	let created = false;
	try {
		writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
		linkSync(tmp, paths.configJson);
		created = true;
		ensureDatabaseFile(paths);
		return { ok: true };
	} catch (error) {
		if (created) {
			try {
				unlinkSync(paths.configJson);
			} catch {
				// 回滚失败时把原始错误抛回去
			}
		}
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'EEXIST') return { ok: false, error: '配置文件已存在，无需再次初始化！' };
		const message = error instanceof Error ? error.message : '写入配置文件失败，请检查目录权限！';
		if (message.includes('数据库') || message.includes('种子库')) {
			return { ok: false, error: message };
		}
		return { ok: false, error: '写入配置文件失败，请检查目录权限！' };
	} finally {
		try {
			unlinkSync(tmp);
		} catch {
			// 临时文件可能还没写出来
		}
	}
}

function stringField(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function requireConfigFields(found: Partial<SiteConfig>): SiteConfig {
	if (!found.USER || !found.ENCRYPTED_PASSWORD || found.EMAIL == null || found.EMAIL === '') {
		throw new Error('配置文件缺少 USER、ENCRYPTED_PASSWORD 或 EMAIL');
	}
	return {
		USER: found.USER,
		ENCRYPTED_PASSWORD: found.ENCRYPTED_PASSWORD,
		EMAIL: found.EMAIL
	};
}
