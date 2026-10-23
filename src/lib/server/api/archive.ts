import { once } from 'node:events';
import {
	closeSync,
	constants,
	createWriteStream,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmdirSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeSync,
	type Stats
} from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createGunzip, createInflateRaw } from 'node:zlib';

export const ARCHIVE_LIMIT = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 256 * 1024 * 1024;
const NAME_LIMIT = 4096;
const CHUNK = 64 * 1024;

export type ArchiveResult = { ok: true } | { ok: false; entry: string };

export type ExtractOptions = { copyTo?: string };

type Staged = { stored: string; dest: string };

/** 压缩包条目里的 ..、绝对路径、空名都拒绝。 */
export function unsafeArchiveEntry(name: string): boolean {
	if (!name || name.includes('\0')) return true;
	const normalized = name.replaceAll('\\', '/');
	if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return true;
	if (segments(normalized).some((part) => part === '..')) return true;
	try {
		const decoded = decodeURIComponent(normalized);
		if (decoded !== normalized && segments(decoded).some((part) => part === '..')) return true;
	} catch {
		return true;
	}
	return false;
}

function segments(name: string): string[] {
	return name.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.');
}

function isInside(root: string, target: string): boolean {
	const base = path.resolve(root);
	const resolved = path.resolve(target);
	return resolved === base || resolved.startsWith(base + path.sep);
}

function yieldLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function asBuffer(chunk: Uint8Array): Buffer {
	return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function lstatOrNull(target: string): Stats | null {
	try {
		return lstatSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

/** 沿路径走时，指向目录外的符号链接直接拒绝。 */
function resolveSafe(root: string, name: string): string | null {
	if (unsafeArchiveEntry(name)) return null;
	const parts = segments(name);
	if (parts.length === 0) return null;
	let current = path.resolve(root);
	for (let index = 0; index < parts.length; index++) {
		const next = path.resolve(current, parts[index] ?? '');
		if (!isInside(root, next)) return null;
		const stat = lstatOrNull(next);
		if (stat?.isSymbolicLink()) {
			let real: string;
			try {
				real = realpathSync(next);
			} catch {
				return null;
			}
			if (!isInside(root, real)) return null;
			if (index < parts.length - 1 && !statSync(real).isDirectory()) return null;
			current = real;
			continue;
		}
		if (stat && index < parts.length - 1 && !stat.isDirectory()) return null;
		current = next;
	}
	return current;
}

function symlinkInside(root: string, linkPath: string, linkText: string): boolean {
	if (!linkText || linkText.includes('\0') || linkText.includes('\n') || linkText.includes('\r')) return false;
	return isInside(root, path.resolve(path.dirname(linkPath), linkText));
}

class Scratch {
	readonly root: string;
	output = 0;
	private createdFiles: string[] = [];
	private createdDirs: string[] = [];
	private swaps: Staged[] = [];

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	ensureDir(dir: string) {
		const abs = path.resolve(dir);
		if (abs !== this.root && !isInside(this.root, abs)) throw new Error('目录越界');
		const rel = path.relative(this.root, abs);
		if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('目录越界');
		let current = this.root;
		this.mkdirOne(current);
		if (rel === '') return;
		for (const part of rel.split(path.sep)) {
			if (!part || part === '.') continue;
			const next = path.join(current, part);
			const stat = lstatOrNull(next);
			if (stat?.isSymbolicLink()) {
				const real = realpathSync(next);
				if (!isInside(this.root, real) || !statSync(real).isDirectory()) throw new Error('符号链接越界');
				current = real;
				continue;
			}
			if (stat && !stat.isDirectory()) throw new Error('路径被文件占用');
			if (!stat) this.mkdirOne(next);
			current = next;
		}
	}

	beginFile(dest: string): { fd: number; staged: Staged; close: () => void } {
		this.ensureDir(path.dirname(dest));
		const existing = lstatOrNull(dest);
		if (existing?.isSymbolicLink()) {
			const real = realpathSync(dest);
			if (!isInside(this.root, real)) throw new Error('符号链接越界');
			unlinkSync(dest);
		}
		const created = !existing || existing.isSymbolicLink();
		const stored = created ? dest : `${dest}.onenav-partial`;
		if (created) this.createdFiles.push(dest);
		else this.swaps.push({ stored, dest });
		const fd = openSync(
			stored,
			constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
			0o644
		);
		return {
			fd,
			staged: { stored, dest },
			close: () => closeSync(fd)
		};
	}

	asSymlink(staged: Staged, linkText: string) {
		unlinkSync(staged.stored);
		symlinkSync(linkText, staged.stored);
	}

	commit() {
		for (const swap of this.swaps) renameSync(swap.stored, swap.dest);
		this.swaps = [];
		this.createdFiles = [];
		this.createdDirs = [];
	}

	rollback() {
		for (const swap of this.swaps) {
			try {
				unlinkSync(swap.stored);
			} catch {
				// 半成品可能已经不在。
			}
		}
		for (const file of [...this.createdFiles].reverse()) {
			try {
				const stat = lstatSync(file);
				if (stat.isFile() || stat.isSymbolicLink()) unlinkSync(file);
			} catch {
				// 半成品可能已经不在。
			}
		}
		for (const dir of [...this.createdDirs].reverse()) {
			try {
				rmdirSync(dir);
			} catch {
				// 目录非空就留着，避免删掉解压前就有的内容。
			}
		}
		this.swaps = [];
		this.createdFiles = [];
		this.createdDirs = [];
	}

	private mkdirOne(dir: string) {
		if (lstatOrNull(dir)) return;
		mkdirSync(dir);
		this.createdDirs.push(dir);
	}
}

class Reader {
	private chunks: Buffer[] = [];
	private head = 0;
	private size = 0;
	private ended = false;
	cancelled = false;
	tooBig = false;
	private waiters: Array<() => void> = [];
	private readonly hwm = 256 * 1024;
	private readonly abortResolve: () => void;
	readonly aborted: Promise<void>;

	constructor() {
		let resolveAbort: () => void = () => {};
		this.aborted = new Promise((resolve) => {
			resolveAbort = resolve;
		});
		this.abortResolve = resolveAbort;
	}

	private wake() {
		const pending = this.waiters;
		this.waiters = [];
		for (const fn of pending) fn();
	}

	private wait(): Promise<void> {
		return new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}

	cancel() {
		this.cancelled = true;
		this.ended = true;
		this.abortResolve();
		this.wake();
	}

	/** 流正常结束且缓冲区已空。半截数据不算结束。 */
	get idle(): boolean {
		return this.ended && this.size === 0;
	}

	finish() {
		this.ended = true;
		this.wake();
	}

	async offer(buf: Buffer): Promise<void> {
		if (this.cancelled || buf.length === 0) return;
		this.chunks.push(buf);
		this.size += buf.length;
		this.wake();
		while (this.size > this.hwm && !this.cancelled) await this.wait();
	}

	async peek(n: number): Promise<Buffer | null> {
		while (this.size < n) {
			if (this.ended || this.cancelled) return null;
			await this.wait();
		}
		return this.copy(n);
	}

	async read(n: number): Promise<Buffer | null> {
		if (n === 0) return Buffer.alloc(0);
		while (this.size < n) {
			if (this.ended || this.cancelled) return null;
			await this.wait();
		}
		return this.take(n);
	}

	async discard(n: number): Promise<boolean> {
		let left = n;
		while (left > 0) {
			const chunk = await this.read(Math.min(left, CHUNK));
			if (!chunk) return false;
			left -= chunk.length;
			if (left > 0) await yieldLoop();
		}
		return true;
	}

	private copy(n: number): Buffer {
		const out = Buffer.alloc(n);
		let written = 0;
		let index = 0;
		let offset = this.head;
		while (written < n) {
			const chunk = this.chunks[index];
			if (!chunk) break;
			const avail = chunk.length - offset;
			const take = Math.min(avail, n - written);
			chunk.copy(out, written, offset, offset + take);
			written += take;
			index += 1;
			offset = 0;
		}
		return out;
	}

	private take(n: number): Buffer {
		const out = Buffer.alloc(n);
		let written = 0;
		while (written < n) {
			const chunk = this.chunks[0];
			if (!chunk) break;
			const avail = chunk.length - this.head;
			const take = Math.min(avail, n - written);
			chunk.copy(out, written, this.head, this.head + take);
			written += take;
			this.head += take;
			this.size -= take;
			if (this.head >= chunk.length) {
				this.chunks.shift();
				this.head = 0;
			}
		}
		this.wake();
		return out;
	}
}

async function* bufferChunks(buf: Buffer): AsyncGenerator<Buffer> {
	for (let offset = 0; offset < buf.length; offset += CHUNK) {
		yield buf.subarray(offset, Math.min(offset + CHUNK, buf.length));
		await yieldLoop();
	}
}

function stopSource(source: AsyncIterable<Uint8Array>) {
	const maybe = source as { destroy?: () => void };
	if (typeof maybe.destroy === 'function') maybe.destroy();
}

async function pump(source: AsyncIterable<Uint8Array>, reader: Reader, copyTo?: string): Promise<void> {
	const iterator = source[Symbol.asyncIterator]();
	let pending = Buffer.alloc(0);
	while (pending.length < 2 && !reader.cancelled) {
		const next = await iterator.next();
		if (next.done) break;
		const buf = asBuffer(next.value);
		pending = Buffer.concat([pending, buf]);
	}
	if (pending.length < 2) {
		reader.finish();
		return;
	}
	const isGzip = pending[0] === 0x1f && pending[1] === 0x8b;
	const raw = new PassThrough({ highWaterMark: CHUNK });
	const decoded = isGzip ? raw.pipe(createGunzip()) : raw;
	const out = copyTo ? createWriteStream(copyTo) : null;
	let rawBytes = 0;
	let failed: Error | null = null;
	const note = (error: Error) => {
		failed ??= error;
		reader.cancel();
	};
	raw.on('error', note);
	decoded.on('error', note);
	out?.on('error', note);

	const feed = (async () => {
		try {
			for await (const chunk of decoded) {
				await reader.offer(asBuffer(chunk as Uint8Array));
			}
		} finally {
			reader.finish();
		}
	})();

	const writeRaw = async (buf: Buffer): Promise<boolean> => {
		if (reader.cancelled || reader.tooBig) return false;
		if (rawBytes + buf.length > ARCHIVE_LIMIT) {
			reader.tooBig = true;
			return false;
		}
		rawBytes += buf.length;
		const waitDrain = async (stream: NodeJS.EventEmitter) => {
			const drained = once(stream, 'drain').then(
				() => undefined,
				() => undefined
			);
			await Promise.race([drained, reader.aborted]);
		};
		if (out && !out.write(buf)) await waitDrain(out);
		if (reader.cancelled) return false;
		if (!raw.write(buf)) await waitDrain(raw);
		return !reader.cancelled;
	};

	try {
		let ok = await writeRaw(pending);
		while (ok && !reader.cancelled && !reader.tooBig) {
			const next = await iterator.next();
			if (next.done) break;
			ok = await writeRaw(asBuffer(next.value));
		}
	} catch (error) {
		note(error instanceof Error ? error : new Error('下载中断'));
	} finally {
		raw.end();
		if (out) {
			out.end();
			await finished(out).catch(() => undefined);
		}
		await feed.catch((error: unknown) => {
			if (reader.cancelled) return;
			note(error instanceof Error ? error : new Error('解压中断'));
		});
		if (reader.cancelled) stopSource(source);
	}
	if (failed && !reader.tooBig) throw failed;
}

async function writeStored(reader: Reader, size: number, fd: number, scratch: Scratch): Promise<boolean> {
	let left = size;
	while (left > 0) {
		const chunk = await reader.read(Math.min(left, CHUNK));
		if (!chunk) return false;
		writeSync(fd, chunk);
		scratch.output += chunk.length;
		if (scratch.output > OUTPUT_LIMIT) return false;
		left -= chunk.length;
		await yieldLoop();
	}
	return true;
}

async function writeInflated(reader: Reader, size: number, fd: number, scratch: Scratch): Promise<boolean> {
	let left = size;
	let failed = false;
	async function* chunks() {
		while (left > 0) {
			const chunk = await reader.read(Math.min(left, CHUNK));
			if (!chunk) throw new Error('压缩数据截断');
			left -= chunk.length;
			yield chunk;
		}
	}
	const output = new Writable({
		write(chunk, _encoding, callback) {
			try {
				const buf = asBuffer(chunk as Uint8Array);
				writeSync(fd, buf);
				scratch.output += buf.length;
				if (scratch.output > OUTPUT_LIMIT) {
					failed = true;
					callback(new Error('解压结果过大'));
					return;
				}
				setImmediate(callback);
			} catch (error) {
				callback(error instanceof Error ? error : new Error('写入失败'));
			}
		}
	});
	try {
		await pipeline(Readable.from(chunks()), createInflateRaw(), output);
	} catch {
		return false;
	}
	return !failed && left === 0;
}

type CentralEntry = { name: string; symlink: boolean };

async function readCentral(reader: Reader): Promise<CentralEntry[] | null> {
	const entries: CentralEntry[] = [];
	while (true) {
		const sig = await reader.peek(4);
		if (!sig) return null;
		const kind = sig.readUInt32LE(0);
		if (kind === 0x06054b50) {
			const eocd = await reader.read(22);
			if (!eocd) return null;
			const count = eocd.readUInt16LE(10);
			const comment = eocd.readUInt16LE(20);
			if (comment > 0 && !(await reader.discard(comment))) return null;
			if (count !== entries.length) return null;
			return entries;
		}
		if (kind !== 0x02014b50) return null;
		const header = await reader.read(46);
		if (!header) return null;
		const nameLength = header.readUInt16LE(28);
		const extraLength = header.readUInt16LE(30);
		const commentLength = header.readUInt16LE(32);
		const nameBuf = await reader.read(nameLength);
		if (!nameBuf || !(await reader.discard(extraLength + commentLength))) return null;
		const os = header[5] ?? 0;
		const external = header.readUInt32LE(38);
		const symlink = os === 3 && ((external >>> 16) & 0o170000) === 0o120000;
		entries.push({ name: nameBuf.toString('utf8'), symlink });
	}
}

async function readZip(reader: Reader, scratch: Scratch): Promise<ArchiveResult> {
	const staged: Array<{ name: string; staged: Staged; size: number }> = [];
	let current = '';
	try {
		scratch.ensureDir(scratch.root);
		while (true) {
			const sig = await reader.peek(4);
			if (!sig) return { ok: false, entry: current };
			const kind = sig.readUInt32LE(0);
			if (kind === 0x02014b50 || kind === 0x06054b50) break;
			if (kind !== 0x04034b50) return { ok: false, entry: current };
			const header = await reader.read(30);
			if (!header) return { ok: false, entry: current };
			const flags = header.readUInt16LE(6);
			const method = header.readUInt16LE(8);
			const compressedSize = header.readUInt32LE(18);
			const nameLength = header.readUInt16LE(26);
			const extraLength = header.readUInt16LE(28);
			if ((flags & 0x1) !== 0 || (flags & 0x8) !== 0 || compressedSize === 0xffffffff) {
				return { ok: false, entry: current };
			}
			const nameBuf = await reader.read(nameLength);
			if (!nameBuf || !(await reader.discard(extraLength))) return { ok: false, entry: current };
			const name = nameBuf.toString('utf8');
			current = name;
			if (unsafeArchiveEntry(name)) return { ok: false, entry: name };
			const dir = name.endsWith('/');
			const target = resolveSafe(scratch.root, name);
			if (!target) return { ok: false, entry: name };
			if (dir) {
				if (compressedSize > 0 && !(await reader.discard(compressedSize))) return { ok: false, entry: name };
				scratch.ensureDir(target);
				await yieldLoop();
				continue;
			}
			if (method !== 0 && method !== 8) return { ok: false, entry: name };
			const file = scratch.beginFile(target);
			let wrote = false;
			try {
				wrote =
					method === 0
						? await writeStored(reader, compressedSize, file.fd, scratch)
						: await writeInflated(reader, compressedSize, file.fd, scratch);
			} finally {
				file.close();
			}
			if (!wrote) return { ok: false, entry: name };
			staged.push({ name, staged: file.staged, size: statSync(file.staged.stored).size });
			await yieldLoop();
		}
		const central = await readCentral(reader);
		if (!central) return { ok: false, entry: current };
		for (const entry of central) {
			current = entry.name;
			if (unsafeArchiveEntry(entry.name)) return { ok: false, entry: entry.name };
			if (entry.symlink) {
				const found = staged.find((item) => item.name === entry.name);
				if (!found || found.size > NAME_LIMIT) return { ok: false, entry: entry.name };
				const linkText = readFileSync(found.staged.stored).toString('utf8');
				if (!symlinkInside(scratch.root, found.staged.dest, linkText)) return { ok: false, entry: entry.name };
				scratch.asSymlink(found.staged, linkText);
				continue;
			}
			if (entry.name.endsWith('/')) {
				const target = resolveSafe(scratch.root, entry.name);
				if (!target) return { ok: false, entry: entry.name };
				scratch.ensureDir(target);
			}
		}
		return { ok: true };
	} catch {
		return { ok: false, entry: current };
	}
}

function field(header: Buffer, start: number, length: number): string {
	const raw = header.subarray(start, start + length);
	const zero = raw.indexOf(0);
	return (zero === -1 ? raw : raw.subarray(0, zero)).toString('utf8').trim();
}

function paxPath(body: string): string {
	for (const line of body.split('\n')) {
		const match = line.match(/^\d+ path=(.*)$/);
		if (match?.[1]) return match[1];
	}
	return '';
}

async function readText(reader: Reader, size: number): Promise<string | null> {
	if (size > NAME_LIMIT) return null;
	const data = await reader.read(size);
	if (!data) return null;
	const pad = (512 - (size % 512)) % 512;
	if (pad > 0 && !(await reader.discard(pad))) return null;
	return data.toString('utf8');
}

async function readTar(reader: Reader, scratch: Scratch): Promise<ArchiveResult> {
	let pendingName = '';
	let pendingLink = '';
	let current = '';
	try {
		scratch.ensureDir(scratch.root);
		while (true) {
			const header = await reader.read(512);
			if (!header) return reader.idle ? { ok: true } : { ok: false, entry: current };
			if (header.every((byte) => byte === 0)) return { ok: true };
			const name = field(header, 0, 100);
			const prefix = field(header, 345, 155);
			const size = Number.parseInt(field(header, 124, 12) || '0', 8);
			const typeflag = String.fromCharCode(header[156] ?? 0);
			const link = field(header, 157, 100);
			if (!Number.isFinite(size) || size < 0) return { ok: false, entry: name };
			if (typeflag === 'L' || typeflag === 'K' || typeflag === 'x' || typeflag === 'g') {
				const text = await readText(reader, size);
				if (text == null) return { ok: false, entry: name };
				if (typeflag === 'K') pendingLink = text.replace(/\0+$/, '');
				else if (typeflag === 'L') pendingName = text.replace(/\0+$/, '');
				else {
					const pax = paxPath(text);
					if (pax) pendingName = pax;
				}
				continue;
			}
			const full = pendingName || (prefix ? `${prefix}/${name}` : name);
			const linkText = pendingLink || link;
			pendingName = '';
			pendingLink = '';
			current = full;
			if (!full) continue;
			if (typeflag === '1' || typeflag === '3' || typeflag === '4' || typeflag === '6') {
				return { ok: false, entry: full };
			}
			if (unsafeArchiveEntry(full)) return { ok: false, entry: full };
			const target = resolveSafe(scratch.root, full);
			if (!target) return { ok: false, entry: full };
			const dir = typeflag === '5' || full.endsWith('/');
			if (typeflag === '2') {
				if (!symlinkInside(scratch.root, target, linkText)) return { ok: false, entry: full };
				if (size > 0 && !(await reader.discard(size + ((512 - (size % 512)) % 512)))) {
					return { ok: false, entry: full };
				}
				const file = scratch.beginFile(target);
				file.close();
				scratch.asSymlink(file.staged, linkText);
				await yieldLoop();
				continue;
			}
			if (dir) {
				scratch.ensureDir(target);
				if (size > 0 && !(await reader.discard(size + ((512 - (size % 512)) % 512)))) {
					return { ok: false, entry: full };
				}
				await yieldLoop();
				continue;
			}
			const file = scratch.beginFile(target);
			let wrote = false;
			try {
				wrote = await writeStored(reader, size, file.fd, scratch);
			} finally {
				file.close();
			}
			const pad = (512 - (size % 512)) % 512;
			if (!wrote || (pad > 0 && !(await reader.discard(pad)))) return { ok: false, entry: full };
			await yieldLoop();
		}
	} catch {
		return { ok: false, entry: current };
	}
}

async function parseAll(reader: Reader, scratch: Scratch): Promise<ArchiveResult> {
	const magic = await reader.peek(2);
	if (!magic || magic.length < 2) return { ok: false, entry: '' };
	if (magic[0] === 0x50 && magic[1] === 0x4b) return readZip(reader, scratch);
	return readTar(reader, scratch);
}

/**
 * 边读边解 zip 或 tar.gz。条目之间会让出事件循环。
 * 越界路径、指向目录外的符号链接会失败，并删掉这次写出的半成品。
 */
export async function extractArchive(
	source: Buffer | Readable,
	destDir: string,
	options: ExtractOptions = {}
): Promise<ArchiveResult> {
	const rootStat = lstatOrNull(path.resolve(destDir));
	if (rootStat?.isSymbolicLink()) return { ok: false, entry: destDir };
	const reader = new Reader();
	const scratch = new Scratch(destDir);
	const iterable = Buffer.isBuffer(source) ? bufferChunks(source) : source;
	const pumped = pump(iterable, reader, options.copyTo).then(
		() => 'ok' as const,
		() => 'fail' as const
	);
	let result: ArchiveResult = { ok: false, entry: '' };
	try {
		result = await parseAll(reader, scratch);
	} catch {
		result = { ok: false, entry: '' };
	}
	reader.cancel();
	const pumpResult = await pumped;
	if (pumpResult === 'fail' || reader.tooBig) result = { ok: false, entry: result.ok ? '' : result.entry };
	if (result.ok) {
		try {
			scratch.commit();
			return { ok: true };
		} catch {
			result = { ok: false, entry: '' };
		}
	}
	scratch.rollback();
	if (options.copyTo) {
		try {
			unlinkSync(options.copyTo);
		} catch {
			// 压缩包半成品可能还没写出来。
		}
	}
	return result.ok ? { ok: false, entry: '' } : result;
}
