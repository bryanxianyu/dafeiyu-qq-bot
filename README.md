# 🐟 养大肥鱼

大肥鱼是 QQ 里有自己人格和记忆的 AI 群友，会斗图、会自己冒泡。聊天模型可以在 DSH 中配置。

基于 [DeepSeek Harness（DSH）](https://www.npmjs.com/package/@deepseek-ai/dsh) 和 [NapCat](https://github.com/NapNeko/NapCatQQ)（OneBot v11）。Windows 使用安装包，macOS 可从源码运行。两个平台共用本机网页控制台、人格卡和长期记忆。

## 它能做什么

- **像群友一样聊天**：潜水看群，有梗就接；被 @ 一定回；刚聊完时大家接着说的话都会看。回复按字数“打字”、分几条发，不秒回、不乱引用。
- **主动冒泡**：群里安静一阵子后自己说点什么——接之前的话题、吐槽、问问熟人、发个表情包。只在白天，次数有上限，可调可关。
- **人格卡**：身份、性格、说话风格、底线、示例对话，常驻系统提示不漂移。自带温和的「大肥鱼」和毒舌的「贴吧老哥」两套，每个群/私聊可以用不同人格，网页一键切换或 QQ 里发 `/切换人格`。
- **长期记忆**：自动从聊天里整理要紧事，按艾宾浩斯遗忘曲线慢慢淡忘，被想起就记得更牢；核心事实经主人确认后永久记住。
- **表情包**：偷群里的表情包，用 DSH 中选定的视觉模型看图打标签；聊天时按情绪挑图；库里没有合适的就上网搜（必应安全搜索 + 看图把关）。
- **私聊看图和读文件**：识别私聊图片与表情包；主人发来的文件会作为 DSH 只读附件提供给文件工具，权限不足或 NapCat 未提供下载内容时会明确说明。
- **QQ 空间**：每天到点写一条“鱼的日记”，默认先私聊给主人确认再发。
- **防注入**：群友发来的东西一律当聊天内容；群聊里不能跑命令、碰文件；伪造“系统提示/主人”无效；记忆不收指令性内容。权限由程序强制，不靠模型自觉。
- **网页控制台**：可查看运行状态和今日统计，编辑人格、记忆、表情库和安全权限。Windows 的内置 QQ 可以扫码登录，macOS 在 OneBot 服务提供的界面登录。

## 快速开始

### 获取源码

双平台版本目前在 `refactor/macos` 分支。从终端执行以下命令，之后的安装命令都在进入的仓库根目录运行。

```sh
git clone --branch refactor/macos https://github.com/bryanxianyu/dafeiyu-qq-bot.git
cd dafeiyu-qq-bot
```

### Windows 从源码打包

需要 Windows 10/11 x64、[PowerShell 7](https://github.com/PowerShell/PowerShell) 和 x64 版 [Node.js](https://nodejs.org/)（22.x 至少 22.19，或 24 及以上）。确认终端能找到 `pwsh`、`node` 和 `npm`。打包会联网下载依赖，并调用 Windows 自带的 .NET Framework 64 位 C# 编译器。

```powershell
pwsh ./windows/pack.ps1
```

脚本会自动下载 DSH 和 NapCat 一键包，在仓库的 `dist\` 中生成 `大肥鱼-Setup-vX.exe` 和 `dafeiyu-vX-portable.zip`，其中 `vX` 为实际版本号。双击生成的安装程序并启动「大肥鱼」。安装包已包含 Node.js 和 DSH 运行时。

1. 在浏览器控制台打开「账号与连接」，填写主人 QQ 号。要在群里使用，再填写允许说话的群号。机器人 QQ 号可留空，填写后可用于下次自动登录。
2. 若已在同一台电脑的 DSH 桌面版配置模型，从「QQ 聊天」下拉框选择同步过来的模型。若没有配置 DSH 桌面版，可以填写 [DeepSeek API Key](https://platform.deepseek.com/api_keys)，并保留「使用默认模型」。保存配置。
3. 内置 NapCat 首次启动会联网下载 QQ 组件。用登录了机器人账号的手机 QQ 扫描控制台首页或托盘弹窗里的二维码。首页显示「大肥鱼在线」后，可以用主人 QQ 私聊机器人发送 `/状态`。

Windows 和 macOS 都会同步 DSH 桌面版的模型路由。Windows 安装目录下的 fish profile 配置位于 `home/profiles/fish/cordis.patch.yml`，也可在其中手动配置模型。聊天、记忆整理和表情看图可以分别选择模型和思考等级。参考 [fish profile 配置示例](macos/README.md#在-dsh-配置模型)。

### macOS 从源码运行

需要 [Node.js](https://nodejs.org/)（22.x 至少 22.19，或 24 及以上）。在仓库根目录运行以下命令。

```sh
npm ci --prefix macos && node macos/start.mjs
```

打开 [大肥鱼控制台](http://127.0.0.1:5140/)，在「账号与连接」选择 DSH 模型，或填写 DeepSeek API Key 并保留「使用默认模型」。填入主人 QQ 号和正向 OneBot v11 WebSocket 的地址及 Token，再保存。已有 OneBot 服务可直接使用。需要部署 NapCat 时，按 [macOS 部署指南](macos/README.md#用容器运行-napcat)启动容器、登录 QQ 并配置连接。

运行数据默认保存在仓库内的 `macos/data/runtime/`。如需使用其他位置，可在启动时设置 `FISH_RUNTIME_DIR`。

### QQ 里的命令

| 命令 | 说明 |
|---|---|
| `/人格` | 看当前人格和可选人格（主人） |
| `/切换人格`、`/人格 名字` | 切换这个群/私聊的人格（主人） |
| `/重置` | 换一缸新水：开始新对话，要紧的事已整理进长期记忆（群里只有主人能用） |
| `/状态` | 在线状态、模型、会话 |

主人私聊里还可以让它发说说，回「发」/「不发」确认草稿。

## ⚠️ 使用须知

- **QQ 账号风险**：NapCat 是非官方 QQ 协议实现，机器人号有被腾讯风控、限制甚至封号的可能。请用小号，不要用主号。
- **QQ 空间**：用的是网页版非官方接口，可能随腾讯改版失效；机器人号频繁自动发帖有风控风险，默认关闭。
- **费用**：模型调用按所选供应商计费。主动冒泡、看图打标签、上网找表情都会额外调用模型，控制台里都有用量上限。
- **内容责任**：人格卡（尤其是攻击性人格）由你自己编写和启用，请遵守群规和法律法规，别拿它去骚扰别人。
- **主人私聊的完整权限**：默认主人私聊可以让它在工作目录里读写文件、执行命令（DSH 沙箱，高危操作自动拒绝）。不需要的话在「安全」页调成「只聊天」。
- **私聊附件**：图片最多识别 3 张、每张最多 8MB；图片识别与表情打标共用「每天最多看几张新图」额度。文件最多读取 2 个、每个 10MB；当前支持 UTF-8 文本文件，读取只开放给主人私聊，并要求工具权限为「完整」。

## 项目结构

```
plugin/          DSH 插件 dsh-fish：QQ 桥、群聊行为、安全层、表情/空间动作
release/app/     控制台：网页 GUI、进程管理、人格卡与长期记忆、表情包库
windows/         Windows 打包、安装与托盘程序、内置 NapCat 管理、实机测试脚本
macos/           macOS 源码启动入口、锁定的 DSH 依赖、可选 NapCat Compose
test/            共用单元测试、假 QQ
docs/            开发说明（架构、心智设计、安全设计、测试）
```

技术细节见 [开发说明](docs/DEVELOPMENT.md)和 [macOS 重构方案](docs/MACOS-REFACTOR.md)。

## 测试

```powershell
node test/mind-unit.mjs        # 记忆系统
node test/security-unit.mjs    # 安全层：工具守卫、内网地址、转义、记忆投毒
node test/fun-unit.mjs         # 表情包库 + QQ 空间
```

端到端测试（真模型 + 假 QQ，不碰正在运行的实例）见开发说明。

## 致谢

- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)：Agent 运行时
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：OneBot v11 QQ 协议实现
- 表情包和 QQ 空间的思路参考了 [astrbot_plugin_meme_manager](https://github.com/anka-afk/astrbot_plugin_meme_manager)、[MaiBot](https://github.com/MaiM-with-u/MaiBot)、[astrbot_plugin_qzone_ultra](https://github.com/diaomin66/astrbot_plugin_qzone_ultra)

## 许可证

[MIT](LICENSE)。打包产物里内置的 DSH、NapCat、Node.js 各自遵循其原有许可证。
