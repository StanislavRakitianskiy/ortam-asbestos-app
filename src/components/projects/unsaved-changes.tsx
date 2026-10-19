"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const LEAVE_MESSAGE = "You have unsaved changes on the Project tab. Leave without saving?";

type UnsavedChanges = {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** For Link onNavigate: asks before leaving with unsaved changes and cancels the navigation if declined. */
  confirmLeave: (event: { preventDefault: () => void }) => void;
};

const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

/** Tracks unsaved form changes and warns before the page is closed, reloaded or left through an app link. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const confirmLeave = useCallback(
    (event: { preventDefault: () => void }) => {
      if (dirty && !window.confirm(LEAVE_MESSAGE)) event.preventDefault();
    },
    [dirty],
  );

  const value = useMemo(() => ({ dirty, setDirty, confirmLeave }), [dirty, confirmLeave]);
  return <UnsavedChangesContext value={value}>{children}</UnsavedChangesContext>;
}

export function useUnsavedChanges(): UnsavedChanges {
  const context = useContext(UnsavedChangesContext);
  if (context === null) throw new Error("useUnsavedChanges must be used inside UnsavedChangesProvider");
  return context;
}
