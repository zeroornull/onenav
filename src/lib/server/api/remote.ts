/** PHP Api 构造函数里的主备接口。探测推迟到真正发请求时，结果只留在进程内。 */
const PRIMARY = 'https://onenav.xiaoz.top';
const FALLBACK = 'https://onenav.rss.ink';
const DAY = 24 * 60 * 60 * 1000;

export const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36';

let cached: { url: string; at: number } | null = null;

export function clearApiCache(): void {
	cached = null;
}

/** 主站 HEAD 得到 301/302 或连不上时改用备用站。Node 会校验 TLS。 */
export async function apiBase(): Promise<string> {
	if (cached && Date.now() - cached.at < DAY) return cached.url;
	let url = PRIMARY;
	try {
		const response = await fetch(PRIMARY, {
			method: 'HEAD',
			redirect: 'manual',
			signal: AbortSignal.timeout(2000),
			headers: { 'user-agent': BROWSER_UA }
		});
		if (response.status === 0 || response.status === 301 || response.status === 302) url = FALLBACK;
	} catch {
		url = FALLBACK;
	}
	cached = { url, at: Date.now() };
	return url;
}

export async function fetchText(url: string, timeoutMs: number, userAgent = BROWSER_UA): Promise<string> {
	const response = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(timeoutMs),
		headers: { 'user-agent': userAgent }
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.text();
}
