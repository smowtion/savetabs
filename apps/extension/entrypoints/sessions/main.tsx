import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../assets/tailwind.css";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Sessions page root element is missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
