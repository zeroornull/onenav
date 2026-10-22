export type ApiBody = Record<string, unknown>;
export type Row = Record<string, unknown>;

export function isOk(code: unknown): boolean {
	return code === 0 || code === 200;
}

export function errorText(body: ApiBody, fallback = '操作失败'): string {
	if (typeof body.err_msg === 'string' && body.err_msg) return body.err_msg;
	if (typeof body.msg === 'string' && body.msg) return body.msg;
	return fallback;
}

export function listData(body: ApiBody): Row[] {
	const data = body.data;
	if (Array.isArray(data)) return data.filter(isRow);
	if (isRow(data)) return Object.values(data).filter(isRow);
	return [];
}

export function objectData(body: ApiBody): Row | null {
	return isRow(body.data) ? body.data : null;
}

export function countOf(body: ApiBody, fallback: number): number {
	const value = Number(body.count);
	return Number.isFinite(value) ? value : fallback;
}

export function str(row: Row | null | undefined, key: string): string {
	if (!row) return '';
	const value = row[key];
	if (value == null) return '';
	return String(value);
}

export function num(row: Row | null | undefined, key: string): number {
	if (!row) return 0;
	const value = Number(row[key]);
	return Number.isFinite(value) ? value : 0;
}

export function showTime(value: unknown): string {
	if (value == null || value === '') return '';
	const text = String(value);
	if (text.includes('-') || text.includes(':')) return text;
	const stamp = Number(text);
	if (!Number.isFinite(stamp) || stamp <= 0) return text;
	const date = new Date(stamp < 1e12 ? stamp * 1000 : stamp);
	if (Number.isNaN(date.getTime())) return text;
	const pad = (part: number) => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fileNameOf(body: ApiBody): string {
	if (typeof body.file_name === 'string') return body.file_name;
	const data = objectData(body);
	return str(data, 'file_name');
}

export async function api(path: string, init?: RequestInit): Promise<ApiBody> {
	const response = await fetch(`/api/${path}`, { credentials: 'include', ...init });
	const text = await response.text();
	if (!text.trim()) throw new Error('接口没有返回内容');
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('接口返回的不是 JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('code' in parsed)) {
		throw new Error('接口响应缺少 code');
	}
	return parsed as ApiBody;
}

export function apiGet(method: string, query?: Record<string, string | number | undefined>): Promise<ApiBody> {
	const params = new URLSearchParams();
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) params.set(key, String(value));
		}
	}
	const qs = params.toString();
	return api(qs ? `${method}?${qs}` : method, { method: 'GET' });
}

export function apiPost(method: string, fields: Record<string, unknown>): Promise<ApiBody> {
	return api(method, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(fields)
	});
}

export async function apiUpload(
	method: string,
	file: File,
	extra?: Record<string, string>
): Promise<ApiBody> {
	const data = new FormData();
	data.set('file', file);
	if (extra) {
		for (const [key, value] of Object.entries(extra)) data.set(key, value);
	}
	return api(method, { method: 'POST', body: data });
}

function isAttachment(disposition: string): boolean {
	return /attachment/i.test(disposition);
}

async function saveBlob(response: Response, filename: string): Promise<void> {
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export async function downloadApi(path: string, filename: string): Promise<void> {
	const response = await fetch(`/api/${path}`, { credentials: 'include' });
	const disposition = response.headers.get('content-disposition') ?? '';
	if (isAttachment(disposition)) {
		if (!response.ok) throw new Error('下载失败');
		await saveBlob(response, filename);
		return;
	}
	const type = response.headers.get('content-type') ?? '';
	if (type.includes('json')) {
		const body = (await response.json()) as ApiBody;
		if (!isOk(body.code)) throw new Error(errorText(body, '下载失败'));
		throw new Error('接口没有返回文件');
	}
	if (!response.ok) throw new Error('下载失败');
	await saveBlob(response, filename);
}

function isRow(value: unknown): value is Row {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
