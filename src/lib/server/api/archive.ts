import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { resolveInside } from '#lib/server/api/util';

const ARCHIVE_LIMIT = 64 * 1024 * 1024;

export type ArchiveResult = { ok: true } | { ok: false; entry: string };

type ArchiveEntry = { name: string; data: Buffer; dir: boolean };

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

function inside(destDir: string, name: string): string | null {
	if (unsafeArchiveEntry(name)) return null;
	return resolveInside(destDir, path.resolve(destDir, name));
}

/**
 * 把 zip 或 tar.gz 解进 destDir。
 * 任一条目越界则整个压缩包不落盘。
 */
export function extractArchive(buf: Buffer, destDir: string): ArchiveResult {
	if (buf.length === 0 || buf.length > ARCHIVE_LIMIT) return { ok: false, entry: '' };
	const entries = readEntries(buf);
	if (!entries) return { ok: false, entry: '' };
	const root = path.resolve(destDir);
	for (const entry of entries) {
		if (!inside(root, entry.name)) return { ok: false, entry: entry.name };
	}
	mkdirSync(root, { recursive: true });
	for (const entry of entries) {
		const target = inside(root, entry.name);
		if (!target) return { ok: false, entry: entry.name };
		if (entry.dir) {
			mkdirSync(target, { recursive: true });
			continue;
		}
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, entry.data);
	}
	return { ok: true };
}

function readEntries(buf: Buffer): ArchiveEntry[] | null {
	try {
		if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return readZip(buf);
		if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return readTar(gunzipSync(buf));
		return readTar(buf);
	} catch {
		return null;
	}
}

function readZip(buf: Buffer): ArchiveEntry[] | null {
	const entries: ArchiveEntry[] = [];
	const names = new Set<string>();
	let offset = 0;
	while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
		const flags = buf.readUInt16LE(offset + 6);
		const method = buf.readUInt16LE(offset + 8);
		const compressedSize = buf.readUInt32LE(offset + 18);
		const nameLength = buf.readUInt16LE(offset + 26);
		const extraLength = buf.readUInt16LE(offset + 28);
		const nameStart = offset + 30;
		const dataStart = nameStart + nameLength + extraLength;
		if (dataStart > buf.length || (flags & 0x8) !== 0) return null;
		if (dataStart + compressedSize > buf.length) return null;
		const name = buf.subarray(nameStart, nameStart + nameLength).toString('utf8');
		names.add(name);
		const compressed = buf.subarray(dataStart, dataStart + compressedSize);
		let data: Buffer;
		if (method === 0) data = Buffer.from(compressed);
		else if (method === 8) data = inflateRawSync(compressed);
		else return null;
		entries.push({ name, data, dir: name.endsWith('/') });
		offset = dataStart + compressedSize;
	}
	const central = centralNames(buf);
	if (!central) return null;
	for (const name of central) {
		if (!names.has(name)) entries.push({ name, data: Buffer.alloc(0), dir: name.endsWith('/') });
	}
	return entries;
}

function centralNames(buf: Buffer): string[] | null {
	let eocd = -1;
	const min = Math.max(0, buf.length - 22 - 65535);
	for (let i = buf.length - 22; i >= min; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return null;
	const count = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);
	const names: string[] = [];
	for (let index = 0; index < count; index++) {
		if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) return null;
		const nameLength = buf.readUInt16LE(offset + 28);
		const extraLength = buf.readUInt16LE(offset + 30);
		const commentLength = buf.readUInt16LE(offset + 32);
		const nameStart = offset + 46;
		if (nameStart + nameLength > buf.length) return null;
		names.push(buf.subarray(nameStart, nameStart + nameLength).toString('utf8'));
		offset = nameStart + nameLength + extraLength + commentLength;
	}
	return names;
}

function readTar(tar: Buffer): ArchiveEntry[] | null {
	const entries: ArchiveEntry[] = [];
	let offset = 0;
	let pendingName = '';
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = field(header, 0, 100);
		const prefix = field(header, 345, 155);
		const size = Number.parseInt(field(header, 124, 12) || '0', 8);
		if (!Number.isFinite(size) || size < 0) return null;
		const typeflag = String.fromCharCode(header[156] ?? 0);
		const dataStart = offset + 512;
		const blocks = Math.ceil(size / 512);
		const dataEnd = dataStart + blocks * 512;
		if (dataEnd > tar.length) return null;
		const data = Buffer.from(tar.subarray(dataStart, dataStart + size));
		offset = dataEnd;
		if (typeflag === 'L' || typeflag === 'x' || typeflag === 'g') {
			const longName = typeflag === 'L' ? data.toString('utf8').replace(/\0+$/, '') : paxPath(data.toString('utf8'));
			if (longName) pendingName = longName;
			continue;
		}
		if (typeflag === '1' || typeflag === '2' || typeflag === '3' || typeflag === '4' || typeflag === '6') return null;
		const full = pendingName || (prefix ? `${prefix}/${name}` : name);
		pendingName = '';
		if (!full) continue;
		const dir = typeflag === '5' || full.endsWith('/');
		entries.push({ name: full, data: dir ? Buffer.alloc(0) : data, dir });
	}
	return entries;
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
