# 系统域（System）：走通骨架与运维探针

[English](system.md) | 简体中文

> 目标契约:随框架首笔落地,长期保留;实现细节以代码与测试为准。

## 职责与边界

服务端的第一个域:用最小的两个只读端点趟通"组合根 → 域自装配 → 挂载 → 路由 → 错误包络"整条链路,并为运维提供探针。业务域照它的三件套形状生长。

- **管**:`/api/system/health` 与 `/api/system/info` 两个端点。
- **不管**:任何业务数据、任何写入、任何状态存储;不触碰 `data/`。

## 核心概念

- `health` 是存活探针:Docker healthcheck 的探测目标,永远返回 `{"status":"ok"}`。
- `info` 是运行身份:版本、Node 版本、启动时间、运行时长——排查部署实例时第一眼看它。
- 域模板:`types.ts`(纯净)+ `router.ts` + `module.ts`(自装配),`main.ts` 加一行。

## 接口面

均为 JSON,只读,无参数;错误包络沿用 server 惯例。

| 方法与路径               | 用途                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `GET /api/system/health` | 存活探针,`200 {"status":"ok"}`                               |
| `GET /api/system/info`   | 运行身份:name / version / node / started_at / uptime_seconds |

## 关键规则

- 无状态:两个端点不读不写任何存储;`started_at` 是进程启动时刻。
- 所有响应 `Cache-Control: no-store`。
- 404/405 与全站同构:未知路径 `PAGE_NOT_FOUND`,方法不匹配 `METHOD_NOT_ALLOWED`。
- 端点路径长期稳定,Docker healthcheck 依赖它。
