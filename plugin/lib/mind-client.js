/**
 * 心智服务客户端：人格卡 / 绝对记忆 / 长期记忆都由控制台进程管理（唯一写入方），
 * 这里通过本机内部接口调用。没有控制台（例如开发时直接用 dsh 跑）就全部返回空。
 */
export function createMindClient(logger) {
	const url = process.env.FISH_MIND_URL;
	const token = process.env.FISH_MIND_TOKEN;
	let warned = false;
	const cardNames = new Map();

	// 父进程看门狗：控制台被强制结束时（任务管理器、托盘程序崩溃），大肥鱼跟着退出，不留孤儿进程
	const parent = Number(process.env.FISH_PARENT_PID);
	if (parent) {
		setInterval(() => {
			try {
				process.kill(parent, 0);
			} catch {
				logger.warn("控制台已经不在了，大肥鱼跟着退出");
				process.exit(0);
			}
		}, 3000).unref();
	}

	async function call(path, body) {
		if (!url) return null;
		try {
			const res = await fetch(`${url}/internal/${path.includes("/") ? path : `mind/${path}`}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Fish-Internal": token },
				body: JSON.stringify(body),
				// 整理记忆、网上找表情（搜索 + 看图）都要多等一会儿
				signal: AbortSignal.timeout(path === "flush" ? 90000 : path === "stickers/pick" ? 60000 : 5000)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			warned = false;
			return await res.json();
		} catch (error) {
			if (!warned) logger.warn(`心智服务暂时连不上（人格/记忆这一轮不生效）：${error?.message ?? error}`);
			warned = true;
			return null;
		}
	}

	return {
		enabled: Boolean(url),
		/** 锚定文本；顺带记下这个聊天当前用的人格卡名（cardName 读） */
		async anchor(chat) {
			const r = await call("anchor", { chat: chat.key });
			if (r?.card) cardNames.set(chat.key, r.card);
			return r?.text ?? "";
		},
		cardName(chat) {
			return cardNames.get(chat.key) ?? "";
		},
		async recall(chat, sender, text) {
			return (await call("recall", { chat: chat.key, userId: sender.userId, text }))?.text ?? "";
		},
		/** 把还没整理的对话立刻整理成长期记忆（/重置 前用） */
		async flush(chat) {
			await call("flush", { chat: chat.key });
		},
		observe(chat, sender, text, reply) {
			call("observe", { chat: chat.key, sender, text, reply });
		},
		/** 人格卡列表 + 这个聊天当前用的卡：{ cards: [{id, name}], current } */
		async cards(chat) {
			return await call("cards", { chat: chat.key });
		},
		/** 把这个聊天切到某张人格卡（按名字或 id）；返回 { ok, card, cards } */
		async switchCard(chat, card) {
			return await call("switch", { chat: chat.key, card });
		},
		/** 表情包：收集（不等结果）、按关键词挑图、常用标签 */
		collectSticker(chat, image, context) {
			call("stickers/collect", { chat: chat.key, url: image.url, summary: image.summary, context });
		},
		async pickSticker(chat, query, web = false) {
			return (await call("stickers/pick", { chat: chat.key, query, web }))?.sticker ?? null;
		},
		async stickerTags() {
			return (await call("stickers/tags", {}))?.tags ?? [];
		}
	};
}
