/** controller/ico.php 的 letter_avatar。Adler32 摘要按 PHP hash(..., true) + unpack('L') 解释。 */

const MOD = 65521;

export function letterAvatarSvg(text: string): string {
	const source = normalizeText(text);
	const total = phpAdlerTotal(source);
	const hue = total % 360;
	const [r, g, b] = hsv2rgb(hue / 360, 0.3, 0.9);
	const first = escapeXml(Array.from(source)[0]?.toUpperCase() ?? '空');
	return (
		'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" height="100" width="100">' +
		`<rect fill="rgb(${r},${g},${b})" x="0" y="0" width="100" height="100"></rect>` +
		`<text x="50" y="50" font-size="50" text-copy="fast" fill="#ffffff" text-anchor="middle" text-rights="admin" alignment-baseline="central">${first}</text>` +
		'</svg>'
	);
}

export function phpAdlerTotal(text: string): number {
	const sum = adler32(Buffer.from(text, 'utf8'));
	const b0 = (sum >>> 24) & 0xff;
	const b1 = (sum >>> 16) & 0xff;
	const b2 = (sum >>> 8) & 0xff;
	const b3 = sum & 0xff;
	return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

/** Referer 为空则放行；非空且不包含 Host 则拒绝。 */
export function refererRejected(referer: string, host: string): boolean {
	if (referer === '') return false;
	return host === '' || !referer.includes(host);
}

export function normalizeText(text: string): string {
	const trimmed = text.trim();
	if (trimmed === '' || trimmed === '0') return '空';
	return trimmed;
}

function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (let i = 0; i < bytes.length; i += 1) {
		a = (a + bytes[i]) % MOD;
		b = (b + a) % MOD;
	}
	return ((b << 16) | a) >>> 0;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
	const i = Math.floor(h * 6);
	const f = h * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);
	let r = 0;
	let g = 0;
	let b = 0;
	switch (i % 6) {
		case 0:
			r = v;
			g = t;
			b = p;
			break;
		case 1:
			r = q;
			g = v;
			b = p;
			break;
		case 2:
			r = p;
			g = v;
			b = t;
			break;
		case 3:
			r = p;
			g = q;
			b = v;
			break;
		case 4:
			r = t;
			g = p;
			b = v;
			break;
		default:
			r = v;
			g = p;
			b = q;
			break;
	}
	return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
