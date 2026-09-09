import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

type ApiBoard = {
  id: string;
  title: string;
  version: number;
  columns: Array<{
    id: string;
    title: string;
    position: number;
    cards: Array<{
      id: string;
      title: string;
      details: string;
      position: number;
    }>;
  }>;
};

const signIn = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Kanban Studio" }),
  ).toBeVisible();
};

const openChat = async (page: import("@playwright/test").Page) => {
  const toggle = page.getByRole("button", { name: /ai assistant/i });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  await expect(page.getByLabel("Message the board assistant")).toBeVisible();
};

const dragTo = async (
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) => {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + Math.min(120, targetBox.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();
};

test("requires valid credentials and supports logout", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /sign in to your workspace/i }),
  ).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();

  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Kanban Studio" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: /sign in to your workspace/i }),
  ).toBeVisible();
});

test.describe("authenticated kanban board", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("loads the kanban board", async ({ page }) => {
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
    await expect(page.getByText("Signed in as")).toBeVisible();
  });

  test("creates, edits, reloads, and deletes a card", async ({ page }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("E2E persistent card");
    await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E persistent card")).toBeVisible();

    await firstColumn
      .getByRole("button", { name: /edit e2e persistent card/i })
      .click();
    await firstColumn
      .getByLabel(/edit title for e2e persistent card/i)
      .fill("E2E edited card");
    await firstColumn
      .getByLabel(/edit details for e2e persistent card/i)
      .fill("Edited and persisted.");
    await firstColumn.getByRole("button", { name: /^save$/i }).click();
    await expect(firstColumn.getByText("E2E edited card")).toBeVisible();

    await page.reload();
    await expect(page.getByText("E2E edited card")).toBeVisible();
    await expect(page.getByText("Edited and persisted.")).toBeVisible();

    await page
      .getByRole("button", { name: /delete e2e edited card/i })
      .click();
    await expect(page.getByText("E2E edited card")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("E2E edited card")).toHaveCount(0);
  });

  test("renames a column and persists it after reload", async ({ page }) => {
    const firstTitle = page.getByLabel("Column title").first();
    const originalTitle = await firstTitle.inputValue();
    await firstTitle.fill("E2E Ideas");
    await firstTitle.press("Enter");
    await expect(firstTitle).toHaveValue("E2E Ideas");
    await expect(
      page.locator("header").getByText("E2E Ideas", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Column title").first()).toHaveValue(
      "E2E Ideas",
    );

    await page.getByLabel("Column title").first().fill(originalTitle);
    await page.getByLabel("Column title").first().press("Enter");
    await expect(
      page.locator("header").getByText(originalTitle, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Column title").first()).toHaveValue(
      originalTitle,
    );
  });

  test("moves a card between columns and persists after reload", async ({
    page,
  }) => {
    const columns = page.locator('[data-testid^="column-"]');
    const sourceColumn = columns.first();
    const targetColumn = columns.nth(3);

    await sourceColumn.getByRole("button", { name: /add a card/i }).click();
    await sourceColumn.getByPlaceholder("Card title").fill("E2E move card");
    await sourceColumn.getByRole("button", { name: /add card/i }).click();
    const card = sourceColumn
      .locator('[data-testid^="card-"]')
      .filter({ hasText: "E2E move card" });
    await expect(card).toBeVisible();
    const cardTestId = await card.getAttribute("data-testid");
    if (!cardTestId) {
      throw new Error("Card test ID is unavailable.");
    }

    await dragTo(
      page,
      card.getByRole("button", { name: /^move /i }),
      targetColumn,
    );
    await expect(targetColumn.getByTestId(cardTestId)).toBeVisible();

    await page.reload();
    const reloadedColumns = page.locator('[data-testid^="column-"]');
    await expect(reloadedColumns.nth(3).getByTestId(cardTestId)).toBeVisible();

    await dragTo(
      page,
      reloadedColumns
        .nth(3)
        .getByTestId(cardTestId)
        .getByRole("button", { name: /^move /i }),
      reloadedColumns.first(),
    );
    await expect(reloadedColumns.first().getByTestId(cardTestId)).toBeVisible();

    await reloadedColumns
      .first()
      .getByTestId(cardTestId)
      .getByRole("button", { name: /delete e2e move card/i })
      .click();
    // A page-wide text search would also match the dnd-kit live region,
    // which still holds the last drag announcement mentioning this card's
    // title; scope to the card heading instead.
    await expect(
      page.getByRole("heading", { name: "E2E move card" }),
    ).toHaveCount(0);
  });

  test("reorders cards in one column and persists after reload", async ({
    page,
  }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    const cards = firstColumn.locator('[data-testid^="card-"]');
    const orderedIds = () =>
      cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")),
      );

    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("E2E reorder card A");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E reorder card A")).toBeVisible();

    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("E2E reorder card B");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E reorder card B")).toBeVisible();

    const cardA = cards.filter({ hasText: "E2E reorder card A" });
    const cardB = cards.filter({ hasText: "E2E reorder card B" });
    const cardAId = await cardA.getAttribute("data-testid");
    const cardBId = await cardB.getAttribute("data-testid");
    if (!cardAId || !cardBId) {
      throw new Error("Card test IDs are unavailable.");
    }

    const before = await orderedIds();
    const indexA = before.indexOf(cardAId);
    expect(before[indexA + 1]).toBe(cardBId);

    await dragTo(page, cardA.getByRole("button", { name: /^move /i }), cardB);
    await expect
      .poll(async () => (await orderedIds())[indexA])
      .toBe(cardBId);
    await expect
      .poll(async () => (await orderedIds())[indexA + 1])
      .toBe(cardAId);

    await page.reload();
    const reloadedColumn = page.locator('[data-testid^="column-"]').first();
    const reloadedOrderedIds = () =>
      reloadedColumn
        .locator('[data-testid^="card-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    // Reload only waits for the page to load, not for the board fetch that
    // follows on mount, so poll rather than reading the order once.
    await expect
      .poll(async () => (await reloadedOrderedIds())[indexA])
      .toBe(cardBId);
    await expect
      .poll(async () => (await reloadedOrderedIds())[indexA + 1])
      .toBe(cardAId);

    await reloadedColumn
      .getByTestId(cardAId)
      .getByRole("button", { name: /delete e2e reorder card a/i })
      .click();
    await reloadedColumn
      .getByTestId(cardBId)
      .getByRole("button", { name: /delete e2e reorder card b/i })
      .click();
    // Scoped to the heading role - a page-wide text search would also
    // match the dnd-kit live region, which still holds the last drag
    // announcement mentioning one of these titles.
    await expect(
      page.getByRole("heading", { name: "E2E reorder card A" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "E2E reorder card B" }),
    ).toHaveCount(0);
  });

  test("reorders cards in one column with the keyboard and persists after reload", async ({
    page,
  }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    const cards = firstColumn.locator('[data-testid^="card-"]');
    const orderedIds = () =>
      cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")),
      );

    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn
      .getByPlaceholder("Card title")
      .fill("E2E keyboard card A");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E keyboard card A")).toBeVisible();

    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn
      .getByPlaceholder("Card title")
      .fill("E2E keyboard card B");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E keyboard card B")).toBeVisible();

    const cardA = cards.filter({ hasText: "E2E keyboard card A" });
    const cardAId = await cardA.getAttribute("data-testid");
    const cardBId = await cards
      .filter({ hasText: "E2E keyboard card B" })
      .getAttribute("data-testid");
    if (!cardAId || !cardBId) {
      throw new Error("Card test IDs are unavailable.");
    }

    const before = await orderedIds();
    const indexA = before.indexOf(cardAId);
    expect(before[indexA + 1]).toBe(cardBId);

    // dnd-kit's default keyboard coordinate getter: Space picks up the
    // focused sortable item, arrow keys step it past its neighbours, and
    // Space again drops it - this is the keyboard path M-5 added.
    const moveHandle = cardA.getByRole("button", { name: /^move /i });
    await moveHandle.focus();
    await moveHandle.press("Space");
    await moveHandle.press("ArrowDown");
    await moveHandle.press("Space");

    await expect.poll(async () => (await orderedIds())[indexA]).toBe(cardBId);
    await expect
      .poll(async () => (await orderedIds())[indexA + 1])
      .toBe(cardAId);

    await page.reload();
    const reloadedColumn = page.locator('[data-testid^="column-"]').first();
    const reloadedOrderedIds = () =>
      reloadedColumn
        .locator('[data-testid^="card-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    // Reload only waits for the page to load, not for the board fetch that
    // follows on mount, so poll rather than reading the order once.
    await expect
      .poll(async () => (await reloadedOrderedIds())[indexA])
      .toBe(cardBId);
    await expect
      .poll(async () => (await reloadedOrderedIds())[indexA + 1])
      .toBe(cardAId);

    await reloadedColumn
      .getByTestId(cardAId)
      .getByRole("button", { name: /delete e2e keyboard card a/i })
      .click();
    await reloadedColumn
      .getByTestId(cardBId)
      .getByRole("button", { name: /delete e2e keyboard card b/i })
      .click();
    // Scoped to the heading role - a page-wide text search would also
    // match the dnd-kit live region, which still holds the last drag
    // announcement mentioning one of these titles.
    await expect(
      page.getByRole("heading", { name: "E2E keyboard card A" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "E2E keyboard card B" }),
    ).toHaveCount(0);
  });

  test("shows server failures without displaying an unsaved card", async ({
    page,
  }) => {
    await page.route("**/api/board/cards", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Simulated save failure" }),
        });
        return;
      }
      await route.continue();
    });

    const firstColumn = page.locator('[data-testid^="column-"]').first();
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("Unsaved E2E card");
    await firstColumn.getByRole("button", { name: /add card/i }).click();

    await expect(page.getByText("Simulated save failure")).toBeVisible();
    await expect(firstColumn.getByPlaceholder("Card title")).toHaveValue(
      "Unsaved E2E card",
    );
    await expect(firstColumn.getByRole("heading", {
      name: "Unsaved E2E card",
    })).toHaveCount(0);
  });

  test("persists a card through a container restart", async ({ page }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn
      .getByPlaceholder("Card title")
      .fill("E2E restart card");
    await firstColumn
      .getByPlaceholder("Details")
      .fill("Survives container replacement.");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText("E2E restart card")).toBeVisible();

    execFileSync("docker", ["compose", "restart", "app"], {
      cwd: path.resolve(process.cwd(), ".."),
      stdio: "pipe",
    });
    await expect
      .poll(async () => {
        try {
          return (await fetch("http://127.0.0.1:8000/api/health")).ok;
        } catch {
          return false;
        }
      })
      .toBe(true);

    await signIn(page);
    await expect(page.getByText("E2E restart card")).toBeVisible();
    await expect(page.getByText("Survives container replacement.")).toBeVisible();
    await page
      .getByRole("button", { name: /delete e2e restart card/i })
      .click();
    await expect(page.getByText("E2E restart card")).toHaveCount(0);
  });

  test("shows a text reply and restores chat history after reload", async ({
    page,
  }) => {
    const messages: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ messages }),
        });
        return;
      }
      const question = (route.request().postDataJSON() as { message: string })
        .message;
      const assistantId = "00000000-0000-7000-8000-000000000301";
      messages.push(
        {
          id: "00000000-0000-7000-8000-000000000300",
          role: "user",
          content: question,
          created_at: "2026-09-07T12:00:00Z",
          proposal: null,
        },
        {
          id: assistantId,
          role: "assistant",
          content: "Focus on the oldest backlog card.",
          created_at: "2026-09-07T12:00:01Z",
          proposal: null,
        },
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: assistantId,
          message: "Focus on the oldest backlog card.",
          model: "openai/gpt-oss-120b",
          proposal: null,
        }),
      });
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" }),
    ).toBeVisible();
    await openChat(page);
    await page
      .getByLabel("Message the board assistant")
      .fill("What should I do next?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      page.getByText("Focus on the oldest backlog card."),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" }),
    ).toBeVisible();
    await openChat(page);
    await expect(
      page.getByText("Focus on the oldest backlog card."),
    ).toBeVisible();
  });

  test("previews, rejects, and confirms multi-change proposals", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ messages: [] }),
        });
        return;
      }
      await route.fallback();
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" }),
    ).toBeVisible();
    await openChat(page);

    const initialBoard = await page.evaluate(async () => {
      const response = await fetch("/api/board");
      return (await response.json()) as ApiBoard;
    });
    const source = initialBoard.columns.find(
      (column) => column.cards.length >= 2,
    );
    const target = initialBoard.columns.find(
      (column) => column.id !== source?.id,
    );
    if (!source || !target) {
      throw new Error("The E2E board needs two populated workflow columns.");
    }
    const editedCard = source.cards[0];
    const movedCard = source.cards[1];
    const operations = [
      {
        type: "create_card",
        column_id: target.id,
        title: "AI E2E card",
        details: "Created after confirmation.",
      },
      {
        type: "edit_card",
        card_id: editedCard.id,
        title: "AI edited title",
        details: null,
      },
      {
        type: "move_card",
        card_id: movedCard.id,
        target_column_id: target.id,
        target_position: 0,
      },
    ];
    const confirmedBoard = structuredClone(initialBoard);
    confirmedBoard.version += 1;
    const confirmedSource = confirmedBoard.columns.find(
      (column) => column.id === source.id,
    )!;
    const confirmedTarget = confirmedBoard.columns.find(
      (column) => column.id === target.id,
    )!;
    confirmedSource.cards[0].title = "AI edited title";
    const [moved] = confirmedSource.cards.splice(1, 1);
    confirmedSource.cards.forEach((card, index) => {
      card.position = index;
    });
    confirmedTarget.cards.unshift({ ...moved, position: 0 });
    confirmedTarget.cards.push({
      id: "00000000-0000-7000-8000-000000000399",
      title: "AI E2E card",
      details: "Created after confirmation.",
      position: confirmedTarget.cards.length,
    });
    confirmedTarget.cards.forEach((card, index) => {
      card.position = index;
    });

    let proposalNumber = 0;
    await page.unroute("**/api/chat");
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ messages: [] }),
        });
        return;
      }
      proposalNumber += 1;
      const proposalId = `00000000-0000-7000-8000-00000000030${proposalNumber}`;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: proposalId,
          message: "I prepared three changes.",
          model: "openai/gpt-oss-120b",
          proposal: {
            id: proposalId,
            status: "pending",
            base_board_version: initialBoard.version,
            operations,
          },
        }),
      });
    });
    await page.route("**/api/chat/proposals/*/reject", async (route) => {
      await route.fulfill({ status: 204 });
    });
    await page.route("**/api/chat/proposals/*/confirm", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(confirmedBoard),
      });
    });

    const composer = page.getByLabel("Message the board assistant");
    await composer.fill("Prepare board changes");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/create “ai e2e card”/i)).toBeVisible();
    await expect(page.getByText(/edit “/i)).toBeVisible();
    await expect(page.getByText(/move “/i)).toBeVisible();
    await page.getByRole("button", { name: "Reject changes" }).click();
    await expect(page.getByText("Rejected")).toBeVisible();
    await expect(
      page
        .locator(`[data-testid="column-${target.id}"]`)
        .getByRole("heading", { name: "AI E2E card" }),
    ).toHaveCount(0);

    await composer.fill("Prepare the changes again");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("button", { name: "Confirm changes" }).click();
    await expect(
      page.getByRole("heading", { name: "AI edited title" }),
    ).toBeVisible();
    await expect(
      page
        .locator(`[data-testid="column-${target.id}"]`)
        .getByTestId(`card-${movedCard.id}`),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI E2E card" }),
    ).toBeVisible();
  });

  test("shows provider failures and keeps the unsent chat draft", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ messages: [] }),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "AI service is unavailable" }),
      });
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" }),
    ).toBeVisible();
    await openChat(page);
    const composer = page.getByLabel("Message the board assistant");
    await composer.fill("Keep this draft");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("AI service is unavailable")).toBeVisible();
    await expect(composer).toHaveValue("Keep this draft");
  });

  test("opens and closes chat without blocking the mobile board", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      });
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" }),
    ).toBeVisible();

    const toggle = page.getByRole("button", { name: /ai assistant/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Message the board assistant")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Message the board assistant")).toBeHidden();
    await expect(
      page.locator('[data-testid^="column-"]').first().getByRole("button", {
        name: /add a card/i,
      }),
    ).toBeVisible();
  });
});
