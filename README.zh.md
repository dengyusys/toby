# Toby

**自托管个人助手:AI 只提案,你确认,系统才写入。**

[English](README.md) | 简体中文

Toby 是自托管、单用户的个人助手,像一位贴身书童——帮你把日程、笔记和项目文件打理得井井有条。在一个对话框里用自然语言吩咐,AI 把你的话变成**结构化受限提案**,你核对后明确确认,服务端才执行确定性写入——确认之前,一个字节都不会落库。

> **当前状态:框架搭建阶段。** 先立骨架(monorepo、服务端、CI、Docker),功能以经过 review 的 PR 逐步交付,见 [PLAN.md](PLAN.md)。

## 快速开始

环境要求:Node.js `22.23.2`、pnpm `11.18.0`(`corepack enable`),命令均在仓库根目录执行。

```bash
pnpm install

pnpm run dev      # 开发模式:PC http://127.0.0.1:8630/ ,移动端 http://127.0.0.1:8631/m/ ,API 由 Vite 代理到 server
pnpm run start    # 生产模式:构建前端,单进程服务端同时提供页面与 API

# 或使用 Docker 部署
docker compose up -d --build
```

- 框架阶段无需配置 AI 密钥;AI 提供商配置随对话域一起到来。
- 服务端默认只绑定 `127.0.0.1` —— 它属于你的机器,不对公网开放。

## 文档

- [docs/README.md](docs/README.md) —— 文档总入口
- [docs/product-overview.md](docs/product-overview.md) —— 定位、范围与路线图
- [docs/system-overview.md](docs/system-overview.md) —— 系统架构
- [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)([英文](CONTRIBUTING.md))—— 贡献指南
- [AGENTS.zh.md](AGENTS.zh.md)([英文](AGENTS.md))—— AI 编码代理工作规则
- [PLAN.md](PLAN.md) —— 框架搭建计划(审阅中)

## 许可证

[MIT](LICENSE)
