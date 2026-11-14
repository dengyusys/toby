import type { AiTestResult } from "@toby/contract";

const failureMessages = {
  unconfigured: "尚未配置模型",
  "invalid-model": "模型不可用，请重新选择",
  auth: "密钥无效或未配置",
  timeout: "请求超时",
  "request-failed": "请求失败",
} as const;

export function describeTestResult(result: AiTestResult): string {
  if (result.stage === "ok") {
    return result.latencyMs === null
      ? "连接成功"
      : `连接成功 · ${result.latencyMs}ms`;
  }
  const message = failureMessages[result.stage];
  return result.stage === "request-failed" && result.message
    ? `${message}：${result.message}`
    : message;
}
