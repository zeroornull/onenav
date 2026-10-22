import type { ApiResult, FileDownload } from '#lib/server/api/context';

function fileDownload(result: ApiResult): FileDownload | null {
	if (result.code !== 0) return null;
	const raw = result.download;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const { filename, contentType, body } = record;
	if (typeof filename !== 'string' || filename === '') return null;
	if (typeof contentType !== 'string' || contentType === '') return null;
	if (typeof body !== 'string' && !(body instanceof Uint8Array)) return null;
	return { filename, contentType, body };
}

function contentDisposition(filename: string): string {
	const base = filename.split(/[/\\]/).pop() || 'download';
	const safe = base.replace(/["\r\n]/g, '_');
	return `attachment; filename="${safe}"`;
}

function responseBody(body: string | Uint8Array): BodyInit {
	if (typeof body === 'string') return body;
	const copy = new ArrayBuffer(body.byteLength);
	new Uint8Array(copy).set(body);
	return copy;
}

/** code 为 0 且带 download 时返回附件，否则交给调用方继续输出 JSON。 */
export function attachmentFrom(result: ApiResult): Response | null {
	const file = fileDownload(result);
	if (!file) return null;
	return new Response(responseBody(file.body), {
		status: 200,
		headers: {
			'content-type': file.contentType,
			'content-disposition': contentDisposition(file.filename)
		}
	});
}
