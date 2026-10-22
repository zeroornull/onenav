import { createHash } from 'node:crypto';
import { loadConfig, type AppConfig } from './config';

export const LOGIN_COOKIE = {
	name: 'key',
	maxAge: 30 * 24 * 60 * 60,
	path: '/' as const,
	httpOnly: true,
	secure: false,
	sameSite: 'lax' as const
};

export const LOGIN_COOKIE_NAME = LOGIN_COOKIE.name;

export function md5(value: string): string {
	return createHash('md5').update(value, 'utf8').digest('hex');
}

/** Cookie 值 = md5(USER + ENCRYPTED_PASSWORD + 'onenav' + User-Agent)。 */
export function loginCookieValue(user: string, encryptedPassword: string, userAgent: string): string {
	return md5(`${user}${encryptedPassword}onenav${userAgent}`);
}

/** 密码校验：md5(用户名 + 密码) 等于 ENCRYPTED_PASSWORD。 */
export function passwordMatches(username: string, password: string, encryptedPassword: string): boolean {
	return md5(`${username}${password}`) === encryptedPassword;
}

type ConfigLike = {
	username?: string;
	encryptedPassword?: string;
	USER?: string;
	ENCRYPTED_PASSWORD?: string;
};

/**
 * 两种调用都认：
 * - isLogin(cookie, userAgent)，配置从 data/config.php 或 config.json 读取
 * - isLogin(cookie, userAgent, config)
 * - isLogin(cookie, USER, ENCRYPTED_PASSWORD, userAgent)，给已经取出配置的调用方
 */
export function isLogin(
	cookie: string | null | undefined,
	userOrAgent: string,
	encryptedOrConfig?: string | ConfigLike | null,
	userAgent?: string
): boolean {
	if (arguments.length >= 4) {
		return cookieMatches(cookie, userOrAgent, String(encryptedOrConfig ?? ''), userAgent ?? '');
	}
	if (arguments.length === 3) {
		if (!encryptedOrConfig || typeof encryptedOrConfig !== 'object') return false;
		const user = encryptedOrConfig.username ?? encryptedOrConfig.USER ?? '';
		const encrypted = encryptedOrConfig.encryptedPassword ?? encryptedOrConfig.ENCRYPTED_PASSWORD ?? '';
		return cookieMatches(cookie, user, encrypted, userOrAgent);
	}
	const config = loadConfig();
	if (!config) return false;
	return cookieMatches(cookie, config.username, config.encryptedPassword, userOrAgent ?? '');
}

export function verifyPassword(
	username: string,
	password: string,
	config: AppConfig | null = loadConfig()
): boolean {
	if (!config) return false;
	const user = username.trim();
	const pass = password.trim();
	if (user !== config.username) return false;
	return passwordMatches(user, pass, config.encryptedPassword);
}

export function cookieHeader(userAgent: string, config: AppConfig | null = loadConfig()): string {
	if (!config) throw new Error('尚未安装');
	const value = loginCookieValue(config.username, config.encryptedPassword, userAgent ?? '');
	return `${LOGIN_COOKIE.name}=${value}; Max-Age=${LOGIN_COOKIE.maxAge}; Path=/; HttpOnly; SameSite=Lax`;
}

export function setLoginCookie(
	cookies: {
		set: (
			name: string,
			value: string,
			options: {
				path: '/';
				httpOnly: true;
				secure: false;
				maxAge: number;
				sameSite: 'lax';
			}
		) => void;
	},
	userAgent: string,
	config: AppConfig | null = loadConfig()
): void {
	if (!config) throw new Error('尚未安装');
	cookies.set(LOGIN_COOKIE.name, loginCookieValue(config.username, config.encryptedPassword, userAgent ?? ''), {
		path: LOGIN_COOKIE.path,
		httpOnly: true,
		secure: false,
		maxAge: LOGIN_COOKIE.maxAge,
		sameSite: LOGIN_COOKIE.sameSite
	});
}

function cookieMatches(
	cookie: string | null | undefined,
	user: string,
	encryptedPassword: string,
	userAgent: string
): boolean {
	if (!cookie) return false;
	return cookie === loginCookieValue(user, encryptedPassword, userAgent ?? '');
}

/** API token = md5(USER + on_options.SecretKey)。 */
export function apiToken(user: string, secretKey: string): string {
	return md5(`${user}${secretKey}`);
}

export type AuthInput = {
	token?: string | null;
	xToken?: string | null;
	cookie?: string | null;
	userAgent?: string | null;
	user: string;
	encryptedPassword: string;
	secretKey?: string | null;
};

/**
 * token 或请求头 X-Token 等于 md5(USER + SecretKey) 则通过。
 * 两者都没传时退回 cookie。传了但不匹配，或 SecretKey 为空，则失败。
 */
export function authorize(input: AuthInput): boolean {
	const token = blankToEmpty(input.token);
	const xToken = blankToEmpty(input.xToken);
	const secretKey = input.secretKey ?? '';
	if (token || xToken) {
		if (!secretKey) return false;
		const expected = apiToken(input.user, secretKey);
		return token === expected || xToken === expected;
	}
	return isLogin(input.cookie, input.user, input.encryptedPassword, input.userAgent ?? '');
}

export type LoginResult = { ok: true; cookie: string } | { ok: false; message: string };

export function attemptLogin(input: {
	user: string;
	password: string;
	config: { USER: string; ENCRYPTED_PASSWORD: string } | null;
	userAgent: string;
}): LoginResult {
	if (!input.config) {
		return { ok: false, message: '尚未安装，请先完成初始化' };
	}
	const user = input.user.trim();
	const password = input.password.trim();
	if (
		user !== input.config.USER ||
		!passwordMatches(user, password, input.config.ENCRYPTED_PASSWORD)
	) {
		return { ok: false, message: '用户名或密码错误！' };
	}
	return {
		ok: true,
		cookie: loginCookieValue(input.config.USER, input.config.ENCRYPTED_PASSWORD, input.userAgent)
	};
}

function blankToEmpty(value: string | null | undefined): string {
	if (value == null) return '';
	return value.trim();
}
