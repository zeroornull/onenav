import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { dataRoot, deny, err, htmlspecialchars, phpEmpty, resolveInside, text } from '#lib/server/api/util';

export const methods = ['exe_sql'];

const SQL_NAME = /^[\w.-]+\.sql$/;
const ATTACH_RE = /\bATTACH\b(?:\s+DATABASE\b)?\s+('(?:[^']*)'|"(?:[^"]*)"|\S+)/gi;

function sqlFile(name: string): string | null {
	const safe = htmlspecialchars(name.trim());
	if (!safe || !SQL_NAME.test(safe) || safe.includes('..')) return null;
	const root = path.join(process.cwd(), 'db', 'sql');
	return resolveInside(root, path.join(root, safe));
}

/** 多语句里的 ATTACH 路径必须落在 data/ 内，否则整段不执行。 */
export function attachmentOutsideData(sql: string): boolean {
	const pattern = new RegExp(ATTACH_RE.source, 'gi');
	for (const match of sql.matchAll(pattern)) {
		const token = match[1] ?? '';
		const quoted =
			(token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'));
		if (!quoted) return true;
		const target = token.slice(1, -1);
		if (target === ':memory:') continue;
		if (!target || target.startsWith('file:') || target.includes('://') || target.includes('\0')) return true;
		const resolved = path.resolve(process.cwd(), target);
		if (!resolveInside(dataRoot(), resolved)) return true;
	}
	return false;
}

function splitSql(sql: string, separator: string): string[] {
	return sql.split(separator).map((part) => part.trim()).filter((part) => !phpEmpty(part));
}

function isRead(sql: string): boolean {
	return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql);
}

function runStatements(
	ctx: ApiContext,
	sql: string,
	separator: string
): { rows: Record<string, unknown>[] | null; executed: number; total: number } {
	if (attachmentOutsideData(sql)) throw new Error('拒绝将附件数据库写到 data 目录之外');
	const parts = sql.split(separator);
	let rows: Record<string, unknown>[] | null = null;
	let executed = 0;
	for (const part of parts) {
		const statement = part.trim();
		if (phpEmpty(statement)) continue;
		if (isRead(statement)) {
			rows = ctx.db.prepare(statement).all() as Record<string, unknown>[];
		} else {
			ctx.db.prepare(statement).run();
		}
		executed++;
	}
	return { rows, executed, total: parts.length - 1 };
}

function runSqlText(ctx: ApiContext, sql: string): ApiResult {
	try {
		const { rows } = runStatements(ctx, sql, ';');
		if (rows) return { code: 0, data: rows, msg: '' };
		return { code: 0, data: '执行完成', msg: '' };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'SQL执行失败';
		return err(-2000, message);
	}
}

function runSqlFile(ctx: ApiContext, rawName: string): ApiResult {
	const name = htmlspecialchars(rawName.trim());
	const file = sqlFile(rawName);
	if (!file || !existsSync(file)) return err(-2000, `${name}不存在!`);
	try {
		const logged = ctx.db.prepare('SELECT COUNT(*) AS n FROM on_db_logs WHERE sql_name = ?').get(name) as { n: number };
		if (Number(logged?.n ?? 0) >= 1) return err(-2000, `${name}已经更新过！`);
		const content = readFileSync(file, 'utf8');
		const separator = name === '20220414.sql' ? '\n' : ';';
		const { executed, total } = runStatements(ctx, content, separator);
		ctx.db
			.prepare('INSERT INTO on_db_logs (sql_name, update_time, status) VALUES (?, ?, ?)')
			.run(name, Math.floor(Date.now() / 1000), 'TRUE');
		return { code: 0, data: `${name}更新完成！总数${total}，成功：${executed}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'SQL执行失败';
		return err(-2000, message);
	}
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	if (method !== 'exe_sql') return { code: -1, msg: '未实现' };
	const denied = deny(ctx);
	if (denied) return denied;
	const sql = text(ctx.params.sql);
	if (sql.trim() !== '') return runSqlText(ctx, sql);
	return runSqlFile(ctx, text(ctx.params.name));
}
