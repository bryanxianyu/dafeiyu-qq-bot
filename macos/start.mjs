import { constants, copyFileSync, cpSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("此入口用于 macOS，Windows 请使用 windows/pack.ps1");
const [major, minor] = process.versions.node.split(".").map(Number);
if (!(major >= 24 || (major === 22 && minor >= 19))) throw new Error("需要 Node.js 22.19+（22.x）或 24+");

const repo = resolve(import.meta.dirname, "..");
const runtime = resolve(process.env.FISH_RUNTIME_DIR || join(import.meta.dirname, "data", "runtime"));
const profile = join(runtime, "home", "profiles", "fish");
const modules = join(profile, "node_modules");
const dependencies = join(import.meta.dirname, "node_modules", "@deepseek-ai");
const scope = join(modules, "@deepseek-ai");
mkdirSync(runtime, { recursive: true, mode: 0o700 });
mkdirSync(modules, { recursive: true });
const installed = lstatSync(scope, { throwIfNoEntry: false });
if (!installed) symlinkSync(dependencies, scope, "dir");
else if (!installed.isSymbolicLink() || readlinkSync(scope) !== dependencies) {
	throw new Error(`fish profile 已关联其他工作目录：${scope}。请为当前工作目录设置单独的 FISH_RUNTIME_DIR。`);
}
try {
	copyFileSync(join(repo, "release", "profile", "package.json"), join(profile, "package.json"), constants.COPYFILE_EXCL);
} catch (error) {
	if (error.code !== "EEXIST") throw error;
}
// 保留插件自身的实际路径，使其能解析 profile 内的 DSH 依赖。
cpSync(join(repo, "plugin"), join(modules, "dsh-fish"), { recursive: true });

process.env.FISH_RUNTIME_DIR = runtime;
process.env.FISH_DSH_BIN = resolve(process.env.FISH_DSH_BIN || join(dependencies, "dsh", "lib", "bin.js"));
await import("../release/app/server.mjs");
