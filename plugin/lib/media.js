import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_PRIVATE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PRIVATE_FILE_BYTES = 10 * 1024 * 1024;

const QQ_MEDIA_SUFFIXES = ["qq.com", "qq.com.cn", "qpic.cn", "gtimg.cn", "qlogo.cn", "tenpay.com"];
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".yaml", ".yml", ".xml", ".html", ".htm", ".log", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".sql", ".sh", ".bash", ".zsh", ".ps1", ".css", ".toml", ".ini", ".conf", ".properties"]);

export function sniffImage(data) {
	const buf = Buffer.from(data);
	if (buf.length < 12) return null;
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
	if (buf.toString("ascii", 0, 4) === "GIF8") return { mime: "image/gif", ext: "gif" };
	if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
	return null;
}

export function safeAttachmentName(value, fallback = "qq-file") {
	const name = String(value ?? "").replace(/[\\/\0-\x1f\x7f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
	return name || fallback;
}

export function isReadableTextFile(name, data, contentType = "") {
	const leaf = String(name ?? "");
	const dot = leaf.lastIndexOf(".");
	const extension = dot > leaf.lastIndexOf("/") ? leaf.slice(dot).toLowerCase() : "";
	const declaredText = /^text\//i.test(contentType) || /^(?:application\/(?:json|xml|yaml|x-yaml|javascript|x-ndjson))\b/i.test(contentType);
	if (extension && !TEXT_EXTENSIONS.has(extension) && !declaredText) return false;
	const bytes = Buffer.from(data);
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

function isPrivateAddress(address) {
	if (isIP(address) === 4) {
		const [a, b] = address.split(".").map(Number);
		return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
	}
	const value = address.toLowerCase();
	if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
	return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("ff");
}

export function isQqMediaUrl(raw) {
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password &&
			(!url.port || url.port === "80" || url.port === "443") &&
			QQ_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
	} catch {
		return false;
	}
}

/** Download only QQ media hosts, checking every redirect and bounding the body. */
export async function fetchQqMedia(raw, { maxBytes, timeoutMs = 15000, resolve = lookup } = {}) {
	let current = raw;
	for (let hop = 0; hop < 4; hop++) {
		if (!isQqMediaUrl(current)) throw new Error("媒体地址不是受支持的 QQ 域名");
		const url = new URL(current);
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
		if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("QQ 媒体地址解析到内网");
		const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
		if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
			current = new URL(response.headers.get("location"), url).href;
			continue;
		}
		if (!response.ok) throw new Error(`下载 QQ 媒体失败（HTTP ${response.status}）`);
		if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("文件超过大小上限");
		const chunks = [];
		let size = 0;
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > maxBytes) throw new Error("文件超过大小上限");
			chunks.push(chunk);
		}
		return { data: Buffer.concat(chunks), contentType: response.headers.get("content-type") ?? "" };
	}
	throw new Error("QQ 媒体重定向次数过多");
}

function inlineData(value, maxBytes) {
	if (typeof value !== "string" || !value.startsWith("base64://")) return null;
	const encoded = value.slice("base64://".length);
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
	const data = Buffer.from(encoded, "base64");
	if (data.length === 0 || data.length > maxBytes || data.toString("base64") !== encoded) return null;
	return data;
}

function rawBase64(value, maxBytes) {
	if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
	const data = Buffer.from(value, "base64");
	if (data.length === 0 || data.length > maxBytes || data.toString("base64") !== value) return null;
	return data;
}

async function resolveMedia(bot, segment, { action, maxBytes, userId, timeoutMs = 30000 }) {
	const data = segment?.data ?? {};
	for (const direct of [data.url, data.file]) {
		const inline = inlineData(direct, maxBytes);
		if (inline) return { data: inline, name: safeAttachmentName(data.name ?? data.file_name) };
	}
	const id = String(data.file_id ?? data.file ?? "");
	const candidates = [];
	for (const direct of [data.url, data.file]) if (isQqMediaUrl(direct)) candidates.push(direct);
	if (id && !isQqMediaUrl(id) && !id.startsWith("base64://")) {
		const lookups = action === "get_file" ? [{ file: id, type: "url" }, { file: id, type: "base64" }, { file: id }] : [{ file: id }];
		for (const params of lookups) {
			try {
				const result = await bot.call(action, params, timeoutMs);
				if (isQqMediaUrl(result?.url)) candidates.push(result.url);
				const responseBase64 = rawBase64(result?.base64, maxBytes);
				if (responseBase64) return { data: responseBase64, contentType: String(result.content_type ?? result.mime_type ?? ""), name: safeAttachmentName(result.file_name ?? result.name ?? data.name ?? data.file_name) };
				const inline = inlineData(result?.file, maxBytes);
				if (inline) return { data: inline, contentType: String(result.content_type ?? result.mime_type ?? ""), name: safeAttachmentName(result.file_name ?? result.name ?? data.name ?? data.file_name) };
				if (isQqMediaUrl(result?.url)) break;
			} catch {}
		}
		if (userId && data.file_id) {
			try {
				const result = await bot.call("get_private_file_url", { user_id: Number(userId), file_id: String(data.file_id) }, timeoutMs);
				if (isQqMediaUrl(result?.url)) candidates.push(result.url);
			} catch {}
		}
	}
	let lastError;
	for (const url of [...new Set(candidates)]) {
		try {
			const result = await fetchQqMedia(url, { maxBytes, timeoutMs });
			const metadata = action === "get_image" ? sniffImage(result.data) : null;
			if (action === "get_image" && !metadata) throw new Error("下载内容不是支持的图片");
			return {
				data: result.data,
				contentType: result.contentType,
				mime: metadata?.mime,
				name: safeAttachmentName(data.name ?? data.file_name ?? (metadata ? `qq-image.${metadata.ext}` : "qq-file"))
			};
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? new Error("OneBot 没有提供可下载的 QQ 媒体链接");
}

export function downloadPrivateImage(bot, segment, userId) {
	return resolveMedia(bot, segment, { action: "get_image", maxBytes: MAX_PRIVATE_IMAGE_BYTES, userId });
}

export function downloadPrivateFile(bot, segment, userId) {
	return resolveMedia(bot, segment, { action: "get_file", maxBytes: MAX_PRIVATE_FILE_BYTES, userId });
}
