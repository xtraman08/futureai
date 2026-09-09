"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { boardApi, BoardApiError } from "@/lib/board-api";
import { moveCard, type BoardData } from "@/lib/kanban";

type KanbanBoardProps = {
  username?: string;
  isLoggingOut?: boolean;
  onLogout?: () => void;
  onSessionExpired?: () => void;
};

export const KanbanBoard = ({
  username,
  isLoggingOut = false,
  onLogout,
  onSessionExpired,
}: KanbanBoardProps = {}) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const isMutatingRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleApiError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof BoardApiError && error.status === 401) {
        onSessionExpired?.();
        return "";
      }
      return error instanceof Error ? error.message : fallback;
    },
    [onSessionExpired],
  );

  const loadBoard = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setLoadError("");
      try {
        setBoard(await boardApi.get(signal));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setLoadError(
          handleApiError(error, "Unable to load the board. Please try again."),
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [handleApiError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadBoard(controller.signal);
    return () => controller.abort();
  }, [loadBoard]);

  const runMutation = async (
    operation: () => Promise<BoardData>,
  ): Promise<boolean> => {
    if (isMutatingRef.current) {
      return false;
    }
    isMutatingRef.current = true;
    setMutationError("");
    setIsMutating(true);
    try {
      setBoard(await operation());
      return true;
    } catch (error) {
      setMutationError(
        handleApiError(
          error,
          "The board could not be updated. Please try again.",
        ),
      );
      return false;
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!isMutatingRef.current) {
      setActiveCardId(event.active.id as string);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || isMutatingRef.current || !over || active.id === over.id) {
      return;
    }

    const cardId = active.id as string;
    const nextColumns = moveCard(
      board.columns,
      cardId,
      over.id as string,
    );
    if (nextColumns === board.columns) {
      return;
    }
    const targetColumn = nextColumns.find((column) =>
      column.cardIds.includes(cardId),
    );
    const targetPosition = targetColumn?.cardIds.indexOf(cardId) ?? -1;
    if (!targetColumn || targetPosition < 0) {
      return;
    }

    await runMutation(() =>
      boardApi.moveCard(cardId, targetColumn.id, targetPosition),
    );
  };

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface)]">
        <div
          role="status"
          className="flex items-center gap-3 text-sm font-semibold text-[var(--navy-dark)]"
        >
          <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--primary-blue)]" />
          Loading board
        </div>
      </main>
    );
  }

  if (loadError || !board) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-6">
        <section className="w-full max-w-lg rounded-[32px] border border-[var(--stroke)] bg-white p-8 text-center shadow-[var(--shadow)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--secondary-purple)]">
            Connection interrupted
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Board unavailable
          </h1>
          <p role="alert" className="mt-3 text-sm text-[var(--gray-text)]">
            {loadError || "The board could not be loaded."}
          </p>
          <button
            type="button"
            onClick={() => void loadBoard()}
            className="mt-6 rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  const activeCard = activeCardId ? board.cards[activeCardId] : null;

  const cardTitle = (cardId: string) => board.cards[cardId]?.title ?? cardId;
  const columnTitle = (id: string) => {
    const directColumn = board.columns.find((column) => column.id === id);
    if (directColumn) {
      return directColumn.title;
    }
    const containingColumn = board.columns.find((column) =>
      column.cardIds.includes(id),
    );
    return containingColumn?.title ?? "the board";
  };

  const announcements: Announcements = {
    onDragStart({ active }) {
      return `Picked up card "${cardTitle(active.id as string)}".`;
    },
    onDragOver({ active, over }) {
      if (!over) {
        return `Card "${cardTitle(active.id as string)}" is no longer over a column.`;
      }
      return `Card "${cardTitle(active.id as string)}" is over column "${columnTitle(over.id as string)}".`;
    },
    onDragEnd({ active, over }) {
      if (!over) {
        return `Card "${cardTitle(active.id as string)}" was dropped.`;
      }
      return `Card "${cardTitle(active.id as string)}" was dropped on column "${columnTitle(over.id as string)}".`;
    },
    onDragCancel({ active }) {
      return `Moving card "${cardTitle(active.id as string)}" was cancelled.`;
    },
  };

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1800px] flex-col gap-8 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                {board.title}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
              {username && onLogout ? (
                <div className="mt-4 flex items-center justify-between gap-5 border-t border-[var(--stroke)] pt-3">
                  <span className="text-xs text-[var(--gray-text)]">
                    Signed in as{" "}
                    <strong className="text-[var(--navy-dark)]">{username}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={onLogout}
                    disabled={isLoggingOut || isMutating}
                    className="text-xs font-semibold text-[var(--secondary-purple)] transition hover:brightness-75 disabled:cursor-wait disabled:opacity-50"
                  >
                    {isLoggingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <div className="grid items-start gap-8 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            {mutationError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
              >
                <span>{mutationError}</span>
                <button
                  type="button"
                  onClick={() => setMutationError("")}
                  className="font-semibold"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {isMutating ? (
              <div
                role="status"
                className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-800"
              >
                Saving board changes…
              </div>
            ) : null}

            {board.columns.length === 0 ? (
              <section className="rounded-[32px] border border-dashed border-[var(--stroke)] bg-white/70 p-12 text-center">
                <h2 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  This board has no columns
                </h2>
                <p className="mt-2 text-sm text-[var(--gray-text)]">
                  Refresh the page or contact the workspace administrator.
                </p>
              </section>
            ) : (
              <DndContext
                id="kanban-board"
                sensors={sensors}
                collisionDetection={closestCorners}
                accessibility={{ announcements }}
                onDragStart={handleDragStart}
                onDragEnd={(event) => void handleDragEnd(event)}
              >
                <section className="grid gap-6 lg:grid-cols-5">
                  {board.columns.map((column) => (
                    <KanbanColumn
                      key={column.id}
                      column={column}
                      cards={column.cardIds.flatMap((cardId) =>
                        board.cards[cardId] ? [board.cards[cardId]] : [],
                      )}
                      disabled={isMutating}
                      onRename={(columnId, title) =>
                        runMutation(() =>
                          boardApi.renameColumn(columnId, title),
                        )
                      }
                      onAddCard={(columnId, title, details) =>
                        runMutation(() =>
                          boardApi.createCard(columnId, title, details),
                        )
                      }
                      onEditCard={(cardId, title, details) =>
                        runMutation(() =>
                          boardApi.updateCard(cardId, title, details),
                        )
                      }
                      onDeleteCard={(cardId) =>
                        runMutation(() => boardApi.deleteCard(cardId))
                      }
                    />
                  ))}
                </section>
                <DragOverlay>
                  {activeCard ? (
                    <div className="w-[260px]">
                      <KanbanCardPreview card={activeCard} />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
          <ChatSidebar
            board={board}
            onBoardConfirmed={setBoard}
            onSessionExpired={onSessionExpired}
          />
        </div>
      </main>
    </div>
  );
};
