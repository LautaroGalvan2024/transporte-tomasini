import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import { App } from "./App";
import { FrontendUpdate } from "./FrontendVersion";
import { registerInstallShortcut } from "./InstallShortcut";
// Keep the established cascade independent of the component import graph.
import "./km100.css";
import "./admin.css";
import "./user-cuil.css";
import "./holiday-calendar.css";
import "./frontend-version.css";
import "./install-shortcut.css";
import "./styles.css";
import "./refinement.css";
registerInstallShortcut();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <FrontendUpdate />
  </React.StrictMode>,
);
