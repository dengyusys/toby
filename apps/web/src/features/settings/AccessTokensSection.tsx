/**
 * The access tokens card on the settings page: create, list, revoke. A new
 * token's secret exists only in the creation answer — the server keeps a
 * digest — so the panel that shows it is the one chance to copy it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  ApiError,
  type AccessTokenCreate,
  type AccessTokenView,
  type AuthScope,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { authClient } from "@/lib/api.ts";
import { AccessTokenList } from "./AccessTokenList.tsx";
import { CreatedTokenPanel } from "./CreatedTokenPanel.tsx";
import { FieldError } from "./FieldError.tsx";

const DAY_MS = 24 * 3_600_000;

const TOKENS_KEY = ["auth", "tokens"] as const;

type TokenList = { tokens: AccessTokenView[] };

export function AccessTokensSection() {
  const [name, setName] = useState("");
  // Read-only is the safe default: a token is widened on purpose, never by accident.
  const [scope, setScope] = useState<AuthScope>("read");
  const [days, setDays] = useState("");
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
      setDays("");
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const dayCount = days === "" ? null : Number(days);
    if (!trimmed) {
      setFormError("请填写名字");
      return;
    }
    if (dayCount !== null && (!Number.isInteger(dayCount) || dayCount < 1)) {
      setFormError("有效天数必须是大于 0 的整数");
      return;
    }
    setFormError("");
    createMutation.mutate({
      name: trimmed,
      scopes: [scope],
      // Omitted means "never expires" on the server.
      ...(dayCount === null
        ? {}
        : {
            expires_at: new Date(Date.now() + dayCount * DAY_MS).toISOString(),
          }),
    });
  }

  const createError = createMutation.isError
    ? createMutation.error instanceof ApiError
      ? createMutation.error.message
      : "创建失败,请稍后重试"
    : "";

  // The tab's name is in the tab bar; the heading keeps the page outline for
  // screen readers. It stays outside the spaced container so it adds no gap.
  return (
    <>
      <h2 className="sr-only">访问令牌</h2>
      <div className="space-y-6">
        {created && (
          <CreatedTokenPanel
            name={created.name}
            secret={created.secret}
            onDone={() => setCreated(null)}
          />
        )}

        <form
          onSubmit={submit}
          noValidate
          aria-label="新建访问令牌"
          className="rounded-xl border bg-card shadow-sm"
        >
          <fieldset
            disabled={createMutation.isPending}
            className="min-w-0 space-y-6 p-5 sm:p-7"
          >
            <legend className="sr-only">新建访问令牌</legend>
            <div>
              <Label htmlFor="token-name" className="text-sm font-medium">
                名字
              </Label>
              <Input
                id="token-name"
                className="mt-2 h-11 rounded-lg"
                value={name}
                placeholder="例如：我的主页、记账脚本"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <span className="text-sm font-medium">权限</span>
              <ToggleGroup
                type="single"
                value={scope}
                aria-label="权限"
                onValueChange={(next) => {
                  // Radix fires "" when the active item is tapped again — not
                  // a choice; the tier stays as it was.
                  if (next === "read" || next === "write") {
                    setScope(next);
                  }
                }}
                className="mt-2"
              >
                <ToggleGroupItem value="read">只读</ToggleGroupItem>
                <ToggleGroupItem value="write">读写</ToggleGroupItem>
              </ToggleGroup>
              <p className="mt-2 text-xs text-muted-foreground">
                只读只能查看;读写还能记账和发消息。
              </p>
            </div>
            <div>
              <Label htmlFor="token-days" className="text-sm font-medium">
                有效天数
              </Label>
              <Input
                id="token-days"
                type="number"
                min={1}
                className="mt-2 h-11 w-48 rounded-lg"
                value={days}
                placeholder="留空为永不过期"
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
            <FieldError id="token-error" message={formError || createError} />
          </fieldset>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-4 sm:px-7">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "创建中…" : "创建令牌"}
            </Button>
          </div>
        </form>

        <section aria-labelledby="token-list-heading">
          <h3 id="token-list-heading" className="mb-3 text-sm font-medium">
            已有的令牌
          </h3>
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
          ) : tokensQuery.data.tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有令牌。</p>
          ) : (
            <AccessTokenList
              tokens={tokensQuery.data.tokens}
              revokingId={
                revokeMutation.isPending ? revokeMutation.variables : undefined
              }
              onRevoke={(id) => revokeMutation.mutate(id)}
            />
          )}
          {revokeMutation.isError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              撤销失败,请稍后重试
            </p>
          )}
        </section>
      </div>
    </>
  );
}
