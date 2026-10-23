import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { ApiResult, FileDownload } from '#lib/server/api/context';

function fileDownload(result: ApiResult): FileDownload | null {
	if (result.code !== 0) return null;
	const raw = result.download;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const { filename, contentType, body } = record;
	if (typeof filename !== 'string' || filename === '') return null;
	if (typeof contentType !== 'string' || contentType === '') return null;
	const hasBody = typeof body === 'string' || body instanceof Uint8Array;
	const filePath = typeof record.path === 'string' && record.path !== '' ? record.path : undefined;
	if (!hasBody && !filePath) return null;
	return {
		filename,
		contentType,
		body: hasBody ? body : undefined,
		path: filePath,
		ephemeral: record.ephemeral === true
	};
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
	if (file.path) {
		let size = 0;
		try {
			size = statSync(file.path).size;
		} catch {
			return null;
		}
		const node = createReadStream(file.path);
		if (file.ephemeral) {
			const temp = file.path;
			node.once('close', () => {
				try {
					unlinkSync(temp);
				} catch {
					// 临时备份已经不在。
				}
			});
		}
		return new Response(Readable.toWeb(node) as BodyInit, {
			status: 200,
			headers: {
				'content-type': file.contentType,
				'content-disposition': contentDisposition(file.filename),
				'content-length': String(size)
			}
		});
	}
	if (file.body == null) return null;
	return new Response(responseBody(file.body), {
		status: 200,
		headers: {
			'content-type': file.contentType,
			'content-disposition': contentDisposition(file.filename)
		}
	});
}
