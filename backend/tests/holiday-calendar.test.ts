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
  initialCalendar,
  parseCalendar,
  parseOfficialCalendar,
  runHolidayCalendarSync,
  updateHolidayYear,
} from "../src/holiday-calendar.js";
import { evaluateKm100, type HolidayEntry } from "../src/holiday-domain.js";
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
test("precarga 2026 es propuesta revisable, nunca confirma ni inventa 2027", () => {
  const calendar = initialCalendar();
  assert.equal(calendar.years[2026].confirmedAt, null);
  assert.equal(calendar.years[2026].entries.length, 0);
  assert.ok(calendar.years[2026].proposal!.entries.length >= 16);
  assert.equal(calendar.years[2027], undefined);
  assert.equal(
    holidayCalendarStatus(calendar, new Date("2026-11-17T12:00:00Z"))
      .needsConfirmation,
    true,
  );
  assert.equal(holidayYearDto(calendar, 2027).version, 0);
  assert.equal(calendar.years[2027], undefined);
  assert.deepEqual(parseCalendar(null), calendar);
  assert.throws(() => parseCalendar("{}"), {
    code: "HOLIDAY_CALENDAR_INVALID",
  });
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
  assert.ok(failed.years[2026].lastCheckError);
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
          assert.equal(
            (await adminAgent.get("/api/holiday-calendar/2027")).status,
            200,
          );
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
        "fuente fallida conserva activo y reporta error administrativo",
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
            assert.equal(response.status, 502);
            assert.equal(
              response.body.error.code,
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
          assert.ok(after.years[2026].lastCheckError);
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
          assert.equal(after.years[2027].confirmedAt, null);
          assert.ok(after.years[2027].lastCheckError);
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
