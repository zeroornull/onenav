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

function sameAccount(left: SiteConfig, right: SiteConfig): boolean {
	return (
		left.USER === right.USER &&
		left.ENCRYPTED_PASSWORD === right.ENCRYPTED_PASSWORD &&
		left.EMAIL === right.EMAIL
	);
}

/**
 * 没有 config.json、且有 config.php 时，用正则取出三个 define 写成 JSON。
 * 读回后三个字段一致才删除 php。核对失败不删 php，并撤掉刚写出的 json。
 * json 已经存在时不再把 php 当账号；只有两边三个字段一致才删掉残留的 php。
 */
export function migratePhpConfig(paths: DataPaths = dataPaths()): void {
	if (!existsSync(paths.configPhp)) return;
	if (existsSync(paths.configJson)) {
		try {
			const fromPhp = parseConfigPhp(readFileSync(paths.configPhp, 'utf8'));
			const fromJson = parseConfigJson(readFileSync(paths.configJson, 'utf8'));
			if (sameAccount(fromPhp, fromJson)) unlinkSync(paths.configPhp);
		} catch {
			// 对不上或读失败时保留 php，也不改 json。
		}
		return;
	}

	const parsed = parseConfigPhp(readFileSync(paths.configPhp, 'utf8'));
	const body = {
		username: parsed.USER,
		encrypted_password: parsed.ENCRYPTED_PASSWORD,
		email: parsed.EMAIL
	};
	mkdirSync(paths.dataDir, { recursive: true });
	const tmp = path.join(paths.dataDir, `.config.json.${process.pid}.tmp`);
	let created = false;
	try {
		writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
		try {
			linkSync(tmp, paths.configJson);
			created = true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST') throw error;
		}
		let written: SiteConfig;
		try {
			written = parseConfigJson(readFileSync(paths.configJson, 'utf8'));
		} catch (error) {
			if (created) {
				try {
					unlinkSync(paths.configJson);
				} catch {
					// 撤掉失败时把原始错误抛回去
				}
			}
			throw error;
		}
		if (!sameAccount(parsed, written)) {
			if (created) {
				try {
					unlinkSync(paths.configJson);
				} catch {
					// 撤掉失败时把核对错误抛回去
				}
				throw new Error('配置迁移核对失败，已保留 data/config.php');
			}
			return;
		}
		unlinkSync(paths.configPhp);
	} finally {
		try {
			unlinkSync(tmp);
		} catch {
			// 临时文件可能还没写出来
		}
	}
}

export function configSource(paths: DataPaths = dataPaths()): 'json' | null {
	migratePhpConfig(paths);
	if (existsSync(paths.configJson)) return 'json';
	return null;
}

export function isInstalled(paths: DataPaths = dataPaths()): boolean {
	return configSource(paths) !== null;
}

/** 运行时只读 data/config.json。config.php 只在迁移里读，核对通过后删除。 */
export function loadSiteConfig(paths: DataPaths = dataPaths()): SiteConfig | null {
	if (configSource(paths) !== 'json') return null;
	return parseConfigJson(readFileSync(paths.configJson, 'utf8'));
}

export type AppConfig = SiteConfig & {
	username: string;
	encryptedPassword: string;
	email: string;
	source: 'json';
};

/** 给路由用的配置。JSON 字段名映射到同一组值。 */
export function loadConfig(paths: DataPaths = dataPaths()): AppConfig | null {
	const site = loadSiteConfig(paths);
	if (!site) return null;
	return {
		...site,
		username: site.USER,
		encryptedPassword: site.ENCRYPTED_PASSWORD,
		email: site.EMAIL,
		source: 'json'
	};
}

/** 迁移时用的正则。只取出三个 define，不执行 PHP。 */
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
	try {
		migratePhpConfig(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : '配置迁移失败';
		return { ok: false, error: message };
	}
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
