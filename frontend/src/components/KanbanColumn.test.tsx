import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanColumn } from "@/components/KanbanColumn";
import type { Column } from "@/lib/kanban";
import { describe, expect, it, vi } from "vitest";

const buildColumn = (title: string): Column => ({
  id: "0199224c-0000-7000-8000-000000000010",
  title,
  cardIds: [],
});

const noopHandlers = () => ({
  onRename: vi.fn().mockResolvedValue(true),
  onAddCard: vi.fn().mockResolvedValue(true),
  onEditCard: vi.fn().mockResolvedValue(true),
  onDeleteCard: vi.fn().mockResolvedValue(true),
});

describe("KanbanColumn", () => {
  it("adopts an externally updated title while not being edited", () => {
    const { rerender } = render(
      <KanbanColumn column={buildColumn("Backlog")} cards={[]} {...noopHandlers()} />,
    );

    expect(screen.getByLabelText("Column title")).toHaveValue("Backlog");

    rerender(
      <KanbanColumn
        column={buildColumn("Renamed by another tab")}
        cards={[]}
        {...noopHandlers()}
      />,
    );

    expect(screen.getByLabelText("Column title")).toHaveValue(
      "Renamed by another tab",
    );
  });

  it("keeps an in-progress edit when unrelated props change", async () => {
    const column = buildColumn("Backlog");
    const handlers = noopHandlers();
    const { rerender } = render(
      <KanbanColumn column={column} cards={[]} {...handlers} />,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText("Column title");
    await user.clear(input);
    await user.type(input, "Draft title");

    rerender(<KanbanColumn column={column} cards={[]} {...handlers} disabled={false} />);

    expect(screen.getByLabelText("Column title")).toHaveValue("Draft title");
  });
});
