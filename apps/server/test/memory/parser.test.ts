/**
 * The deterministic Markdown parser: every line either parses or rejects
 * the file with its line number; serialize ∘ parse is stable, dates pass
 * real calendar checks, and the rendered line is the exact-match key.
 */

import { describe, expect, it } from "vitest";
import { MemoryFileInvalidError } from "../../src/domains/memory/errors.ts";
import {
  isValidMemoryDate,
  memoryEntryProblem,
  memorySectionNameProblem,
  parseMemoryMarkdown,
  renderMemoryLine,
  serializeMemoryMarkdown,
} from "../../src/domains/memory/parser.ts";

const EXAMPLE = `## 约定

- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 2026-11-30)

## 关于我

- 不吃香菜
- 在减脂

## 转账

- 给小王的转账走「人情往来」

## 人物

- 小王: 房东
`;

describe("parseMemoryMarkdown", () => {
  it("parses open sections into entries in file order", () => {
    expect(parseMemoryMarkdown(EXAMPLE).entries).toEqual([
      { section: "约定", text: "咖啡记「饮品」" },
      { section: "约定", text: "出差期间餐饮记「差旅」", until: "2026-11-30" },
      { section: "关于我", text: "不吃香菜" },
      { section: "关于我", text: "在减脂" },
      { section: "转账", text: "给小王的转账走「人情往来」" },
      { section: "人物", text: "小王: 房东" },
    ]);
  });

  it("accepts blank lines anywhere, CRLF endings, and any topic name", () => {
    const memory = parseMemoryMarkdown(
      "## 健康\r\n\r\n\r\n- 每天走八千步\r\n\r\n## a\r\n\r\n\r\n- b\r\n\r\n",
    );
    expect(memory.entries).toEqual([
      { section: "健康", text: "每天走八千步" },
      { section: "a", text: "b" },
    ]);
  });

  it("parses the empty file as the empty book", () => {
    expect(parseMemoryMarkdown("").entries).toEqual([]);
    expect(parseMemoryMarkdown("\n\n").entries).toEqual([]);
  });

  it("rejects bad lines with the offending line number", () => {
    const bad: readonly [string, RegExp][] = [
      // An entry line before any heading.
      ["- a\n", /第 1 行.*必须以「## 小节名」开头/],
      // A heading with no name.
      ["##\n", /第 1 行.*小节名无效/],
      ["##   \n\n- a\n", /第 1 行.*小节名无效/],
      // A third-level heading is not allowed.
      ["## 约定\n\n### 子标题\n", /第 3 行.*只支持二级标题/],
      // A duplicate heading is invalid — merge instead.
      [
        "## 约定\n\n- a\n\n## 工作\n\n- b\n\n## 约定\n\n- c\n",
        /第 9 行.*重复的小节「约定」/,
      ],
      // Names are bounded.
      [`## ${"x".repeat(25)}\n`, /第 1 行.*小节名无效/],
      // Not an entry line.
      ["## 约定\n\n随便一句话\n", /第 3 行.*无法解析的行/],
      // Empty entry text.
      ["## 约定\n\n-   \n", /第 3 行.*无法解析的行/],
      // A marker with no text before it.
      ["## 约定\n\n-  (至 2026-11-30)\n", /第 3 行.*条目内容不能为空/],
      // Shape-valid but impossible dates are rejected, never stored.
      ["## 约定\n\n- x (至 2026-02-30)\n", /第 3 行.*不是真实日期.*2026-02-30/],
    ];
    for (const [content, message] of bad) {
      let error: unknown;
      try {
        parseMemoryMarkdown(content);
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(content)).toBeInstanceOf(
        MemoryFileInvalidError,
      );
      expect((error as Error).message, JSON.stringify(content)).toMatch(
        message,
      );
    }
  });

  it("still rejects a file of unparseable prose", () => {
    expect(() => parseMemoryMarkdown("这不是记忆文件\n")).toThrow(
      MemoryFileInvalidError,
    );
  });
});

describe("serializeMemoryMarkdown", () => {
  it("serializes the empty book to the empty string", () => {
    expect(serializeMemoryMarkdown({ entries: [] })).toBe("");
  });

  it("writes sections in file order, one blank line after each heading", () => {
    const memory = parseMemoryMarkdown(EXAMPLE);
    expect(serializeMemoryMarkdown(memory)).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n- 出差期间餐饮记「差旅」 (至 2026-11-30)\n\n## 关于我\n\n- 不吃香菜\n- 在减脂\n\n## 转账\n\n- 给小王的转账走「人情往来」\n\n## 人物\n\n- 小王: 房东\n",
    );
  });

  it("is stable under parse ∘ serialize ∘ parse", () => {
    const once = serializeMemoryMarkdown(parseMemoryMarkdown(EXAMPLE));
    const twice = serializeMemoryMarkdown(parseMemoryMarkdown(once));
    expect(twice).toBe(once);
  });

  it("renders the 至 marker only when until is present", () => {
    const memory = parseMemoryMarkdown(
      "## 约定\n\n- 有期限 (至 2026-11-30)\n- 无期限\n",
    );
    expect(serializeMemoryMarkdown(memory)).toBe(
      "## 约定\n\n- 有期限 (至 2026-11-30)\n- 无期限\n",
    );
  });
});

describe("isValidMemoryDate", () => {
  it("accepts real calendar dates, including leap years", () => {
    for (const good of [
      "2026-11-14",
      "2028-02-29",
      "2000-02-29",
      "1900-01-01",
      "2099-12-31",
    ]) {
      expect(isValidMemoryDate(good), good).toBe(true);
    }
  });

  it("rejects impossible dates and non-ISO shapes", () => {
    for (const bad of [
      "2026-02-30",
      "2027-02-29", // not a leap year
      "1900-02-29", // century non-leap
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "2026-4-5",
      "2026/10/20",
      "",
      "not a date",
    ]) {
      expect(isValidMemoryDate(bad), bad).toBe(false);
    }
  });
});

describe("memorySectionNameProblem", () => {
  it("accepts free topic names, including the house vocabulary", () => {
    for (const good of ["约定", "关于我", "人物", "转账", "工作", "a"]) {
      expect(memorySectionNameProblem(good), good).toBeNull();
    }
  });

  it("rejects empty and over-long names", () => {
    expect(memorySectionNameProblem("  ")).toMatch(/empty/);
    expect(memorySectionNameProblem("x".repeat(25))).toMatch(/at most 24/);
    // Exactly 24 characters is fine.
    expect(memorySectionNameProblem("x".repeat(24))).toBeNull();
  });
});

describe("renderMemoryLine", () => {
  it("renders plain and dated lines — no name field, people style is text", () => {
    expect(renderMemoryLine({ section: "约定", text: "咖啡记「饮品」" })).toBe(
      "- 咖啡记「饮品」",
    );
    expect(
      renderMemoryLine({
        section: "约定",
        text: "出差餐饮记「差旅」",
        until: "2026-11-30",
      }),
    ).toBe("- 出差餐饮记「差旅」 (至 2026-11-30)");
    expect(renderMemoryLine({ section: "人物", text: "小王: 房东" })).toBe(
      "- 小王: 房东",
    );
  });
});

describe("memoryEntryProblem", () => {
  it("accepts a valid entry of any section", () => {
    expect(memoryEntryProblem({ section: "约定", text: "x" })).toBeNull();
    expect(
      memoryEntryProblem({
        section: "健康",
        text: "小王: 房东",
        until: "2026-11-30",
      }),
    ).toBeNull();
  });

  it("rejects bad shapes and semantics", () => {
    const problems: readonly [unknown, RegExp][] = [
      [{ section: "  ", text: "x" }, /section/],
      [{ section: "x".repeat(25), text: "x" }, /at most 24/],
      [{ section: "约定", text: "  " }, /text/],
      [{ section: "约定", text: "两\n行" }, /single line/],
      [{ section: "约定", text: "- x (至 2026-11-30)" }, /until instead/],
      [{ section: "约定", text: "x", until: "2026-02-30" }, /real calendar/],
      [{ section: "约定", text: "x", until: "2026-1-2" }, /real calendar/],
    ];
    for (const [entry, message] of problems) {
      expect(memoryEntryProblem(entry as never), JSON.stringify(entry)).toMatch(
        message,
      );
    }
  });
});
