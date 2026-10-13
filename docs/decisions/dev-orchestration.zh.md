# dev.js 为什么直接用 node 拉起子进程

[English](dev-orchestration.md) | 简体中文

## 核心思路

dev 编排器(`scripts/dev.js`)启动每个子进程的方式完全一致:**`spawn(process.execPath, [<工具 JS 入口路径>])`——用 node.exe 直接运行 `node_modules` 里的文件。** 绝不按名字 spawn `pnpm` / `vite`,绝不设 `shell: true`。

## 两大主流流派

以编程方式调用 workspace 工具,业界有两种成熟做法:

- **经由包管理器 / shell** —— `spawn("pnpm", ["--filter", "@toby/web", "dev"])` 或 `spawn("vite", { shell: true })`。`pnpm run` 自己就是这条路线(把命令行交给 shell,靠 PATH 找到 `node_modules/.bin` 垫片),`concurrently` 默认也是。方便、可移植——但 Windows 上进程链变成 `编排器 → cmd.exe → node → vite`,`kill()` 杀掉的是 cmd.exe 垫片,真正的服务端活成孤儿、继续占着端口。这一派的主流工具都要外挂进程树杀手(`tree-kill`、Windows Job Object)来补这个窟窿。
- **用 node 直跑** —— 解析工具的 bin 入口(vite 的 package.json `bin` 字段 → `bin/vite.js`),用 node 执行它。这正是 `child_process.fork()` 的机制,也是 nodemon 启动脚本、jest/vitest 拉 worker 的方式。

我们选第二派。"一次 Ctrl+C 全体退场、不留任何进程占用固定端口"是编排器的核心职责,第一派在 Windows 上不靠额外依赖做不到这一点。

## 为什么垫片即使碰得通也不该碰

`node_modules/.bin` 里的 `.cmd` / `.ps1` / 无扩展名垫片是**给 shell 的**接口(PATH 查找),不是给程序的。Unix 下无扩展名文件靠 `#!/usr/bin/env node` shebang 自解释;Windows 没有 shebang 机制,所以才需要 `.cmd` 包装。Node 修复 BatBadBut 漏洞(CVE-2024-27980,Node 18.20 / 20.12+)后,不带 `shell: true` 去 spawn `.cmd` / `.bat` 会直接报错——"直接 spawn 垫片"这条路不只是不稳,平台已经封死。

## 换来了什么

- Windows / macOS / Linux 一条代码路径,行为一致,零平台分支
- 信号与 `kill()` 直达真身——没有中间层吞信号
- 所有子进程与编排器共用同一个 node 可执行文件与版本(反正 `engines.node` 已钉死)
- 进程管理零额外依赖

## 代价与对策

- 编排器需要知道工具入口路径(`apps/*/node_modules/vite/bin/vite.js`)。路径由 vite 自己的 `bin` 字段钉住,启动前 `existsSync` 预检,缺失时明确报 "run pnpm install first" 而不是莫名的 ENOENT。
- 输出走管道后自动检测会关掉 ANSI 颜色——用 `FORCE_COLOR=1` 显式恢复。

## 本仓库的约定

- `scripts/` 里子进程只允许 `{ process.execPath, [JS 文件] }`;`shell: true` 在此禁用
- 根集成测试(`test/http-contract.integration.test.ts`)拉起服务端进程遵循同一模式
- 若引入编排类依赖(concurrently、tree-kill……),即与本决策冲突,须重新审视本 ADR
