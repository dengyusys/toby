/** Both memory receipt wire shapes registered into the chat card table. */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { cardRendererFor } from "../src/features/chat/card-renderers.tsx";

const CREATED_AT = "2026-11-14T08:00:00.000Z";
const LEDGER_RECEIPT = {
  written: 1,
  transaction_ids: [1],
  created_at: CREATED_AT,
  entries: [
    {
      date: "2026-11-14",
      type: "expense",
      category: "餐饮",
      amount: 2550,
      note: "午饭",
    },
  ],
};

afterEach(cleanup);

it("renders an in-run receipt with its before to after diff", () => {
  const Card = cardRendererFor("memory");
  if (!Card) throw new Error("memory card renderer is not registered");
  render(
    <Card
      receipt={{
        action: "updated",
        type: "约定",
        before: "- 咖啡记「饮品」",
        after: "- 咖啡记「饮品」，不加糖",
        created_at: CREATED_AT,
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "已更新" })).toBeInTheDocument();
  expect(screen.getByText("约定")).toBeInTheDocument();
  expect(screen.getByText("- 咖啡记「饮品」")).toBeInTheDocument();
  expect(screen.getByText("- 咖啡记「饮品」，不加糖")).toBeInTheDocument();
});

it("renders every routed receipt and the verbatim listed block", () => {
  const Card = cardRendererFor("memory");
  if (!Card) throw new Error("memory card renderer is not registered");
  render(
    <Card
      receipt={{
        receipts: [
          {
            action: "updated",
            type: "关于我",
            before: "- 不吃香菜",
            after: "- 不吃葱",
            created_at: CREATED_AT,
          },
          {
            action: "forgot",
            type: "人物",
            before: "- 小王:房东",
            created_at: CREATED_AT,
          },
        ],
        listed: ["- 不吃葱", "- 在减脂"],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "已更新" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "已清理" })).toBeInTheDocument();
  expect(screen.getByText("- 不吃香菜")).toBeInTheDocument();
  // Once in the diff and once verbatim in the requested listing.
  expect(screen.getAllByText("- 不吃葱")).toHaveLength(2);
  expect(screen.getByText("- 小王:房东")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "已逐条列出" }),
  ).toBeInTheDocument();
  expect(screen.getByText("- 在减脂")).toBeInTheDocument();
});

it("renders memory sidecar lines beneath a ledger receipt", () => {
  const Card = cardRendererFor("ledger");
  if (!Card) throw new Error("ledger card renderer is not registered");
  render(
    <Card
      receipt={{
        ...LEDGER_RECEIPT,
        memory_receipts: [
          {
            action: "updated",
            type: "约定",
            before: "- 咖啡记「饮品」",
            after: "- 咖啡记「饮品」，不加糖",
            created_at: CREATED_AT,
          },
        ],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "已记入" })).toBeInTheDocument();
  expect(screen.getByText("记忆")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "已更新" })).toBeInTheDocument();
  expect(screen.getByText("- 咖啡记「饮品」")).toBeInTheDocument();
  expect(screen.getByText("- 咖啡记「饮品」，不加糖")).toBeInTheDocument();
});

it("keeps the ledger card unchanged when the memory sidecar is absent", () => {
  const Card = cardRendererFor("ledger");
  if (!Card) throw new Error("ledger card renderer is not registered");
  const { container } = render(<Card receipt={LEDGER_RECEIPT} />);

  expect(screen.getByRole("heading", { name: "已记入" })).toBeInTheDocument();
  expect(screen.getByText("餐饮 · 午饭")).toBeInTheDocument();
  expect(screen.getByText("-¥25.50")).toBeInTheDocument();
  expect(screen.queryByText("记忆")).not.toBeInTheDocument();
  expect(container.firstChild).toMatchSnapshot();
});
