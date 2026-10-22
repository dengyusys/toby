# Toby

**自托管个人助手:AI 只提案,你确认,系统才写入。**

[English](README.md) | 简体中文

Toby 是自托管、单用户的个人助手,像一位贴身书童——帮你把日程、笔记和项目文件打理得井井有条。在一个对话框里用自然语言吩咐,AI 把你的话变成**结构化受限提案**,你核对后明确确认,服务端才执行确定性写入——确认之前,一个字节都不会落库。

> **当前阶段:框架搭建。** 骨架与服务端优先,功能逐步上线,见 [PLAN.md](PLAN.md)。

> **学习项目。** Toby 是学习用途的个人项目,用于动手实践自托管 AI 应用的完整构建;欢迎参考代码与文档。

## 快速开始

环境要求:Node.js `22.23.2`、pnpm `11.18.0`(`corepack enable`),命令均在仓库根目录执行。

```bash
pnpm install

pnpm run dev      # 开发模式:PC http://127.0.0.1:8630/ ,移动端 http://127.0.0.1:8631/m/ ,API 由 Vite 代理到 server
pnpm run start    # 生产模式:构建前端,单进程服务端同时提供页面与 API

# 或使用 Docker 部署
docker compose up -d --build
```

- AI 为可选:一句话记账路径需设置 `TOBY_AI_MODEL` 与对应供应商密钥(见 `.env.example`);其余功能无需 AI。

## 文档

- [docs/product-overview.md](docs/product-overview.md) —— 产品介绍(面向用户)
- [docs/system-overview.md](docs/system-overview.md) —— 系统架构
- [docs/features/](docs/features/) —— 各域目标契约
- [docs/decisions/](docs/decisions/) —— 架构决策记录(ADR)
- [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)([英文](CONTRIBUTING.md))—— 贡献指南
- [AGENTS.zh.md](AGENTS.zh.md)([英文](AGENTS.md))—— AI 编码代理工作规则
- [PLAN.md](PLAN.md) —— 框架搭建计划

## 许可证

[MIT](LICENSE)
