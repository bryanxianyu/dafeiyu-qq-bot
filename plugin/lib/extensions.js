/**
 * 内置的空扩展（兜底）。真正的人格卡 / 记忆系统请写成独立扩展放进 data/extensions/，
 * 接口说明见 loader.js，模板见 data/extensions/persona-template 与 memory-template。
 */
export async function persona(chat) {
	return "";
}

export async function recall(chat, sender, text) {
	return "";
}

export async function remember(chat, sender, text, reply) {}
