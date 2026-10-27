/**
 * The Toby agent runtime against a scripted faux provider: the kind gate
 * (unregistered names and disallowed kinds are blocked before execution),
 * the framework's schema validation feeding errors back to the model, the
 * turn cap, and the extraction correction loop. Automated tests never
 * touch a real model.
 */

import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createTobyAgentFactory,
  defineTool,
} from "../../src/infrastructure/ai/agent.ts";
import { AiError } from "../../src/infrastructure/ai/errors.ts";
import { caughtAiError } from "../helpers.ts";

const CONFIG = { model: "faux/faux-1", timeoutMs: 5_000 };

function makeHarness() {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const factory = createTobyAgentFactory(CONFIG, { models });
  return { factory, faux };
}

function makeProbeTool(name: string) {
  const calls: unknown[] = [];
  const tool = defineTool("read-only", {
    name,
    label: name,
    description: `probe tool ${name}`,
    parameters: Type.Object({ value: Type.Optional(Type.String()) }),
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
  parameters: Type.Object({ value: Type.String() }),
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
      systemPrompt: "sys",
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

  it("executes allowed registered tools", async () => {
    const { factory, faux } = makeHarness();
    const probe = makeProbeTool("probe");
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("probe", { value: "v1" })]),
      fauxAssistantMessage("done"),
    ]);
    const agent = factory({
      systemPrompt: "sys",
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
      parameters: Type.Object({ value: Type.String() }),
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
      systemPrompt: "sys",
      tools: [strict],
      policy: { allowedKinds: ["read-only"], maxTurns: 4 },
    });
    const result = await agent.run("go");
    // The schema-invalid call never reached execute; only the fix did.
    expect(executions).toBe(1);
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
      systemPrompt: "sys",
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
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => {
        throw new Error("must never execute");
      },
    });
    faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("submit_thing", { value: "v" })]),
      fauxAssistantMessage("stopped trying"),
    ]);
    const agent = factory({
      systemPrompt: "sys",
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
      systemPrompt: "sys",
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
      systemPrompt: "sys",
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
      systemPrompt: "sys",
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
        systemPrompt: "sys",
        tools: [ECHO_TOOL, ECHO_TOOL],
        policy: { allowedKinds: ["read-only"], maxTurns: 2 },
      }),
    ).toThrow(/duplicate tool name/);
  });
});
