# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢参与 Toby 的开发。本项目走规范的 PR 工作流,动手前请花两分钟读完本文。

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

| 命令 | 干什么 |
| --- | --- |
| `pnpm run check` | 全量检查:typecheck / lint / format / test,提交前跑这一个就够 |
| `pnpm run typecheck` | 仅类型检查 |
| `pnpm run lint` | 仅 ESLint(含域边界纪律) |
| `pnpm run test` | 仅测试(各包 + 根 HTTP 集成测试) |

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
- commit-msg 钩子会校验格式,不合规则无法提交。

## 分支与 PR

- `main` 受保护:一切改动走 PR,四项 CI 检查(lint / typecheck / test / docker)全绿后 **squash 合并**;PR 标题即最终提交信息,遵循上面的提交规范。
- 分支命名:`feat/<scope>-<主题>`、`fix/<主题>`、`chore/<主题>`、`docs/<主题>`,如 `feat/framework-server`。
- PR 请按模板填写:变更说明、契约影响(改了哪份 `docs/features/*.md`)、验证清单。
- 缺陷与新功能先开 Issue(bug / feature 模板),PR 关联对应 Issue。

## 更多规则

- 代码边界、数据纪律、测试纪律:[AGENTS.zh.md](AGENTS.zh.md)([英文](AGENTS.md))
- 架构与各域契约:[docs/README.md](docs/README.md)
