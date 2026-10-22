import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import {
	backupNameOk,
	dataRoot,
	deny,
	err,
	fileSuffix,
	formatLocal,
	resolveInside,
	ret,
	safeBaseName
} from '#lib/server/api/util';

export const methods = ['backup_db', 'backup_db_list', 'del_backup_db', 'restore_db', 'down_db', 'upload_backup'];

const DB_LIMIT = 64 * 1024 * 1024;

function backupDir(): string {
	return path.join(dataRoot(), 'backup');
}

function versionLabel(): string {
	try {
		const text = readFileSync(path.join(process.cwd(), 'version.txt'), 'utf8').trim();
		const head = text.split('-')[0] ?? '';
		return head.replace(/^v/i, '') || 'null';
	} catch {
		return 'null';
	}
}

function databaseFile(ctx: ApiContext): string | null {
	const name = ctx.db.name;
	if (!name || name === ':memory:') return null;
	return path.resolve(name);
}

function backupFile(name: string): string | null {
	if (!backupNameOk(name)) return null;
	return resolveInside(backupDir(), path.join(backupDir(), name));
}

function backupDb(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const source = databaseFile(ctx);
	if (!source || !existsSync(source)) return ret(-2000, '', '备份目录创建失败，请检查目录权限！');
	const filename = `onenav_${formatLocal(new Date(), 'YmdHi')}_${versionLabel()}.db3`;
	const destination = backupFile(filename);
	if (!destination) return ret(-2000, '', '备份目录创建失败，请检查目录权限！');
	try {
		mkdirSync(backupDir(), { recursive: true });
		copyFileSync(source, destination);
	} catch {
		return ret(-2000, '', '备份目录创建失败，请检查目录权限！');
	}
	return ret(200, filename, 'success');
}

function listBackups(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	if (!existsSync(backupDir())) return { code: 0, msg: '', count: 0, data: [] };
	let names = readdirSync(backupDir()).filter((name) => {
		if (!backupNameOk(name)) return false;
		const file = backupFile(name);
		return file ? existsSync(file) && statSync(file).isFile() : false;
	});
	names.sort().reverse();
	while (names.length > 10) {
		const extra = names.pop();
		const file = extra ? backupFile(extra) : null;
		if (file) {
			try {
				unlinkSync(file);
			} catch {
				// 删不掉的旧备份留在磁盘上，不再放进返回列表。
			}
		}
	}
	const data = names.map((name, id) => {
		const file = backupFile(name);
		const stat = file ? statSync(file) : null;
		return {
			id,
			name,
			mtime: stat ? formatLocal(stat.mtime, 'datetime') : '',
			size: stat ? `${stat.size / 1024}KB` : '0KB'
		};
	});
	return { code: 0, msg: '', count: data.length, data };
}

function delBackup(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const file = backupFile(ctx.params.name ?? '');
	if (!file) return ret(-2000, '', '数据库名称不合法！');
	try {
		unlinkSync(file);
	} catch {
		return ret(-2000, '', '删除失败，请检查目录权限！');
	}
	return ret(200, '', '备份数据库已被删除！');
}

function restoreDb(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const name = ctx.params.name ?? '';
	const file = backupFile(name);
	const target = databaseFile(ctx);
	if (!file || !target) return ret(-2000, '', '数据库名称不合法！');
	if (!existsSync(file)) return ret(-2000, '', '回滚失败，请检查目录权限！');
	try {
		copyFileSync(file, target);
	} catch {
		return ret(-2000, '', '回滚失败，请检查目录权限！');
	}
	return ret(200, '', `数据库已回滚为${name}`);
}

function downDb(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const name = ctx.params.name ?? '';
	const file = backupFile(name);
	if (!file) return ret(-2000, '', '数据库名称不合法！');
	if (!existsSync(file)) return { code: 404, data: '', msg: '文件不存在' };
	let bytes: Buffer;
	try {
		bytes = readFileSync(file);
	} catch {
		return { code: 404, data: '', msg: '文件不存在' };
	}
	return {
		code: 0,
		data: { name, size: bytes.length },
		msg: '',
		download: {
			filename: name,
			contentType: 'application/octet-stream',
			body: bytes
		}
	};
}

async function uploadBackup(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	let upload: { name: string; bytes: Buffer } | null = null;
	try {
		const form = await ctx.request.clone().formData();
		const file = form.get('file');
		if (file && typeof file !== 'string') {
			upload = { name: file.name || '', bytes: Buffer.from(await file.arrayBuffer()) };
		}
	} catch {
		upload = null;
	}
	if (!upload || !upload.bytes.length) return err(-1015, 'File upload failed!');
	if (upload.bytes.length > DB_LIMIT) return err(-2000, '文件过大');
	const base = safeBaseName(upload.name);
	if (!base || fileSuffix(base) !== 'db3') return err(-1014, 'Unsupported file suffix name!');
	const destination = resolveInside(backupDir(), path.join(backupDir(), base));
	if (!destination) return err(-2000, '上传失败，请检查data/backup/目录权限！');
	try {
		mkdirSync(backupDir(), { recursive: true });
		writeFileSync(destination, upload.bytes);
	} catch {
		return err(-2000, '上传失败，请检查data/backup/目录权限！');
	}
	return { code: 0, file_name: `data/backup/${base}` };
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'backup_db':
			return backupDb(ctx);
		case 'backup_db_list':
			return listBackups(ctx);
		case 'del_backup_db':
			return delBackup(ctx);
		case 'restore_db':
			return restoreDb(ctx);
		case 'down_db':
			return downDb(ctx);
		case 'upload_backup':
			return uploadBackup(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
