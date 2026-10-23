export type ApiContext = {
	db: import('better-sqlite3').Database;
	request: Request;
	url: URL;
	userAgent: string;
	authed: boolean;
	params: Record<string, string>;
};

export type ApiResult = Record<string, unknown> & { code: number };

/** 导出和备份下载的文件体。+server 看到它就回附件，不再包一层 JSON。 */
export type FileDownload = {
	filename: string;
	contentType: string;
	body?: string | Uint8Array;
	path?: string;
	ephemeral?: boolean;
};
