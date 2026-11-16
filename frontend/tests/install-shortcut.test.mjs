import assert from "node:assert/strict";
import test from "node:test";

async function browser(t, nav = {}, standalone = false) {
  const win = new EventTarget();
  win.matchMedia = () => ({ matches: standalone });
  win.navigator = nav;
  for (const [key, value] of Object.entries({ window: win, navigator: nav })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const module = await import(
    `../src/install-shortcut.ts?case=${encodeURIComponent(t.name)}`
  );
  module.registerInstallShortcut();
  return { win, ...module };
}

function offer(win, outcome) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const choice = Promise.resolve({ outcome, platform: "web" });
  const calls = [];
  event.userChoice = choice;
  event.prompt = () => {
    calls.push("prompt");
    return choice;
  };
  win.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  return calls;
}

test("un navegador sin instalación disponible recurre a las instrucciones", async (t) => {
  const app = await browser(t);
  assert.equal(await app.requestInstallShortcut(), "manual");
});

test("la instalación nativa tiene prioridad sobre el evento diferido", async (t) => {
  let nativeCalls = 0;
  const app = await browser(t, {
    install: async () => {
      nativeCalls++;
    },
  });
  const deferredCalls = offer(app.win, "accepted");
  assert.equal(await app.requestInstallShortcut(), "installed");
  assert.equal(nativeCalls, 1);
  assert.deepEqual(deferredCalls, []);
});

test("un evento diferido se consume una vez y appinstalled confirma la instalación", async (t) => {
  const app = await browser(t);
  app.registerInstallShortcut();
  const calls = offer(app.win, "accepted");
  assert.equal(await app.requestInstallShortcut(), "accepted");
  assert.deepEqual(calls, ["prompt"]);
  assert.equal(await app.requestInstallShortcut(), "manual");
  app.win.dispatchEvent(new Event("appinstalled"));
  assert.equal(await app.requestInstallShortcut(), "already-installed");
});

test("se puede volver a intentar con un nuevo evento tras cancelar", async (t) => {
  const app = await browser(t);
  const original = offer(app.win, "dismissed");
  assert.equal(await app.requestInstallShortcut(), "dismissed");
  assert.equal(await app.requestInstallShortcut(), "manual");
  const retry = offer(app.win, "accepted");
  assert.equal(await app.requestInstallShortcut(), "accepted");
  assert.deepEqual(original, ["prompt"]);
  assert.deepEqual(retry, ["prompt"]);
});

test("un error de la API nativa deja el botón recuperable", async (t) => {
  let fail = true;
  const app = await browser(t, {
    install: async () => {
      if (fail) throw new Error("Sin permiso");
    },
  });
  assert.equal(await app.requestInstallShortcut(), "failed");
  fail = false;
  assert.equal(await app.requestInstallShortcut(), "installed");
});

test("dos clics comparten el intento nativo y el alternativo espera otro clic tras cancelar", async (t) => {
  let dismiss;
  let nativeCalls = 0;
  const app = await browser(t, {
    install() {
      nativeCalls++;
      return new Promise((_resolve, reject) => {
        dismiss = reject;
      });
    },
  });
  const fallbackCalls = offer(app.win, "accepted");
  const first = app.requestInstallShortcut();
  const second = app.requestInstallShortcut();
  assert.equal(nativeCalls, 1);
  dismiss(new DOMException("Cancelado", "AbortError"));
  assert.deepEqual(await Promise.all([first, second]), [
    "dismissed",
    "dismissed",
  ]);
  assert.deepEqual(fallbackCalls, []);
  assert.equal(await app.requestInstallShortcut(), "accepted");
  assert.equal(nativeCalls, 1);
  assert.deepEqual(fallbackCalls, ["prompt"]);
});

for (const [mode, nav, display] of [
  ["standalone", {}, true],
  ["iOS", { standalone: true }, false],
]) {
  test(`una ventana instalada en ${mode} evita pedir otra instalación`, async (t) => {
    const app = await browser(t, nav, display);
    assert.equal(await app.requestInstallShortcut(), "already-installed");
  });
}
