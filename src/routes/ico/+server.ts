import type { RequestHandler } from './$types';
import { letterAvatarSvg, normalizeText, refererRejected } from './avatar';

/** 查询参数 text，输出 image/svg+xml。Referer 非空且不包含 Host 时拒绝，与 controller/ico.php 一致。 */
export const GET: RequestHandler = ({ url, request }) => {
	if (refererRejected(request.headers.get('referer') ?? '', request.headers.get('host') ?? '')) {
		return new Response('调用失败', {
			status: 200,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}
	const text = normalizeText(url.searchParams.get('text') ?? '');
	return new Response(letterAvatarSvg(text), {
		status: 200,
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': 'max-age=604800'
		}
	});
};
