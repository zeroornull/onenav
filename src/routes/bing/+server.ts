import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from '@sveltejs/kit';

const BING_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8';
const TIMEOUT_MS = 8000;
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36';
const CACHE_FILE = join(tmpdir(), 'onenav-bing-hpimage.json');

function jsonResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
}

function errorResponse(message: string, status: number): Response {
	return jsonResponse(JSON.stringify({ error: message }), status);
}

function failureMessage(err: unknown): string {
	if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
		return '必应壁纸获取超时';
	}
	if (err instanceof Error && err.message) return `必应壁纸获取失败: ${err.message}`;
	return '必应壁纸获取失败';
}

/** Referer 非空且不包含 Host 时拒绝，与 controller/bing.php 一致。 */
function refererRejected(request: Request): boolean {
	const referer = request.headers.get('referer') ?? '';
	if (referer === '') return false;
	const host = request.headers.get('host') ?? '';
	return host === '' || !referer.includes(host);
}

async function readCache(): Promise<string | undefined> {
	try {
		const cached = await readFile(CACHE_FILE, 'utf8');
		if (cached.trim() !== '') return cached;
	} catch {
		// 没有缓存文件时继续向上游拉取
	}
	return undefined;
}

export const GET: RequestHandler = async ({ request }) => {
	try {
		if (refererRejected(request)) {
			return errorResponse('调用失败', 403);
		}

		const cached = await readCache();
		if (cached !== undefined) return jsonResponse(cached);

		const upstream = await fetch(BING_URL, {
			headers: { 'user-agent': USER_AGENT },
			redirect: 'follow',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!upstream.ok) {
			return errorResponse(`必应壁纸获取失败: HTTP ${upstream.status}`, 502);
		}

		const body = await upstream.text();
		if (body.trim() === '') return errorResponse('必应壁纸获取失败: 空响应', 502);

		try {
			await writeFile(CACHE_FILE, body, 'utf8');
		} catch (err) {
			const detail = err instanceof Error ? err.message : '未知错误';
			return errorResponse(`必应壁纸缓存写入失败: ${detail}`, 500);
		}

		return jsonResponse(body);
	} catch (err) {
		return errorResponse(failureMessage(err), 502);
	}
};
