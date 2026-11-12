# Windows 与 macOS 重构方案

两个平台共用一个产品分支和一份 GUI、人格卡、记忆、表情与 QQ 消息逻辑。本次在短期分支 `refactor/macos` 集成，完成下列验收后合入 `main`。Windows 打包和 macOS 启动分别发布，避免长期维护两个逐渐分叉的分支。

| 边界 | 位置 | 约定 |
|---|---|---|
| 养鱼核心 | `plugin/`、`release/app/` | 共用 DSH 插件、正向 OneBot 客户端、控制台 API 和数据格式 |
| Windows | `windows/` | 管理安装包、托盘、内置 NapCat 和依赖精简；安装包继续使用原有目录结构和升级路径 |
| macOS | `macos/` | 用本机 Node 启动控制台和完整 DSH，外部 OneBot 独立运行，用户数据与源码分开 |

## 1. 拆分平台与跑通开发版

Windows 的新入口是 `pwsh ./windows/pack.ps1`。Windows NapCat 的安装、PowerShell 进程探测、二维码文件及 WebSocket 配置写入由 Windows 模块管理。打包时将模块放入原安装布局，C# 托盘仍启动 `app/server.mjs`。

macOS 从 `node macos/start.mjs` 启动。入口默认在仓库的 `macos/data/runtime/` 准备独立的 `fish` profile，也可以通过 `FISH_RUNTIME_DIR` 指定其他位置。控制台用本机 Node 启动 DSH 子进程，关闭时结束对应进程组。默认从浏览器管理，NapCat 登录由外部 OneBot 服务负责。macOS 的 DSH 依赖使用 npm 锁文件，避免沿用只保留 `win32-x64` 二进制的 Windows 裁剪脚本。

## 2. 完成真实环境验收

| 场景 | 通过条件 |
|---|---|
| Windows 回归 | Windows 10/11 构建安装包与便携版，验证新装、覆盖安装、托盘启动、扫码与停止，检查已有会话和记忆仍可读取 |
| macOS 基础 | Apple Silicon 下新装、启动、重启及 Ctrl+C 正常，浏览器能编辑人格与记忆，程序退出后 DSH 进程组结束 |
| macOS 真实 QQ | 容器扫码后用带 Token 的 OneBot 连接，验证私聊、群 @、`/状态`、表情收发、断线重连，重启控制台后可重新读取记忆 |
| 分发 | 新克隆运行 `npm ci --prefix macos` 可重现，验证 Node 22 与 24，能取得 Intel Mac 再验证 x64 |

## 3. 按需做 macOS 应用

源码版通过验收后，再决定是否提供菜单栏或 `.app`。先验证用 macOS 用户级 `launchd` 托管启动和停止，再评估是否要自带 Node。若面向他人发布安装包，单独处理签名、公证、升级和可写数据目录。

## 4. 模型适配与后续扩展

QQ 聊天、记忆提取与表情识别已可分别选择 DSH 模型及思考等级。两个平台通过共享控制台同步桌面版 DSH 的模型路由，Windows 用户也可在控制台配置 DeepSeek API Key。后续 B 站插件可先在单独的 DSH profile 验证加载、扫码和只读日报。
