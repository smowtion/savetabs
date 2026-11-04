/**
 * Open/closed accordion state for the options page.
 *
 * The ids are hydrated from `storage.local` on mount and written back on every
 * user action. Keeping this in one hook means the shell, Expand all and
 * Collapse all cannot disagree about which sections are open.
 */

import { SETTINGS_SCHEMA, type CategoryId } from "@savetabs/shared";
import { useEffect, useState } from "react";

import { loadOpenSections, saveOpenSections } from "../lib/open-sections";

const ALL_CATEGORY_IDS: readonly CategoryId[] = SETTINGS_SCHEMA.map(
  (category) => category.id,
);

export type UseOpenSectionsResult = {
  openSections: ReadonlySet<CategoryId>;
  setSectionOpen: (category: CategoryId, open: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
};

export function useOpenSections(): UseOpenSectionsResult {
  const [openSections, setOpenSections] = useState<ReadonlySet<CategoryId>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    void loadOpenSections().then((sections) => {
      if (active) setOpenSections(new Set(sections));
    });
    return () => {
      active = false;
    };
  }, []);

  function persist(next: ReadonlySet<CategoryId>): void {
    setOpenSections(next);
    void saveOpenSections([...next]).catch((error) => {
      console.error("[savetabs] failed to persist open sections", error);
    });
  }

  function setSectionOpen(category: CategoryId, open: boolean): void {
    const next = new Set(openSections);
    if (open) next.add(category);
    else next.delete(category);
    persist(next);
  }

  function expandAll(): void {
    persist(new Set(ALL_CATEGORY_IDS));
  }

  function collapseAll(): void {
    persist(new Set());
  }

  return { openSections, setSectionOpen, expandAll, collapseAll };
}
