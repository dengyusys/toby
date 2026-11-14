import type { AiTestResult } from "@toby/contract";

export function describeTestResult(result: AiTestResult): string {
  switch (result.stage) {
    case "ok": {
      const timing =
        result.latencyMs === null ? "" : ` · ${result.latencyMs}ms`;
      const reply = result.reply?.replace(/\s+/g, " ").trim().slice(0, 60);
      return `连接成功${timing}${reply ? `「${reply}」` : ""}`;
    }
    case "unconfigured":
      return "尚未配置模型";
    case "invalid-model":
      return "模型不可用，请重新选择";
    case "auth":
      return "密钥无效或未配置";
    case "timeout":
      return "请求超时";
    case "request-failed":
      return `请求失败${result.message ? `：${result.message}` : ""}`;
  }
}
