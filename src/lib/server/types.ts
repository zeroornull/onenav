/** on_categorys。表名拼写沿用数据库。 */
export interface Category {
	id: number;
	name: string;
	add_time: string;
	up_time: string | null;
	weight: number;
	property: number;
	description: string | null;
	font_icon: string | null;
	fid: number;
}

/** on_links。 */
export interface Link {
	id: number;
	fid: number;
	title: string;
	url: string;
	description: string | null;
	add_time: string;
	up_time: string | null;
	weight: number;
	property: number;
	click: number;
	topping: number;
	url_standby: string | null;
	font_icon: string | null;
	check_status: number;
	last_checked_time: string | null;
}
