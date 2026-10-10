# 为什么前端选这套技术栈

[English](web-stack.md) | 简体中文

## 核心思路

标准就一条:**生态主流、配置少,经得起两个应用各复制一份。**

## React + Vite

- **React 19**:生态最大,要什么有什么
- **Vite 6**:开发快、配置少,两个应用两份几乎一样的配置

不引入 Next 一类全栈框架:server 已经是 Fastify,前端只需要纯静态产物。

## Tailwind v4 + shadcn

- **Tailwind v4**:主题就是一份 CSS 变量,组件只消费语义令牌,不写裸色值
- **shadcn**:组件源码直接进仓库,不是 npm 依赖——**想改就改,不受上游版本牵制**

不选 MUI / AntD 一类组件库:定制主题要跟库的体系搏斗,包也大。

## 状态与路由

- **TanStack Query**:管服务端状态的缓存、失效与重试;提案确认后一次 `invalidateQueries`,各视图自动重取
- **react-router**(HashRouter):静态分发不需要 SPA fallback

## 测试

vitest + happy-dom + Testing Library:vitest 与 Vite 共用同一套解析,配置几乎为零;happy-dom 轻量,跑得快;测试从用户行为出发,不绑实现细节。

## 本仓库的约定

- 两个应用技术栈完全一致:React 19 + Vite 6 + Tailwind v4 + shadcn,差异只在形态
- 构建产物为纯静态 SPA,由 server 单进程分发
- 共享逻辑只进 `@toby/contract`;组件与样式不共享
