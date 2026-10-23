import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { ARCHIVE_LIMIT, extractArchive } from '#lib/server/api/archive';
import { BUSY_MSG, claimExclusive } from '#lib/server/api/exclusive';
import { apiBase, BROWSER_UA, fetchText } from '#lib/server/api/remote';
import { deny, ret, text } from '#lib/server/api/util';

export const methods = ['up_updater', 'down_updater', 'check_version', 'getNextVersion', 'get_latest_version'];

const LATEST_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36 Edg/100.0.1185.50';

function currentVersion(): string {
	const raw = readFileSync(path.join(process.cwd(), 'version.txt'), 'utf8');
	const head = raw.split('-')[0] ?? '';
	return head.replaceAll('v', '');
}

function checkVersion(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	try {
		if (text(ctx.params.version) === currentVersion()) return ret(200, '', 'success');
	} catch {
		// version.txt 读不到时走下面的失败文案。
	}
	return ret(-2000, '', '更新失败，版本校验不匹配，请检查目录权限！');
}

async function latestVersion(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	try {
		const body = await fetchText(
			'https://git.xiaoz.org/xiaoz/onenav/raw/branch/main/version.txt',
			5_000,
			LATEST_UA
		);
		return ret(200, body, '');
	} catch {
		return ret(200, '', '');
	}
}

async function nextVersion(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const version = text(ctx.params.version).trim();
	if (!/^[0-9.]+$/.test(version)) return ret(200, '0.0.0', '');
	try {
		const base = await apiBase();
		const body = await fetchText(`${base}/v1/get_version.php?version=${encodeURIComponent(version)}`, 10_000);
		return ret(200, body, '');
	} catch {
		return ret(200, '', '');
	}
}

async function moveArchive(partial: string, archive: string) {
	try {
		renameSync(partial, archive);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
		await pipeline(createReadStream(partial), createWriteStream(archive));
		unlinkSync(partial);
	}
}

/** PHP finally：update.php 存在且不小于 100 字节才算更新程序就绪。 */
async function downloadUpdater(): Promise<true | ApiResult> {
	const release = claimExclusive();
	if (!release) return ret(-2000, '', BUSY_MSG);
	const root = process.cwd();
	const archive = path.join(root, 'update.tar.gz');
	const partial = path.join(tmpdir(), `onenav-update-${randomBytes(8).toString('hex')}.tar.gz`);
	const updatePhp = path.join(root, 'update.php');
	try {
		const base = await apiBase();
		const response = await fetch(`${base}/update.tar.gz`, {
			redirect: 'follow',
			signal: AbortSignal.timeout(60_000),
			headers: { 'user-agent': BROWSER_UA }
		});
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		const length = Number(response.headers.get('content-length') ?? '');
		if (Number.isFinite(length) && length > ARCHIVE_LIMIT) throw new Error('too big');
		const placed = await extractArchive(
			Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
			root,
			{ copyTo: partial }
		);
		if (!placed.ok) throw new Error('illegal archive');
		await moveArchive(partial, archive);
	} catch {
		try {
			unlinkSync(partial);
		} catch {
			// 下载失败时清掉半截压缩包。
		}
		try {
			unlinkSync(archive);
		} catch {
			// 旧压缩包可能本来就不存在。
		}
	} finally {
		release();
	}
	if (existsSync(updatePhp)) {
		if (statSync(updatePhp).size < 100) return ret(-2000, '', '更新程序异常，请检查目录权限！');
		return true;
	}
	return ret(-2000, '', '更新程序下载失败，请检查目录权限！');
}

async function downUpdater(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const downloaded = await downloadUpdater();
	if (downloaded === true) return ret(200, '', '更新程序准备就绪！');
	return downloaded;
}

async function remoteLength(url: string): Promise<number> {
	const response = await fetch(url, {
		method: 'HEAD',
		redirect: 'manual',
		signal: AbortSignal.timeout(10_000),
		headers: { 'user-agent': BROWSER_UA }
	});
	const length = Number(response.headers.get('content-length') ?? '');
	if (!Number.isFinite(length)) throw new Error('missing length');
	return length;
}

async function upUpdater(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const root = process.cwd();
	const updatePhp = path.join(root, 'update.php');
	const archive = path.join(root, 'update.tar.gz');
	if (!existsSync(updatePhp)) {
		const downloaded = await downloadUpdater();
		if (downloaded === true) return ret(200, '', '更新程序准备就绪！');
		return downloaded;
	}
	if (existsSync(archive)) {
		try {
			const base = await apiBase();
			const length = await remoteLength(`${base}/update.tar.gz`);
			if (statSync(archive).size !== length) {
				const downloaded = await downloadUpdater();
				if (downloaded === true) return ret(200, '', '更新程序更新完毕！');
				return ret(-2000, '', '更新程序下载失败，请检查目录权限！');
			}
			return ret(200, '', '更新程序（压缩包）准备就绪！');
		} catch {
			return ret(-2000, '', '更新程序下载失败，请检查目录权限！');
		}
	}
	if (existsSync(updatePhp)) return ret(200, '', '更新程序（PHP）准备就绪！');
	return ret(200, '', '更新程序（其它）准备就绪！');
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'up_updater':
			return upUpdater(ctx);
		case 'down_updater':
			return downUpdater(ctx);
		case 'check_version':
			return checkVersion(ctx);
		case 'getNextVersion':
			return nextVersion(ctx);
		case 'get_latest_version':
			return latestVersion(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
