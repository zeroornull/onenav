import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { getOption, setOption } from '#lib/server/options';
import { apiBase, fetchText } from '#lib/server/api/remote';
import { deny, htmlspecialchars, phpEmpty, ret, text } from '#lib/server/api/util';

export const methods = [
	'check_subscribe',
	'is_subscribe',
	'check_is_subscribe',
	'get_subscribe',
	'get_subscribe_status',
	'set_subscribe'
];

type SubscribeRow = Record<string, unknown>;

const cache = new Map<string, boolean>();

export function clearSubscribeCache(): void {
	cache.clear();
}

function hostOf(ctx: ApiContext): string {
	return ctx.request.headers.get('host') ?? ctx.url.host;
}

function emptyField(value: unknown): boolean {
	if (value == null || value === false) return true;
	if (typeof value === 'number') return value === 0;
	return phpEmpty(String(value));
}

function phpNumber(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	const match = String(value ?? '').trim().match(/^[+-]?\d+/);
	return match ? Number(match[0]) : 0;
}

function startOfToday(): number {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return Math.floor(now.getTime() / 1000);
}

function loadSubscribe(ctx: ApiContext): SubscribeRow | null {
	const raw = getOption(ctx.db, 's_subscribe');
	if (raw == null || raw === '') return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		return value as SubscribeRow;
	} catch {
		return null;
	}
}

function subscribeActive(endTime: unknown, code: unknown): boolean {
	return phpNumber(code) === 200 && phpNumber(endTime) > startOfToday();
}

async function remoteSubscribe(ctx: ApiContext, orderId: string, email: string): Promise<Record<string, unknown> | null> {
	const base = await apiBase();
	const domain = hostOf(ctx);
	const url =
		`${base}/v1/check_subscribe.php?order_id=${encodeURIComponent(orderId)}` +
		`&email=${encodeURIComponent(email)}&domain=${encodeURIComponent(domain)}`;
	const payload: unknown = JSON.parse(await fetchText(url, 30_000));
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
	return payload as Record<string, unknown>;
}

/** 订单号或邮箱为空时直接视为未订阅，不再请求订阅服务器。 */
export async function subscriptionActive(ctx: ApiContext): Promise<boolean> {
	const row = loadSubscribe(ctx);
	const orderId = row?.order_id;
	const email = row?.email;
	if (emptyField(orderId) || emptyField(email)) return false;
	const key = `${ctx.db.name}\0${String(orderId)}\0${String(email)}\0${hostOf(ctx)}`;
	const cached = cache.get(key);
	if (cached != null) return cached;
	try {
		const payload = await remoteSubscribe(ctx, String(orderId), String(email));
		const data = payload?.data;
		const endTime = data && typeof data === 'object' && !Array.isArray(data) ? (data as SubscribeRow).end_time : undefined;
		if (subscribeActive(endTime, payload?.code)) {
			cache.set(key, true);
			return true;
		}
		if (phpNumber(payload?.code) === -1000) {
			cache.set(key, false);
			return false;
		}
		return false;
	} catch {
		return false;
	}
}

async function checkSubscribe(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const row = loadSubscribe(ctx);
	if (emptyField(row?.order_id) || emptyField(row?.email)) return ret(-2000, '', '此功能需要订阅！');
	try {
		const payload = await remoteSubscribe(ctx, String(row?.order_id), String(row?.email));
		const data = payload?.data;
		const record = data && typeof data === 'object' && !Array.isArray(data) ? data : '';
		const endTime = record && typeof record === 'object' ? (record as SubscribeRow).end_time : undefined;
		if (subscribeActive(endTime, payload?.code)) return ret(200, record, 'success');
		if (phpNumber(payload?.code) === -1000) return ret(-2000, '', String(payload?.msg ?? ''));
		return ret(-2000, '', '请求接口失败，请重试！');
	} catch {
		return ret(-2000, '', '网络请求失败，请重试！');
	}
}

function setSubscribe(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	clearSubscribeCache();
	const value = JSON.stringify({
		order_id: htmlspecialchars(text(ctx.params.order_id).trim()),
		email: htmlspecialchars(text(ctx.params.email).trim()),
		end_time: htmlspecialchars(text(ctx.params.end_time).trim())
	});
	const existed = getOption(ctx.db, 's_subscribe') != null;
	setOption(ctx.db, 's_subscribe', value);
	return { code: 0, data: existed ? '设置已更新！' : '设置成功！' };
}

function getSubscribe(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const row = loadSubscribe(ctx);
	return ret(200, row ?? false, 'success');
}

async function subscribeStatus(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	if (await subscriptionActive(ctx)) return ret(200, 'Active', 'success');
	return ret(-2000, '', 'failure');
}

async function isSubscribe(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	const active = await subscriptionActive(ctx);
	return ret(200, active, active ? 'success' : '');
}

async function checkIsSubscribe(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	if (await subscriptionActive(ctx)) return ret(200, true, 'success');
	return ret(-2000, '', '该功能需要订阅后才能使用！');
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	switch (method) {
		case 'check_subscribe':
			return checkSubscribe(ctx);
		case 'is_subscribe':
			return isSubscribe(ctx);
		case 'check_is_subscribe':
			return checkIsSubscribe(ctx);
		case 'get_subscribe':
			return getSubscribe(ctx);
		case 'get_subscribe_status':
			return subscribeStatus(ctx);
		case 'set_subscribe':
			return setSubscribe(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
