/**
 * Pure helper wording for the ledger feature (mobile copy): the revert
 * wire codes and the fallbacks of describeError, pinned without any UI.
 * Mirrors the PC test deliberately.
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "@toby/contract";
import { describeError } from "../src/features/ledger/ledger-view.ts";

describe("describeError", () => {
  it("maps the revert wire codes to zh copy", () => {
    expect(
      describeError(
        new ApiError(410, "PROPOSAL_EXPIRED", "revert window has closed"),
      ),
    ).toBe("撤销窗口已过,不能再撤销");
    expect(
      describeError(
        new ApiError(409, "REVERT_CONFLICT", "a later write touched"),
      ),
    ).toBe("已有后续改动,不能撤销——新的改动优先");
    expect(
      describeError(new ApiError(409, "PROPOSAL_NOT_REVERTIBLE", "-")),
    ).toBe("该写入不可撤销");
    expect(describeError(new ApiError(404, "PROPOSAL_NOT_FOUND", "-"))).toBe(
      "记录不存在或已被清理",
    );
  });

  it("falls back to the message, then to the generic copy", () => {
    expect(describeError(new ApiError(400, "SOMETHING_ELSE", "boom"))).toBe(
      "boom",
    );
    expect(describeError(new Error("offline"))).toBe("请求失败,请稍后重试");
  });
});
