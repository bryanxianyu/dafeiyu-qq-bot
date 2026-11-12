# 在 macOS 运行大肥鱼

先按 [根目录 README 的步骤](../README.md#获取源码)获取双平台分支，然后在仓库根目录操作。需要 Node.js（22.x 至少 22.19，或 24 及以上）和 npm。依赖安装到 `macos/node_modules/`。

```sh
npm ci --prefix macos && node macos/start.mjs
```

后续从仓库根目录运行 `node macos/start.mjs` 即可启动。打开终端输出的控制台地址，在「账号与连接」选择同步过来的 DSH 聊天模型，或填写 DeepSeek API Key 并保留「使用默认模型」。填写主人 QQ 号。要在群里使用，再填写允许说话的群号。

QQ 聊天需要一个已登录机器人账号的正向 OneBot v11 WebSocket 服务。可用已有服务，或按下方步骤部署 NapCat。将地址和服务设置的 WebSocket Token 填入「外部 OneBot v11 地址」和「外部 OneBot Token」，保存配置。Token 留空会保留此前的配置。按 Ctrl+C 可退出控制台和它启动的 DSH。

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

已有 OneBot 服务可跳过本节。先启动 Docker Desktop，在终端运行 `docker compose version` 确认 Compose 可用。若终端找不到 `docker`，而 Docker Desktop 安装在默认位置，可在当前终端运行 `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`。下方命令都从仓库根目录执行。NapCat 镜像支持 Linux arm64 和 amd64，示例中的宿主机端口只绑定回环地址。[NapCat-Docker 官方说明](https://github.com/NapNeko/NapCat-Docker/blob/main/README.md)

首次部署时运行以下命令生成本机的 `macos/.env`。该文件已被 Git 忽略。已有文件时会沿用。

```sh
if [ ! -e macos/.env ]; then
  token="$(openssl rand -hex 24)" &&
    (umask 077; set -C; printf 'NAPCAT_WEBUI_TOKEN=%s\n' "$token" > macos/.env)
fi
docker compose --env-file macos/.env -f macos/compose.yaml up -d
```

如果 Docker Hub 无法拉取，使用同一个 `macos/.env` 和仓库锁定版本的 [NapCat GHCR 镜像](https://github.com/NapNeko/NapCatLinuxNodeLoader/pkgs/container/nodenapcat)。

```sh
docker compose --env-file macos/.env -f macos/compose.yaml -f macos/compose.ghcr.yaml up -d
```

1. 打开 [NapCat WebUI](http://127.0.0.1:6099/webui)。Docker Hub 镜像首次启动时用 `macos/.env` 里的 `NAPCAT_WEBUI_TOKEN` 初始化登录口令。使用 GHCR 镜像或已有 NapCat 配置时，以 `macos/data/config/webui.json` 中的 `token` 为准。容器初始化后可在本机用 `node -p "JSON.parse(require('fs').readFileSync('macos/data/config/webui.json','utf8')).token"` 查看。
2. 按 WebUI 提示，用登录了机器人账号的手机 QQ 扫码。
3. 在 NapCat 的网络配置中启用 OneBot v11 正向 WebSocket 服务器。若已有服务器，编辑它即可。容器内监听 `0.0.0.0:3001`，消息格式选择「数组」，为 WebSocket 设置独立的 Token。
4. 回到大肥鱼控制台，填 `ws://127.0.0.1:3001` 和上一步设置的 WebSocket Token。保存后，首页显示「大肥鱼在线」时，可用主人 QQ 私聊机器人发送 `/状态`。

查看日志时，把启动命令末尾的 `up -d` 换成 `logs -f napcat`。停止容器时换成 `down`。容器的 QQ 登录数据和 NapCat 配置保存在 `macos/data/`。确定可用镜像版本后，可以在 `macos/.env` 设置 `NAPCAT_TAG` 固定版本。
