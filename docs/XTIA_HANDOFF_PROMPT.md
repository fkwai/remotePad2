# 在 xtia 开启下一段开发时，复制以下 prompt

> 2026-11-27 更新：用户已授权在本地独立 worktree 继续开发；最新约定见 [AGENTS.md](../AGENTS.md)。Linux Go 远端 worker 也已通过 PR #2 合入 dev。下方保留交接时的历史记录。

```text
请接手 RemotePad2，之后所有开发、构建和 Docker 环境测试都放在 xtia。
我的 MacBook Air 仅拉取已经开发好的东西并运行，不再当开发/测试机。

当前项目：https://github.com/fkwai/remotePad2
开发分支：dev（GitHub 默认 main 是稳定版，请不要检错分支）。
先阅读仓库 AGENTS.md 和 docs/XTIA_DEVELOPMENT.md，再核查 xtia 实际已有的检出、分支、未提交工作、容器和端口。没有检出时可放 ~/work/remotePad2；不要覆盖已有文件。不要到旧版 remotePad 仓库继续开发。

这是一个 terminal-first 网页工作台，可组合为 IDE / agent manager。
四个组件：Files Index 左、Sessions Index 右、Editor 中间上、Terminal 中间下；面板可调整，布局按工作台 session 记忆。
左上 RemotePad2 名称只管理 session 和所在机器，旁边 main/dev/nightly 标签才切版本。
右上是 SSH 管理：常用机器可增删、显示连接状态，连接/打开/断开/保存/删除用图标和 tooltip。长别名省略，收藏不能被滚动条遮住。
SSH 准备在真实本机 Terminal/PTY 里运行，显示实际命令和原始输出，可输入密码和 Ctrl+C。成功后新开同通道远程 tab。Disconnect 只断转发，远端后端和 shell 保留。
关闭浏览器不应结束 shell；关闭对应终端 tab 才结束 shell。本机后端重启会结束其持有的本机 shell，不能为了测试重启用户实例。
Agent 通过外部 CLI / Codex App follower 接入，RemotePad 不拥有 agent runtime；保持 CLI/App 会话同步已有逻辑，App follower 是本机 IPC，不能假设 Linux 有 Mac App。

前端、本地后端和 gateway 使用 TypeScript/Node。Linux amd64/arm64 SSH 目标优先使用 apps/worker 的 Go 二进制。客户端从 GitHub 下载 CI 已构建的 worker，目标机通过 SSH 接收并运行。Node fallback 和隔离 SSH 验证见 XTIA_DEVELOPMENT.md。

功能基线 dev 6eb0e4d；PR #1 已合并，修复 Linux Bash Ctrl+C 被 EXIT trap 写成 0：打包/连接脚本显式 trap INT/TERM 返回 130/143，测试还要求取消后 shell 可继续输入。另修复全新 HOME 下 1 session / sessions 的断言。
这个基线的 Ubuntu CI 已通过：构建、16 单元、16 浏览器、3 gateway 测试。2026-11-26 nightly 287d4a4 已成功发布。请以接手时最新 origin/dev 为准，不要回退到这些历史 SHA。

已有验证命令：pnpm install --frozen-lockfile；pnpm build；pnpm test；pnpm exec playwright install --with-deps chromium；pnpm test:e2e；pnpm test:gateway。
Node 22+，pnpm 固定 10.15.0。Docker 测试环境在 xtia 独立搭建，目前仓库没有专用 Docker/Compose 测试矩阵。先对齐现有 Ubuntu CI，再扩展其他环境。隔离 HOME、依赖、session、测试端口与输出目录；并行 E2E 同时区分 E2E_PORT 和 E2E_WORK_ROOT。不要挪用/停止 CatsCo 服务或复用 Air 的 node_modules、真实密钥、聊天数据库作为测试素材。

产品入口保留 6020 的 gateway 和 /main/、/dev/、/nightly/；可选 Vite 6021，E2E 默认 6220。当前无账号系统、只绑定 loopback，远程预览和 Docker 测试保持私有，不直接暴露公网。
后续开发改动 CI 绿后可以直接合入 dev，不必每次让我再确认；main 发布要我明确要求。代码合并/拉取与重启运行实例分开，不要擅自结束已有 shell。

旧版仅供参考：https://github.com/fkwai/remotePad/tree/dev 。这次交接已把 Air 上老版残留的 4 个本地提交推送到老版 dev，最新 a54d0db。
现在先确认你在 xtia，读交接文档并报告已核实的开发状态，然后根据我接下来的具体任务继续。不要依赖 Air 上这个聊天的上下文。
```
