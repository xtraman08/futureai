import {
  chatApi,
  ChatApiError,
  parseChatHistory,
  parseSendChatResponse,
} from "@/lib/chat-api";
import { boardFixture, jsonResponse } from "@/test/board-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

const columnId = "0199224c-0000-7000-8000-000000000010";
const cardId = "0199224c-0000-7000-8000-000000000101";

const proposal = {
  id: "0199224c-0000-7000-8000-000000000201",
  status: "pending",
  base_board_version: 0,
  operations: [
    {
      type: "create_card",
      column_id: columnId,
      title: "Created",
      details: "",
    },
    {
      type: "edit_card",
      card_id: cardId,
      title: "Edited",
      details: null,
    },
    {
      type: "move_card",
      card_id: cardId,
      target_column_id: columnId,
      target_position: 0,
    },
    { type: "delete_card", card_id: cardId },
    { type: "rename_column", column_id: columnId, title: "Ideas" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat API", () => {
  it("parses persisted messages and every operation type", () => {
    const messages = parseChatHistory({
      messages: [
        {
          id: "user-message",
          role: "user",
          content: "Update the board",
          created_at: "2026-09-07T12:00:00Z",
          proposal: null,
        },
        {
          id: proposal.id,
          role: "assistant",
          content: "I prepared changes.",
          created_at: "2026-09-07T12:00:01Z",
          proposal,
        },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1].proposal?.operations.map(({ type }) => type)).toEqual([
      "create_card",
      "edit_card",
      "move_card",
      "delete_card",
      "rename_column",
    ]);
  });

  it("loads history and sends a message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: proposal.id,
          message: "I prepared changes.",
          model: "openai/gpt-oss-120b",
          proposal,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatApi.getHistory()).resolves.toEqual([]);
    const response = await chatApi.send("Update the board");

    expect(response.proposal?.id).toBe(proposal.id);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "Update the board" }),
      }),
    );
  });

  it("confirms and rejects proposals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(boardFixture()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatApi.confirm(proposal.id)).resolves.toMatchObject({
      title: "Kanban Studio",
    });
    await expect(chatApi.reject(proposal.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/chat/proposals/${proposal.id}/confirm`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/chat/proposals/${proposal.id}/reject`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns safe API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: "Proposal is stale" }, 409),
      ),
    );

    await expect(chatApi.confirm(proposal.id)).rejects.toEqual(
      expect.objectContaining<Partial<ChatApiError>>({
        message: "Proposal is stale",
        status: 409,
      }),
    );
  });

  it("rejects malformed chat payloads", () => {
    expect(() =>
      parseSendChatResponse({
        id: "message",
        message: "Broken",
        model: "model",
        proposal: {
          ...proposal,
          operations: [{ type: "unknown" }],
        },
      }),
    ).toThrow("invalid chat response");
  });
});
