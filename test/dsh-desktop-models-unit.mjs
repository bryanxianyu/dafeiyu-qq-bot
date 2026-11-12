import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "../macos/node_modules/yaml/dist/index.js";
import { loadDesktopModelImport, syncFishProfileModelRoutes } from "../release/app/dsh-desktop-models.mjs";

const root = mkdtempSync(join(tmpdir(), "fish-dsh-import-unit-"));
const desktopHome = join(root, "desktop-home");
const desktopProfile = join(desktopHome, "profiles", "desktop");
const fishProfile = join(root, "fish-home", "profiles", "fish");
const manifest = join(root, "data", "desktop-model-import.json");
const credentials = join(desktopHome, ".credentials.yaml");
mkdirSync(desktopProfile, { recursive: true });
mkdirSync(fishProfile, { recursive: true });
writeFileSync(credentials, "version: 1\nrefs: {}\nrecords: {}\n", { mode: 0o600 });
chmodSync(credentials, 0o600);
const desktopPatch = join(desktopProfile, "cordis.patch.yml");
const fishPatch = join(fishProfile, "cordis.patch.yml");
const originalFish = `- id: llm-pi-ai
  config:
    providers:
      fish-local:
        api: openai-completions
        baseURL: http://127.0.0.1:11434/v1
        models:
          - id: local-model
- id: fish-qq
  config:
    owners: [10001]
`;
writeFileSync(fishPatch, originalFish);

try {
	writeFileSync(desktopPatch, `- id: llm-pi-ai
  config:
    providers:
      fish-local:
        api: openai-completions
        baseURL: http://127.0.0.1:11435/v1
        models:
          - id: desktop-shadow
      openai:
        apiKeyEnv: OPENAI_API_KEY
        models:
          - id: gpt-6-luna
            input: [text, image]
      unsafe-gateway:
        headers:
          Authorization: Bearer super-secret-test-key
        api: openai-completions
        baseURL: https://gateway.example/v1
        models:
          - id: private-model
`);
	const first = loadDesktopModelImport(desktopHome, YAML);
	assert.deepEqual(first.providerIds, ["fish-local", "openai"]);
	assert.deepEqual(first.skipped, ["unsafe-gateway"]);
	assert.equal(first.credentialsPath, credentials);
	assert.equal(JSON.stringify(first).includes("super-secret-test-key"), false);
	syncFishProfileModelRoutes(fishProfile, first, manifest, YAML);
	let rows = YAML.parse(readFileSync(fishPatch, "utf8"));
	let providers = rows.find((row) => row.id === "llm-pi-ai").config.providers;
	assert.deepEqual(Object.keys(providers), ["fish-local", "openai"]);
	assert.equal(providers["fish-local"].models[0].id, "local-model");
	assert.equal(providers.openai.models[0].id, "gpt-6-luna");
	assert.deepEqual(rows.find((row) => row.id === "fish-qq").config.owners, [10001]);
	assert.equal(readFileSync(desktopPatch, "utf8").includes("super-secret-test-key"), true);
	assert.equal((readFileSync(fishPatch, "utf8")).includes("super-secret-test-key"), false);

	writeFileSync(desktopPatch, `- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GOOGLE_API_KEY
        models:
          - id: gemini-3.5-flash-lite
`);
	const second = loadDesktopModelImport(desktopHome, YAML);
	syncFishProfileModelRoutes(fishProfile, second, manifest, YAML);
	rows = YAML.parse(readFileSync(fishPatch, "utf8"));
	providers = rows.find((row) => row.id === "llm-pi-ai").config.providers;
	assert.deepEqual(Object.keys(providers), ["fish-local", "google"]);
	assert.deepEqual(rows.find((row) => row.id === "fish-qq").config.owners, [10001]);
	console.log("DSH 桌面模型导入、密钥过滤、fish 路由合并和移除同步通过");
} finally {
	rmSync(root, { recursive: true, force: true });
}
