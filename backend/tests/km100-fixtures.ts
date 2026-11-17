import assert from "node:assert/strict";
import request from "supertest";
import { getDb } from "../src/db.js";

// Older regression suites exercise review/odometer rules. Resolve their new
// fixture's calendar through the real API, then restore the isolated settings.
export async function resolveFixtureKm100(
  agent: ReturnType<typeof request.agent>,
  origin: string,
  id: string,
) {
  const db = getDb();
  const original = await db.setting.findUniqueOrThrow({
    where: { id: "main" },
  });
  const trip = (await agent.get(`/api/trips/${id}`)).body;
  try {
    for (const year of trip.km100Context.missingYears as number[]) {
      const calendar = (await agent.get(`/api/holiday-calendar/${year}`)).body;
      const confirmed = await agent
        .put(`/api/holiday-calendar/${year}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send({
          version: calendar.version,
          entries: [
            {
              date: `${year}-01-01`,
              name: "Año nuevo de prueba",
              source: "manual",
              enabled: true,
            },
          ],
          confirm: true,
        });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    }
    const preview = await agent
      .post("/api/trips/km100-preview")
      .set("Origin", origin)
      .set("X-Tomasini-Request", "1")
      .send({
        departureAt: trip.departureAt,
        arrivalAt: trip.arrivalAt,
        startKm: trip.startKm,
        endKm: trip.endKm,
      });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const resolved = await agent
      .patch(`/api/trips/${id}`)
      .set("Origin", origin)
      .set("X-Tomasini-Request", "1")
      .send({
        version: trip.version,
        km100Resolve: true,
        km100: preview.body.suggestedKm ?? 0,
        km100CalendarToken: preview.body.calendarToken,
      });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    return resolved.body;
  } finally {
    await db.setting.update({
      where: { id: "main" },
      data: { holidayCalendar: original.holidayCalendar },
    });
  }
}
