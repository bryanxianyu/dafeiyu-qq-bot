// 按依赖闭包裁剪 DSH 的 node_modules：只保留 fish profile 实际挂载的插件 + dsh 启动器 + 它们的依赖。
// 用法：node prune.mjs <node_modules> <dump-config.yml> [额外根包...]
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const [nm, dumpFile, ...extra] = process.argv.slice(2);
const pkgName = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const isBare = (spec) => !spec.startsWith(".") && !spec.startsWith("node:") && !spec.startsWith("/") && !/^[a-z]+:/.test(spec);

// 根：profile 里挂载的插件
const roots = new Set(extra);
for (const m of readFileSync(dumpFile, "utf8").matchAll(/^\s+name: '?([^'\s]+)'?/gm)) {
	if (isBare(m[1])) roots.add(pkgName(m[1]));
}
// 根：dsh 启动器自己 import 的包
const dshLib = join(nm, "@deepseek-ai/dsh/lib");
for (const f of readdirSync(dshLib).filter((f) => f.endsWith(".js"))) {
	const src = readFileSync(join(dshLib, f), "utf8");
	for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) if (isBare(m[1])) roots.add(pkgName(m[1]));
}
roots.add("@deepseek-ai/dsh");
roots.delete("dsh-fish");

const keep = new Set();
const queue = [...roots];
while (queue.length) {
	const name = queue.pop();
	if (keep.has(name)) continue;
	const pj = join(nm, name, "package.json");
	if (!existsSync(pj)) continue; // 可能是 node 内置或嵌套依赖
	keep.add(name);
	// 启动器把所有 bundle（含 Web 界面、Office 预览）都声明成依赖，只跟它真正 import 的包走
	if (name === "@deepseek-ai/dsh") continue;
	const pkg = JSON.parse(readFileSync(pj, "utf8"));
	for (const deps of [pkg.dependencies, pkg.optionalDependencies, pkg.peerDependencies]) {
		for (const dep of Object.keys(deps ?? {})) queue.push(dep);
	}
}

let removed = 0;
let freed = 0;
const size = (p) => {
	let s = 0;
	for (const e of readdirSync(p, { withFileTypes: true })) {
		const q = join(p, e.name);
		s += e.isDirectory() ? size(q) : statSync(q).size;
	}
	return s;
};
for (const entry of readdirSync(nm)) {
	if (entry.startsWith(".")) continue;
	const names = entry.startsWith("@") ? readdirSync(join(nm, entry)).map((n) => `${entry}/${n}`) : [entry];
	for (const name of names) {
		if (keep.has(name)) continue;
		const p = join(nm, name);
		freed += size(p);
		rmSync(p, { recursive: true, force: true });
		removed++;
	}
	if (entry.startsWith("@") && readdirSync(join(nm, entry)).length === 0) rmSync(join(nm, entry), { recursive: true });
}
// 瘦身：只留 win32-x64 预编译二进制；去掉 sourcemap 和类型声明
const slim = (dir) => {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === "prebuilds") {
				for (const plat of readdirSync(p)) {
					if (plat !== "win32-x64") {
						freed += size(join(p, plat));
						rmSync(join(p, plat), { recursive: true, force: true });
					}
				}
			} else {
				slim(p);
			}
		} else if (/\.(js|mjs|cjs)\.map$|\.d\.(ts|mts|cts)$/.test(e.name)) {
			freed += statSync(p).size;
			rmSync(p);
		}
	}
};
slim(nm);
console.log(`保留 ${keep.size} 个包，删除 ${removed} 个，共释放 ${(freed / 1048576).toFixed(0)} MB`);
