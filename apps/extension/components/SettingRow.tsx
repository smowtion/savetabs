/**
 * One setting row in the options accordion.
 *
 * The layout is always label (+ optional info tooltip) and description on the
 * left, control on the right. The stable `data-testid` lets tests prove that
 * every schema key renders exactly once.
 */

import type { ReactNode } from "react";

import { Tooltip } from "./Tooltip";

export type SettingRowTooltip = {
  text: string;
  label: string;
};

export type SettingRowProps = {
  /** Dotted settings key, e.g. "tabs.closeAfterSave". */
  settingKey: string;
  label: string;
  description: string;
  tooltip?: SettingRowTooltip;
  /** Extra explanation, e.g. why a row is disabled in this browser. */
  note?: string;
  disabled?: boolean;
  children: ReactNode;
};

/** DOM id of the control inside a setting row, used by the row label. */
export function settingControlId(key: string): string {
  return `setting-${key}-control`;
}

export function SettingRow({
  settingKey,
  label,
  description,
  tooltip,
  note,
  disabled = false,
  children,
}: SettingRowProps) {
  const controlId = settingControlId(settingKey);

  return (
    <div
      data-testid={`setting-${settingKey}`}
      className={`flex items-start justify-between gap-4 py-3 ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={controlId}
            className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
          >
            {label}
          </label>
          {tooltip !== undefined && (
            <Tooltip
              id={`${controlId}-tooltip`}
              text={tooltip.text}
              label={tooltip.label}
            />
          )}
        </div>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
        {note !== undefined && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {note}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
