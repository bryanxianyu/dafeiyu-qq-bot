/**
 * QQ 空间发说说（非官方网页接口，流程参考 astrbot_plugin_qzone_ultra，MIT）：
 *   1. NapCat get_cookies 取空间域的登录 cookie（要有 p_skey）
 *   2. g_tk = hash33(p_skey)，从 5381 开始
 *   3. POST taotao.qzone.qq.com 的 emotion_cgi_publish_v6
 * cookie 只在这个模块里用，不进模型上下文、不写日志。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const COOKIE_DOMAINS = ["user.qzone.qq.com", "qzone.qq.com", "h5.qzone.qq.com", "mobile.qzone.qq.com"];
const PUBLISH_URL = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** QQ 网页的 CSRF 令牌。只依赖低 31 位，所以 32 位整数运算和 Python 的大整数结果一致 */
export function hash33(s) {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = (h + (h << 5) + s.charCodeAt(i)) | 0;
	return h & 0x7fffffff;
}

export function parseCookies(text) {
	const out = {};
	for (const part of String(text ?? "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

/** 空间接口有时回 JSON，有时回 callback(...) 或带 frameElement 的 HTML */
export function parseQzoneResponse(text) {
	try {
		return JSON.parse(text);
	} catch {}
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {}
	}
	return null;
}

export class Qzone {
	constructor({ bot, file, logger }) {
		this.bot = bot;
		this.file = file;
		this.logger = logger;
		this.state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
		this.state.history ??= [];
		this.state.draft ??= null;
		this.state.lastDiary ??= "";
		this.state.lastError ??= "";
	}

	save() {
		writeFileSync(this.file + ".tmp", JSON.stringify(this.state, null, 1));
		renameSync(this.file + ".tmp", this.file);
	}

	postedToday() {
		const day = new Date().toDateString();
		return this.state.history.filter((h) => h.ok && new Date(h.at).toDateString() === day).length;
	}

	setDraft(text, origin) {
		this.state.draft = { text, origin, at: Date.now() };
		this.save();
	}

	takeDraft() {
		const draft = this.state.draft;
		this.state.draft = null;
		this.save();
		// 草稿两小时内有效
		return draft && Date.now() - draft.at < 2 * 3600_000 ? draft : null;
	}

	async cookies() {
		for (const domain of COOKIE_DOMAINS) {
			try {
				const data = await this.bot.call("get_cookies", { domain }, 10000);
				const jar = parseCookies(data?.cookies);
				if (jar.p_skey) return jar;
			} catch {}
		}
		throw new Error("拿不到 QQ 空间的登录凭证（NapCat get_cookies 没有返回 p_skey）");
	}

	/** 发一条纯文字说说，返回 { ok, tid } 或抛错 */
	async publish(text, origin = "") {
		const content = String(text).trim().slice(0, 1000);
		if (!content) throw new Error("说说内容是空的");
		let result;
		try {
			const jar = await this.cookies();
			const uin = Number(String(jar.uin ?? jar.p_uin ?? "").replace(/^o0*/, "")) || this.bot.selfId;
			const gtk = hash33(jar.p_skey);
			const body = new URLSearchParams({
				syn_tweet_verson: "1",
				paramstr: "1",
				who: "1",
				con: content,
				feedversion: "1",
				ver: "1",
				ugc_right: "1",
				to_sign: "0",
				hostuin: String(uin),
				code_version: "1",
				format: "json",
				qzreferrer: `https://user.qzone.qq.com/${uin}`
			});
			const res = await fetch(`${PUBLISH_URL}?g_tk=${gtk}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
					Referer: `https://user.qzone.qq.com/${uin}`,
					Origin: "https://user.qzone.qq.com",
					"User-Agent": UA
				},
				body,
				redirect: "manual",
				signal: AbortSignal.timeout(20000)
			});
			const payload = parseQzoneResponse(await res.text());
			if (!payload) throw new Error(`空间返回了看不懂的内容（HTTP ${res.status}），可能是登录失效或接口改版`);
			if (Number(payload.code) !== 0) throw new Error(`空间拒绝了：${payload.message || payload.msg || `code ${payload.code}`}`);
			result = { ok: true, tid: payload.tid ?? payload.t1_tid ?? "" };
			this.state.lastError = "";
		} catch (error) {
			result = { ok: false, error: error.message };
			this.state.lastError = error.message;
		}
		this.state.history.unshift({ at: Date.now(), text: content, origin, ...result });
		this.state.history = this.state.history.slice(0, 100);
		this.save();
		if (!result.ok) throw new Error(result.error);
		this.logger.info(`发了一条说说：${content.slice(0, 40)}`);
		return result;
	}
}
