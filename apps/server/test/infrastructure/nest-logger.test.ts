import { describe, expect, it } from "vitest";
import { createNestLogger } from "../../src/infrastructure/logging/nest-logger.ts";

describe("createNestLogger", () => {
  it("maps every TOBY_LOG_LEVEL onto the enabled built-in levels", () => {
    const expected: Record<string, string[] | false> = {
      trace: ["verbose", "debug", "log", "warn", "error", "fatal"],
      debug: ["debug", "log", "warn", "error", "fatal"],
      info: ["log", "warn", "error", "fatal"],
      warn: ["warn", "error", "fatal"],
      error: ["error", "fatal"],
      fatal: ["fatal"],
      silent: false,
    };
    for (const [level, levels] of Object.entries(expected)) {
      const logger = createNestLogger(level);
      if (levels === false || logger === false) {
        expect(logger, level).toBe(false);
      } else {
        for (const candidate of [
          "verbose",
          "debug",
          "log",
          "warn",
          "error",
          "fatal",
        ] as const) {
          expect(
            logger.isLevelEnabled(candidate),
            `${level} → ${candidate}`,
          ).toBe(levels.includes(candidate));
        }
      }
    }
  });

  it("writes JSON records with structured params to stdout", () => {
    const logger = createNestLogger("info");
    expect(logger).not.toBe(false);
    if (logger === false) {
      return;
    }
    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      logger?.log("toby server started", { host: "127.0.0.1", port: 8629 });
    } finally {
      process.stdout.write = originalWrite;
    }
    const record = JSON.parse(lines.join("")) as Record<string, unknown>;
    expect(record.message).toBe("toby server started");
    expect(record.params).toEqual({ host: "127.0.0.1", port: 8629 });
  });

  it("keeps error params (including Error objects) out of the message", () => {
    const logger = createNestLogger("info");
    expect(logger).not.toBe(false);
    if (logger === false) {
      return;
    }
    const lines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      logger.error("listen failed", { err: new Error("boom") });
    } finally {
      process.stderr.write = originalWrite;
    }
    const record = JSON.parse(lines.join("")) as {
      message: string;
      params: Record<string, unknown>;
    };
    expect(record.message).toBe("listen failed");
    expect(String(record.params.err)).toContain("boom");
  });
});
