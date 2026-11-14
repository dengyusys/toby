/**
 * The ledger receipt card's dispatch: current update results render the
 * diff, while proposal-era history (status: "committed" receipts with
 * entries) renders as plain recorded cards — never as update results,
 * which white-screened the chat page on old history.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { cardRendererFor } from "../src/features/chat/card-renderers.tsx";

const CREATED_AT = "2026-11-14T08:00:00.000Z";

function entry(amount: number) {
  return {
    date: "2026-11-14",
    type: "expense" as const,
    category: "餐饮",
    amount,
    note: "午饭",
  };
}

afterEach(cleanup);

it("renders a proposal-era committed receipt as a plain recorded card", () => {
  const Card = cardRendererFor("ledger");
  if (!Card) throw new Error("ledger card renderer is not registered");
  render(
    <Card
      receipt={{
        proposal_id: "p1",
        status: "committed",
        created_at: CREATED_AT,
        committed_at: CREATED_AT,
        revert_until: CREATED_AT,
        written: 1,
        transaction_ids: [1],
        entries: [entry(2550)],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "已记入" })).toBeInTheDocument();
  expect(screen.getByText("餐饮 · 午饭")).toBeInTheDocument();
  expect(screen.getByText("-¥25.50")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "已修改" }),
  ).not.toBeInTheDocument();
});

it("still renders a current update result as the before to after diff", () => {
  const Card = cardRendererFor("ledger");
  if (!Card) throw new Error("ledger card renderer is not registered");
  render(
    <Card
      receipt={{
        transaction_id: 1,
        action: "updated",
        before: { ...entry(2550), id: 1, created_at: CREATED_AT },
        after: { ...entry(3000), id: 1, created_at: CREATED_AT },
        updated_at: CREATED_AT,
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "已修改" })).toBeInTheDocument();
  expect(screen.getByText("¥25.50")).toBeInTheDocument();
  expect(screen.getByText("¥30.00")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "已记入" }),
  ).not.toBeInTheDocument();
});
