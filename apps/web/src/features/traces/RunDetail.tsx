/**
 * The selected run's full record: summary header, the prompt, the message
 * transcript in pi-ai verbatim shapes (system prompt with tool
 * declarations, user inputs, assistant content blocks — thinking, tool
 * calls, text — and tool results), the outcome, and the raw event JSON
 * for anything the pretty views do not cover.
 */

import type { ReactNode } from "react";
import type {
  PiAssistantMessage,
  PiImageContent,
  PiSystemMessage,
  PiTextContent,
  PiThinkingContent,
  PiToolCall,
  PiToolResultMessage,
  PiUserMessage,
  TraceMessage,
} from "@toby/contract";
import { Markdown } from "@/components/markdown.tsx";
import { formatDuration } from "./format.ts";
import type { TraceRun } from "./trace-stream-context.ts";
import { Button } from "@/components/ui/button.tsx";

const MONO = "whitespace-pre-wrap break-all font-mono text-xs leading-relaxed";

type ContentBlock = PiTextContent | PiImageContent;

/** Flatten a verbatim content value to display text ("[图片]" for images). */
function flattenText(content: string | readonly ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => (block.type === "text" ? block.text : "[图片]"))
    .join("\n");
}

export function RunDetail({
  run,
  onBack,
}: {
  run: TraceRun;
  onBack: () => void;
}) {
  const finished = run.phase === "finished";
  return (
    <div className="flex flex-col gap-4 p-4">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="self-start"
        onClick={onBack}
      >
        ← 返回列表
      </Button>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{run.label}</h2>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {run.kind === "agent" ? "工具循环" : "单发"}
          </span>
          {finished && (
            <span
              className={
                run.status === "succeeded"
                  ? "rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                  : "rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
              }
            >
              {run.status === "succeeded" ? "成功" : "失败"}
            </span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">模型</dt>
          <dd className="font-mono">{run.model}</dd>
          <dt className="text-muted-foreground">开始时间</dt>
          <dd>
            {new Date(run.started_at).toLocaleString("zh-CN", {
              hour12: false,
            })}
          </dd>
          {finished && (
            <>
              <dt className="text-muted-foreground">耗时</dt>
              <dd>{formatDuration(run.duration_ms)}</dd>
              {run.turns !== undefined && (
                <>
                  <dt className="text-muted-foreground">轮次</dt>
                  <dd>{run.turns}</dd>
                </>
              )}
              {run.stopReason !== undefined && (
                <>
                  <dt className="text-muted-foreground">停止原因</dt>
                  <dd className="font-mono">{run.stopReason}</dd>
                </>
              )}
              {run.usage && (
                <>
                  <dt className="text-muted-foreground">Tokens</dt>
                  <dd className="tabular-nums">
                    共 {run.usage.totalTokens}(入 {run.usage.input} / 出{" "}
                    {run.usage.output})
                  </dd>
                  <dt className="text-muted-foreground">费用</dt>
                  <dd className="tabular-nums">
                    ${run.usage.cost.total.toFixed(6)}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      </section>

      <Section title="提示词">
        <p className={MONO}>{run.prompt || "(无文本输入)"}</p>
      </Section>

      {finished ? (
        <>
          <Section title={`对话过程(${run.messages.length} 条消息)`}>
            <div className="flex flex-col gap-3">
              {run.messages.map((message, index) => (
                <MessageView key={index} message={message} />
              ))}
            </div>
          </Section>
          {run.result_text !== undefined && run.result_text.length > 0 && (
            <Section title="最终回复">
              <p className={MONO}>{run.result_text}</p>
            </Section>
          )}
          {run.error !== undefined && (
            <Section title="失败原因">
              <p className="font-mono text-xs leading-relaxed text-destructive">
                {run.error}
              </p>
            </Section>
          )}
          <details className="rounded-xl border bg-card p-4 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              原始事件 JSON
            </summary>
            <pre className={MONO}>{JSON.stringify(run, null, 2)}</pre>
          </details>
        </>
      ) : (
        <Section title="对话过程">
          <p className="text-xs text-muted-foreground">运行中,等待返回…</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MessageView({ message }: { message: TraceMessage }) {
  switch (message.role) {
    case "system":
      return <SystemView message={message} />;
    case "user":
      return <UserView message={message} />;
    case "assistant":
      return <AssistantView message={message} />;
    case "toolResult":
      return <ToolResultView message={message} />;
    default:
      // Defensive: an unexpected role still shows, never hides.
      return (
        <MessageFrame label="未识别消息" tone="muted">
          <pre className={MONO}>{JSON.stringify(message, null, 2)}</pre>
        </MessageFrame>
      );
  }
}

function SystemView({ message }: { message: PiSystemMessage }) {
  const tools = message.toolsAdded ?? [];
  return (
    <MessageFrame label="系统提示词" tone="muted">
      <p className={MONO}>{flattenText(message.content)}</p>
      {tools.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">
            工具声明({tools.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {tools.map((tool) => (
              <div key={tool.name} className="rounded-lg border p-3">
                <p className="font-mono text-xs font-medium">{tool.name}</p>
                {tool.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                )}
                {tool.parameters !== undefined && (
                  <pre className={`${MONO} mt-2`}>
                    {JSON.stringify(tool.parameters, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </MessageFrame>
  );
}

function UserView({ message }: { message: PiUserMessage }) {
  return (
    <MessageFrame label="用户" tone="plain">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {flattenText(message.content)}
      </p>
    </MessageFrame>
  );
}

function AssistantView({ message }: { message: PiAssistantMessage }) {
  // Content blocks render in order: thinking, tool calls, text — exactly
  // the order the model produced them.
  const thinking = message.content.filter(
    (block): block is PiThinkingContent => block.type === "thinking",
  );
  const toolCalls = message.content.filter(
    (block): block is PiToolCall => block.type === "toolCall",
  );
  const texts = message.content.filter(
    (block): block is PiTextContent => block.type === "text",
  );
  return (
    <MessageFrame label="助手" tone="plain">
      {thinking.map((block, index) =>
        block.thinking.length > 0 ? (
          <details key={`thinking-${index}`} className="mb-2">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              思考过程{block.redacted ? "(已脱敏)" : ""}
            </summary>
            <pre className={`${MONO} mt-2`}>{block.thinking}</pre>
          </details>
        ) : null,
      )}
      {message.content.map((block, index) =>
        block.type === "toolCall" ? (
          <ToolCallView key={block.id ?? `call-${index}`} call={block} />
        ) : null,
      )}
      {texts.map((block, index) => (
        <Markdown key={`text-${index}`} text={block.text} />
      ))}
      {(message.usage !== undefined || message.durationMs !== undefined) && (
        <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">
          {message.durationMs !== undefined &&
            `${formatDuration(message.durationMs)}`}
          {message.usage !== undefined &&
            ` · ${message.usage.totalTokens} tokens`}
        </p>
      )}
      {toolCalls.length === 0 &&
        texts.length === 0 &&
        thinking.length === 0 && (
          <p className="text-xs text-muted-foreground">(空回复)</p>
        )}
    </MessageFrame>
  );
}

function ToolCallView({ call }: { call: PiToolCall }) {
  return (
    <div className="mt-2 rounded-lg border bg-muted/40 p-3">
      <p className="font-mono text-xs font-medium">
        调用工具:{call.name}
        <span className="ml-2 text-[10px] font-normal text-muted-foreground">
          {call.id}
        </span>
      </p>
      {call.argumentsError !== undefined ? (
        <pre className={`${MONO} mt-1 text-destructive`}>
          {call.argumentsError}
        </pre>
      ) : (
        Object.keys(call.arguments).length > 0 && (
          <pre className={`${MONO} mt-1`}>
            {JSON.stringify(call.arguments, null, 2)}
          </pre>
        )
      )}
    </div>
  );
}

function ToolResultView({ message }: { message: PiToolResultMessage }) {
  return (
    <MessageFrame
      label={`工具结果:${message.toolName}`}
      tone={message.isError ? "error" : "muted"}
    >
      <pre className={`${MONO} ${message.isError ? "text-destructive" : ""}`}>
        {flattenText(message.content)}
      </pre>
      {message.details !== undefined && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">
            工具详情
          </summary>
          <pre className={`${MONO} mt-1`}>
            {JSON.stringify(message.details, null, 2)}
          </pre>
        </details>
      )}
    </MessageFrame>
  );
}

function MessageFrame({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "plain" | "muted" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={
        tone === "plain"
          ? "rounded-lg border p-3"
          : tone === "error"
            ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3"
            : "rounded-lg border bg-muted/30 p-3"
      }
    >
      <p className="mb-2 text-[10px] font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
