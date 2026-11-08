/**
 * Renders assistant text as Markdown (GFM). AI output is untrusted input:
 * react-markdown emits React elements only — raw HTML is never rendered,
 * URL schemes are sanitized by its defaults, and images degrade to their
 * alt text — so no innerHTML and no sanitizer are involved. remark-breaks
 * keeps single newlines as breaks, so plain-text turns look exactly as
 * they did under whitespace-pre-wrap. Styling stays on semantic tokens
 * (docs/design/principles.md): no new shadows, block code reuses the
 * tool-call box language.
 */

import type { ReactNode } from "react";
import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/** A fenced block renders one code child; unwrap it so block code never
 * carries the inline-code chrome. */
function innerCode(children: ReactNode): ReactNode {
  const child = Array.isArray(children) ? children[0] : children;
  return isValidElement<{ children?: ReactNode }>(child) &&
    child.type === "code"
    ? child.props.children
    : children;
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-s-2 border-border ps-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-medium">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-medium">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-medium">{children}</h5>,
  h6: ({ children }) => <h6 className="text-sm font-medium">{children}</h6>,
  ul: ({ children }) => (
    <ul className="list-disc space-y-0.5 ps-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-0.5 ps-5">{children}</ol>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {innerCode(children)}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="border-border" />,
  img: ({ alt }) => <>{alt}</>,
};

/** Chat assistant text is Markdown; `className` adapts the wrapper spacing
 * per call site (chat pads with px-1, the trace monitor does not). */
export function Markdown({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  if (text.length === 0) {
    return null;
  }
  return (
    <div
      className={`flex flex-col gap-2 text-sm leading-relaxed text-foreground ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
