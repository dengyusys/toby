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

## 人物

- 小王: 房东
`;

describe("parseMemoryMarkdown", () => {
  it("parses the three sections into entries in file order", () => {
    expect(parseMemoryMarkdown(EXAMPLE).entries).toEqual([
      { type: "约定", text: "咖啡记「饮品」" },
      { type: "约定", text: "出差期间餐饮记「差旅」", until: "2026-11-30" },
      { type: "关于我", text: "不吃香菜" },
      { type: "关于我", text: "在减脂" },
      { type: "人物", name: "小王", text: "房东" },
    ]);
  });

  it("accepts blank lines anywhere and CRLF line endings", () => {
    const memory = parseMemoryMarkdown(
      "## 约定\r\n\r\n\r\n- a\r\n\r\n## 关于我\r\n\r\n\r\n## 人物\r\n\r\n",
    );
    expect(memory.entries).toEqual([{ type: "约定", text: "a" }]);
  });

  it("parses the empty skeleton into no entries", () => {
    const skeleton = serializeMemoryMarkdown({ entries: [] });
    expect(parseMemoryMarkdown(skeleton).entries).toEqual([]);
  });

  it("rejects bad lines with the offending line number", () => {
    const bad: readonly [string, RegExp][] = [
      ["hello\n", /第 1 行.*必须以「## 约定」开头/],
      ["## 人物\n\n- a: b\n\n\n\n", /第 1 行.*期望标题「## 约定」/],
      // A fourth heading is not allowed.
      [
        "## 约定\n\n\n## 关于我\n\n\n## 人物\n\n- a: b\n\n## 人物\n\n",
        /第 11 行.*多余的标题/,
      ],
      // Missing tail sections.
      ["## 约定\n\n- a\n", /第 4 行.*缺少「## 关于我」小节/],
      ["## 约定\n\n\n## 关于我\n\n", /第 6 行.*缺少「## 人物」小节/],
      // Not an entry line.
      [
        "## 约定\n\n\n## 关于我\n\n随便一句话\n\n## 人物\n\n",
        /第 6 行.*无法解析的行/,
      ],
      // Empty entry text.
      [
        "## 约定\n\n-   \n\n## 关于我\n\n\n## 人物\n\n",
        /第 3 行.*无法解析的行/,
      ],
      // A marker with no text before it.
      [
        "## 约定\n\n-  (至 2026-11-30)\n\n## 关于我\n\n\n## 人物\n\n",
        /第 3 行.*条目内容不能为空/,
      ],
      // 人物 needs name: text.
      [
        "## 约定\n\n\n## 关于我\n\n\n## 人物\n\n- 没有冒号\n",
        /第 9 行.*name: text/,
      ],
      ["## 约定\n\n\n## 关于我\n\n\n## 人物\n\n- : 只有正文\n", /第 9 行/],
      ["## 约定\n\n\n## 关于我\n\n\n## 人物\n\n- 小王: \n", /第 9 行/],
      // Shape-valid but impossible dates are rejected, never stored.
      [
        "## 约定\n\n- x (至 2026-02-30)\n\n## 关于我\n\n\n## 人物\n\n",
        /第 3 行.*不是真实日期.*2026-02-30/,
      ],
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

  it("rejects a blank file", () => {
    expect(() => parseMemoryMarkdown("")).toThrow(MemoryFileInvalidError);
    expect(() => parseMemoryMarkdown("\n\n")).toThrow(MemoryFileInvalidError);
  });
});

describe("serializeMemoryMarkdown", () => {
  it("writes headings in fixed order with one blank line after each", () => {
    expect(serializeMemoryMarkdown({ entries: [] })).toBe(
      "## 约定\n\n\n## 关于我\n\n\n## 人物\n\n",
    );
  });

  it("groups entries by type, in file order within a type", () => {
    const memory = parseMemoryMarkdown(EXAMPLE);
    expect(serializeMemoryMarkdown(memory)).toBe(
      "## 约定\n\n- 咖啡记「饮品」\n- 出差期间餐饮记「差旅」 (至 2026-11-30)\n\n## 关于我\n\n- 不吃香菜\n- 在减脂\n\n## 人物\n\n- 小王: 房东\n",
    );
  });

  it("is stable under parse ∘ serialize ∘ parse", () => {
    const once = serializeMemoryMarkdown(parseMemoryMarkdown(EXAMPLE));
    const twice = serializeMemoryMarkdown(parseMemoryMarkdown(once));
    expect(twice).toBe(once);
  });

  it("renders the 至 marker only when until is present", () => {
    const memory = parseMemoryMarkdown(
      "## 约定\n\n- 有期限 (至 2026-11-30)\n- 无期限\n\n## 关于我\n\n\n## 人物\n\n",
    );
    expect(serializeMemoryMarkdown(memory)).toBe(
      "## 约定\n\n- 有期限 (至 2026-11-30)\n- 无期限\n\n## 关于我\n\n\n## 人物\n\n",
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

describe("renderMemoryLine", () => {
  it("renders plain, dated and person lines", () => {
    expect(renderMemoryLine({ type: "约定", text: "咖啡记「饮品」" })).toBe(
      "- 咖啡记「饮品」",
    );
    expect(
      renderMemoryLine({
        type: "约定",
        text: "出差餐饮记「差旅」",
        until: "2026-11-30",
      }),
    ).toBe("- 出差餐饮记「差旅」 (至 2026-11-30)");
    expect(renderMemoryLine({ type: "人物", name: "小王", text: "房东" })).toBe(
      "- 小王: 房东",
    );
  });
});

describe("memoryEntryProblem", () => {
  it("accepts a valid entry of every type", () => {
    expect(memoryEntryProblem({ type: "约定", text: "x" })).toBeNull();
    expect(
      memoryEntryProblem({
        type: "人物",
        name: "小王",
        text: "x",
        until: "2026-11-30",
      }),
    ).toBeNull();
  });

  it("rejects bad shapes and semantics", () => {
    const problems: readonly [unknown, RegExp][] = [
      [{ type: "其他", text: "x" }, /type/],
      [{ type: "约定", text: "  " }, /text/],
      [{ type: "约定", text: "两\n行" }, /single line/],
      [{ type: "约定", text: "- x (至 2026-11-30)" }, /until instead/],
      [{ type: "人物", text: "x" }, /name/],
      [{ type: "人物", name: "  ", text: "x" }, /name/],
      [{ type: "人物", name: "a:b", text: "x" }, /name.*:/],
      [{ type: "约定", text: "x", until: "2026-02-30" }, /real calendar/],
      [{ type: "约定", text: "x", until: "2026-1-2" }, /real calendar/],
    ];
    for (const [entry, message] of problems) {
      expect(memoryEntryProblem(entry as never), JSON.stringify(entry)).toMatch(
        message,
      );
    }
  });
});
