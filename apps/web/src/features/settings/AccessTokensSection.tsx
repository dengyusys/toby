/**
 * The access tokens tab: a table of the live tokens, an add button that opens
 * a one-field form, and revoke on each row. A new token's secret exists only
 * in the creation answer — the server keeps a digest — so the panel that
 * shows it is the one chance to copy it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  ApiError,
  type AccessTokenCreate,
  type AccessTokenView,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { authClient } from "@/lib/api.ts";
import { AccessTokenTable } from "./AccessTokenTable.tsx";
import { CreatedTokenPanel } from "./CreatedTokenPanel.tsx";
import { FieldError } from "./FieldError.tsx";
import { FORM_ROW, FORM_ROW_LABEL } from "./form-row.ts";

const TOKENS_KEY = ["auth", "tokens"] as const;

type TokenList = { tokens: AccessTokenView[] };

export function AccessTokensSection() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const tokensQuery = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => authClient.listTokens(),
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: AccessTokenCreate) => authClient.createToken(body),
    onSuccess: (result) => {
      // The answer already carries the new row; no refetch needed.
      queryClient.setQueryData<TokenList>(TOKENS_KEY, (current) => ({
        tokens: [result.token, ...(current?.tokens ?? [])],
      }));
      setCreated({ name: result.token.name, secret: result.secret });
      setName("");
      setAdding(false);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => authClient.revokeToken(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<TokenList>(TOKENS_KEY, (current) => ({
        tokens: (current?.tokens ?? []).filter((token) => token.id !== id),
      }));
    },
  });

  /** Closes the form and forgets whatever was typed or reported in it. */
  function closeForm() {
    setAdding(false);
    setName("");
    setFormError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("请填写名字");
      return;
    }
    setFormError("");
    createMutation.mutate({ name: trimmed });
  }

  const createError = createMutation.isError
    ? createMutation.error instanceof ApiError
      ? createMutation.error.message
      : "创建失败,请稍后重试"
    : "";

  // The tab's name is in the tab bar; the heading keeps the page outline for
  // screen readers.
  return (
    <>
      <h2 className="sr-only">访问令牌</h2>
      <div className="space-y-4">
        {created && (
          <CreatedTokenPanel
            name={created.name}
            secret={created.secret}
            onDone={() => setCreated(null)}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            已有的令牌
          </h3>
          <Button
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding}
            aria-expanded={adding}
            aria-controls="new-token-form"
          >
            添加令牌
          </Button>
        </div>

        {adding && (
          <form
            id="new-token-form"
            onSubmit={submit}
            noValidate
            aria-label="新建访问令牌"
            className="@container rounded-lg border bg-card"
          >
            <fieldset
              disabled={createMutation.isPending}
              className="min-w-0 p-4 sm:p-5"
            >
              <legend className="sr-only">新建访问令牌</legend>
              <div className={FORM_ROW}>
                <Label htmlFor="token-name" className={FORM_ROW_LABEL}>
                  名字
                </Label>
                <div>
                  {/* One field, its action, and the way back out. */}
                  <div className="flex gap-2">
                    <Input
                      id="token-name"
                      className="min-w-0 flex-1"
                      value={name}
                      placeholder="例如：我的主页、记账脚本"
                      autoFocus
                      onChange={(event) => setName(event.target.value)}
                    />
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "创建中…" : "创建"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={createMutation.isPending}
                      onClick={closeForm}
                    >
                      取消
                    </Button>
                  </div>
                  {(formError || createError) && (
                    <FieldError
                      id="token-error"
                      message={formError || createError}
                    />
                  )}
                </div>
              </div>
            </fieldset>
          </form>
        )}

        {tokensQuery.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取令牌…
          </p>
        ) : tokensQuery.isError ? (
          <div>
            <p role="alert" className="text-sm text-destructive">
              无法读取令牌。
            </p>
            <Button
              variant="outline"
              className="mt-3"
              disabled={tokensQuery.isFetching}
              onClick={() => void tokensQuery.refetch()}
            >
              重新读取
            </Button>
          </div>
        ) : (
          <AccessTokenTable
            tokens={tokensQuery.data.tokens}
            revokingId={
              revokeMutation.isPending ? revokeMutation.variables : undefined
            }
            onRevoke={(id) => revokeMutation.mutate(id)}
          />
        )}
        {revokeMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            撤销失败,请稍后重试
          </p>
        )}
      </div>
    </>
  );
}
