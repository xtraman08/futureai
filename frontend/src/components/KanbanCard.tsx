import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  disabled?: boolean;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

export const KanbanCard = ({
  card,
  disabled = false,
  onEdit,
  onDelete,
}: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: disabled || isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || disabled || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const succeeded = await onEdit(card.id, title.trim(), details.trim());
    setIsSubmitting(false);
    if (succeeded) {
      setIsEditing(false);
    }
  };

  const cancelEditing = () => {
    setTitle(card.title);
    setDetails(card.details);
    setIsEditing(false);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form className="space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="sr-only">Card title</span>
            <input
              aria-label={`Edit title for ${card.title}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={disabled || isSubmitting}
              className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
              required
            />
          </label>
          <label className="block">
            <span className="sr-only">Card details</span>
            <textarea
              aria-label={`Edit details for ${card.title}`}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              disabled={disabled || isSubmitting}
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--gray-text)] outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={disabled || isSubmitting}
              className="rounded-full bg-[var(--primary-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={disabled || isSubmitting}
              className="rounded-full border border-[var(--stroke)] px-3 py-1.5 text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
                {card.title}
              </h4>
              <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
                {card.details || "No details yet."}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Move ${card.title}`}
              disabled={disabled}
              className="cursor-grab rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wide text-[var(--gray-text)] hover:bg-[var(--surface)] active:cursor-grabbing disabled:cursor-wait"
              {...attributes}
              {...listeners}
            >
              Drag
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-[var(--stroke)] pt-3">
            <button
              type="button"
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(true);
              }}
              disabled={disabled}
              className="text-xs font-semibold text-[var(--primary-blue)] transition hover:brightness-75 disabled:cursor-wait disabled:opacity-50"
              aria-label={`Edit ${card.title}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void onDelete(card.id)}
              disabled={disabled}
              className="text-xs font-semibold text-[var(--gray-text)] transition hover:text-[var(--navy-dark)] disabled:cursor-wait disabled:opacity-50"
              aria-label={`Delete ${card.title}`}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
