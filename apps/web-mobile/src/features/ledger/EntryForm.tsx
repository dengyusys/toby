/**
 * Entry form card (记一笔, mobile): the sentence-parse row with its
 * follow-up and error lines, then the six-field structured form and the
 * full-width submit button. The form state and the two mutations live in
 * LedgerPage; pending flags, error values, and handlers arrive as props,
 * so this file only renders. Nothing is shared with the PC app.
 */

import {
  describeError,
  inputClass,
  primaryButtonClass,
  type EntryFormState,
} from "./ledger-view.ts";

interface EntryFormProps {
  sentence: string;
  onSentenceChange: (value: string) => void;
  onParseSentence: (text: string) => void;
  sentencePending: boolean;
  sentenceError: Error | null;
  followUp: string | null;
  form: EntryFormState;
  onFieldChange: <K extends keyof EntryFormState>(
    field: K,
    value: EntryFormState[K],
  ) => void;
  onSubmitEntry: (event: React.FormEvent<HTMLFormElement>) => void;
  createPending: boolean;
  createError: Error | null;
}

export function EntryForm({
  sentence,
  onSentenceChange,
  onParseSentence,
  sentencePending,
  sentenceError,
  followUp,
  form,
  onFieldChange,
  onSubmitEntry,
  createPending,
  createError,
}: EntryFormProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-medium">记一笔</h2>
      <form className="mt-3" onSubmit={onSubmitEntry}>
        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="text-xs font-medium text-muted-foreground">
              一句话记账
            </span>
            <input
              placeholder="如:昨天午饭花了 35"
              value={sentence}
              onChange={(event) => onSentenceChange(event.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            disabled={sentencePending || sentence.trim() === ""}
            onClick={() => onParseSentence(sentence.trim())}
            className="inline-flex h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
          >
            {sentencePending ? "解析中…" : "解析"}
          </button>
        </div>
        {sentenceError && (
          <p className="mt-2 text-sm text-destructive">
            {describeError(sentenceError)}
          </p>
        )}
        {followUp && (
          <p className="mt-2 text-sm text-muted-foreground">
            补充一下:{followUp}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3 border-t pt-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                日期
              </span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(event) => onFieldChange("date", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                类型
              </span>
              <select
                value={form.type}
                onChange={(event) =>
                  onFieldChange(
                    "type",
                    event.target.value === "income" ? "income" : "expense",
                  )
                }
                className={inputClass}
              >
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                分类
              </span>
              <input
                required
                maxLength={24}
                placeholder="餐饮"
                value={form.category}
                onChange={(event) =>
                  onFieldChange("category", event.target.value)
                }
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                账户
              </span>
              <input
                maxLength={24}
                placeholder="现金 / 微信(可留空)"
                value={form.account}
                onChange={(event) =>
                  onFieldChange("account", event.target.value)
                }
                className={inputClass}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              金额
            </span>
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={(event) => onFieldChange("amount", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              备注
            </span>
            <input
              maxLength={200}
              placeholder="可选"
              value={form.note}
              onChange={(event) => onFieldChange("note", event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={createPending}
          className={`${primaryButtonClass} mt-4`}
        >
          {createPending ? "生成中…" : "生成提案"}
        </button>
        {createError && (
          <p className="mt-2 text-sm text-destructive">
            {describeError(createError)}
          </p>
        )}
      </form>
    </section>
  );
}
