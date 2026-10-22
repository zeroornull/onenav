import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkInstallEnvironment, installSite, isInstalled } from '#lib/server/config';

export const load: PageServerLoad = () => {
	if (isInstalled()) redirect(303, '/login');
	return { env: checkInstallEnvironment() };
};

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const result = installSite(
			{
				username: String(form.get('username') ?? ''),
				password: String(form.get('password') ?? ''),
				password2: String(form.get('password2') ?? ''),
				email: String(form.get('email') ?? '')
			},
			{ basePath: '' }
		);
		if (!result.ok) return fail(400, { message: result.error, env: checkInstallEnvironment() });
		redirect(303, '/login');
	}
} satisfies Actions;
