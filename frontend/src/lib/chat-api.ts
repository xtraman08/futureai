import { parseBoardResponse } from "@/lib/board-api";
import type { BoardData } from "@/lib/kanban";

type JsonRecord = Record<string, unknown>;

export type ProposalStatus = "pending" | "confirmed" | "rejected" | "stale";

export type BoardOperation =
  | {
      type: "create_card";
      column_id: string;
      title: string;
      details: string;
    }
  | {
      type: "edit_card";
      card_id: string;
      title: string | null;
      details: string | null;
    }
  | {
      type: "move_card";
      card_id: string;
      target_column_id: string;
      target_position: number;
    }
  | { type: "delete_card"; card_id: string }
  | { type: "rename_column"; column_id: string; title: string };

export type ChatProposal = {
  id: string;
  status: ProposalStatus;
  baseBoardVersion: number;
  operations: BoardOperation[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposal: ChatProposal | null;
};

export type SendChatResponse = {
  id: string;
  message: string;
  model: string;
  proposal: ChatProposal | null;
};

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalidResponse = (): never => {
  throw new ChatApiError("The server returned an invalid chat response.", 502);
};

const readString = (value: unknown) =>
  typeof value === "string" ? value : invalidResponse();

const readNullableString = (value: unknown) =>
  value === null ? null : readString(value);

const readPosition = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : invalidResponse();

const parseOperation = (value: unknown): BoardOperation => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return invalidResponse();
  }
  switch (value.type) {
    case "create_card":
      return {
        type: value.type,
        column_id: readString(value.column_id),
        title: readString(value.title),
        details: readString(value.details),
      };
    case "edit_card":
      return {
        type: value.type,
        card_id: readString(value.card_id),
        title: readNullableString(value.title),
        details: readNullableString(value.details),
      };
    case "move_card":
      return {
        type: value.type,
        card_id: readString(value.card_id),
        target_column_id: readString(value.target_column_id),
        target_position: readPosition(value.target_position),
      };
    case "delete_card":
      return {
        type: value.type,
        card_id: readString(value.card_id),
      };
    case "rename_column":
      return {
        type: value.type,
        column_id: readString(value.column_id),
        title: readString(value.title),
      };
    default:
      return invalidResponse();
  }
};

const parseProposal = (value: unknown): ChatProposal | null => {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.operations) ||
    !["pending", "confirmed", "rejected", "stale"].includes(
      value.status as string,
    )
  ) {
    return invalidResponse();
  }
  return {
    id: readString(value.id),
    status: value.status as ProposalStatus,
    baseBoardVersion: readPosition(value.base_board_version),
    operations: value.operations.map(parseOperation),
  };
};

const parseMessage = (value: unknown): ChatMessage => {
  if (
    !isRecord(value) ||
    (value.role !== "user" && value.role !== "assistant")
  ) {
    return invalidResponse();
  }
  return {
    id: readString(value.id),
    role: value.role,
    content: readString(value.content),
    createdAt: readString(value.created_at),
    proposal: parseProposal(value.proposal),
  };
};

export const parseChatHistory = (value: unknown): ChatMessage[] => {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return invalidResponse();
  }
  return value.messages.map(parseMessage);
};

export const parseSendChatResponse = (value: unknown): SendChatResponse => {
  if (!isRecord(value)) {
    return invalidResponse();
  }
  return {
    id: readString(value.id),
    message: readString(value.message),
    model: readString(value.model),
    proposal: parseProposal(value.proposal),
  };
};

const fetchResponse = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new ChatApiError("Unable to connect to the server.", 0);
  }
};

const readPayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new ChatApiError(
      response.ok
        ? "The server returned an invalid chat response."
        : "The server could not complete the request.",
      response.status,
    );
  }
};

const throwResponseError = (payload: unknown, status: number): never => {
  const detail =
    isRecord(payload) && typeof payload.detail === "string"
      ? payload.detail
      : "The server could not complete the request.";
  throw new ChatApiError(detail, status);
};

const jsonRequest = (body?: JsonRecord): RequestInit => ({
  method: "POST",
  headers: body ? { "Content-Type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export const chatApi = {
  async getHistory(signal?: AbortSignal) {
    const response = await fetchResponse("/api/chat", { signal });
    const payload = await readPayload(response);
    if (!response.ok) {
      return throwResponseError(payload, response.status);
    }
    return parseChatHistory(payload);
  },

  async send(message: string) {
    const response = await fetchResponse(
      "/api/chat",
      jsonRequest({ message }),
    );
    const payload = await readPayload(response);
    if (!response.ok) {
      return throwResponseError(payload, response.status);
    }
    return parseSendChatResponse(payload);
  },

  async confirm(proposalId: string): Promise<BoardData> {
    const response = await fetchResponse(
      `/api/chat/proposals/${proposalId}/confirm`,
      jsonRequest(),
    );
    const payload = await readPayload(response);
    if (!response.ok) {
      return throwResponseError(payload, response.status);
    }
    return parseBoardResponse(payload);
  },

  async reject(proposalId: string): Promise<void> {
    const response = await fetchResponse(
      `/api/chat/proposals/${proposalId}/reject`,
      jsonRequest(),
    );
    if (response.status === 204) {
      return;
    }
    const payload = await readPayload(response);
    if (!response.ok) {
      return throwResponseError(payload, response.status);
    }
    throw new ChatApiError("The server returned an invalid chat response.", 502);
  },
};
