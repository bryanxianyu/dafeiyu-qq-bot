# 在 macOS 运行大肥鱼

在仓库根目录操作。需要 Node.js 22.19+（22.x）或 24+。QQ 聊天需要在 DSH 的 `fish` profile 中配置可用模型，以及能访问的正向 OneBot v11 WebSocket。

```sh
npm ci --prefix macos
node macos/start.mjs
```

打开终端输出的控制台地址，在「账号与连接」选择聊天模型，并填写主人 QQ 号、允许使用的群和外部 OneBot 地址。如果服务启用了 WebSocket Token，在同一页填写。Token 留空会保留此前的配置。按 Ctrl+C 可退出控制台和它启动的 DSH。

人格卡、记忆、表情、配置及 DSH 会话默认保存在仓库里的 `macos/data/runtime/`。这个目录已被 Git 忽略。需要自定义路径时，在启动命令前设置 `FISH_RUNTIME_DIR`，例如：

```sh
FISH_RUNTIME_DIR="$HOME/FishData" node macos/start.mjs
```

开发或测试时也可以用 `FISH_PORT` 指定独立端口，用 `--no-open` 跳过打开浏览器。

如果旧版曾将数据保存在 `~/Library/Application Support/DaFeiYu/`，先退出旧版控制台。在 `macos/data/runtime/` 尚未创建时，把整个旧目录移到该路径，再启动新版。若两个目录都已有数据，先备份并核对后再合并。

## 在 DSH 配置模型

大肥鱼读取它自己启动的 `fish` profile。默认 DSH Home 是 `macos/data/runtime/home/`，设置了 `FISH_RUNTIME_DIR` 时是该目录下的 `home/`。启动时会把 DSH 桌面版 `desktop` profile 中 `llm-pi-ai` 的模型路由合并进 fish profile 的 `cordis.patch.yml`。桌面版有 `.credentials.yaml` 时，fish profile 会使用该凭据文件。手动配置的 fish 路由优先于同名桌面路由。模型路由变更会自动同步，API 密钥不会复制到 fish profile。

默认桌面版 DSH Home 是 `~/.dsh`。如果 DSH 桌面版使用其他目录，可在启动前设置 `FISH_DESKTOP_DSH_HOME`。包含自定义请求头或内联 API Key 的桌面路由会被跳过，避免复制凭据；可改用 `apiKeyEnv` 引用 DSH 凭据存储。

下面以本机 Ollama 为例。在 `fish` 的 `cordis.patch.yml` 中加入以下配置。如果文件已存在，把供应商合并到已有的 `llm-pi-ai` 条目里。将 `your-local-model` 换成 Ollama 里已经加载的模型 ID。

```yaml
- id: llm-pi-ai
  config:
    providers:
      local-ollama:
        api: openai-completions
        baseURL: http://127.0.0.1:11434/v1
        apiKeyEnv: FISH_OLLAMA_KEY
        models:
          - id: your-local-model
```

额外的本地模型可继续加在 fish profile 的 `cordis.patch.yml` 中。对默认无需认证的本机 Ollama，可以用占位值启动：`FISH_OLLAMA_KEY=ollama node macos/start.mjs`。保存配置后，在大肥鱼的「账号与连接」点「刷新 DSH 模型」，选择 QQ 聊天、记忆整理和表情识别模型，再保存。记忆和视觉识别可跟随聊天模型；用于看图的模型需要声明图片输入，例如 `input: [text, image]`。

私聊图片会用选定的视觉模型识别，再把简短描述交给 QQ 聊天模型；图片最多 3 张、每张不超过 8MB。表情识别和私聊看图共用「每天最多看几张新图」额度。主人私聊收到的 UTF-8 文本文件会下载到 DSH 的 `home/attachments/`，作为只读附件交给 DSH `read` 工具；最多 2 个、每个不超过 10MB，且要求主人私聊工具权限为「完整」。PDF、Word、压缩包等二进制格式目前会提示不支持，不会交给模型假装读取。NapCat 必须能通过 `get_image` / `get_file` 或私聊文件 URL 动作提供媒体内容；只返回容器内路径时，大肥鱼无法在宿主机读取。

切换聊天模型会重启 QQ 工作进程并续接已有会话，切换记忆或视觉模型即时生效。旧版保存过的 DeepSeek Key 和聊天模型仍可作为兼容默认值，新配置交给 DSH 管理。联网搜索仍使用 DSH 中单独配置的搜索后端。

聊天、记忆和看图可分别选择思考等级。记忆和看图默认跟随聊天；若 DSH 没有提供聊天模型的具体默认等级，各自使用所选模型的默认值。可选等级由 DSH 的模型能力决定；手工添加的模型若没有声明推理等级，请先在 DSH 模型设置中配置，再刷新模型目录。不同模型的等级不兼容时，DSH 会报告错误，请为辅助模型选择它支持的等级或模型默认值。

用本机模拟 OneBot 和模型服务验证：`node macos/model-e2e.mjs`。测试使用独立临时目录，无需 QQ 账号或真实 API Key；覆盖 DSH 模型同步、QQ 模型切换、记忆整理、私聊图片识别、表情入审核库和文件附件读取路径。若要向 DSH 桌面版配置的模型逐个发送真实短请求，可运行 `node macos/model-smoke.mjs --run-real-model-requests`；该命令会发送固定提示词，最多生成 128 tokens，可能消耗模型额度。可用 `--models=provider/model,provider/model` 只测试指定模型。

## 用容器运行 NapCat

已有 OneBot 服务可跳过本节。Compose 示例需要已运行的 Docker 和 Compose。NapCat 官方镜像提供 Linux arm64 和 amd64 版本，端口在这个示例里只映射到本机回环地址。[NapCat-Docker 官方说明](https://github.com/NapNeko/NapCat-Docker)

1. 首次部署时，在 `macos/.env` 写入 `NAPCAT_WEBUI_TOKEN=你的随机长口令`。可用 `openssl rand -hex 24` 生成口令。`macos/.env` 已加入 Git 忽略规则。
2. 运行 `docker compose --env-file macos/.env -f macos/compose.yaml up -d`。打开 [NapCat WebUI](http://127.0.0.1:6099/webui)，使用上面的口令进入，按界面提示用机器人 QQ 扫码。
3. 在 NapCat 网络配置里确认已启用 OneBot v11 正向 WebSocket，容器内监听 `0.0.0.0:3001`，消息格式选数组，设置独立的 WebSocket Token。WebUI 口令和 WebSocket Token 分别用于登录管理界面和连接机器人。
4. 回到大肥鱼控制台，填 `ws://127.0.0.1:3001` 和上一步设置的 WebSocket Token。保存后，首页显示「在线」即可测试 QQ 中的 `/状态`。

查看日志时，把启动命令末尾的 `up -d` 换成 `logs -f napcat`。停止容器时换成 `down`。容器的 QQ 登录数据和 NapCat 配置保存在 `macos/data/`。确定可用镜像版本后，可以在 `macos/.env` 设置 `NAPCAT_TAG` 固定版本。

如果 Docker Hub 无法拉取，可叠加 `-f macos/compose.ghcr.yaml` 使用固定版本的 NapCat 官方 GHCR 镜像。例如：`docker compose --env-file macos/.env -f macos/compose.yaml -f macos/compose.ghcr.yaml up -d`。该镜像的 WebUI 令牌由自身生成，保存在 `macos/data/config/webui.json`；可以在项目根目录用 `node -p "JSON.parse(require('fs').readFileSync('macos/data/config/webui.json','utf8')).token"` 查看。首次使用时，在 WebUI 的网络配置中新建启用的 WebSocket 服务器，监听容器内 `0.0.0.0:3001`，设置 Token；宿主机端口仍只绑定 `127.0.0.1`。
