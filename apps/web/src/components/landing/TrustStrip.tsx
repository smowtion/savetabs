import type { Translator } from "@savetabs/shared";
import {
  Languages,
  MonitorSmartphone,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

/**
 * Compact trust chips that sit directly under the hero.
 *
 * Every chip restates a factual product property from the shared
 * dictionaries: local-first storage, end-to-end encryption, the twelve
 * interface languages, and the account-free local path. The icons are
 * decorative; the visible label carries the meaning.
 */

type Props = { t: Translator };

const ITEMS = [
  { key: "localFirst", icon: MonitorSmartphone },
  { key: "encrypted", icon: ShieldCheck },
  { key: "languages", icon: Languages },
  { key: "noAccount", icon: UserCheck },
] as const;

export function TrustStrip({ t }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20">
      <ul
        aria-label={t("web.landing.trust.label")}
        className="motion-fade-up flex flex-wrap items-center justify-center gap-2 sm:gap-3"
      >
        {ITEMS.map(({ key, icon: Icon }) => (
          <li
            key={key}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          >
            <Icon
              aria-hidden="true"
              size={16}
              className="shrink-0 text-indigo-600 dark:text-indigo-400"
            />
            {t(`web.landing.trust.${key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
