import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "./hooks/useTheme";
import { loadAccountToken } from "./lib/account-session";
import { loadKey } from "./lib/key-session";
import Account from "./pages/Account";
import Changelog from "./pages/Changelog";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import Reset from "./pages/Reset";
import Sessions from "./pages/Sessions";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";

/**
 * Route guard: session pages require a stored sync key or an account token.
 * A token without a key reaches the sessions page, which renders the inline
 * password unlock form instead of redirecting to the landing page.
 */
function RequireKey({ children }: { children: ReactNode }) {
  const hasKey = loadKey() !== null;
  const hasAccountToken = loadAccountToken() !== null;
  return hasKey || hasAccountToken ? <>{children}</> : <Navigate to="/" replace />;
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
        <Route path="/account" element={<Account />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
