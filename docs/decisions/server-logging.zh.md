# 服务端日志:选用 Pino

English | [简体中文](server-logging.zh.md)

服务端只向 stdout 输出一条 pino 流——请求生命周期行加错误边界的 500
报告,再无其他。留存归进程管理器(`docker logs`、systemd journal),服务端
自身不保留任何日志。

**理由:零日志政策让每个意外 500 都找不到对应的请求;而 pino 本就是
fastify 已解析的传递依赖,以同版本列为直接 catalog 条目,安装量零增加。**

## 记什么

- **请求生命周期**——fastify 自带的 logger 集成(组合根把实例传入
  `fastify({ logger })`):每个请求一行 "incoming request" 和一行
  "request completed",带请求 id、方法、url、状态码与耗时。
- **脱敏 500**——错误边界调用 `request.log.error({ stack },
"unhandled error")`:只传堆栈字符串,绝不传 error 对象(驱动错误的
  属性和 cause 里带 SQL 文本、主机与用户),并与请求行共享请求 id,
  500 一眼对上引发它的请求。
- `main.ts` 启动期失败仍打印纯文本 stderr——配置解析时 logger 尚不存在。

## 刻意不记什么

- **请求内容**:body、header、cookie 一律不进日志(默认序列化器只记
  方法、url、状态码);会话令牌永不出现。
- **文件与轮转**:只写 stdout,留存归进程管理器,不归应用。
- **AI 转录与提示词**:模型调用内容永不进日志;trace 总线保持零存储的
  console 语义(docs/features/traces.md)。

## 暂为最小实现

级别固定为 `info`。开发美化输出、`TOBY_LOG_LEVEL` 配置、AI 运行摘要行
留作后续迭代;每次迭代回溯本记录。
