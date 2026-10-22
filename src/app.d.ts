declare global {
	namespace App {
		interface Locals {
			isLogin: boolean;
			user: string | null;
			userAgent: string;
		}
	}
}

export {};
