import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import "./frontend-version.css";

const storageKey = "tomasini.frontend.version";
const pollInterval = 60_000;

function versionId(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

const installed = versionId(
  document.querySelector('meta[name="tomasini-frontend-version"]')?.getAttribute("content"),
);

function previousVersion() {
  const fallback = versionId(history.state?.[storageKey]);
  if (fallback) return fallback;
  try {
    return versionId(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function rememberVersion(version: string) {
  let stored = false;
  try {
    localStorage.setItem(storageKey, version);
    stored = true;
  } catch {
    // The same history entry survives a reload even when storage is read-only.
  }
  if (!stored || history.state?.[storageKey]) {
    try {
      history.replaceState({ ...history.state, [storageKey]: version }, "");
    } catch {
      // Storage and history may both be unavailable in a restricted browser.
    }
  }
}

export function InstalledVersion() {
  return installed && (
    <small className="installed-version" title={installed}>Versión {installed.slice(0, 8)}</small>
  );
}

function useAvailableVersion() {
  const [available, setAvailable] = useState<string | null>(null);
  useEffect(() => {
    if (!installed) return;
    let stopped = false;
    let request: AbortController | undefined;
    async function check() {
      if (document.visibilityState === "hidden" || !navigator.onLine || request) return;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 10_000);
      try {
        const response = await fetch("/frontend-version.json", {
          cache: "no-store",
          credentials: "omit",
          signal: request.signal,
        });
        if (!response.ok) return;
        const remote = versionId((await response.json())?.version);
        if (stopped || !remote) return;
        const previous = previousVersion();
        if (remote !== installed || (previous && remote !== previous)) {
          setAvailable(remote);
        } else if (!previous) {
          rememberVersion(remote);
        }
      } catch {
        // Offline, interrupted or invalid responses are retried on the next check.
      } finally {
        clearTimeout(timeout);
        request = undefined;
      }
    }
    void check();
    const timer = window.setInterval(check, pollInterval);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    window.addEventListener("pageshow", check);
    return () => {
      stopped = true;
      request?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);
  return available;
}

export function FrontendUpdate() {
  const available = useAvailableVersion();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!available || !dialog) return;
    dialog.showModal();
    reloadRef.current?.focus();
    return () => dialog.close();
  }, [available]);

  if (!available) return null;
  return (
    <dialog
      ref={dialogRef}
      className="frontend-update"
      role="dialog"
      aria-modal="true"
      aria-labelledby="frontend-update-title"
      aria-describedby="frontend-update-description frontend-update-warning"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key === "Tab") {
          event.preventDefault();
          reloadRef.current?.focus();
        }
      }}
    >
      <h2 id="frontend-update-title">Hay una nueva versión de Tomasini</h2>
      <p id="frontend-update-description">Recargá esta página para continuar con la versión {available.slice(0, 8)}.</p>
      <p id="frontend-update-warning">Los cambios sin guardar pueden perderse.</p>
      <button
        type="button"
        ref={reloadRef}
        className="button primary"
        onClick={() => {
          rememberVersion(available);
          window.location.reload();
        }}
      >
        <RefreshCw size={18} aria-hidden="true" />
        Recargar página
      </button>
    </dialog>
  );
}
