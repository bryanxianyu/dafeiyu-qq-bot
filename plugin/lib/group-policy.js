export function shouldPeek(state, text, isOwner, config, now = Date.now(), random = Math.random) {
	if (config.groupMode !== "natural") return false;
	if (now - state.lastSpoke < config.groupCooldown * 1000) return false;
	if (now < (state.engagedUntil ?? 0)) return true;
	if (isOwner) return true;
	if (/鱼/.test(text)) return true;
	const chance = /[?？吗呢]$/.test(text) ? config.groupChattiness * 2 : config.groupChattiness;
	return random() < chance;
}
