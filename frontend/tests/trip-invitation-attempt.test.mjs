import assert from "node:assert/strict";
import test from "node:test";
import {
  invitationAttempt,
  invitationAttemptIsUncertain,
} from "../src/features/invitations/invitation-attempt.ts";

test("la invitación congela el intento normalizado y reutiliza sus credenciales", () => {
  const first = invitationAttempt(null, {
    token: "test-token",
    name: "  Chofer Prueba  ",
    username: "  00123456  ",
    password: " Clave de prueba ",
  });
  assert.deepEqual(first, {
    token: "test-token",
    name: "Chofer Prueba",
    username: "00123456",
    password: " Clave de prueba ",
  });
  assert.ok(Object.isFrozen(first));
  const retry = invitationAttempt(first, {
    token: "different",
    name: "Changed",
    username: "other",
    password: "other",
  });
  assert.equal(retry, first);
});

test("la incertidumbre de una invitación mantiene las excepciones de validación", () => {
  for (const status of [0, 500, 503])
    assert.equal(
      invitationAttemptIsUncertain({ status, code: "" }, false),
      true,
    );
  assert.equal(
    invitationAttemptIsUncertain(
      { status: 410, code: "INVITATION_UNAVAILABLE" },
      false,
    ),
    true,
  );
  assert.equal(
    invitationAttemptIsUncertain({ status: 409, code: "CONFLICT" }, false),
    false,
  );
  assert.equal(
    invitationAttemptIsUncertain({ status: 409, code: "CONFLICT" }, true),
    true,
  );
  for (const code of ["USERNAME_TAKEN", "VALIDATION"])
    assert.equal(
      invitationAttemptIsUncertain({ status: 400, code }, true),
      false,
    );
});
