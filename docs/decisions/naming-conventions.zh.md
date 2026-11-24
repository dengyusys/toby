# 命名约定

[English](naming-conventions.md) | 简体中文

**一张地图,标明本项目每一层用什么命名写法。只有一行是 Toby 自己的
决定;其余各行沿袭各自语言生态的默认,记录在此免得每次重新推导。**

## 地图

| 层次                           | 写法            | 例子                                          |
| ------------------------------ | --------------- | --------------------------------------------- |
| HTTP JSON 字段,Toby 自有       | snake_case      | `turn_id`、`masked_key`、`income_total`       |
| HTTP JSON 字段,上游携带(pi-ai) | 上游原样        | `stopReason`、`toolCallId`、`content` 块      |
| SQL 表名与列名                 | snake_case      | `setting_key`、`credential_json`              |
| TypeScript 局部变量与函数      | camelCase       | `incomeTotal`、`formatCents`                  |
| TypeScript 类型与接口名        | PascalCase      | `AiSettingsView`、`LedgerTransactionRow`      |
| React prop 与 state(应用内部)  | camelCase       | `apiKey`、`onChange`                          |
| 环境变量、模块常量             | UPPER_SNAKE     | `TOBY_AI_MODEL`、`AGENT_HISTORY_MAX_CHARS`    |
| wire 字符串值:错误码           | SCREAMING_SNAKE | `SETTINGS_INVALID_MODEL`、`RATE_LIMITED`      |
| wire 字符串值:阶段/意图/状态   | 小写单词        | `request-failed`、`ledger`、`stored`\|`env`   |
| 文件名                         | kebab-case      | `settings-client.ts`、`naming-conventions.md` |

新名字的判断口诀:**它上不上 HTTP、进不进数据库?** Toby 自己取的名
→ snake_case;上游携带的值 → 一律不动;只活在 TypeScript 或 React 里
的 → camelCase;常量与环境变量 → 大写。

## 被决定的那一行:JSON 字段

每个 API 面上都汇合着两套词汇:

- **自有字段**——Toby 自己定名的——用 snake_case,与它们通常一对一
  镜像的 SQL 列名一致;
- **携带值**——上游拥有的形状,首要是 pi-ai 消息及其嵌套字段——保持
  上游拼写不动。零翻译回放是比任何大小写规则更强的契约:chat item
  与 trace 事件存取这些值都原样进行。

规则只约束 API 的 JSON:TypeScript 局部变量保持 camelCase,React prop
是应用内部 camelCase,环境变量 UPPER_SNAKE。两个世界只在一个点相遇
——camelCase 局部变量在边界处一次性变成 snake_case 键
(`incomeTotal` 以 `income_total` 返回)。

## 沿革

settings 域落地时自有字段用了 camelCase(`maskedKey`、
`chatHistoryHours`、`apiKey`、`latencyMs`),早于规则成文——而规则
条文当时住在 `docs/features/traces.md`,一个域的功能文档里,没人会
去那里找全局规则。2026-11-24,四个字段全部改名 snake_case,规则
迁到此处。

## 为什么硬切

单进程部署(`pnpm run start` 用同一份构建同时供页面和 API)加单一
自托管用户,意味着服务端与两个 web 永远一起上线——双名兼容层服务
不了任何人。存储数据不受影响:settings 落库的是标量行和 credential
JSON,字段名根本不进数据库。
