import { randomInt } from 'node:crypto';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { allRows, countRows, deny, formatLocal, intval, limitOf, oneRow, pageOf, phpEmpty, ret, text } from '#lib/server/api/util';

export const methods = ['create_share', 'share_list', 'del_share', 'get_sid_links'];

const SID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSid(): string {
	let sid = '';
	for (let index = 0; index < 8; index += 1) sid += SID_ALPHABET[randomInt(SID_ALPHABET.length)];
	return sid;
}

function createShare(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const addTime = formatLocal(new Date(), 'datetime');
	const expire = text(ctx.params.expire_time).trim();
	const password = text(ctx.params.password).trim();
	const created = Date.parse(addTime.replace(' ', 'T'));
	const expires = Date.parse(expire.replace(' ', 'T'));
	if (!Number.isFinite(expires) || created > expires) return ret(-2000, '', '到期日期不能小于当前日期！');
	if (Buffer.byteLength(password) > 16) return ret(-2000, '', '密码长度不能超过16位！');
	if (password && !/[A-Za-z0-9]{4,16}/.test(password)) {
		return ret(-2000, '', '密码只能由4-16位字母和数字组成！');
	}
	const sid = randomSid();
	const result = ctx.db
		.prepare(
			`INSERT INTO on_shares (sid, add_time, expire_time, password, cid, note)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(sid, addTime, expire, password, intval(ctx.params.cid), text(ctx.params.note));
	if (!result.changes) return ret(-2000, '', '写入数据库失败！');
	return ret(200, '', 'success');
}

function shareList(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const page = pageOf(ctx.params.page);
	const limit = limitOf(ctx.params.limit);
	const offset = (page - 1) * limit;
	const count = countRows(ctx, 'SELECT COUNT(*) AS n FROM on_shares');
	const data = allRows(
		ctx,
		`SELECT on_shares.*,
			(SELECT name FROM on_categorys WHERE id = on_shares.cid) AS category_name
		 FROM on_shares
		 ORDER BY id DESC
		 LIMIT ? OFFSET ?`,
		limit,
		offset
	);
	return { code: 0, msg: '', count, data };
}

function delShare(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const id = intval(ctx.params.id);
	if (phpEmpty(ctx.params.id) || !id) return ret(-2000, null, 'ID不能为空！');
	const result = ctx.db.prepare('DELETE FROM on_shares WHERE id = ?').run(id);
	if (result.changes) return ret(200, '', 'success');
	return ret(-2000, '', '删除失败！');
}

function sidLinks(ctx: ApiContext): ApiResult {
	const sid = text(ctx.params.sid).trim();
	const password = text(ctx.params.password).trim();
	if (sid.length !== 8 || !/[A-Za-z0-9]{8}$/.test(sid)) return ret(-2000, '', 'SID不合法！');
	const share = oneRow(ctx, 'SELECT * FROM on_shares WHERE sid = ?', sid);
	if (!share) return ret(-2000, '', 'SID不存在！');
	const category = oneRow(ctx, 'SELECT name FROM on_categorys WHERE id = ?', Number(share.cid));
	const now = Date.now();
	const expires = Date.parse(String(share.expire_time ?? '').replace(' ', 'T'));
	if (!Number.isFinite(expires) || now > expires) return ret(-2000, '', '链接已过期！');
	const storedPassword = String(share.password ?? '');
	if (storedPassword && storedPassword !== password) return ret(401, '', '密码错误！');
	const results = allRows(
		ctx,
		'SELECT * FROM on_links WHERE fid = ? ORDER BY weight DESC, id DESC',
		Number(share.cid)
	);
	return ret(200, {
		category_name: category ? String(category.name ?? '') : '',
		expire_time: share.expire_time,
		results
	}, 'success');
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	switch (method) {
		case 'create_share':
			return createShare(ctx);
		case 'share_list':
			return shareList(ctx);
		case 'del_share':
			return delShare(ctx);
		case 'get_sid_links':
			return sidLinks(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
