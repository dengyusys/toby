# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢参与 Toby 的开发。这是单人项目——改动以直接 push 进 `main` 落地,门禁是本地检查全绿。动手前请花两分钟读完本文。

## 开发环境

- Node.js `22.23.2`(`.nvmrc` 已固定)
- pnpm `11.18.0`(`corepack enable` 自动启用)
- 命令均在仓库根目录执行

## 本地起步

```bash
pnpm install
pnpm run dev      # 开发环境:server 8629 + web 8630 + web-mobile 8631
```

## 提交前检查

| 命令                 | 干什么                                                       |
| -------------------- | ------------------------------------------------------------ |
| `pnpm run check`     | 全量检查:typecheck / lint / format / test,提交前跑这一个就够 |
| `pnpm run typecheck` | 仅类型检查                                                   |
| `pnpm run lint`      | 仅 ESLint(代码质量规则)                                      |
| `pnpm run test`      | 仅测试(各包 + 根 HTTP 集成与边界测试)                        |

「改了什么就跑什么」的对照表见 [AGENTS.zh.md](AGENTS.zh.md)。

## 提交规范

- **英文 Conventional Commits**,scope 用英文包名或域名:

```text
feat(schedule): add month view
fix(web-mobile): fix drawer swipe on iOS
docs(architecture): add system overview
chore(deps): bump dependencies
```

- 常用 type:`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `ci` / `build`
- 常用 scope:`server` / `web` / `web-mobile` / `contract` / `ui` / `repo` / `tooling` / `deps`
- 提交信息只留一行标题:不写正文段落,不加 Co-Authored-By 之类尾注。
- commit-msg 钩子会校验格式,不合规则无法提交。

## 分支与落地

- 改动直接 push 进 `main`:推之前先跑 `pnpm run check`,必须全绿。CI 在 push 到 `main` 与每次 PR 后跑同样四项检查,作为事后保险。
- 分支命名(本地实验用):`feat/<scope>-<主题>`、`fix/<主题>`、`chore/<主题>`、`docs/<主题>`,如 `feat/framework-server`。
- 仅有的 PR 是 dependabot 的依赖升级——过目后一键合并(或手工套用)。

## 更多规则

- 代码边界、数据纪律、测试纪律:[AGENTS.zh.md](AGENTS.zh.md)([英文](AGENTS.md))
- 架构:[docs/system-overview.zh.md](docs/system-overview.zh.md);各域契约:[docs/features/](docs/features/)
