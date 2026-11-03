/**
 * 扩展加载器：人格卡 / 记忆系统 / 其他插件的统一接口。
 *
 * 目录约定（控制台的「扩展」页会列出并管理它们）：
 *   <extensionsDir>/<扩展id>/
 *     manifest.json   { "id", "name", "type": "persona" | "memory" | "other",
 *                       "version", "description", "entry": "index.mjs",
 *                       "panel": "panel.html"（可选，控制台里的设置页）,
 *                       "priority": 0（数字大的先执行）, "enabled": true }
 *     config.json     扩展自己的配置（控制台的设置页读写它）
 *     index.mjs       导出下面任意几个钩子
 *
 * 钩子（都可以是 async，全部可选）：
 *   init(api)                         启动时调用；api = { id, dir, dataDir, config, logger }
 *   persona(chat)            → 字符串  开新缸时的人格设定；按 priority 取第一个非空的
 *   recall(chat, sender, text) → 字符串  每条消息前注入的上下文（如检索到的记忆）；所有扩展的结果拼起来
 *   remember(chat, sender, text, reply)  模型回复后调用（写入记忆）；所有扩展都会收到
 *   dispose()                         大肥鱼停止时调用
 *
 *   chat   = { key: 'group:123' | 'private:456', type: 'group' | 'private', id: number }
 *   sender = { userId: number, nickname: string, isOwner: boolean }
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as builtin from "./extensions.js";

const readJson = (p, fallback) => {
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return fallback;
	}
};

export async function loadExtensions({ dir, file, dataDir, logger }) {
	const loaded = [];

	if (dir && existsSync(dir)) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const extDir = join(dir, e.name);
			const manifest = readJson(join(extDir, "manifest.json"), null);
			if (!manifest || manifest.enabled === false) continue;
			const id = manifest.id || e.name;
			try {
				const mod = await import(pathToFileURL(join(extDir, manifest.entry || "index.mjs")).href);
				const config = readJson(join(extDir, "config.json"), {});
				const extLogger = {
					info: (msg) => logger.info(`[${id}] ${msg}`),
					warn: (msg) => logger.warn(`[${id}] ${msg}`)
				};
				await mod.init?.({ id, dir: extDir, dataDir, config, logger: extLogger });
				loaded.push({ id, name: manifest.name || id, priority: Number(manifest.priority) || 0, mod });
				logger.info(`已加载扩展：${manifest.name || id}`);
			} catch (error) {
				logger.warn(`扩展 ${id} 加载失败，已跳过：${error?.message ?? error}`);
			}
		}
	}

	// 兼容旧的单文件扩展
	if (file) {
		try {
			const mod = await import(pathToFileURL(resolve(file)).href);
			await mod.init?.({ id: "extensionsFile", dir: resolve(file, ".."), dataDir, config: {}, logger });
			loaded.push({ id: "extensionsFile", name: file, priority: 0, mod });
			logger.info(`已加载扩展：${file}`);
		} catch (error) {
			logger.warn(`扩展 ${file} 加载失败：${error?.message ?? error}`);
		}
	}

	loaded.sort((a, b) => b.priority - a.priority);
	const safe = async (ext, hook, args) => {
		try {
			return await ext.mod[hook]?.(...args);
		} catch (error) {
			logger.warn(`扩展 ${ext.id}.${hook} 出错：${error?.message ?? error}`);
			return undefined;
		}
	};

	return {
		list: loaded.map(({ id, name }) => ({ id, name })),
		async persona(chat) {
			for (const ext of loaded) {
				const card = await safe(ext, "persona", [chat]);
				if (card) return String(card);
			}
			return (await builtin.persona(chat)) || "";
		},
		async recall(chat, sender, text) {
			const parts = [];
			for (const ext of loaded) {
				const part = await safe(ext, "recall", [chat, sender, text]);
				if (part) parts.push(String(part));
			}
			return parts.join("\n");
		},
		async remember(chat, sender, text, reply) {
			for (const ext of loaded) await safe(ext, "remember", [chat, sender, text, reply]);
		},
		async dispose() {
			for (const ext of loaded) await safe(ext, "dispose", []);
		}
	};
}
