# 日程域:每日状态板

[English](schedule.md) | 简体中文

> 职责、接口与关键规则;实现细节在代码与测试里。

## 职责与边界

回答"今天每件事是什么状态"。先登记事项、各自带一个有序状态词表;每个(事项, 日期)最多一条状态。

- **拥有**:事项登记(标题+有序词表)、每事项每天一条记录、含边界的日期范围查询、保存视图配置(筛选/排序/分组)、级联删除。
- **不拥有**:时间与时区、循环规则、提醒或任何时间触发动作、日历同步、自定义字段、通知、多用户。

## 核心概念

- 词表是封闭的:写入必须用该事项当前词表里的状态;顺序按约定从最好到最差(客户端可据此做颜色分级,文字始终是权威)。
- `(事项, 日期)` 是自然键:写入接口是幂等的 create-or-update——最后写入生效,无版本控制。
- 视图是保存的查询——只有筛选/排序/分组配置,绝不是记录的副本;服务端只校验和存储配置,从不解释它。
- 日期就是本地日历日(`YYYY-MM-DD`);本域任何地方不做时区转换。
- 删除事项在同一事务里移除其全部记录,并从所有保存视图的筛选里清掉它的 id。

## 接口

全部 JSON,默认在会话守卫之后;错误遵循服务端标准错误体,`errorCode` 取自本域封闭联合。

| 方法与路径                                        | 用途                                       |
| ------------------------------------------------- | ------------------------------------------ |
| `GET /api/schedule/items`                         | 按创建顺序列出事项,各带全库 `entryCount`   |
| `POST /api/schedule/items`                        | 登记 `{title, statuses}`;标题重复 409      |
| `PATCH /api/schedule/items/:id`                   | 改名和/或修订词表;至少一个字段             |
| `DELETE /api/schedule/items/:id`                  | 单事务级联;返回 `{deletedEntries}`         |
| `PUT /api/schedule/entries`                       | 幂等设置 `{itemId, date, status}`;返回整行 |
| `DELETE /api/schedule/entries/:id`                | 清除一条记录;id 不存在 404                 |
| `GET /api/schedule?from&to`                       | 含边界范围,结果完整,按日期再按 id 排序     |
| `GET/POST/PATCH/DELETE /api/schedule/views[/:id]` | 保存视图 CRUD                              |

## 关键规则

- 每个创建/更新/删除都是一次校验过的仓库事务写入——级联与视图筛选清理在同一事务里。
- 标题:trim 后 1–50 字符,精确匹配唯一;状态词:1–8 项,每项 trim 后 1–30 字符,词表内唯一。
- 仍被任何记录使用的状态不能移除或改名(409 `SCHEDULE_STATUS_IN_USE`)。
- 范围查询:`from`/`to` 必填、含边界、`from` ≤ `to`、跨度至多 366 天;无分页——响应在该范围内是完整的。
- 视图配置:`itemIds`/`statuses` 省略或为空表示不筛;列表内 OR,两列表间 AND;`sort: date|title`、`group: none|item|status`;未知字段拒绝。
- 错误码只存在于封闭联合——`SCHEDULE_ITEM_NOT_FOUND`、`SCHEDULE_ENTRY_NOT_FOUND`、`SCHEDULE_VIEW_NOT_FOUND`、`SCHEDULE_ITEM_DUPLICATE`、`SCHEDULE_STATUS_IN_USE`、`SCHEDULE_INVALID_ITEM`、`SCHEDULE_INVALID_DATE`、`SCHEDULE_INVALID_STATUS`、`SCHEDULE_INVALID_VIEW_CONFIG`——以及 web 客户端;别处没有。
