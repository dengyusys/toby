# 版本策略

[English](versioning.md) | 简体中文

> **来源**:[Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver),
> Anthony Fu,2025-01-07。

## 方案

`{EPOCH × 1000 + MAJOR}.MINOR.PATCH`——第一位数字承载两层含义:

- **EPOCH**(千位):推倒重来的重写——`v1000.0.0` 式的跳变,配代号。
  罕见。
- **MAJOR**:技术上有破坏性、但不必惊动任何人的变更——破坏性变更
  不等于营销事件。
- **MINOR**:功能。**PATCH**:修复。

零 epoch 读起来就是普通 SemVer,机制上什么都没变。
