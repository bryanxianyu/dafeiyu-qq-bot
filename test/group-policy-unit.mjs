import assert from "node:assert/strict";
import { shouldPeek } from "../plugin/lib/group-policy.js";

const config = { groupMode: "natural", groupCooldown: 60, groupChattiness: 0.1 };
const state = { lastSpoke: 100_000, engagedUntil: 250_000 };
assert.equal(shouldPeek(state, "你好", true, config, 130_000), false);
assert.equal(shouldPeek(state, "你好", false, config, 130_000), false);
assert.equal(shouldPeek(state, "你好", true, config, 160_001), true);
assert.equal(shouldPeek(state, "你好", false, config, 160_001), true);
assert.equal(shouldPeek(state, "你好", false, config, 300_000, () => 0.5), false);
console.log("群聊普通发言冷却与连续对话判断通过");
