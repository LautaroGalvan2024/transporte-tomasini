import assert from "node:assert/strict";
import test from "node:test";
import { scheduleTripPreview } from "../src/features/trips/trip-preview.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function previewRequest() {
  let timerCallback, resolve, reject, signal;
  const events = [];
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  const stop = scheduleTripPreview({
    request: (value) => {
      signal = value;
      events.push("request");
      return promise;
    },
    onPreview: (preview) => events.push(preview),
    onError: (error) => events.push(error.message),
    onSettled: () => events.push("settled"),
    schedule: (callback, delay) => {
      assert.equal(delay, 300);
      timerCallback = callback;
      return 12;
    },
    cancel: (timer) => {
      assert.equal(timer, 12);
      events.push("cancel");
    },
  });
  return {
    stop,
    fire: () => timerCallback(),
    resolve,
    reject,
    events,
    signal: () => signal,
  };
}

test("el preview espera el debounce y publica sugerencia cero antes de finalizar", async () => {
  const pending = previewRequest();
  assert.deepEqual(pending.events, []);
  pending.fire();
  const preview = { mode: "NONE", suggestedKm: 0, calendarToken: "one" };
  pending.resolve(preview);
  await flush();
  assert.deepEqual(pending.events, ["request", preview, "settled"]);
});

test("al cambiar los inputs se aborta e ignora una respuesta anterior tardía", async () => {
  const old = previewRequest();
  old.fire();
  old.stop();
  assert.equal(old.signal().aborted, true);
  const latest = previewRequest();
  latest.fire();
  latest.resolve({ calendarToken: "latest", suggestedKm: 20 });
  old.resolve({ calendarToken: "stale", suggestedKm: 90 });
  await flush();
  assert.deepEqual(old.events, ["request", "cancel"]);
  assert.deepEqual(latest.events, [
    "request",
    { calendarToken: "latest", suggestedKm: 20 },
    "settled",
  ]);
});

test("un error activo se muestra y un rechazo abortado no altera el formulario", async () => {
  const active = previewRequest();
  active.fire();
  active.reject(new Error("Sin conexión"));
  await flush();
  assert.deepEqual(active.events, ["request", "Sin conexión", "settled"]);
  const cancelled = previewRequest();
  cancelled.fire();
  cancelled.stop();
  cancelled.reject(new Error("Abortado"));
  await flush();
  assert.deepEqual(cancelled.events, ["request", "cancel"]);
});
