import { md5 } from '#lib/server/auth';
import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { loadConfig } from '#lib/server/config';
import { getOption, readSite, readTransitionPage, setOption, setSite, setTransitionPage } from '#lib/server/options';
import { deny, err, htmlspecialchars, intval, text } from '#lib/server/api/util';

export const methods = ['set_site', 'site_info', 'set_transition_page', 'transition_page', 'create_sk'];

function setSiteOption(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const value = {
		title: htmlspecialchars(text(ctx.params.title)),
		logo: htmlspecialchars(text(ctx.params.logo)),
		subtitle: htmlspecialchars(text(ctx.params.subtitle)),
		keywords: htmlspecialchars(text(ctx.params.keywords)),
		description: htmlspecialchars(text(ctx.params.description)),
		custom_header: text(ctx.params.custom_header),
		custom_footer: text(ctx.params.custom_footer),
		link_model: text(ctx.params.link_model),
		link_num: text(ctx.params.link_num)
	};
	const existed = getOption(ctx.db, 's_site') != null;
	setSite(ctx.db, value);
	return { code: 0, data: existed ? '设置已更新！' : '设置成功！' };
}

function siteInfo(ctx: ApiContext): ApiResult {
	try {
		const site = readSite(ctx.db);
		return { code: 200, data: site ?? false, msg: 'success' };
	} catch {
		return { code: 200, data: false, msg: 'success' };
	}
}

function setTransition(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const value = {
		control: htmlspecialchars(text(ctx.params.control).trim()),
		visitor_stay_time: intval(ctx.params.visitor_stay_time),
		admin_stay_time: intval(ctx.params.admin_stay_time),
		menu: text(ctx.params.menu),
		footer: text(ctx.params.footer),
		a_d_1: text(ctx.params.a_d_1),
		a_d_2: text(ctx.params.a_d_2)
	};
	const existed = getOption(ctx.db, 's_transition_page') != null;
	setTransitionPage(ctx.db, value);
	return { code: 0, data: existed ? '设置已更新！' : '设置成功！' };
}

function transitionInfo(ctx: ApiContext): ApiResult {
	try {
		const page = readTransitionPage(ctx.db);
		return { code: 200, data: page ?? false, msg: 'success' };
	} catch {
		return { code: 200, data: false, msg: 'success' };
	}
}

function createSk(ctx: ApiContext): ApiResult {
	const denied = deny(ctx);
	if (denied) return denied;
	const user = loadConfig()?.username ?? '';
	const sk = md5(`${user}${user}${Math.floor(Date.now() / 1000)}`);
	try {
		setOption(ctx.db, 'SecretKey', sk);
	} catch {
		return err(-2000, 'SecretKey生成失败！');
	}
	const stored = getOption(ctx.db, 'SecretKey');
	if (stored !== sk) return err(-2000, 'SecretKey生成失败！');
	return { code: 0, data: sk };
}

export function handle(ctx: ApiContext, method: string): ApiResult {
	switch (method) {
		case 'set_site':
			return setSiteOption(ctx);
		case 'site_info':
			return siteInfo(ctx);
		case 'set_transition_page':
			return setTransition(ctx);
		case 'transition_page':
			return transitionInfo(ctx);
		case 'create_sk':
			return createSk(ctx);
		default:
			return { code: -1, msg: '未实现' };
	}
}
