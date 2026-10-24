# 备份与恢复

[English](backup.md) | 简体中文

## 备份做了什么

`pnpm run backup` 把数据根目录下的每个域数据库快照到 `backups/` 下的
时间戳文件夹:

```
backups/2026-10-24T12-30-05-000Z/
├── ledger.db        # 一致的 SQLite 快照(VACUUM INTO)
├── notes.db
├── domain-file.txt  # 非数据库文件按字节复制
└── manifest.json    # 文件清单、大小、SHA-256 校验和
```

- **服务运行中执行是安全的。** 快照使用 SQLite 的 `VACUUM INTO`——
  读取数据库的一致镜像(含已提交的 WAL 内容),而不是复制可能正在
  写入的文件。源数据库不会被写入。
- **不复制 `-wal` / `-shm` 旁挂文件** —— VACUUM 快照已包含其中
  已提交的内容。
- **备份永不覆盖**:目标文件夹必须为空或不存在,每次运行都会创建
  新的时间戳文件夹。
- **备份里没有的东西:** 未确认的提案存在服务端内存中,不持久化;
  备份只包含已写入数据库文件的数据(见[提案确认内核 ADR](../decisions/actions-kernel.zh.md))。

## 运行

```bash
pnpm run backup
```

默认:数据根目录 `data/`(或 `TOBY_DATA_ROOT`),输出到
`backups/<时间戳>/`。覆盖默认:

```bash
pnpm --filter @toby/server run backup -- --data-root <目录> --out <目录>
```

清单记录了每个文件的 SHA-256 校验和 —— 按 AGENTS.md 数据规则,移动
或恢复备份前后必须比对校验和。

## 恢复

1. 停止服务(`Ctrl+C` / 停掉容器)。
2. 替换域数据库文件:把 `backups/<时间戳>/ledger.db` 覆盖到
   `data/ledger.db`(每个域一个文件)。
3. 删除残留的旁挂文件 `data/ledger.db-wal` 与 `data/ledger.db-shm`
   (如存在)。
4. 校验:`sha256sum data/ledger.db` 必须与清单中被恢复文件条目一致。
5. 重启服务;在界面上抽查数据。

## 保留策略

备份就是普通文件 —— 归档到哪里都行。过期文件夹手动删除(`backups/`
已 git 忽略);没有自动清理。
