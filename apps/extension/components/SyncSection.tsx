/**
 * Sync & Backup key management.
 *
 * The key is the only credential for the encrypted cloud data, so it is shown
 * masked by default, copying is explicit, and rotation demands typing ROTATE
 * after a warning that the old cloud data becomes unreadable. Importing a key
 * asks whether local sessions should be uploaded under it; the answer is
 * recorded as a pending rebind decision that the sync service consumes.
 *
 * This component only manages key material. It never enables sync, contacts
 * the network, or changes sync settings.
 */

import { formatKey, parseKey, type Translator } from "@savetabs/shared";
import { useEffect, useId, useState, type FormEvent } from "react";

import { copyText } from "../lib/clipboard-write";
import {
  getOrCreateKey,
  rotateKey,
  setKey,
  type RebindMode,
} from "../lib/sync/key-store";

const ROTATE_CONFIRMATION = "ROTATE";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950";

export type SyncSectionProps = {
  t: Translator;
};

type Status = {
  kind: "success" | "error";
  message: string;
};

/** Hide every key symbol after the `ST` prefix while keeping the layout. */
export function maskKey(key: string): string {
  return key.slice(0, 2) + key.slice(2).replace(/[0-9A-Z]/gi, "•");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SyncSection({ t }: SyncSectionProps) {
  const [key, setKeyValue] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [importValue, setImportValue] = useState("");
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState("");
  const importInputId = useId();
  const rotateConfirmId = useId();

  useEffect(() => {
    let active = true;
    getOrCreateKey()
      .then((stored) => {
        if (active) setKeyValue(stored);
      })
      .catch((error) => {
        if (!active) return;
        setStatus({
          kind: "error",
          message: t("settings.sync.actionFailed", {
            message: errorMessage(error),
          }),
        });
      });
    return () => {
      active = false;
    };
  }, [t]);

  function beginImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      const normalized = formatKey(parseKey(importValue));
      setPendingImport(normalized);
      setStatus(null);
    } catch {
      setPendingImport(null);
      setStatus({ kind: "error", message: t("settings.sync.invalidKey") });
    }
  }

  async function applyImport(rebind: RebindMode): Promise<void> {
    if (pendingImport === null) return;
    try {
      const stored = await setKey(pendingImport, rebind);
      setKeyValue(stored);
      setPendingImport(null);
      setImportValue("");
      setRevealed(false);
      setStatus({
        kind: "success",
        message:
          rebind === "upload"
            ? t("settings.sync.importSuccess")
            : t("settings.sync.importSkipped"),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.sync.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function copyKey(): Promise<void> {
    if (key === null) return;
    try {
      await copyText(key);
      setStatus({ kind: "success", message: t("settings.sync.copied") });
    } catch {
      setStatus({ kind: "error", message: t("settings.sync.copyFailed") });
    }
  }

  function beginRotation(): void {
    setRotating(true);
    setRotateConfirm("");
    setStatus(null);
  }

  function cancelRotation(): void {
    setRotating(false);
    setRotateConfirm("");
  }

  async function confirmRotation(): Promise<void> {
    if (rotateConfirm !== ROTATE_CONFIRMATION) return;
    try {
      const rotated = await rotateKey();
      setKeyValue(rotated);
      setRevealed(false);
      setRotating(false);
      setRotateConfirm("");
      setStatus({
        kind: "success",
        message: t("settings.sync.rotateSuccess"),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.sync.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <div>
        <h3 className="text-sm font-semibold">{t("settings.sync.keyTitle")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code
            data-testid="sync-key-value"
            aria-label={t("settings.sync.keyLabel")}
            className="min-w-0 break-all rounded-md bg-neutral-100 px-2 py-1 font-mono text-sm dark:bg-neutral-800"
          >
            {key === null
              ? t("common.loading")
              : revealed
                ? key
                : maskKey(key)}
          </code>
          <button
            type="button"
            disabled={key === null}
            onClick={() => setRevealed((current) => !current)}
            className={BUTTON_CLASS}
          >
            {revealed ? t("settings.sync.hideKey") : t("settings.sync.revealKey")}
          </button>
          <button
            type="button"
            disabled={key === null}
            onClick={() => void copyKey()}
            className={BUTTON_CLASS}
          >
            {t("settings.sync.copyKey")}
          </button>
        </div>
        {!revealed && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t("settings.sync.keyMaskedHint")}
          </p>
        )}
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {t("settings.sync.loseKeyWarning")}
        </p>
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {t("settings.sync.onlyCredentialWarning")}
        </p>
      </div>

      <form onSubmit={beginImport} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label
            htmlFor={importInputId}
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            {t("settings.sync.importLabel")}
          </label>
          <input
            id={importInputId}
            type="text"
            value={importValue}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("settings.sync.importPlaceholder")}
            onChange={(event) => {
              setImportValue(event.target.value);
              setPendingImport(null);
              if (status?.kind === "error") setStatus(null);
            }}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <button
          type="submit"
          disabled={importValue.trim() === ""}
          className={BUTTON_CLASS}
        >
          {t("settings.sync.importLabel")}
        </button>
      </form>

      {pendingImport !== null && (
        <div
          role="group"
          aria-label={t("settings.sync.importPrompt")}
          className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950"
        >
          <p className="text-sm font-medium">
            {t("settings.sync.importPrompt")}
          </p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            {t("settings.sync.importPromptHint")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => void applyImport("upload")}
              className={PRIMARY_BUTTON_CLASS}
            >
              {t("settings.sync.importUpload")}
            </button>
            <button
              type="button"
              onClick={() => void applyImport("skip")}
              className={BUTTON_CLASS}
            >
              {t("settings.sync.importSkip")}
            </button>
          </div>
        </div>
      )}

      {!rotating ? (
        <div>
          <button
            type="button"
            disabled={key === null}
            onClick={beginRotation}
            className={DANGER_BUTTON_CLASS}
          >
            {t("settings.sync.rotateKey")}
          </button>
        </div>
      ) : (
        <div
          role="group"
          aria-label={t("settings.sync.rotateTitle")}
          className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
        >
          <p className="text-sm font-medium">{t("settings.sync.rotateTitle")}</p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            {t("settings.sync.rotateWarning")}
          </p>
          <label
            htmlFor={rotateConfirmId}
            className="mt-2 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            {t("settings.sync.rotateConfirmLabel")}
          </label>
          <input
            id={rotateConfirmId}
            type="text"
            value={rotateConfirm}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("settings.sync.rotateConfirmPlaceholder")}
            onChange={(event) => setRotateConfirm(event.target.value)}
            className="mt-1 w-40 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={rotateConfirm !== ROTATE_CONFIRMATION}
              onClick={() => void confirmRotation()}
              className={DANGER_BUTTON_CLASS}
            >
              {t("settings.sync.rotateConfirm")}
            </button>
            <button
              type="button"
              onClick={cancelRotation}
              className={BUTTON_CLASS}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {status !== null && (
        <div
          role={status.kind === "success" ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-sm ${
            status.kind === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
