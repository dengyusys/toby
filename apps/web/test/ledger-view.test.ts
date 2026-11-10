/**
 * Pure helper wording for the ledger feature: the write wire codes and
 * the fallbacks of describeError, pinned without any UI.
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "@toby/contract";
import { describeError } from "../src/features/ledger/ledger-view.ts";

describe("describeError", () => {
  it("maps the write wire codes to zh copy", () => {
    expect(describeError(new ApiError(404, "TRANSACTION_NOT_FOUND", "-"))).toBe(
      "账目不存在,可能已被删除",
    );
    expect(describeError(new ApiError(501, "AI_UNAVAILABLE", "-"))).toBe(
      "AI 未配置:需要在服务端设置 TOBY_AI_MODEL(格式 provider/model,如 zai/glm-4.7)",
    );
  });

  it("falls back to the message, then to the generic copy", () => {
    expect(describeError(new ApiError(400, "SOMETHING_ELSE", "boom"))).toBe(
      "boom",
    );
    expect(describeError(new Error("offline"))).toBe("请求失败,请稍后重试");
  });
});
