import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "./hooks/useTheme";
import { loadKey } from "./lib/key-session";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import Sessions from "./pages/Sessions";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";

/** Route guard: session pages require a stored sync key. */
function RequireKey({ children }: { children: ReactNode }) {
  return loadKey() === null ? <Navigate to="/" replace /> : <>{children}</>;
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
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
