import clsx from "clsx";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  chatApi,
  ChatApiError,
  type BoardOperation,
  type ChatMessage,
  type ProposalStatus,
} from "@/lib/chat-api";
import type { BoardData } from "@/lib/kanban";

type ChatSidebarProps = {
  board: BoardData;
  onBoardConfirmed: (board: BoardData) => void;
  onSessionExpired?: () => void;
};

const SparkMark = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
  >
    <path
      d="M12 2.8c.6 4.6 2.6 6.6 7.2 7.2-4.6.6-6.6 2.6-7.2 7.2-.6-4.6-2.6-6.6-7.2-7.2 4.6-.6 6.6-2.6 7.2-7.2Z"
      fill="currentColor"
    />
    <path
      d="M18.5 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z"
      fill="currentColor"
      opacity=".65"
    />
  </svg>
);

const findColumn = (board: BoardData, columnId: string) =>
  board.columns.find((column) => column.id === columnId)?.title ?? "a column";

const findCard = (board: BoardData, cardId: string) =>
  board.cards[cardId]?.title ?? "a card";

const operationLabel = (operation: BoardOperation, board: BoardData) => {
  switch (operation.type) {
    case "create_card":
      return `Create “${operation.title}” in ${findColumn(board, operation.column_id)}`;
    case "edit_card":
      return `Edit “${findCard(board, operation.card_id)}”`;
    case "move_card":
      return `Move “${findCard(board, operation.card_id)}” to ${findColumn(board, operation.target_column_id)}`;
    case "delete_card":
      return `Delete “${findCard(board, operation.card_id)}”`;
    case "rename_column":
      return `Rename ${findColumn(board, operation.column_id)} to “${operation.title}”`;
  }
};

const statusLabel: Record<ProposalStatus, string> = {
  pending: "Awaiting review",
  confirmed: "Applied",
  rejected: "Rejected",
  stale: "Out of date",
};

export const ChatSidebar = ({
  board,
  onBoardConfirmed,
  onSessionExpired,
}: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const errorMessage = useCallback(
    (caught: unknown, fallback: string) => {
      if (caught instanceof ChatApiError && caught.status === 401) {
        onSessionExpired?.();
        return "";
      }
      return caught instanceof Error ? caught.message : fallback;
    },
    [onSessionExpired],
  );

  const loadHistory = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError("");
      try {
        setMessages(await chatApi.getHistory(signal));
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") {
          return;
        }
        setError(
          errorMessage(caught, "Unable to load the conversation."),
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [errorMessage],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, pendingQuestion]);

  const updateProposal = (proposalId: string, status: ProposalStatus) => {
    setMessages((current) =>
      current.map((message) =>
        message.proposal?.id === proposalId
          ? {
              ...message,
              proposal: { ...message.proposal, status },
            }
          : message,
      ),
    );
  };

  const applyConfirmation = (proposalId: string) => {
    setMessages((current) =>
      current.map((message) => {
        if (!message.proposal) {
          return message;
        }
        if (message.proposal.id === proposalId) {
          return {
            ...message,
            proposal: { ...message.proposal, status: "confirmed" },
          };
        }
        if (message.proposal.status === "pending") {
          return {
            ...message,
            proposal: { ...message.proposal, status: "stale" },
          };
        }
        return message;
      }),
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || isSending) {
      return;
    }

    setError("");
    setIsSending(true);
    setPendingQuestion(question);
    try {
      const response = await chatApi.send(question);
      const timestamp = new Date().toISOString();
      setMessages((current) => [
        ...current,
        {
          id: `local-user-${response.id}`,
          role: "user",
          content: question,
          createdAt: timestamp,
          proposal: null,
        },
        {
          id: response.id,
          role: "assistant",
          content: response.message,
          createdAt: timestamp,
          proposal: response.proposal,
        },
      ]);
      setDraft("");
    } catch (caught) {
      setError(errorMessage(caught, "Unable to send the message."));
    } finally {
      setPendingQuestion("");
      setIsSending(false);
    }
  };

  const handleConfirm = async (proposalId: string) => {
    setError("");
    setActiveProposalId(proposalId);
    try {
      const confirmedBoard = await chatApi.confirm(proposalId);
      applyConfirmation(proposalId);
      onBoardConfirmed(confirmedBoard);
    } catch (caught) {
      setError(errorMessage(caught, "Unable to apply the proposal."));
      if (caught instanceof ChatApiError && caught.status === 409) {
        await loadHistory();
      }
    } finally {
      setActiveProposalId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    setError("");
    setActiveProposalId(proposalId);
    try {
      await chatApi.reject(proposalId);
      updateProposal(proposalId, "rejected");
    } catch (caught) {
      setError(errorMessage(caught, "Unable to reject the proposal."));
    } finally {
      setActiveProposalId(null);
    }
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="order-first 2xl:order-none">
      <button
        type="button"
        aria-controls="ai-chat-panel"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between rounded-2xl bg-[var(--navy-dark)] px-5 py-4 text-left text-white shadow-[var(--shadow)] 2xl:hidden"
      >
        <span className="flex items-center gap-3 font-display font-semibold">
          <SparkMark />
          AI assistant
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
          {isOpen ? "Close" : "Open"}
        </span>
      </button>

      <aside
        id="ai-chat-panel"
        aria-label="AI assistant"
        className={clsx(
          "mt-3 min-h-[560px] flex-col overflow-hidden rounded-[28px] border border-[var(--stroke)] bg-white shadow-[var(--shadow)] 2xl:sticky 2xl:top-6 2xl:mt-0 2xl:flex 2xl:h-[calc(100vh-3rem)]",
          isOpen ? "flex" : "hidden",
        )}
      >
        <header className="border-b border-[var(--stroke)] bg-[linear-gradient(135deg,var(--navy-dark),#123d73)] px-5 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/12 text-[var(--accent-yellow)]">
              <SparkMark />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">
                Board assistant
              </h2>
              <p className="mt-0.5 text-xs text-white/65">
                Changes always wait for your approval
              </p>
            </div>
          </div>
        </header>

        <div
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          className="flex-1 space-y-4 overflow-y-auto bg-[var(--surface)] px-4 py-5"
        >
          {isLoading ? (
            <p role="status" className="text-sm text-[var(--gray-text)]">
              Loading conversation…
            </p>
          ) : messages.length === 0 && !pendingQuestion ? (
            <div className="rounded-2xl border border-dashed border-[var(--stroke)] bg-white px-4 py-5 text-sm leading-6 text-[var(--gray-text)]">
              Ask about the board or request card and column changes. You will
              review every proposed change before it is applied.
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              key={message.id}
              className={clsx(
                "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6",
                message.role === "user"
                  ? "ml-auto bg-[var(--primary-blue)] text-white"
                  : "border border-[var(--stroke)] bg-white text-[var(--navy-dark)]",
              )}
            >
              <p>{message.content}</p>
              {message.proposal ? (
                <section className="mt-3 border-t border-[var(--stroke)] pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--secondary-purple)]">
                      Proposed changes
                    </h3>
                    <span className="rounded-full bg-purple-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--secondary-purple)]">
                      {statusLabel[message.proposal.status]}
                    </span>
                  </div>
                  <ol className="mt-3 space-y-2">
                    {message.proposal.operations.map((operation, index) => (
                      <li
                        key={`${message.proposal?.id}-${index}`}
                        className="flex gap-2 text-xs leading-5 text-[var(--gray-text)]"
                      >
                        <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--accent-yellow)] text-[9px] font-bold text-[var(--navy-dark)]">
                          {index + 1}
                        </span>
                        {operationLabel(operation, board)}
                      </li>
                    ))}
                  </ol>
                  {message.proposal.status === "pending" ? (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleConfirm(message.proposal!.id)
                        }
                        disabled={activeProposalId !== null}
                        className="rounded-xl bg-[var(--secondary-purple)] px-3 py-2.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-50"
                      >
                        {activeProposalId === message.proposal.id
                          ? "Applying…"
                          : "Confirm changes"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleReject(message.proposal!.id)
                        }
                        disabled={activeProposalId !== null}
                        className="rounded-xl border border-[var(--stroke)] bg-white px-3 py-2.5 text-xs font-semibold text-[var(--navy-dark)] disabled:cursor-wait disabled:opacity-50"
                      >
                        Reject changes
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </article>
          ))}

          {pendingQuestion ? (
            <>
              <article className="ml-auto max-w-[92%] rounded-2xl bg-[var(--primary-blue)] px-4 py-3 text-sm leading-6 text-white">
                {pendingQuestion}
              </article>
              <div
                role="status"
                className="flex items-center gap-2 text-xs font-semibold text-[var(--secondary-purple)]"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--secondary-purple)]" />
                Assistant is thinking
              </div>
            </>
          ) : null}
          <div ref={messageEndRef} />
        </div>

        <div className="border-t border-[var(--stroke)] bg-white p-4">
          {error ? (
            <div
              role="alert"
              className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="font-semibold"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="chat-message" className="sr-only">
              Message the board assistant
            </label>
            <textarea
              id="chat-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={isSending}
              rows={3}
              maxLength={10_000}
              placeholder="Ask about the board…"
              className="w-full resize-none rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition placeholder:text-[var(--gray-text)] focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-sky-100 disabled:cursor-wait"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--gray-text)]">
                Enter to send · Shift+Enter for a new line
              </span>
              <button
                type="submit"
                disabled={isSending || !draft.trim()}
                className="rounded-xl bg-[var(--navy-dark)] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[var(--secondary-purple)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
};
