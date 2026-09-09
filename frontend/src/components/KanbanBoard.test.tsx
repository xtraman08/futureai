import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import {
  boardFixture,
  jsonResponse,
  type ApiBoardFixture,
} from "@/test/board-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ChatSidebar", () => ({
  ChatSidebar: () => null,
}));

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanBoard", () => {
  it("loads the authenticated board from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(boardFixture())),
    );

    render(<KanbanBoard />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading board");
    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(2);
  });

  it("retries a failed initial load", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(boardFixture()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<KanbanBoard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to connect to the server",
    );
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("persists a column rename after editing finishes", async () => {
    const renamedBoard = boardFixture();
    renamedBoard.version = 1;
    renamedBoard.columns[0].title = "Ideas";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(boardFixture()))
      .mockResolvedValueOnce(jsonResponse(renamedBoard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<KanbanBoard />);
    await screen.findByRole("heading", { name: "Kanban Studio" });
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await user.clear(input);
    await user.type(input, "Ideas");
    await user.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/board/columns/${boardFixture().columns[0].id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Ideas" }),
      }),
    );
    expect(await screen.findByText("Ideas")).toBeInTheDocument();
  });

  it("creates, edits, and deletes a card through the API", async () => {
    const baseBoard = boardFixture();
    const createdBoard: ApiBoardFixture = structuredClone(baseBoard);
    const newCard = {
      id: "0199224c-0000-7000-8000-000000000199",
      title: "New card",
      details: "Notes",
      position: 1,
    };
    createdBoard.columns[0].cards.push(newCard);
    createdBoard.version = 1;
    const editedBoard: ApiBoardFixture = structuredClone(createdBoard);
    editedBoard.columns[0].cards[1] = {
      ...newCard,
      title: "Edited card",
      details: "Revised notes",
    };
    editedBoard.version = 2;
    const deletedBoard: ApiBoardFixture = structuredClone(baseBoard);
    deletedBoard.version = 3;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(baseBoard))
      .mockResolvedValueOnce(jsonResponse(createdBoard))
      .mockResolvedValueOnce(jsonResponse(editedBoard))
      .mockResolvedValueOnce(jsonResponse(deletedBoard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<KanbanBoard />);
    await screen.findByRole("heading", { name: "Kanban Studio" });
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await user.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await user.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await user.type(detailsInput, "Notes");

    await user.click(within(column).getByRole("button", { name: /add card/i }));
    expect(await within(column).findByText("New card")).toBeInTheDocument();

    await user.click(
      within(column).getByRole("button", { name: /edit new card/i }),
    );
    const editTitle = within(column).getByLabelText(/edit title for new card/i);
    const editDetails = within(column).getByLabelText(
      /edit details for new card/i,
    );
    await user.clear(editTitle);
    await user.type(editTitle, "Edited card");
    await user.clear(editDetails);
    await user.type(editDetails, "Revised notes");
    await user.click(within(column).getByRole("button", { name: /^save$/i }));
    expect(await within(column).findByText("Edited card")).toBeInTheDocument();
    expect(within(column).getByText("Revised notes")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete edited card/i,
    });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(within(column).queryByText("Edited card")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps card input visible and reports failed mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(boardFixture()))
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Unable to save this card" }, 500),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<KanbanBoard />);
    await screen.findByRole("heading", { name: "Kanban Studio" });
    const column = getFirstColumn();
    await user.click(
      within(column).getByRole("button", { name: /add a card/i }),
    );
    await user.type(
      within(column).getByPlaceholderText(/card title/i),
      "Unsaved card",
    );
    await user.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save this card",
    );
    expect(within(column).getByPlaceholderText(/card title/i)).toHaveValue(
      "Unsaved card",
    );
  });

  it("ignores a second mutation dispatched in the same tick", async () => {
    const baseBoard = boardFixture();
    const deletedBoard: ApiBoardFixture = structuredClone(baseBoard);
    deletedBoard.columns[0].cards = [];
    deletedBoard.version = 1;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(baseBoard))
      .mockResolvedValueOnce(jsonResponse(deletedBoard));
    vi.stubGlobal("fetch", fetchMock);

    render(<KanbanBoard />);
    await screen.findByRole("heading", { name: "Kanban Studio" });

    const deleteFirstCard = screen.getByRole("button", {
      name: /delete align roadmap themes/i,
    });
    const deleteSecondCard = screen.getByRole("button", {
      name: /delete qa micro-interactions/i,
    });

    // Both dispatched synchronously, before either mutation's `await`
    // resolves - simulates two handlers racing in the same tick.
    fireEvent.click(deleteFirstCard);
    fireEvent.click(deleteSecondCard);

    await waitFor(() =>
      expect(
        screen.queryByText("Align roadmap themes"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("QA micro-interactions")).toBeInTheDocument();
    // 1 initial load + 1 accepted mutation; the racing second click never
    // reached the network.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders an explicit empty-board state", async () => {
    const emptyBoard = boardFixture();
    emptyBoard.columns = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(emptyBoard)),
    );

    render(<KanbanBoard />);

    expect(
      await screen.findByRole("heading", {
        name: /this board has no columns/i,
      }),
    ).toBeInTheDocument();
  });

  it("notifies the auth gate when the session expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Not authenticated" }, 401)),
    );
    const onSessionExpired = vi.fn();

    render(<KanbanBoard onSessionExpired={onSessionExpired} />);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
