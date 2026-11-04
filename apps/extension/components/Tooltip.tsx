/**
 * Small info affordance for a setting label.
 *
 * The trigger is a real button with an accessible name. `aria-describedby`
 * always points at the tooltip element, which stays in the DOM while hidden so
 * assistive technology can resolve the description even before it is opened.
 */

import { Info } from "lucide-react";
import { useState } from "react";

export type TooltipProps = {
  id: string;
  /** Visually hidden description referenced by `aria-describedby`. */
  text: string;
  /** Accessible name for the info button. */
  label: string;
};

export function Tooltip({ id, text, label }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="rounded-full p-0.5 text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className="absolute left-1/2 top-full z-10 mt-1 w-56 -translate-x-1/2 rounded-md bg-neutral-900 px-2 py-1 text-xs font-normal text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
      >
        {text}
      </span>
    </span>
  );
}
