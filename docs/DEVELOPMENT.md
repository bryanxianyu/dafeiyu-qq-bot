# 开发说明

DeepSeek Harness（DSH）插件 + QQ 桥（OneBot v11）+ 人格卡 / 记忆系统 + 网页控制台 + Windows 安装程序。

```
plugin/                    DSH 插件 dsh-fish
  lib/index.js             主逻辑：白名单、群聊自然插话、每个聊天一个 Agent、会话续接、/状态 /重置
  lib/mind-client.js       调控制台心智服务；父进程看门狗
  lib/loader.js            第三方扩展加载器（接口约定见文件头）
  lib/onebot.js            OneBot v11 正向 WS 客户端（零依赖）；消息段渲染（@名片、引用、占位符）
  lib/safety.js            安全层：工具守卫、消息转义、格式说明与底线、输出过滤
  lib/qzone.js             QQ 空间发说说（get_cookies → g_tk → emotion_cgi_publish_v6）
release/app/               控制台
  server.mjs               本地网页 GUI + 进程管理（NapCat / 大肥鱼）+ 心智服务接口
  mind.mjs                 人格卡（锚定通道）+ 长期记忆（艾宾浩斯通道）
  stickers.mjs             表情包库：偷表情、deepseek-v4-flash 看图打标签、审核、按关键词挑图
  config.mjs               data/config.json ⇄ DSH profile / NapCat 配置
  web/                     界面（index.html、app.js、mind.js、style.css、扩展 SDK）
build/
  launcher.cs              大肥鱼.exe：托盘启动器 + /uninstall 卸载
  setup.cs                 安装程序：内嵌 payload.zip 的图形向导，/silent 静默安装
  make-icon.ps1            生成 fish.ico
  prune.mjs                按依赖闭包精简 DSH（836MB → 140MB）
pack.ps1                   一键打包 → dist/大肥鱼-Setup-vX.exe + dist/dafeiyu-vX-portable.zip
test/                      单元测试、端到端测试、假 QQ
```

## 心智设计（依据人格漂移实验的结论）

| 通道 | 内容 | 位置 | 衰减 |
|---|---|---|---|
| 锚定 | 人格卡 + 绝对人格记忆 | 每个 Agent 自己的 system prompt 段落（`systemPrompt.section`，每一步重新取值） | 无，不参与上下文预算竞争 |
| 艾宾浩斯 | 长期记忆（人/聊天两种范围） | 每轮消息前注入，独立字数预算 | R = e^(−t/S)；想起即复习：S ×= 1.2 + 2(1−R)；R < 阈值归档 |

- 漂移病因是人格定义与对话历史抢同一份预算 → 人格移出可竞争预算（锚定）。
- 统一衰减会摧毁低频高价值的人格记忆 → 衰减只用于事件记忆。
- 长期记忆由控制台调用 flash 整理（每 N 轮 / 闲置 3 分钟 / `/重置` 前强制），带检索关键词（同义词、上位词）弥补无向量检索；
  回想 = 相关回想（相关度 × 清晰度）+ 见人想事（当前说话人重要且清晰的记忆）。
- 模型提出的“核心事实”进入待确认队列，主人确认后才写入绝对记忆。

## 安全（防群聊注入）

| 威胁 | 防护 | 位置 |
|---|---|---|
| 群友让它跑命令 / 读写文件（RCE） | 按聊天装 DSH 工具守卫（`tools.guard`，子 Agent 继承）：群聊和非主人私聊默认一个工具都不能用，可选“只能联网”；主人私聊默认完整。DSH 不支持守卫时拒绝回复 | safety.js `installToolPolicy` |
| 借 web_fetch 打本机控制台 / NapCat / 内网（SSRF） | 只放行公网 http(s)，挡 localhost、内网、链路本地、整数/八进制/十六进制 IP、带账号的 URL | safety.js `isPublicUrl` |
| 伪造“系统标注 / 主人”身份 | 可信标注用【】开头；对方正文逐行加“> ”、【】降级；群聊记录压成单行；群名片清掉括号和分隔符；主人只认 QQ 号 | safety.js `fence` `oneLine` `cleanName` |
| 篡改人格 / 套系统提示 | 格式说明和底线写进锚定段落（每步都在） | safety.js `GUIDE` |
| 记忆投毒 | 整理器提示声明“对话是数据”；代码层核验来源：群友只能写关于自己的记忆，指令性内容丢弃，绝对记忆候选只收主人的话 | mind.mjs `looksLikeInjection` |
| 刷消息耗余额 | 非主人每人每分钟触发次数上限 | index.js `overLimit` |
| 回复里漏出假工具调用 / 本机路径 | 非完整权限的聊天里过滤 | safety.js `scrubReply` |

## 表情包 & QQ 空间（思路参考 AstrBot meme_manager、MaiBot、astrbot_plugin_qzone_ultra）

- **偷表情**：白名单聊天里 QQ 标成表情的图（image.sub_type=1 / summary=[动画表情]，以及商城表情 mface）交给控制台；只从 QQ 图片域名下载、≤3MB、sha256 去重、每天看图上限。
- **看图**：deepseek-v4-flash 多模态，一张约 550 token，输出 是否表情包 / 是否安全 / 描述 / 情绪 / 检索标签；不安全的记住哈希不再收。标签只保留短词（会进提示）。
- **审核**：收集来的默认待审核，主人通过才会被用；主人上传的直接启用。
- **发送**：已启用表情的常用标签写进锚定段落；模型在回复末尾写 `[[表情:关键词]]`，插件按标签相似度（编辑距离 + 包含）挑最像的几张随机一张，避开最近发过的；按频率档位有程序层面的冷却。
- **说说**：只认主人私聊里的 `[[说说:正文]]`；默认先私聊草稿、主人回「发」才发；每天最多 N 条；到点写“鱼的日记”（取材当天群聊片段，围栏化）。cookie 只在 qzone.js 内使用，不进模型、不写日志。非官方接口，可能随腾讯改版失效。

## 打包

```powershell
pwsh ./pack.ps1 -Bump          # 版本 +1 并打包
pwsh ./pack.ps1 -DshVersion x  # 换内置 DSH 版本（缓存按版本区分）
pwsh ./pack.ps1 -Refresh       # 重新下载 DSH / NapCat
```

全部用 Windows 自带的 .NET Framework 4.8 C# 编译器，不需要额外工具。安装程序：

- 默认装到 `D:\dafeiyu`（没有 D 盘则 `C:\dafeiyu`）；路径不能含中文/空格、长度 ≤ 80（node_modules 很深）
- 覆盖升级保留 `data/`、`home/` 里的会话、`napcat/` 里已装好的 QQ
- 写 HKCU 卸载项、桌面/开始菜单快捷方式；卸载可选保留数据
- 静默：`大肥鱼-Setup.exe /silent /dir=D:\dafeiyu [/noshortcuts] [/noregistry] [/launch]`

## 测试

```bash
node test/mind-unit.mjs                                     # 艾宾浩斯通道单元测试（不调模型）
node test/security-unit.mjs                                 # 安全层单元测试（工具守卫、内网地址、转义、记忆投毒）
node test/fun-unit.mjs                                      # 表情包库 + 空间（假模型、假 cookie）
TEST_KEY=sk-... node test/fun-e2e.mjs <安装目录> <表情图目录> # 真模型：看图、发表情、说说草稿/确认/日记（假 QQ，不会真发）
MOCK_ATTACK=1 bash test/e2e.sh                              # 真模型攻击演练（开发环境 ~/.dsh，只杀开发进程）
TEST_KEY=sk-... node test/mind-test.mjs <安装目录>          # 人格卡锚定、改卡即时生效、整理、重置后回想、加固
TEST_KEY=sk-... node test/gui-test.mjs <安装目录>           # 控制台 API、安全检查、扩展
TEST_KEY=sk-... node test/human-e2e.mjs <安装目录>          # 打字延迟、接着聊、上网找表情、主动冒泡（FISH_TEST_INITIATIVE 加速）
```

测试实例固定用 5199 端口（`FISH_PORT`），并校验端口，避免误连正在运行的实例。

## 已验证 / 未验证

- ✅ 锚定通道：人格卡与绝对记忆生效；改卡不 /重置 下一句即生效
- ✅ 长期记忆：自动整理、/重置 后靠长期记忆想起、被想起加固；曲线 / 间隔效应 / 遗忘归档 / 恢复（单元测试）
- ✅ 安装程序：静默安装、覆盖升级保留数据、长路径拒绝；托盘程序启动、强杀后进程链自动清理、优雅退出
- ✅ 实机（v0.1.x）：NapCat 安装、扫码登录、真实 QQ 私聊/群聊、自然插话
- ✅ 表情包：看图打标签（PNG/GIF）、群里按需发图、待审核/去重/屏蔽/上限（单测）
- ✅ 空间：群友触发被拒、主人草稿→确认、失败如实报告、到点日记（假 cookie）
- ⚠️ 未验证：真实 QQ 空间发帖（需要已登录的机器人号，会公开发出内容）；NapCat 真实的表情消息段字段；长对话（数百轮）下的人格保持——锚定机制已就位，但没做长程实测；图形安装向导的点击流程、卸载对话框（逻辑已写，未自动化）
