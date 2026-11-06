/**
 * The Toby agent runtime against a scripted faux provider: the kind gate
 * (unregistered names and disallowed kinds are blocked before execution),
 * the framework's schema validation feeding errors back to the model, the
 * turn cap, and the extraction correction loop. Automated tests never
 * touch a real model.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createTobyAgentFactory,
  defineTool,
} from "../../../src/infrastructure/model/agent.ts";
import type {
  TraceEvent,
  TraceReporter,
} from "../../../src/infrastructure/trace/types.ts";
import { createTraceBus } from "../../../src/infrastructure/trace/bus.ts";
import { AiError } from "../../../src/infrastructure/model/errors.ts";
import { caughtAiError } from "../../helpers.ts";

const CONFIG = { model: "faux/faux-1", timeoutMs: 5_000 };

function makeHarness(extra: { reporter?: TraceReporter } = {}) {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const factory = createTobyAgentFactory(CONFIG, { models, ...extra });
  return { factory, faux };
}

function makeProbeTool(name: string) {
  const calls: unknown[] = [];
  const tool = defineTool("read-only", {
    name,
    label: name,
    description: `probe tool ${name}`,
    promptSnippet: `probe ${name}`,
    parameters: z.object({ value: z.string().optional() }),
    execute: async (_id, params) => {
      calls.push(params);
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  });
  return { tool, calls };
}

const ECHO_TOOL = defineTool("read-only", {
  name: "echo",
  label: "echo",
  description: "echo a value",
  promptSnippet: "echo a value",
  parameters: z.object({ value: z.string() }),
  execute: async (_id, params) => ({
    content: [{ type: "text", text: params.value }],
    details: {},
  }),
});

describe("createTobyAgentFactory", () => {
  it("rejects unknown provider/model pairs at construction", () => {
    expect(() =>
      createTobyAgentFactory({ model: "nope/x", timeoutMs: 1 }),
    ).toThrow(/provider\/model/);
  });

  it("runs a plain prompt through to the final text", async () => {
    const { factory, faux } = makeHarness();
    faux.appendResponses([fauxAssistantMessage("the answer")]);
    const agent = factory({
      preamble: "sys",
      tools: [],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    const result = await agent.run("hello");
    expect(result.text).toBe("the answer");
    expect(result.turns).toBe(1);
    expect(result.turnCapped).toBe(false);
    expect(result.stopReason).toBe("stop");
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("renders the tool snippet and guidelines into the system prompt", async () => {
    const { factory, faux } = makeHarness();
    faux.appendResponses([fauxAssistantMessage("done")]);
    const tool = defineTool("read-only", {
      name: "probe",
      label: "probe",
      description: "probe tool",
      promptSnippet: "probe a value",
      promptGuidelines: ["Use it before asking."],
      parameters: z.object({}),
      execute: async () => ({ content: [], details: {} }),
    });
    const agent = factory({
      preamble: "sys",
      rules: ["be brief"],
      context: ["today is 2026-11-06"],
      tools: [tool],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    const result = await agent.run("go");
    const system = result.messages[0] as { role: string; content: string };
    expect(system.role).toBe("system");
    expect(system.content).toContain(
      "<tools>\n- probe：probe a value\n  - Use it before asking.\n</tools>",
    );
    expect(system.content).toContain("<rules>\n- be brief\n</rules>");
    expect(system.content).toContain(
      "<context>\ntoday is 2026-11-06\n</context>",
    );
  });

  it("rejects hand-written prompt text that names a tool", () => {
    const { factory } = makeHarness();
    expect(() =>
      factory({
        preamble: "You may call echo.",
        tools: [ECHO_TOOL],
        policy: { allowedKinds: ["read-only"], maxTurns: 2 },
      }),
    ).toThrow(/names tool "echo"/);
  });

  it("executes allowed registered tools", async () => {
    const { factory, faux } = makeHarness();
    const probe = makeProbeTool("probe");
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("probe", { value: "v1" })]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [probe.tool],
      policy: { allowedKinds: ["read-only"], maxTurns: 3 },
    });
    const result = await agent.run("go");
    expect(probe.calls).toEqual([{ value: "v1" }]);
    expect(result.turns).toBe(2);
  });

  it("feeds schema-invalid arguments back without executing the tool", async () => {
    const { factory, faux } = makeHarness();
    let executions = 0;
    const strict = defineTool("read-only", {
      name: "strict_probe",
      label: "strict_probe",
      description: "strict probe tool",
      promptSnippet: "strict probe",
      parameters: z.object({ value: z.string() }),
      execute: async (_id, params) => {
        executions += 1;
        return {
          content: [{ type: "text", text: params.value }],
          details: {},
        };
      },
    });
    faux.appendResponses([
      // Missing the required `value` — pi-agent-core validates arguments
      // against the tool schema before the gate hook and execute run, so the
      // bad call becomes an error tool result the model can correct against.
      fauxAssistantMessage([fauxToolCall("strict_probe", {})]),
      fauxAssistantMessage([fauxToolCall("strict_probe", { value: "fixed" })]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [strict],
      policy: { allowedKinds: ["read-only"], maxTurns: 4 },
    });
    const result = await agent.run("go");
    // The schema-invalid call never reached execute; only the fix did.
    expect(executions).toBe(1);
    expect(result.turns).toBe(3);
  });

  it("coerces loosely typed arguments into the schema's shape (pi 1.5.0 boundary)", async () => {
    const { factory, faux } = makeHarness();
    const calls: unknown[] = [];
    const typed = defineTool("read-only", {
      name: "typed_probe",
      label: "typed_probe",
      description: "typed probe tool",
      promptSnippet: "typed probe",
      parameters: z.object({
        count: z.number().int(),
        tags: z.array(z.string()),
      }),
      execute: async (_id, params) => {
        calls.push(params);
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });
    faux.appendResponses([
      // Since pi 1.5.0 the boundary validates through pi-schema with
      // coercion: "2" becomes 2, a bare tag wraps into a one-item array —
      // execute sees the coerced values, and the domain's semantic
      // validation stays the trust boundary downstream of this.
      fauxAssistantMessage([
        fauxToolCall("typed_probe", { count: "2", tags: "food" }),
      ]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [typed],
      policy: { allowedKinds: ["read-only"], maxTurns: 3 },
    });
    const result = await agent.run("go");
    expect(calls).toEqual([{ count: 2, tags: ["food"] }]);
    expect(result.turns).toBe(2);
  });

  it("bounces arguments no coercion rule can save", async () => {
    const { factory, faux } = makeHarness();
    const calls: unknown[] = [];
    const typed = defineTool("read-only", {
      name: "typed_probe",
      label: "typed_probe",
      description: "typed probe tool",
      promptSnippet: "typed probe",
      parameters: z.object({ count: z.number().int() }),
      execute: async (_id, params) => {
        calls.push(params);
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });
    faux.appendResponses([
      // A non-numeric string cannot coerce to an integer, so the call fails
      // schema validation — an error tool result the model corrects against.
      fauxAssistantMessage([
        fauxToolCall("typed_probe", { count: "not a number" }),
      ]),
      fauxAssistantMessage([fauxToolCall("typed_probe", { count: 7 })]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [typed],
      policy: { allowedKinds: ["read-only"], maxTurns: 4 },
    });
    const result = await agent.run("go");
    expect(calls).toEqual([{ count: 7 }]);
    expect(result.turns).toBe(3);
  });

  it("blocks tool calls for names that are not registered", async () => {
    const { factory, faux } = makeHarness();
    const probe = makeProbeTool("probe");
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("hallucinated_tool", {})]),
      fauxAssistantMessage("gave up"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [probe.tool],
      policy: { allowedKinds: ["read-only"], maxTurns: 3 },
    });
    const result = await agent.run("go");
    expect(probe.calls).toEqual([]);
    expect(result.text).toBe("gave up");
  });

  it("blocks tools whose kind the policy does not allow", async () => {
    const { factory, faux } = makeHarness();
    const writer = defineTool("write-intent", {
      name: "submit_thing",
      label: "submit_thing",
      description: "submit a thing",
      promptSnippet: "submit a thing",
      parameters: z.object({ value: z.string() }),
      execute: async () => {
        throw new Error("must never execute");
      },
    });
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("submit_thing", { value: "v" })]),
      fauxAssistantMessage("stopped trying"),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [writer],
      policy: { allowedKinds: ["read-only"], maxTurns: 3 },
    });
    const result = await agent.run("go");
    expect(result.text).toBe("stopped trying");
  });

  it("caps turns: the run ends at maxTurns and reports turnCapped", async () => {
    const { factory, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("echo", { value: "1" })]),
      fauxAssistantMessage([fauxToolCall("echo", { value: "2" })]),
      fauxAssistantMessage([fauxToolCall("echo", { value: "3" })]),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [ECHO_TOOL],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    const result = await agent.run("go");
    expect(result.turns).toBe(2);
    expect(result.turnCapped).toBe(true);
  });

  it("times the run out when the provider is too slow", async () => {
    const models = createModels();
    const faux = fauxProvider({ tokensPerSecond: 100 });
    models.setProvider(faux.provider);
    const factory = createTobyAgentFactory(
      { model: "faux/faux-1", timeoutMs: 50 },
      { models },
    );
    faux.appendResponses([fauxAssistantMessage("word ".repeat(200))]);
    const agent = factory({
      preamble: "sys",
      tools: [],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    const error = await caughtAiError(agent.run("go"));
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("timeout");
  });

  it("maps a provider-error stop reason onto request-failed", async () => {
    const { factory, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "provider exploded",
      }),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    const error = await caughtAiError(agent.run("go"));
    // The faux provider's auth resolves, so the 502-shaped code applies.
    expect(error.code).toBe("request-failed");
    expect(error.message).toContain("provider exploded");
  });

  it("rejects duplicate tool names at spec time", () => {
    const { factory } = makeHarness();
    expect(() =>
      factory({
        preamble: "sys",
        tools: [ECHO_TOOL, ECHO_TOOL],
        policy: { allowedKinds: ["read-only"], maxTurns: 2 },
      }),
    ).toThrow(/duplicate tool name/);
  });

  it("reports each run to the trace bus with its transcript", async () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const { factory, faux } = makeHarness({ reporter: bus });
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("echo", { value: "v1" })]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      name: "probe-agent",
      preamble: "sys",
      tools: [ECHO_TOOL],
      policy: { allowedKinds: ["read-only"], maxTurns: 3 },
    });
    await agent.run("go");

    expect(events).toHaveLength(2);
    const started = events[0] as {
      run: { kind: string; label: string; prompt: string };
    };
    expect(started.run).toMatchObject({
      kind: "agent",
      label: "probe-agent",
      prompt: "go",
    });

    const finished = events[1] as {
      run: {
        status: string;
        result_text?: string;
        messages: readonly { role: string }[];
        usage?: { totalTokens: number };
      };
    };
    expect(finished.run.status).toBe("succeeded");
    expect(finished.run.result_text).toBe("done");
    // The whole verbatim pi-ai transcript survives: system prompt, user
    // prompt, the tool-calling assistant turn, the tool result, the final
    // answer — roles in pi-ai's own casing.
    expect(finished.run.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(finished.run.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("reports failed runs with the error message", async () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const { factory, faux } = makeHarness({ reporter: bus });
    faux.appendResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "provider exploded",
      }),
    ]);
    const agent = factory({
      preamble: "sys",
      tools: [],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });
    await caughtAiError(agent.run("go"));
    expect(events).toHaveLength(2);
    const finished = events[1] as {
      run: { status: string; error?: string };
    };
    expect(finished.run.status).toBe("failed");
    expect(finished.run.error).toContain("provider exploded");
  });
});
