import type { ApiContext, ApiResult } from '#lib/server/api/context';
import { subscriptionActive } from '#lib/server/api/methods/subscribe';
import { allRows, deny, phpEmpty, ret, text } from '#lib/server/api/util';
import { getOption } from '#lib/server/options';

export const methods = ['ai_search'];

/** 单条描述进提示词前先截断，整表描述还有总长度上限。 */
export const AI_DESC_CHARS = 120;
export const AI_DESC_BUDGET = 6_000;

const SEARCH_PROMPT = `用户会给你一段JSON格式的书签数据，其中包含每个链接的标题、URL和描述（描述可能为空）等信息。你需要根据用户提供的关键词，智能匹配与之相关的链接，并推荐3个额外的相关链接。请严格遵循以下规则：

### 规则：

1. **匹配链接**：
    - **仅使用提供的书签数据进行匹配**，不得引用或使用任何其他外部信息。
    - **对于没有描述或描述不充分的URL**，请基于你的知识推断该URL的含义，以便进行准确匹配。
    - 返回的匹配链接必须与用户提供的关键词高度相关，优先匹配精确相关的内容。
    - 根据相关性将匹配结果按从高到低排序，确保最相关的链接出现在列表前面。
    - 匹配的结果不超过5个链接，如果无法匹配任何链接，请提醒用户。

2. **推荐额外链接**：
    - **推荐的额外3个链接不来自用户提供的JSON数据**，应基于你所学的知识进行推荐。
    - 确保这些推荐的链接与用户的需求相关，补充和扩展匹配结果。
    - 不要推荐用户提供的JSON内容中的任何链接。

3. **输出格式**：
    - **匹配结果**：以列表形式返回，应包含链接标题、URL和简短的链接描述，优先使用用户JSON中的标题和描述，如果没有或不完善你可以补充。
    - **推荐结果**：以列表形式返回，应包含链接标题、URL和简短的链接描述。`;

const TRANSLATE_PROMPT =
	'请自动检测用户输入的语言。当输入内容是中文时，翻译成英文；当输入内容不属于中文时，翻译成中文。只需返回翻译后的内容，不需要额外解释或描述。';

type AiSetting = {
	status?: string;
	url?: string;
	sk?: string;
	model?: string;
	custom_model?: string;
};

function readSetting(ctx: ApiContext): AiSetting | null {
	const raw = getOption(ctx.db, 'ai_setting');
	if (raw == null || phpEmpty(raw)) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as AiSetting;
	} catch {
		return null;
	}
}

function messages(ctx: ApiContext, feature: string, content: string): { role: string; content: string }[] {
	if (feature === 'search') {
		const rows = allRows(
			ctx,
			'SELECT url, title, substr(description, 1, ?) AS description FROM on_links',
			AI_DESC_CHARS
		);
		let budget = AI_DESC_BUDGET;
		const bookmarks = rows.map((link) => {
			const title = link.title == null ? '' : String(link.title);
			const url = link.url == null ? '' : String(link.url);
			let description: string | null = null;
			if (link.description != null && String(link.description) !== '' && budget > 0) {
				const raw = String(link.description);
				description = raw.length <= budget ? raw : raw.slice(0, budget);
				budget -= description.length;
			} else if (link.description != null) {
				description = '';
			}
			return { title, url, description };
		});
		return [
			{ role: 'system', content: SEARCH_PROMPT },
			{ role: 'user', content: `JSON书签列表为：${JSON.stringify(bookmarks)}` },
			{ role: 'user', content }
		];
	}
	return [
		{ role: 'system', content: TRANSLATE_PROMPT },
		{ role: 'user', content }
	];
}

async function aiSearch(ctx: ApiContext): Promise<ApiResult> {
	const denied = deny(ctx);
	if (denied) return denied;
	if (!(await subscriptionActive(ctx))) return ret(-2000, '', '该功能需要订阅后才能使用！');
	const setting = readSetting(ctx);
	if (!setting) return ret(-2000, '', '获取参数失败！');
	if (setting.status === 'off') return ret(-2000, '', 'AI功能未启用！');
	const url = setting.url ?? '';
	if (!url) return ret(-2000, '', '获取参数失败！');
	const model = setting.model === 'custom' ? (setting.custom_model ?? '') : (setting.model ?? '');
	const feature = phpEmpty(ctx.params.feature) ? 'search' : text(ctx.params.feature);
	const content = text(ctx.params.content);
	const temperature = feature === 'search' ? 0.1 : 0.2;
	const topP = feature === 'search' ? 0.7 : 1;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${setting.sk ?? ''}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				temperature,
				top_p: topP,
				messages: messages(ctx, feature, content),
				stream: true
			}),
			signal: AbortSignal.timeout(120_000)
		});
		const body = await response.text();
		return ret(200, body, 'success');
	} catch {
		return ret(-2000, '', '网络请求失败，请重试！');
	}
}

export async function handle(ctx: ApiContext, method: string): Promise<ApiResult> {
	if (method !== 'ai_search') return { code: -1, msg: '未实现' };
	return aiSearch(ctx);
}
