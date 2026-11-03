/**
 * 极简 OneBot v11 正向 WebSocket 客户端（NapCat / LLOneBot / Lagrange 都支持）。
 * 只用 Node 自带的 WebSocket，不引入依赖。
 */

export class OneBot {
	constructor({ url, token, logger, onMessage, reconnectMs = 5000 }) {
		this.url = url;
		this.token = token;
		this.logger = logger;
		this.onMessage = onMessage;
		this.reconnectMs = reconnectMs;
		this.selfId = undefined;
		this.pending = new Map();
		this.seq = 0;
		this.closed = false;
		this.ws = undefined;
		this.timer = undefined;
	}

	start() {
		this.connect();
	}

	connect() {
		if (this.closed) return;
		const url = new URL(this.url);
		if (this.token) url.searchParams.set("access_token", this.token);
		const ws = new WebSocket(url);
		this.ws = ws;
		ws.addEventListener("open", () => {
			this.logger.info(`已连上 QQ（OneBot）：${this.url}`);
		});
		ws.addEventListener("message", (event) => {
			let data;
			try {
				data = JSON.parse(String(event.data));
			} catch {
				return;
			}
			this.handle(data);
		});
		ws.addEventListener("close", () => {
			for (const { reject } of this.pending.values()) reject(new Error("OneBot 连接断开"));
			this.pending.clear();
			if (this.closed) return;
			this.logger.warn(`QQ 连接断开，${this.reconnectMs / 1000} 秒后重连（确认 NapCat 已登录并开启了 WebSocket 服务端）`);
			this.timer = setTimeout(() => this.connect(), this.reconnectMs);
		});
		ws.addEventListener("error", () => {});
	}

	handle(data) {
		if (data.echo !== undefined && this.pending.has(data.echo)) {
			const { resolve, reject } = this.pending.get(data.echo);
			this.pending.delete(data.echo);
			if (data.status === "failed") reject(new Error(data.wording || data.message || `retcode ${data.retcode}`));
			else resolve(data.data);
			return;
		}
		if (data.self_id !== undefined) this.selfId = Number(data.self_id);
		if (data.post_type === "message") {
			Promise.resolve(this.onMessage(data)).catch((error) => {
				this.logger.warn(`处理消息失败：${error?.message ?? error}`);
			});
		}
	}

	call(action, params, timeoutMs = 30000) {
		const ws = this.ws;
		if (ws === undefined || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("QQ 未连接"));
		const echo = `fish-${++this.seq}`;
		return new Promise((resolve, reject) => {
			this.pending.set(echo, { resolve, reject });
			ws.send(JSON.stringify({ action, params, echo }));
			setTimeout(() => {
				if (this.pending.delete(echo)) reject(new Error(`${action} 超时`));
			}, timeoutMs);
		});
	}

	close() {
		this.closed = true;
		clearTimeout(this.timer);
		this.ws?.close();
	}
}

const unescapeCQ = (s) => s.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");

/** CQ 码字符串 → 消息段数组 */
export function toSegments(message) {
	if (typeof message !== "string") return message ?? [];
	const segments = [];
	const re = /\[CQ:([a-z_]+)((?:,[^\]]*)?)\]/g;
	let last = 0;
	for (let m; (m = re.exec(message)); last = re.lastIndex) {
		if (m.index > last) segments.push({ type: "text", data: { text: unescapeCQ(message.slice(last, m.index)) } });
		const data = {};
		for (const kv of m[2].split(",").slice(1)) {
			const i = kv.indexOf("=");
			if (i > 0) data[kv.slice(0, i)] = unescapeCQ(kv.slice(i + 1));
		}
		segments.push({ type: m[1], data });
	}
	if (last < message.length) segments.push({ type: "text", data: { text: unescapeCQ(message.slice(last)) } });
	return segments;
}

const PLACEHOLDER = { image: "[图片]", face: "[表情]", mface: "[表情]", record: "[语音]", video: "[视频]", file: "[文件]", forward: "[聊天记录]", json: "[卡片]", xml: "[卡片]", poke: "[戳一戳]", dice: "[骰子]", rps: "[猜拳]", share: "[链接]", location: "[位置]", music: "[音乐]", markdown: "[消息]" };

/**
 * 把消息段渲染成给模型看的文本：@别人 保留成「@名字(QQ)」，引用回复带上原文，图片等换成占位符。
 * @param lookup { name(qq): Promise<string|undefined>, quote(id): Promise<string|undefined> }，都可省略
 * @returns { text, quote: 引用的原文, mentioned: 是否 @ 了机器人, targets: 被 @ 的其他人, stickers: 消息里的表情包 [{url, summary}] }
 */
export async function renderMessage(message, selfId, lookup = {}) {
	let mentioned = false;
	const targets = [];
	const stickers = [];
	let quote = "";
	let text = "";
	for (const seg of toSegments(message)) {
		const data = seg.data ?? {};
		if (seg.type === "text") text += data.text ?? "";
		else if (seg.type === "at") {
			if (data.qq === "all") text += "@全体成员 ";
			else if (Number(data.qq) === selfId) mentioned = true;
			else {
				const given = String(data.name ?? "").replace(/[\s【】\[\]［］()（）｜|<>《》:：@＠]/g, "").slice(0, 24);
				const name = (await lookup.name?.(Number(data.qq)).catch(() => undefined)) || given;
				text += `@${name}(${data.qq}) `;
				targets.push(`${name || "群友"}(${data.qq})`);
			}
		} else if (seg.type === "reply") {
			quote = (await lookup.quote?.(data.id).catch(() => undefined)) || "";
		} else if (seg.type === "mface") {
			text += data.summary || PLACEHOLDER.mface;
			// 商城表情：图在 QQ 的表情 CDN 上，名字（summary）就是现成的标签
			const emojiId = String(data.emoji_id ?? "");
			const url = data.url || (/^[0-9a-f]{32}$/i.test(emojiId) ? `https://gxh.vip.qq.com/club/item/parcel/item/${emojiId.slice(0, 2)}/${emojiId}/raw300.gif` : "");
			if (url) stickers.push({ url, summary: data.summary ?? "" });
		} else if (seg.type === "face") text += data.summary || PLACEHOLDER.face;
		else if (seg.type === "image") {
			// QQ 把收藏的表情标成 sub_type=1 或 summary=[动画表情]；普通照片不收
			const isSticker = Number(data.sub_type) === 1 || /动画表情/.test(data.summary ?? "");
			text += isSticker ? "[表情包]" : data.summary && data.summary !== "[图片]" ? data.summary : "[图片]";
			if (isSticker && data.url) stickers.push({ url: data.url, summary: "" });
		} else if (PLACEHOLDER[seg.type]) text += PLACEHOLDER[seg.type];
	}
	text = text.replace(/[ \t]+/g, " ").trim();
	return { text, quote, mentioned, targets, stickers };
}

/** 兼容旧接口：只要纯文本 + 是否 @ 了机器人 */
export async function parseMessage(message, selfId) {
	const { text, mentioned } = await renderMessage(message, selfId);
	return { text, mentioned };
}

/** QQ 单条消息别太长，按段切开。 */
export function splitReply(text, max = 1500) {
	const chunks = [];
	let rest = text;
	while (rest.length > max) {
		let cut = rest.lastIndexOf("\n", max);
		if (cut < max / 2) cut = max;
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^\n/, "");
	}
	if (rest.length > 0) chunks.push(rest);
	return chunks;
}
