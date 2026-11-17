import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  applyOfficialCheck,
  downloadOfficialCalendar,
  getCalendar,
  holidayCalendarStatus,
  holidayYearDto,
  HOLIDAY_CALENDAR_AUDIT_ID,
  HolidaySourceNotPublishedError,
  initialCalendar,
  parseCalendar,
  parseOfficialCalendar,
  runHolidayCalendarSync,
  updateHolidayYear,
} from "../src/holiday-calendar.js";
import {
  emptyHolidayYear,
  evaluateKm100,
  type HolidayEntry,
} from "../src/holiday-domain.js";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";

function source(year = 2026) {
  return {
    temporalCoverage: String(year),
    mainEntity: {
      itemListElement:
        initialCalendar().years[2026].proposal!.sourceEntries.map((entry) => ({
          item: {
            name: entry.name,
            startDate: entry.date.replace("2026", String(year)),
            additionalProperty: { name: "tipo", value: "inamovible" },
            location: { name: "Argentina", "@type": "Country" },
          },
        })),
    },
  };
}
function confirmed() {
  const calendar = initialCalendar(),
    proposal = calendar.years[2026].proposal!;
  return updateHolidayYear(
    calendar,
    2026,
    {
      version: 0,
      entries: proposal.entries,
      confirm: true,
      proposalHash: proposal.hash,
    },
    new Date("2026-11-17T00:00:00Z"),
  );
}
test("precarga distingue fuente oficial y base legal para cualquier año futuro sin confirmarlos", () => {
  const calendar = initialCalendar();
  const saved = JSON.stringify(calendar);
  for (const year of [2026, 2027, 2035, 2101, 2200]) {
    const state = holidayYearDto(calendar, year);
    assert.equal(state.confirmedAt, null);
    assert.deepEqual(state.entries, []);
    assert.ok(state.proposal!.entries.length >= 10);
    assert.equal(
      state.proposal!.kind,
      year === 2026 ? "official" : "statutory",
    );
    assert.ok(
      state.proposal!.entries.every((entry) =>
        entry.date.startsWith(`${year}-`),
      ),
    );
  }
  assert.equal(JSON.stringify(calendar), saved);
  assert.equal(
    holidayCalendarStatus(calendar, new Date("2026-11-17T12:00:00Z"))
      .needsConfirmation,
    true,
  );
  assert.equal(holidayYearDto(calendar, 2027).version, 0);
  assert.deepEqual(parseCalendar(null), calendar);
  assert.throws(() => parseCalendar("{}"), {
    code: "HOLIDAY_CALENDAR_INVALID",
  });
});

test("JSON anterior se hidrata una sola vez, conserva calendarios confirmados y recupera años vacíos por fallos", () => {
  const existing = confirmed();
  const { annualSourceStatus: _status2026, ...legacy2026 } =
    existing.years[2026];
  const { annualSourceStatus: _status2027, ...legacy2027 } = {
    ...emptyHolidayYear(2027),
    version: 4,
    lastCheckedAt: "2026-11-17T12:00:00.000Z",
    lastCheckError:
      "No se pudo consultar un calendario oficial completo para este año.",
  };
  const previous = {
    schemaVersion: 1,
    years: { "2026": legacy2026, "2027": legacy2027 },
    lastSyncDay: "2026-11-17",
  };
  const serialized = JSON.stringify(previous);
  const hydrated = parseCalendar(serialized);
  assert.deepEqual(hydrated.years[2026].entries, existing.years[2026].entries);
  assert.equal(
    hydrated.years[2026].confirmedAt,
    existing.years[2026].confirmedAt,
  );
  assert.equal(hydrated.years[2026].proposal, null);
  assert.equal(hydrated.years[2026].version, existing.years[2026].version);
  assert.equal(hydrated.years[2026].revision, existing.years[2026].revision);
  assert.equal(hydrated.years[2027].version, 4);
  assert.equal(hydrated.years[2027].revision, 0);
  assert.equal(hydrated.years[2027].confirmedAt, null);
  assert.deepEqual(hydrated.years[2027].entries, []);
  assert.equal(hydrated.years[2027].proposal!.kind, "statutory");
  assert.equal(holidayYearDto(hydrated, 2200).proposal!.kind, "statutory");
  assert.equal(hydrated.lastSyncDay, "2026-11-17");
  assert.deepEqual(parseCalendar(JSON.stringify(hydrated)), hydrated);
  assert.equal(JSON.stringify(previous), serialized);
});

test("hidratar conserva manuales y no resucita una propuesta consumida ni reemplaza una oficial existente", () => {
  const initial = initialCalendar(),
    proposal = initial.years[2027].proposal!;
  const manual: HolidayEntry = {
    date: "2027-07-22",
    name: "Día propio",
    source: "manual",
    enabled: true,
  };
  const draft = {
    ...initial,
    years: {
      "2027": { ...emptyHolidayYear(2027), version: 2, entries: [manual] },
    },
  };
  const hydrated = parseCalendar(JSON.stringify(draft));
  assert.deepEqual(hydrated.years[2027].entries, [manual]);
  assert.ok(
    hydrated.years[2027].proposal!.entries.some(
      (entry) => entry.date === manual.date && entry.source === "manual",
    ),
  );
  assert.equal(hydrated.years[2027].version, 2);
  const consumed = updateHolidayYear(initial, 2027, {
    version: 0,
    entries: proposal.entries,
    confirm: false,
    proposalHash: proposal.hash,
  });
  assert.equal(consumed.years[2027].confirmedAt, null);
  assert.equal(
    parseCalendar(JSON.stringify(consumed)).years[2027].proposal,
    null,
  );
  const official = applyOfficialCheck(initial, 2027, [
    ...proposal.sourceEntries,
    manual,
  ]);
  const { kind: _kind, ...legacyProposal } = official.years[2027].proposal!;
  const legacyOfficial = {
    ...official,
    years: {
      ...official.years,
      "2027": { ...official.years[2027], proposal: legacyProposal },
    },
  };
  const parsed = parseCalendar(JSON.stringify(legacyOfficial));
  assert.equal(holidayYearDto(parsed, 2027).proposal!.kind, "official");
  assert.equal(
    parsed.years[2027].proposal!.hash,
    official.years[2027].proposal!.hash,
  );
  assert.deepEqual(
    parsed.years[2027].proposal!.entries,
    official.years[2027].proposal!.entries,
  );
});

test("una fuente anual publicada reemplaza la propuesta base y las consultas repetidas no resucitan la confirmada", () => {
  const initial = initialCalendar(),
    base = initial.years[2027].proposal!;
  const available = applyOfficialCheck(initial, 2027, base.sourceEntries);
  assert.equal(available.years[2027].proposal!.kind, "official");
  assert.equal(available.years[2027].annualSourceStatus, "available");
  assert.equal(available.years[2027].confirmedAt, null);
  assert.deepEqual(available.years[2027].entries, []);
  const official = available.years[2027].proposal!;
  const accepted = updateHolidayYear(available, 2027, {
    version: available.years[2027].version,
    entries: official.entries,
    confirm: true,
    proposalHash: official.hash,
  });
  const again = applyOfficialCheck(accepted, 2027, official.sourceEntries);
  assert.equal(again.years[2027].proposal, null);
  assert.equal(again.years[2027].confirmedAt, accepted.years[2027].confirmedAt);
  assert.equal(again.years[2027].revision, accepted.years[2027].revision);
  assert.deepEqual(again.years[2027].entries, accepted.years[2027].entries);
  const notPublished = applyOfficialCheck(
    again,
    2027,
    null,
    new Date("2026-11-18T12:00:00Z"),
    "not_published",
  );
  assert.equal(notPublished.years[2027].annualSourceStatus, "not_published");
  assert.equal(notPublished.years[2027].proposal, null);
  assert.equal(
    notPublished.years[2027].confirmedAt,
    accepted.years[2027].confirmedAt,
  );
  assert.equal(
    notPublished.years[2027].revision,
    accepted.years[2027].revision,
  );
  assert.deepEqual(
    notPublished.years[2027].entries,
    accepted.years[2027].entries,
  );
});
test("confirmación consume propuesta, conserva cobertura y controla versión y hash", () => {
  const calendar = confirmed(),
    state = calendar.years[2026];
  assert.equal(state.revision, 1);
  assert.equal(state.version, 1);
  assert.equal(state.proposal, null);
  assert.ok(state.confirmedAt);
  const edited = updateHolidayYear(calendar, 2026, {
    version: 1,
    entries: state.entries.slice(1),
    confirm: false,
  });
  assert.equal(edited.years[2026].confirmedAt, state.confirmedAt);
  assert.equal(edited.years[2026].revision, 2);
  assert.throws(
    () =>
      updateHolidayYear(edited, 2026, {
        version: 1,
        entries: [],
        confirm: false,
      }),
    { code: "CONFLICT" },
  );
  assert.throws(
    () =>
      updateHolidayYear(calendar, 2026, {
        version: 1,
        entries: [],
        confirm: true,
        proposalHash: "0".repeat(64),
      }),
    { code: "HOLIDAY_PROPOSAL_CHANGED" },
  );
  assert.throws(() =>
    updateHolidayYear(calendar, 2026, {
      version: 1,
      entries: [
        {
          date: "2027-01-01",
          name: "Incorrecto",
          source: "manual",
          enabled: true,
        },
      ],
      confirm: true,
    }),
  );
});
test("consulta oficial crea propuesta, no altera activo, token o km guardados", () => {
  const calendar = confirmed(),
    entries = [
      ...calendar.years[2026].entries,
      {
        date: "2026-12-24",
        name: "Nuevo",
        source: "official",
        enabled: true,
      } satisfies HolidayEntry,
    ];
  const trip = {
    departureAt: new Date("2026-12-24T10:00:00-03:00"),
    arrivalAt: new Date("2026-12-24T11:00:00-03:00"),
    startKm: 0,
    endKm: 100,
  };
  const before = evaluateKm100(calendar, trip),
    next = applyOfficialCheck(calendar, 2026, entries);
  assert.deepEqual(next.years[2026].entries, calendar.years[2026].entries);
  assert.equal(evaluateKm100(next, trip).calendarToken, before.calendarToken);
  assert.equal(next.years[2026].proposal!.entries.at(-2)?.date, "2026-12-24");
  const failed = applyOfficialCheck(next, 2026, null);
  assert.deepEqual(failed.years[2026].proposal, next.years[2026].proposal);
  assert.deepEqual(failed.years[2026].entries, next.years[2026].entries);
  assert.equal(failed.years[2026].annualSourceStatus, "unavailable");
});
test("parser oficial excluye no laborables, turísticos y locales sin convertir fechas a UTC", () => {
  const payload = source();
  for (const type of ["no_laborable", "turistico", "especial"])
    payload.mainEntity.itemListElement.push({
      item: {
        name: type,
        startDate: "2026-12-07",
        additionalProperty: { name: "tipo", value: type },
        location: { name: "Argentina", "@type": "Country" },
      },
    });
  payload.mainEntity.itemListElement.push({
    item: {
      name: "Año nuevo",
      startDate: "2027-01-01",
      additionalProperty: { name: "tipo", value: "inamovible" },
      location: { name: "Argentina", "@type": "Country" },
    },
  });
  const entries = parseOfficialCalendar(payload, 2026);
  assert.equal(
    entries.some((entry) => entry.date === "2026-12-07"),
    false,
  );
  assert.equal(entries[0].date, "2026-01-01");
  assert.equal(
    entries.some((entry) => entry.date === "2026-11-23"),
    true,
  );
  assert.throws(() => parseOfficialCalendar(payload, 2027));
  assert.throws(() =>
    parseOfficialCalendar(
      { temporalCoverage: "2026", mainEntity: { itemListElement: [] } },
      2026,
    ),
  );
  const malformed = source();
  malformed.mainEntity.itemListElement[0].item.startDate = "2026-02-30";
  assert.throws(() => parseOfficialCalendar(malformed, 2026));
});
test("descarga oficial valida timeout, redirecciones, tamaño y formato sin red real", async () => {
  let received: RequestInit | undefined;
  const fetcher = (async (_url, init) => {
    received = init;
    return Response.json(source());
  }) as typeof fetch;
  assert.ok((await downloadOfficialCalendar(2026, fetcher)).length >= 16);
  assert.equal(received?.redirect, "error");
  assert.ok(received?.signal instanceof AbortSignal);
  await assert.rejects(
    downloadOfficialCalendar(
      2026,
      (async () => new Response("missing", { status: 404 })) as typeof fetch,
    ),
    HolidaySourceNotPublishedError,
  );
  await assert.rejects(
    downloadOfficialCalendar(
      2026,
      (async () =>
        new Response("x", {
          headers: { "content-length": "600000" },
        })) as typeof fetch,
    ),
  );
  await assert.rejects(
    downloadOfficialCalendar(
      2026,
      (async () => new Response("x".repeat(524_289))) as typeof fetch,
    ),
  );
  await assert.rejects(
    downloadOfficialCalendar(
      2026,
      (async () => new Response("not-json")) as typeof fetch,
    ),
  );
});

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "API calendario: permisos, CSRF, concurrencia, auditoría y sincronización aislada",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      origin = getConfig().origin;
    const previousSettings = await db.setting.findUniqueOrThrow({
      where: { id: "main" },
    });
    const ids: string[] = [],
      password = "Prueba-feriados-local-2026",
      passwordHash = await hashPassword(password),
      suffix = randomUUID().slice(0, 8);
    try {
      await db.setting.update({
        where: { id: "main" },
        data: { holidayCalendar: null },
      });
      const admin = await db.user.create({
        data: {
          username: `holiday_admin_${suffix}`,
          name: "Admin feriados prueba",
          passwordHash,
          role: "ADMIN",
          mustChangePassword: false,
        },
      });
      ids.push(admin.id);
      const driver = await db.user.create({
        data: {
          username: `holiday_driver_${suffix}`,
          name: "Chofer ficticio feriados",
          passwordHash,
          role: "DRIVER",
          mustChangePassword: false,
          driver: { create: {} },
        },
      });
      ids.push(driver.id);
      const adminAgent = request.agent(app),
        driverAgent = request.agent(app);
      const post = (
        agent: typeof adminAgent,
        path: string,
        body: object = {},
      ) =>
        agent
          .post(`/api${path}`)
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send(body);
      const put = (agent: typeof adminAgent, body: object) =>
        agent
          .put("/api/holiday-calendar/2026")
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send(body);
      assert.equal(
        (
          await post(adminAgent, "/auth/login", {
            username: admin.username,
            password,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post(driverAgent, "/auth/login", {
            username: driver.username,
            password,
          })
        ).status,
        200,
      );
      await t.test(
        "GET es sólo lectura y administración es obligatoria",
        async () => {
          assert.equal(
            (await request(app).get("/api/holiday-calendar/status")).status,
            401,
          );
          assert.equal(
            (await driverAgent.get("/api/holiday-calendar/2026")).status,
            403,
          );
          assert.equal(
            (await put(driverAgent, { version: 0, entries: [], confirm: true }))
              .status,
            403,
          );
          assert.equal(
            (await post(driverAgent, "/holiday-calendar/2026/check")).status,
            403,
          );
          assert.equal(
            (
              await adminAgent
                .put("/api/holiday-calendar/2026")
                .send({ version: 0, entries: [], confirm: true })
            ).status,
            403,
          );
          assert.equal(
            (await adminAgent.get("/api/holiday-calendar/2026")).status,
            200,
          );
          for (const year of [2027, 2035, 2101, 2200]) {
            const future = await adminAgent.get(
              `/api/holiday-calendar/${year}`,
            );
            assert.equal(future.status, 200, JSON.stringify(future.body));
            assert.equal(future.body.proposal.kind, "statutory");
            assert.ok(future.body.proposal.entries.length >= 10);
            assert.deepEqual(future.body.entries, []);
            assert.equal(future.body.confirmedAt, null);
          }
          assert.equal(
            (await adminAgent.get("/api/holiday-calendar/status")).status,
            200,
          );
          assert.equal(
            (await db.setting.findUniqueOrThrow({ where: { id: "main" } }))
              .holidayCalendar,
            null,
          );
        },
      );
      await t.test(
        "guardar confirma, protege versión concurrente y registra actor e instantánea",
        async () => {
          const proposal = initialCalendar().years[2026].proposal!;
          const input = {
            version: 0,
            entries: proposal.entries,
            confirm: true,
            proposalHash: proposal.hash,
          };
          const responses = await Promise.all([
            put(adminAgent, input),
            put(adminAgent, input),
          ]);
          assert.deepEqual(
            responses.map((response) => response.status).sort(),
            [200, 409],
          );
          const audits = await db.audit.findMany({
            where: { actorId: admin.id, entity: "HOLIDAY_CALENDAR" },
          });
          assert.equal(audits.length, 1);
          assert.equal(audits[0].entityId, HOLIDAY_CALENDAR_AUDIT_ID);
          assert.equal(audits[0].action, "CONFIRMED");
          assert.ok(audits[0].before && audits[0].after);
          assert.doesNotMatch(JSON.stringify(audits), /passwordHash|tokenHash/);
        },
      );
      await t.test(
        "GET hidrata un JSON ya guardado con año futuro vacío sin escribir ni alterar el confirmado",
        async () => {
          const before = await db.setting.findUniqueOrThrow({
            where: { id: "main" },
          });
          const saved = await getCalendar();
          const { annualSourceStatus: _status, ...oldEmpty } = {
            ...emptyHolidayYear(2027),
            version: 6,
            lastCheckedAt: "2026-11-17T12:00:00.000Z",
            lastCheckError: "Fallo anterior de la fuente",
          };
          const legacy = JSON.stringify({
            schemaVersion: 1,
            years: { "2026": saved.years[2026], "2027": oldEmpty },
            lastSyncDay: null,
          });
          try {
            await db.setting.update({
              where: { id: "main" },
              data: { holidayCalendar: legacy },
            });
            const response = await adminAgent.get("/api/holiday-calendar/2027");
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.proposal.kind, "statutory");
            assert.equal(response.body.version, 6);
            assert.equal(response.body.revision, 0);
            assert.equal(response.body.confirmedAt, null);
            const current = await adminAgent.get("/api/holiday-calendar/2026");
            assert.deepEqual(current.body.entries, saved.years[2026].entries);
            assert.equal(
              current.body.confirmedAt,
              saved.years[2026].confirmedAt,
            );
            assert.equal(current.body.proposal, null);
            assert.equal(
              (await adminAgent.get("/api/holiday-calendar/2200")).body.proposal
                .kind,
              "statutory",
            );
            assert.equal(
              (await db.setting.findUniqueOrThrow({ where: { id: "main" } }))
                .holidayCalendar,
              legacy,
            );
          } finally {
            await db.setting.update({
              where: { id: "main" },
              data: { holidayCalendar: before.holidayCalendar },
            });
          }
        },
      );
      await t.test(
        "404 devuelve la precarga disponible sin error y conserva un calendario confirmado",
        async () => {
          const before = await getCalendar();
          const mock = t.mock.method(
            globalThis,
            "fetch",
            async () => new Response("unavailable", { status: 404 }),
          );
          try {
            const response = await post(
              adminAgent,
              "/holiday-calendar/2026/check",
            );
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.annualSourceStatus, "not_published");
            assert.equal(response.body.proposal, null);
            assert.equal(
              response.body.confirmedAt,
              before.years[2026].confirmedAt,
            );
            for (const year of [2027, 2031, 2200]) {
              const future = await post(
                adminAgent,
                `/holiday-calendar/${year}/check`,
              );
              assert.equal(future.status, 200, JSON.stringify(future.body));
              assert.equal(future.body.annualSourceStatus, "not_published");
              assert.equal(future.body.proposal.kind, "statutory");
              assert.ok(future.body.proposal.entries.length >= 10);
              assert.equal(future.body.confirmedAt, null);
            }
            const noContent = await post(
              adminAgent,
              "/holiday-calendar/2025/check",
            );
            assert.equal(noContent.status, 502);
            assert.equal(
              noContent.body.error.code,
              "HOLIDAY_SOURCE_UNAVAILABLE",
            );
          } finally {
            mock.mock.restore();
          }
          const after = await getCalendar();
          assert.deepEqual(
            after.years[2026].entries,
            before.years[2026].entries,
          );
          assert.equal(after.years[2026].revision, before.years[2026].revision);
          assert.equal(
            after.years[2026].confirmedAt,
            before.years[2026].confirmedAt,
          );
          assert.equal(after.years[2026].proposal, null);
          assert.equal(after.years[2026].annualSourceStatus, "not_published");
        },
      );
      await t.test(
        "fallo de red conserva propuesta y permite luego incorporar la fuente anual oficial",
        async () => {
          const before = await adminAgent.get("/api/holiday-calendar/2027");
          const failedFetch = t.mock.method(globalThis, "fetch", async () => {
            throw new TypeError("Failed to fetch");
          });
          try {
            const response = await post(
              adminAgent,
              "/holiday-calendar/2027/check",
            );
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.annualSourceStatus, "unavailable");
            assert.deepEqual(response.body.proposal, before.body.proposal);
            assert.deepEqual(response.body.entries, before.body.entries);
            assert.equal(response.body.revision, before.body.revision);
          } finally {
            failedFetch.mock.restore();
          }
          const availableFetch = t.mock.method(globalThis, "fetch", async () =>
            Response.json(source(2027)),
          );
          try {
            const response = await post(
              adminAgent,
              "/holiday-calendar/2027/check",
            );
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.annualSourceStatus, "available");
            assert.equal(response.body.proposal.kind, "official");
            assert.equal(response.body.confirmedAt, null);
            assert.deepEqual(response.body.entries, []);
            const accepted = await adminAgent
              .put("/api/holiday-calendar/2027")
              .set("Origin", origin)
              .set("X-Tomasini-Request", "1")
              .send({
                version: response.body.version,
                entries: response.body.proposal.entries,
                confirm: true,
                proposalHash: response.body.proposal.hash,
              });
            assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
            const repeated = await post(
              adminAgent,
              "/holiday-calendar/2027/check",
            );
            assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
            assert.equal(repeated.body.proposal, null);
            assert.equal(repeated.body.confirmedAt, accepted.body.confirmedAt);
            assert.equal(repeated.body.revision, accepted.body.revision);
            assert.deepEqual(repeated.body.entries, accepted.body.entries);
          } finally {
            availableFetch.mock.restore();
          }
        },
      );
      await t.test(
        "sync diario actual y próximo se reclama una sola vez, sin SMTP ni activaciones",
        async () => {
          let calls = 0;
          const before = await getCalendar(),
            payload = source();
          payload.mainEntity.itemListElement.push({
            item: {
              name: "Feriado de prueba",
              startDate: "2026-12-24",
              additionalProperty: { name: "tipo", value: "inamovible" },
              location: { name: "Argentina", "@type": "Country" },
            },
          });
          const fetcher = (async (url) => {
            calls++;
            return String(url).includes("2026")
              ? Response.json(payload)
              : new Response("missing", { status: 404 });
          }) as typeof fetch;
          const now = new Date("2026-11-17T12:00:00Z");
          const result = await Promise.all([
            runHolidayCalendarSync(now, fetcher),
            runHolidayCalendarSync(now, fetcher),
          ]);
          assert.equal(
            result.reduce((sum, item) => sum + item.checked, 0),
            2,
          );
          assert.equal(calls, 2);
          const after = await getCalendar();
          assert.deepEqual(
            after.years[2026].entries,
            before.years[2026].entries,
          );
          assert.ok(after.years[2026].proposal);
          assert.equal(
            after.years[2027].confirmedAt,
            before.years[2027].confirmedAt,
          );
          assert.equal(after.years[2027].proposal, null);
          assert.equal(after.years[2027].annualSourceStatus, "not_published");
          assert.deepEqual(
            after.years[2027].entries,
            before.years[2027].entries,
          );
          assert.equal((await runHolidayCalendarSync(now, fetcher)).checked, 0);
          assert.equal(calls, 2);
        },
      );
    } finally {
      await db.setting.update({
        where: { id: "main" },
        data: { holidayCalendar: previousSettings.holidayCalendar },
      });
      await db.audit.deleteMany({ where: { actorId: { in: ids } } });
      await db.session.deleteMany({ where: { userId: { in: ids } } });
      await db.driver.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await disconnect();
    }
  },
);
