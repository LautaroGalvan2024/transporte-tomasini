import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import { App } from "./App";
import { FrontendUpdate } from "./FrontendVersion";
import { registerInstallShortcut } from "./InstallShortcut";
import "./styles.css";
import "./refinement.css";
registerInstallShortcut();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <FrontendUpdate />
  </React.StrictMode>,
);
