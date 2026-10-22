import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize, LOGIN_COOKIE_NAME } from '#lib/server/auth';
import { loadConfig } from '#lib/server/config';
import { getDb } from '#lib/server/db';
import { readSecretKey } from '#lib/server/options';
import type { ApiContext } from '#lib/server/api/context';
import { attachmentFrom } from '#lib/server/api/download';
import { dispatch } from '#lib/server/api/dispatch';

function stringifyParam(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return value.map((item) => stringifyParam(item) ?? '').join(',');
	return JSON.stringify(value);
}

function appendSearch(params: Record<string, string>, search: URLSearchParams) {
	const arrays = new Map<string, string[]>();
	for (const [raw, value] of search.entries()) {
		if (raw.endsWith('[]')) {
			const key = raw.slice(0, -2);
			const list = arrays.get(key) ?? [];
			list.push(value);
			arrays.set(key, list);
			continue;
		}
		params[raw] = value;
	}
	for (const [key, values] of arrays) {
		params[key] = values.join(',');
	}
}

async function mergeParams(request: Request, url: URL): Promise<Record<string, string>> {
	const params: Record<string, string> = {};
	appendSearch(params, url.searchParams);
	if (request.method === 'GET' || request.method === 'HEAD') return params;

	const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
	if (contentType.includes('multipart/form-data')) {
		try {
			const form = await request.clone().formData();
			for (const [key, value] of form.entries()) {
				if (typeof value === 'string') params[key] = value;
			}
		} catch {
			return params;
		}
		return params;
	}

	if (contentType.includes('application/json')) {
		const text = await request.clone().text();
		if (!text.trim()) return params;
		try {
			const body: unknown = JSON.parse(text);
			if (body && typeof body === 'object' && !Array.isArray(body)) {
				for (const [key, value] of Object.entries(body)) {
					const next = stringifyParam(value);
					if (next !== undefined) params[key] = next;
				}
			}
		} catch {
			return params;
		}
		return params;
	}

	if (contentType.includes('application/x-www-form-urlencoded')) {
		appendSearch(params, new URLSearchParams(await request.clone().text()));
	}
	return params;
}

function resolveAuthed(
	db: ApiContext['db'],
	request: Request,
	params: Record<string, string>,
	userAgent: string,
	cookie: string | undefined
): boolean {
	const config = loadConfig();
	return authorize({
		token: params.token,
		xToken: request.headers.get('x-token'),
		cookie,
		userAgent,
		user: config?.username ?? '',
		encryptedPassword: config?.encryptedPassword ?? '',
		secretKey: readSecretKey(db) ?? ''
	});
}

const handle: RequestHandler = async ({ request, url, cookies, params }) => {
	const merged = await mergeParams(request, url);
	const userAgent = request.headers.get('user-agent') ?? '';
	const db = getDb();
	const ctx: ApiContext = {
		db,
		request,
		url,
		userAgent,
		authed: resolveAuthed(db, request, merged, userAgent, cookies.get(LOGIN_COOKIE_NAME)),
		params: merged
	};
	const result = await dispatch(ctx, params.method ?? '');
	const attachment = attachmentFrom(result);
	if (attachment) return attachment;
	if ('download' in result) {
		const rest = { ...result };
		delete rest.download;
		return json(rest);
	}
	return json(result);
};

export const GET: RequestHandler = handle;
export const POST: RequestHandler = handle;
