import type { ApiContext, ApiResult } from './context';

type MethodModule = {
	methods?: string[];
	handle?: (ctx: ApiContext, method: string) => ApiResult | Promise<ApiResult>;
};

const NOT_IMPLEMENTED: ApiResult = { code: -1, msg: '未实现' };

const modules = import.meta.glob('./methods/*.ts', { eager: true }) as Record<string, MethodModule>;

const registry = new Map<string, NonNullable<MethodModule['handle']>>();

for (const path of Object.keys(modules).sort()) {
	const mod = modules[path];
	if (!mod?.methods || typeof mod.handle !== 'function') continue;
	for (const name of mod.methods) {
		registry.set(name, mod.handle);
	}
}

export function dispatch(ctx: ApiContext, method: string): ApiResult | Promise<ApiResult> {
	const handle = registry.get(method);
	if (!handle) return NOT_IMPLEMENTED;
	return handle(ctx, method);
}
