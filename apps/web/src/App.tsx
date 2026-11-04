import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "./hooks/useTheme";
import { useI18n } from "./hooks/useI18n";
import { loadKey } from "./lib/key-session";
import Landing from "./pages/Landing";
import Sessions from "./pages/Sessions";

/** Route guard: session pages require a stored sync key. */
function RequireKey({ children }: { children: ReactNode }) {
  return loadKey() === null ? <Navigate to="/" replace /> : <>{children}</>;
}

function Placeholder({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 text-center text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
      <p className="max-w-md text-base">{message}</p>
    </main>
  );
}

/** Filled in by the privacy page task. */
function PrivacyPlaceholder() {
  const { t } = useI18n();
  return <Placeholder message={t("web.landing.privacyPlaceholder")} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/sessions"
          element={
            <RequireKey>
              <Sessions />
            </RequireKey>
          }
        />
        <Route path="/privacy" element={<PrivacyPlaceholder />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
