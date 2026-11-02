import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { assertPortAvailable } from "./db.mjs";

test("un puerto ocupado se rechaza sin cerrar el proceso existente", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(assertPortAvailable(port), /ocupado/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("la prueba de puerto libre libera su propio socket", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await assertPortAvailable(port);
  await assertPortAvailable(port);
});
