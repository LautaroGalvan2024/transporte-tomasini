type InstallPrompt = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallNavigator = Navigator & {
  install?: () => Promise<unknown>;
  standalone?: boolean;
};

export type InstallResult =
  | "already-installed"
  | "installed"
  | "accepted"
  | "dismissed"
  | "manual"
  | "failed";

let registered = false;
let installedHere = false;
let deferredPrompt: InstallPrompt | null = null;
let preferDeferredPrompt = false;
let activeRequest: Promise<InstallResult> | null = null;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function subscribeToInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call once in main before rendering React, so an early browser prompt is retained. */
export function registerInstallShortcut() {
  if (registered) return;
  registered = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPrompt;
    installedHere = false;
    publish();
  });
  window.addEventListener("appinstalled", () => {
    installedHere = true;
    deferredPrompt = null;
    publish();
  });
}

function alreadyInstalled() {
  return (
    installedHere ||
    (navigator as InstallNavigator).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function canPromptInstall() {
  return (
    !alreadyInstalled() &&
    (typeof (navigator as InstallNavigator).install === "function" ||
      deferredPrompt !== null)
  );
}

async function startInstall(): Promise<InstallResult> {
  if (alreadyInstalled()) return "already-installed";
  const browser = navigator as InstallNavigator;
  const useDeferred = preferDeferredPrompt && deferredPrompt !== null;
  if (typeof browser.install === "function" && !useDeferred) {
    try {
      await browser.install();
      installedHere = true;
      deferredPrompt = null;
      publish();
      return "installed";
    } catch (error) {
      // A fallback prompt needs a fresh user gesture. Keep it for the next click.
      preferDeferredPrompt = true;
      return error instanceof Error && error.name === "AbortError"
        ? "dismissed"
        : "failed";
    }
  }
  if (!deferredPrompt) return "manual";

  const prompt = deferredPrompt;
  deferredPrompt = null;
  publish();
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome === "accepted"
      ? "accepted"
      : "dismissed";
  } catch {
    return "failed";
  }
}

/** Invoke directly from a click so the native dialog receives user activation. */
export function requestInstallShortcut(): Promise<InstallResult> {
  if (!activeRequest) {
    activeRequest = startInstall().finally(() => {
      activeRequest = null;
    });
  }
  return activeRequest;
}
