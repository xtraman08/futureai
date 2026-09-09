import { boardApi, BoardApiError, parseBoardResponse } from "@/lib/board-api";
import { boardFixture, jsonResponse } from "@/test/board-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseBoardResponse", () => {
  it("validates, orders, and normalizes the backend board contract", () => {
    const payload = boardFixture();
    payload.columns.reverse();
    payload.columns[1].cards.push({
      id: "0199224c-0000-7000-8000-000000000103",
      title: "Second backlog card",
      details: "",
      position: 1,
    });
    payload.columns[1].cards.reverse();

    const board = parseBoardResponse(payload);

    expect(board.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "Review",
    ]);
    expect(board.columns[0].cardIds).toEqual([
      "0199224c-0000-7000-8000-000000000101",
      "0199224c-0000-7000-8000-000000000103",
    ]);
    expect(board.cards["0199224c-0000-7000-8000-000000000103"]).toEqual({
      id: "0199224c-0000-7000-8000-000000000103",
      title: "Second backlog card",
      details: "",
    });
  });

  it("rejects malformed and duplicate resources", () => {
    expect(() => parseBoardResponse({ title: "Missing fields" })).toThrow(
      BoardApiError,
    );

    const duplicate = boardFixture();
    duplicate.columns[1].cards[0].id = duplicate.columns[0].cards[0].id;
    expect(() => parseBoardResponse(duplicate)).toThrow(/duplicate card/i);
  });
});

describe("boardApi", () => {
  it("sends every board mutation using the backend contract", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(boardFixture())),
    );
    vi.stubGlobal("fetch", fetchMock);
    const columnId = boardFixture().columns[0].id;
    const cardId = boardFixture().columns[0].cards[0].id;

    await boardApi.get();
    await boardApi.renameColumn(columnId, "Ideas");
    await boardApi.createCard(columnId, "New", "Notes");
    await boardApi.updateCard(cardId, "Edited", "New notes");
    await boardApi.moveCard(cardId, columnId, 1);
    await boardApi.deleteCard(cardId);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/board", {
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/board/columns/${columnId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Ideas" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/board/cards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          column_id: columnId,
          title: "New",
          details: "Notes",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/board/cards/${cardId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Edited", details: "New notes" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `/api/board/cards/${cardId}/move`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          target_column_id: columnId,
          target_position: 1,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      `/api/board/cards/${cardId}`,
      { method: "DELETE" },
    );
  });

  it("maps API, network, and malformed response failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "Card not found" }, 404))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(boardApi.get()).rejects.toMatchObject({
      message: "Card not found",
      status: 404,
    });
    await expect(boardApi.get()).rejects.toMatchObject({
      message: "Unable to connect to the server.",
      status: 0,
    });
    await expect(boardApi.get()).rejects.toMatchObject({ status: 502 });
  });
});
