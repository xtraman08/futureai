import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import { parseBoardResponse } from "@/lib/board-api";
import { boardFixture, jsonResponse } from "@/test/board-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

const proposalId = "0199224c-0000-7000-8000-000000000201";
const apiProposal = {
  id: proposalId,
  status: "pending",
  base_board_version: 0,
  operations: [
    {
      type: "create_card",
      column_id: "0199224c-0000-7000-8000-000000000010",
      title: "AI card",
      details: "",
    },
    {
      type: "rename_column",
      column_id: "0199224c-0000-7000-8000-000000000011",
      title: "Complete",
    },
  ],
};

const historyResponse = () => ({
  messages: [
    {
      id: "user-message",
      role: "user",
      content: "Update my board",
      created_at: "2026-09-07T12:00:00Z",
      proposal: null,
    },
    {
      id: proposalId,
      role: "assistant",
      content: "I prepared two changes.",
      created_at: "2026-09-07T12:00:01Z",
      proposal: apiProposal,
    },
  ],
});

const renderSidebar = (
  onBoardConfirmed = vi.fn(),
  onSessionExpired = vi.fn(),
) => {
  render(
    <ChatSidebar
      board={parseBoardResponse(boardFixture())}
      onBoardConfirmed={onBoardConfirmed}
      onSessionExpired={onSessionExpired}
    />,
  );
  return { onBoardConfirmed, onSessionExpired };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatSidebar", () => {
  it("restores history and renders an accessible proposal preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(historyResponse())),
    );
    const user = userEvent.setup();

    renderSidebar();

    const mobileToggle = screen.getByRole("button", { name: /ai assistant/i });
    expect(mobileToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(mobileToggle);
    expect(mobileToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("I prepared two changes.")).toBeInTheDocument();
    const preview = screen.getByRole("heading", {
      name: "Proposed changes",
    }).parentElement?.parentElement;
    expect(preview).toBeTruthy();
    expect(within(preview!).getByText(/create “ai card” in backlog/i)).toBeVisible();
    expect(
      within(preview!).getByText(/rename review to “complete”/i),
    ).toBeVisible();
    expect(
      within(preview!).getByRole("button", { name: "Confirm changes" }),
    ).toBeEnabled();
    expect(
      within(preview!).getByRole("button", { name: "Reject changes" }),
    ).toBeEnabled();
  });

  it("shows thinking state and appends a successful reply", async () => {
    let resolveSend: (response: Response) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSend = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderSidebar();
    await screen.findByText(/ask about the board/i);
    const composer = screen.getByLabelText("Message the board assistant");
    await user.type(composer, "What should I do next?{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant is thinking",
    );
    resolveSend(
      jsonResponse({
        id: "assistant-message",
        message: "Start with the backlog.",
        model: "openai/gpt-oss-120b",
        proposal: null,
      }),
    );

    expect(await screen.findByText("Start with the backlog.")).toBeVisible();
    expect(composer).toHaveValue("");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "What should I do next?" }),
      }),
    );
  });

  it("keeps the draft after a failure and allows retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Provider unavailable" }, 502),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "retry-response",
          message: "Recovered response",
          model: "openai/gpt-oss-120b",
          proposal: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderSidebar();
    await screen.findByText(/ask about the board/i);
    const composer = screen.getByLabelText("Message the board assistant");
    await user.type(composer, "Retry me");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable",
    );
    expect(composer).toHaveValue("Retry me");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Recovered response")).toBeVisible();
    expect(composer).toHaveValue("");
  });

  it("confirms a proposal and replaces the board from the response", async () => {
    const confirmedBoard = boardFixture();
    confirmedBoard.version = 1;
    confirmedBoard.columns[0].title = "Ideas";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(historyResponse()))
      .mockResolvedValueOnce(jsonResponse(confirmedBoard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { onBoardConfirmed } = renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Confirm changes" }),
    );

    await waitFor(() => expect(onBoardConfirmed).toHaveBeenCalledOnce());
    expect(onBoardConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
    );
    expect(screen.getByText("Applied")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/chat/proposals/${proposalId}/confirm`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("marks sibling pending proposals stale after one is confirmed", async () => {
    const secondProposalId = "0199224c-0000-7000-8000-000000000202";
    const secondProposal = {
      ...apiProposal,
      id: secondProposalId,
      base_board_version: 0,
    };
    const twoProposalHistory = () => ({
      messages: [
        ...historyResponse().messages,
        {
          id: "user-message-2",
          role: "user",
          content: "Update it again",
          created_at: "2026-09-07T12:00:02Z",
          proposal: null,
        },
        {
          id: secondProposalId,
          role: "assistant",
          content: "I prepared another change.",
          created_at: "2026-09-07T12:00:03Z",
          proposal: secondProposal,
        },
      ],
    });
    const confirmedBoard = boardFixture();
    confirmedBoard.version = 1;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(twoProposalHistory()))
      .mockResolvedValueOnce(jsonResponse(confirmedBoard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSidebar();

    const confirmButtons = await screen.findAllByRole("button", {
      name: "Confirm changes",
    });
    expect(confirmButtons).toHaveLength(2);
    await user.click(confirmButtons[0]);

    await waitFor(() =>
      expect(screen.getAllByText("Applied")).toHaveLength(1),
    );
    expect(screen.getByText("Out of date")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Confirm changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject changes" }),
    ).not.toBeInTheDocument();
  });

  it("rejects a proposal without updating the board", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(historyResponse()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { onBoardConfirmed } = renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Reject changes" }),
    );

    expect(await screen.findByText("Rejected")).toBeVisible();
    expect(onBoardConfirmed).not.toHaveBeenCalled();
  });
});
