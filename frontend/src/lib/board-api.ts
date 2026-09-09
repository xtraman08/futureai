import type { BoardData, Card, Column } from "@/lib/kanban";

type JsonRecord = Record<string, unknown>;

export class BoardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BoardApiError";
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown, field: string) => {
  if (typeof value !== "string") {
    throw new BoardApiError(`Invalid board response: ${field}`, 502);
  }
  return value;
};

const readPosition = (value: unknown, field: string) => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BoardApiError(`Invalid board response: ${field}`, 502);
  }
  return value as number;
};

const parseCard = (value: unknown, path: string) => {
  if (!isRecord(value)) {
    throw new BoardApiError(`Invalid board response: ${path}`, 502);
  }
  return {
    card: {
      id: readString(value.id, `${path}.id`),
      title: readString(value.title, `${path}.title`),
      details: readString(value.details, `${path}.details`),
    } satisfies Card,
    position: readPosition(value.position, `${path}.position`),
  };
};

export const parseBoardResponse = (value: unknown): BoardData => {
  if (!isRecord(value) || !Array.isArray(value.columns)) {
    throw new BoardApiError("Invalid board response", 502);
  }

  const cards: Record<string, Card> = {};
  const cardIds = new Set<string>();
  const parsedColumns = value.columns.map((columnValue, columnIndex) => {
    const path = `columns[${columnIndex}]`;
    if (!isRecord(columnValue) || !Array.isArray(columnValue.cards)) {
      throw new BoardApiError(`Invalid board response: ${path}`, 502);
    }

    const id = readString(columnValue.id, `${path}.id`);
    const parsedCards = columnValue.cards
      .map((cardValue, cardIndex) =>
        parseCard(cardValue, `${path}.cards[${cardIndex}]`),
      )
      .sort((left, right) => left.position - right.position);

    for (const { card } of parsedCards) {
      if (cardIds.has(card.id)) {
        throw new BoardApiError("Invalid board response: duplicate card", 502);
      }
      cardIds.add(card.id);
      cards[card.id] = card;
    }

    return {
      column: {
        id,
        title: readString(columnValue.title, `${path}.title`),
        cardIds: parsedCards.map(({ card }) => card.id),
      } satisfies Column,
      position: readPosition(columnValue.position, `${path}.position`),
    };
  });

  const columns = parsedColumns
    .sort((left, right) => left.position - right.position)
    .map(({ column }) => column);
  if (new Set(columns.map((column) => column.id)).size !== columns.length) {
    throw new BoardApiError("Invalid board response: duplicate column", 502);
  }

  return {
    id: readString(value.id, "id"),
    title: readString(value.title, "title"),
    version: readPosition(value.version, "version"),
    columns,
    cards,
  };
};

const requestBoard = async (
  path: string,
  init?: RequestInit,
): Promise<BoardData> => {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new BoardApiError("Unable to connect to the server.", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BoardApiError(
      response.ok
        ? "The server returned an invalid board response."
        : "The server could not complete the request.",
      response.status,
    );
  }

  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "The server could not complete the request.";
    throw new BoardApiError(detail, response.status);
  }

  return parseBoardResponse(payload);
};

const jsonRequest = (method: string, body: JsonRecord): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const boardApi = {
  get(signal?: AbortSignal) {
    return requestBoard("/api/board", { signal });
  },
  renameColumn(columnId: string, title: string) {
    return requestBoard(
      `/api/board/columns/${columnId}`,
      jsonRequest("PATCH", { title }),
    );
  },
  createCard(columnId: string, title: string, details: string) {
    return requestBoard(
      "/api/board/cards",
      jsonRequest("POST", { column_id: columnId, title, details }),
    );
  },
  updateCard(cardId: string, title: string, details: string) {
    return requestBoard(
      `/api/board/cards/${cardId}`,
      jsonRequest("PATCH", { title, details }),
    );
  },
  deleteCard(cardId: string) {
    return requestBoard(`/api/board/cards/${cardId}`, { method: "DELETE" });
  },
  moveCard(cardId: string, targetColumnId: string, targetPosition: number) {
    return requestBoard(
      `/api/board/cards/${cardId}/move`,
      jsonRequest("POST", {
        target_column_id: targetColumnId,
        target_position: targetPosition,
      }),
    );
  },
};
