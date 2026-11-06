/**
 * Accordion section used by the options page.
 *
 * The header is a real button with `aria-expanded`/`aria-controls`; the panel
 * stays mounted and is hidden while collapsed so assistive technology can
 * always resolve the controls relationship. Open state is owned by the parent
 * so it can be persisted in `storage.local`.
 */

import type { CategoryId } from "@savetabs/shared";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export type AccordionProps = {
  categoryId: CategoryId;
  title: string;
  description?: string;
  count: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children?: ReactNode;
};

export function Accordion({
  categoryId,
  title,
  description,
  count,
  open,
  onToggle,
  children,
}: AccordionProps) {
  const headerId = `settings-section-${categoryId}-header`;
  const panelId = `settings-section-${categoryId}-panel`;

  return (
    <section
      id={`settings-section-${categoryId}`}
      className="scroll-mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h2>
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(!open)}
          className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        >
          <ChevronDown
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 shrink-0 text-neutral-500 transition-transform dark:text-neutral-400 ${
              open ? "rotate-180" : ""
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold">{title}</span>
              <span className="rounded-full bg-neutral-200 px-1.5 text-xs tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {count}
              </span>
            </span>
            {description !== undefined && (
              <span className="mt-0.5 block text-sm text-neutral-500 dark:text-neutral-400">
                {description}
              </span>
            )}
          </span>
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800"
      >
        {children}
      </div>
    </section>
  );
}
