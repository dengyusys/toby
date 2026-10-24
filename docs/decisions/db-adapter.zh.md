# 数据库适配器设计

[English](db-adapter.md) | 简体中文

服务端通过一个自建的薄异步 port 访问数据库——**不用 ORM,不用查询构建器。** 各 domain 继续在自己的 `store.ts` 里手写 SQL;服务端说哪种方言——默认 SQLite,或经其适配器说 MySQL——是配置选择,不是代码选择。port 的数量是开放的:SQLite 和 MySQL 只是今天存在的适配器——第三种数据库加入时,实现同一个接口即可,其他都不用动。

**理由:我们需要的抽象很小,而 ORM 能卖给我们的那部分,在这个项目里不存在。**

连接、执行参数化语句、包一个事务,每个驱动大约百来行代码。难的部分——方言差异——无论如何都在:每个 domain 拥有自己的存储,查询本来就要手写。类型安全由 domain 自己维护:`store.ts` 里的 typed row interface 和 mapper。

与[服务端技术栈决策](nestjs-server-stack.zh.md)一致:推荐使用的数据库是 SQLite;MySQL 适配器出于作者的学习目的而存在——想亲身感受另一种方言接在同一个接口后面的样子。

## Port 接口

```ts
export type DbDialect = "sqlite" | "mysql";
export type DbParam = string | number | bigint | boolean | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export interface DbRunResult {
  changes: number; // sqlite `.changes` / mysql `affectedRows`
  insertId: number | null; // rowid / AUTO_INCREMENT;仅在 INSERT 后有意义
}

export interface DbOperations {
  exec(sql: string): Promise<void>; // 单条原始语句,无参数(DDL)
  query<Row = DbRow>(sql: string, params?: readonly DbParam[]): Promise<Row[]>;
  run(sql: string, params?: readonly DbParam[]): Promise<DbRunResult>;
}

export interface DomainDb extends DbOperations {
  readonly dialect: DbDialect;
  transaction<T>(body: (tx: DbOperations) => Promise<T>): Promise<T>; // resolve 则 commit,reject 则回滚
  close(): Promise<void>;
}
```

`Row` 刻意不加约束:写成 `<Row extends Record<string, unknown>>` 会拒绝调用方的 `interface` 行类型——interface 没有隐式索引签名。

## 设计约定

- **代码位置:** `infrastructure/db/` —— port 在 `types.ts`(零驱动导入)、错误映射在 `errors.ts`、每方言一个适配器(`sqlite/`、`mysql/`)、按域工厂 `createDomainDb(config, domain)` 在 `create-db.ts`、极简 `migrate.ts`。domain 的 `store.ts` 只导入 port 类型;domain 的 `types.ts` 保持纯净。
- **占位符只用位置 `?`。** 两个驱动都原生接受。禁用命名占位符和 `IN` 列表的数组绑定——`IN` 列表手工展开。
- **单一错误类型。** 适配器把驱动错误映射为一个 `DbError`,code 是封闭联合(`unique-violation | foreign-key-violation | constraint | syntax | busy | connection | unknown`),原始错误保留在 `cause`。原始驱动错误不越过 port。
- **每域一库,一如既往。** SQLite 方言:一个文件 `data/<domain>.db`。MySQL 方言:一个 schema `toby_<domain>`,启动时 `CREATE DATABASE IF NOT EXISTS … CHARACTER SET utf8mb4`。跨域永不共享数据库。
- **事务是一等公民**,因为提案管线的提交一步——重读目标、检查冲突、串行写入——恰好就是一个事务。
  - SQLite 适配器:手工 `BEGIN` / `COMMIT` / `ROLLBACK`(better-sqlite3 的同步 `.transaction()` 装不下异步事务体),且**所有操作经内部 promise 队列串行化**——事务在整个跨度内独占队列,任何外部 `await` 都无法把语句插进去。
  - MySQL 适配器:每域一个小连接池;事务签出一条连接,事务体绑定在这条连接上。
  - 两者共同的规则:事务体内只 await port 方法。
- **结果归一:** `changes` 和 `insertId` 在两个方言里含义一致(`Number(lastInsertRowid)` / `insertId || null`)。布尔由 domain mapper 归一(`row.done === 1`)——两个驱动都不返回真正的布尔值。
- **时间全程 UTC 字符串。** domain 传字符串,绝不传 `Date` 对象;MySQL 池钉死 `dateStrings: true` 与 `timezone: "Z"`,驱动永不做转换。金额保持整数分(`INTEGER` / `INT`)——不用 DECIMAL,不用浮点。
- **标识符全小写。** 写可移植 SQL 子集是一种纪律;方言特化 SQL 留在单个 domain 的 `store.ts` 内并加注释。
- **迁移是代码,不是工具链。** 极简 `schema_version` 表 + 每域一个前向有序的语句列表,启动时经 port 应用。无回滚,无迁移 CLI。MySQL 的 DDL 自动提交,所以迁移批次在 SQLite 上原子、在 MySQL 上不原子——DDL 依赖 `IF NOT EXISTS` 的习惯。
- **配置:** `TOBY_DB_DIALECT`(默认 `sqlite`;设 `mysql` 切换)加 `TOBY_DB_MYSQL_HOST / _PORT / _USER / _PASSWORD / _DATABASE_PREFIX`(默认 `127.0.0.1`、`3306`、`toby`、空、`toby_`),由 `infrastructure/config` 启动时一次性解析。
- **测试规则:** `pnpm run test` 永远不要求运行中的 MySQL。MySQL 适配器测试由 `TOBY_TEST_MYSQL_URL` 门控,默认跳过。

## 我们接受的代价

- port 层面一切异步优先。SQLite 一侧,串行化队列让适配器拥有与原始同步驱动同样的"一次只进一个操作"的保证。
- MySQL 的运维面——守护进程、凭据、按 schema 备份——只要跑 MySQL 就真实存在,而本项目一样都不需要:适配器是学习用具,不是部署必需。SQLite 仍是推荐的数据库。
- SQL 无法跨方言共享之处(DDL、方言特化),就每个方言写一份。在本项目的规模下,这点重复是廉价的;哪天不廉价了,重开本记录。

这个设计用 ORM 的便利,换一条我们完全理解、零依赖的接缝——与整个技术栈其余部分同一个标准。
