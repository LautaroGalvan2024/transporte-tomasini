import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  invitationAccept,
  invitationCreate,
  invitationStatus,
  invitationTokenHash,
} from "../src/invitation-domain.js";

test("invitaciones: TTL limitado, rol vinculado y rechazo de escalamiento en aceptación", () => {
  assert.equal(invitationCreate.parse({ role: "DRIVER" }).expiresInDays, 7);
  for (const expiresInDays of [0, -1, 31, 1.5])
    assert.equal(
      invitationCreate.safeParse({ role: "DRIVER", expiresInDays }).success,
      false,
    );
  assert.equal(
    invitationCreate.safeParse({ role: "ADMIN", driverId: randomUUID() })
      .success,
    false,
  );
  const input = {
    token: randomBytes(32).toString("base64url"),
    name: "Chofer",
    username: "chofer",
    password: "Una-contraseña-larga",
  };
  assert.equal(invitationAccept.safeParse(input).success, true);
  assert.equal(
    invitationAccept.safeParse({ ...input, role: "ADMIN" }).success,
    false,
  );
  assert.equal(
    invitationAccept.safeParse({ ...input, driverId: randomUUID() }).success,
    false,
  );
});
test("invitaciones: expiran exactamente al límite y conservan estados terminales", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const row = { acceptedAt: null, revokedAt: null, expiresAt: now };
  assert.equal(invitationStatus(row, now), "EXPIRED");
  assert.equal(
    invitationStatus({ ...row, expiresAt: new Date(now.getTime() + 1) }, now),
    "PENDING",
  );
  assert.equal(
    invitationStatus({ ...row, acceptedAt: new Date(now.getTime() - 1) }, now),
    "ACCEPTED",
  );
  assert.equal(
    invitationStatus({ ...row, revokedAt: new Date(now.getTime() - 1) }, now),
    "REVOKED",
  );
});
test("invitaciones: la representación persistida no contiene el token de acceso", () => {
  const first = randomBytes(32).toString("base64url"),
    second = randomBytes(32).toString("base64url");
  assert.ok(/^[a-f0-9]{64}$/.test(invitationTokenHash(first)));
  assert.ok(invitationTokenHash(first) !== first);
  assert.ok(invitationTokenHash(first) !== invitationTokenHash(second));
});
