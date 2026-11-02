import test from "node:test";
import assert from "node:assert/strict";
import { assertRunner } from "./ci-prepare-db.mjs";
import { validatePublishContext, validateReceipt } from "./ci-publish.mjs";
const valid = {
  GITHUB_REPOSITORY: "LautaroGalvan2024/transporte-tomasini",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_SHA: "a".repeat(40),
  TOMASINI_DEPLOY_HOST: "72.60.50.213",
  TOMASINI_DEPLOY_USER: "tomasini-ci",
  TOMASINI_DEPLOY_KNOWN_HOSTS:
    "72.60.50.213 ssh-ed25519 public-test-placeholder",
  TOMASINI_DEPLOY_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key",
};
test("publicación solo desde main del repositorio y sin argumentos SSH inyectables", () => {
  assert.deepEqual(validatePublishContext(valid), {
    host: "72.60.50.213",
    user: "tomasini-ci",
    commit: "a".repeat(40),
  });
  for (const override of [
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REPOSITORY: "somebody/fork" },
    { GITHUB_SHA: "a; echo unsafe" },
    { TOMASINI_DEPLOY_HOST: "-oProxyCommand=unsafe" },
    { TOMASINI_DEPLOY_HOST: "host;unsafe" },
    { TOMASINI_DEPLOY_USER: "mozzi" },
    { TOMASINI_DEPLOY_KNOWN_HOSTS: "" },
    { TOMASINI_DEPLOY_KEY: "" },
  ])
    assert.throws(() => validatePublishContext({ ...valid, ...override }));
});
test("el recibo debe corresponder exactamente a commit y paquete; se omiten campos extra", () => {
  const receipt = {
    status: "deployed",
    commit: "a".repeat(40),
    release: "b".repeat(64),
    previousRelease: "c".repeat(64),
    unexpected: "not emitted",
  };
  assert.equal(
    "unexpected" in validateReceipt(receipt, receipt.release, receipt.commit),
    false,
  );
  for (const override of [
    { status: "failed" },
    { commit: "d".repeat(40) },
    { release: "d".repeat(64) },
    { previousRelease: "invalid" },
  ])
    assert.throws(() =>
      validateReceipt(
        { ...receipt, ...override },
        receipt.release,
        receipt.commit,
      ),
    );
});
test("bootstrap CI rechaza ejecución local antes de conectar o crear datos", () => {
  for (const environment of [
    {},
    { GITHUB_ACTIONS: "false" },
    { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" },
    {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      GITHUB_WORKSPACE: "/wrong-checkout",
    },
  ])
    assert.throws(() => assertRunner(environment));
});
