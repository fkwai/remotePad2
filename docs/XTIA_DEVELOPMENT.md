# RemotePad2 → xtia 开发交接

交接日期：2026-11-26。

## 仓库和工作位置

- 当前项目：[fkwai/remotePad2 的 dev 分支](https://github.com/fkwai/remotePad2/tree/dev)。GitHub 默认分支 main 是稳定版，开始开发时务必显式选择 dev。
- 之后在 **xtia** 上开发、构建和运行 Docker 环境测试。
- MacBook Air 只负责拉取完成的版本和运行客户端，不再作为开发或测试机器。
- Air 上的新项目路径是 `/Users/kuaifang/git/remotePad2`。`/Users/kuaifang/git/remotePad` 是旧版，不能混用。
- xtia 的实际登录方式、已有目录和 Docker 配置尚未在这次交接中核查；下面的 `~/work/remotePad2` 是建议的新检出位置。

如果 xtia 尚无检出，在 xtia 上执行：

```sh
mkdir -p ~/work
git clone --branch dev https://github.com/fkwai/remotePad2.git ~/work/remotePad2
cd ~/work/remotePad2
git status --short --branch
```

如果已有检出，先检查路径、分支和未提交修改，再做 fast-forward 更新，保留已有工作。

## 已完成并发布的内容

功能基线为 dev 的 `6eb0e4d`，交接说明本身以 dev 最新提交为准。

- 四个组件：左 Files Index、右 Sessions Index、中间上 Editor / 下 Terminal。面板可调整大小，布局按工作台 session 保存。
- 文件树、Favorites / Repos、文件搜索、隐藏文件开关、嵌套 sticky 目录、Explorer、编辑器和渲染分栏已实现。
- RemotePad2 名称按钮只管理工作台 session 及所在机器；旁边独立的 main/dev/nightly 按钮切版本。
- 右上角管理 SSH：配置别名、自定义常用机器、连接状态、连接/打开/断开/保存/删除图标。收藏按钮已为滚动条留位，长别名省略显示。
- SSH 连接在普通、可交互的本机 PTY 中真正执行打包、SSH 和准备命令，显示命令及原始输出，可输入密码确认和 Ctrl+C。连接成功后打开同通道的新浏览器 tab。
- SSH 隧道由私有 ControlMaster 持有。Disconnect 仅断该通道的转发，远端后端和 PTY 保留；删除收藏不会断开。
- 终端进程归后端所有。关闭网页不结束 shell；关闭终端 tab 才结束对应 shell；本机后端重启会结束它持有的本机 shell。
- Codex CLI 和本机 Codex App follower 已接入；agent 本身是外部运行时。App follower 依赖桌面 App 的本机 IPC，Linux 环境不要假设存在 Mac App。

CI 修复：[PR #1](https://github.com/fkwai/remotePad2/pull/1)，已合并到 dev。
Linux Bash 的 Ctrl+C 曾在 EXIT trap 中被记成成功 0，现已显式处理 INT/TERM 为 130/143，测试还验证取消后 shell 可继续用。
全新环境的 session 数量断言也已兼容 `1 session` 和复数。

已核对的云端结果：

- [dev CI：构建 + 16 单元测试 + 16 浏览器测试 + 3 gateway 测试通过](https://github.com/fkwai/remotePad2/actions/runs/45117521570)。
- [2026-11-26 Nightly 成功发布](https://github.com/fkwai/remotePad2/actions/runs/45762278512)，对应 `nightly` 提交 `287d4a4`，来源 dev `6eb0e4d`。
- nightly/main 的本机运行实例可能仍是旧版本。源码、已发布分支和正在运行的进程是三种状态，分别检查。

旧版 [fkwai/remotePad](https://github.com/fkwai/remotePad/tree/dev) 的本地 dev 曾有 4 个未推送提交，这次一并保存到它自己的 dev 分支，最后一个为 `a54d0db`。它可以作为旧 UI 行为和历史架构参考，后续新开发在 RemotePad2。

## 当前技术和文件入口

后端仍然是 TypeScript/Node，**没有完成 Go 迁移**。

| 内容 | 入口 |
| --- | --- |
| 产品约定 | `AGENTS.md`、`README.md` |
| 浏览器布局、终端和编辑器组装 | `apps/web/src/main.ts` |
| 文件树 / Explorer / Editor | `apps/web/src/components/files.ts`、`folder.ts`、`editor.ts` |
| 版本 / session 菜单 | `apps/web/src/components/workspaces.ts` |
| SSH 管理界面 | `apps/web/src/components/connections.ts` |
| 服务入口、HTTP / WS | `apps/server/src/index.ts` |
| PTY 与 shell 生命周期 | `apps/server/src/terminal.ts` |
| SSH 脚本、ControlMaster、状态 | `apps/server/src/ssh.ts`、`ssh-routes.ts` |
| SSH 配置别名 / 常用列表 / 通道隔离 | `ssh-hosts.ts`、`ssh-machines.ts`、`ssh-runtime.ts`（server src 下） |
| 文件读写、预览、搜索 | `apps/server/src/files.ts`、`search.ts`、`preview-access.ts` |
| Codex CLI 元数据 / App follower | `apps/server/src/codex.ts`、`codex-app.ts` |
| API / WS 共享类型 | `packages/protocol/src/index.ts` |
| 单入口和通道进程 | `apps/server/src/gateway.ts`、`lanes.ts`、`lane-cli.ts` |
| CI / nightly | `.github/workflows/ci.yml`、`nightly.yml` |
| 测试 | `tests/*.test.ts`、`tests/e2e/`、`playwright.config.ts` |

运行状态属于机器本身，不随 Git 同步：`~/.remotepad2/` 下的窗口、收藏、SSH 机器和 socket/log；`~/.ssh/` 的密钥与配置；`~/.codex/` 的聊天与凭据。开发测试使用独立 HOME，不把这些个人数据当测试素材或提交到仓库。

## 在 xtia 验证

当前要求 Node.js 22+，固定 pnpm `10.15.0`（见 package.json）。
以下命令仅在 xtia 的开发检出或其独立测试容器里执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm test:gateway
```

浏览器测试会启动临时后端，默认 6220。`E2E_PORT`、`E2E_WORK_ROOT` 可分别指定端口和干净测试目录。两个浏览器套件并行运行时，两者都要区分，防止共享 HOME、窗口状态或 trace 输出。单元测试临时目录可用 `REMOTEPAD2_TEST_TMP` 指定。

Docker 测试环境需要在 xtia 新建，仓库目前没有专用 Dockerfile/Compose 矩阵。开始时：

1. 先确认 xtia 自己现有的容器和端口，使用独立的 RemotePad 项目名、目录和 volume。
2. 在容器中做新的 Git 检出，安装 Linux 依赖；不要复用 Air 的 node_modules 或本机运行目录。
3. 首先复现现有 Ubuntu/Node 22/Bash 的 CI，然后扩展 Debian、不同 Node/Bash 版本；Alpine/musl 及其他 CPU 是后续待验证环境，尚未承诺支持。
4. 覆盖文件/API/WS、真实 PTY 输入和尺寸、Ctrl+C 及取消、关闭浏览器后重连、关闭 tab 的生命周期、SSH 错误和断开重连。
5. SSH 常规测试使用测试专属容器和密钥；真实云端 SSH 测试只操作自己建立的转发与临时 shell。

当前服务器/gateway 只绑定 loopback，且没有账号系统。Docker 测试与交互预览都保持私有；不要为了远程预览直接改成公网 `0.0.0.0`。生产/使用入口仍是一套 gateway 的 6020，带 `/main/`、`/dev/`、`/nightly/`；可选 Vite 是 6021。测试端口与产品入口分开，别为每个分支增加公共预览入口。

## 开发、发布与 Air 更新

- xtia 做代码和 Docker 测试；功能分支/PR 以 dev 为目标。CI 通过后，开发 agent 可以直接合入 dev，不需要逐次再问用户。
- main 的发布需要用户明确要求；nightly 由 GitHub Actions 自动验证 dev 并发布，不依赖 Air 开机。
- 合并/push/pull 不代表运行后端已更新，也不授权重启现有进程。
- Air 上先 `git pull --ff-only origin dev`，只做安装/运行所需工作。当前 Node 版仍需要 Node/pnpm，现有 lane 启动器会在启动已停止的通道前安装和构建；“只下载 Go 二进制即可运行”还没有实现。
- `pnpm lanes status` 可以检查通道。更新后端需要明确的停止/启动操作；`pnpm lanes start dev` 不会替换已经运行的进程。重启前处理本机 shell 生命周期，不擅自结束用户 session。

## 下一阶段：Go 方向

用户希望前后端分工更清晰、远端后端部署更简单，已讨论机器侧服务使用 Go：

- 前端继续 JS/TS，Node 用于开发/打包；浏览器执行构建后的网页。
- Go 服务负责文件、PTY、HTTP/WS、SSH 等机器侧能力；按 OS/CPU 在 CI 预构建，远端连接时上传对应文件。
- 可进一步把构建后的网页嵌入本机 Go 程序，减少 Air 的部署依赖。

这是待落实的设计方向。这次交接没有启动重写。接手时先审计现有接口、状态归属、PTY 与进程恢复、原生依赖和 Codex App IPC，再提出逐步迁移顺序。Go 不会自动解决网络 RTT、前端点击延迟或浏览器交互问题；已有能力和数据格式要有清晰兼容路径。
