import { expect, test } from "@playwright/test";
import { manualDistanceEnabled } from "../src/features/trips/manual-distance-enabled.ts";
import { loadApp, trip, trips, user } from "./app.mjs";

const direct = {
  ...trip,
  mileageMode: "DISTANCE",
  distanceKm: 350,
  startKm: null,
  endKm: null,
  km100Context: {
    schemaVersion: 1,
    mode: "NONE",
    suggestedKm: 0,
    missingYears: [],
    intervals: [],
    calendarToken: "calendar-fixture",
  },
};
const selector = "Cómo cargar los kilómetros";
const roles = ["ADMIN", "DRIVER"];

for (const role of roles) {
  test(`viaje con distancia por ${role}: lectura de odómetros y permisos de edición`, async ({
    page,
  }) => {
    let patch;
    await loadApp(page, "/trips", {
      "GET /auth/me": (r) => r.fulfill({ json: { ...user, role } }),
      "GET /trips": (r) =>
        r.fulfill({ json: { ...trips, items: [direct], total: 1 } }),
      ["GET /trips/" + trip.id]: (r) => r.fulfill({ json: direct }),
      ["PATCH /trips/" + trip.id]: (r) => {
        patch = r.request().postDataJSON();
        return r.fulfill({
          json: { ...direct, distanceKm: patch.distanceKm, version: 2 },
        });
      },
    });
    await page
      .getByRole("button", { name: /Rosario.*Santa Fe/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/350\s*km/).first()).toBeVisible();
    for (const label of ["Odómetro al salir", "Odómetro al llegar"]) {
      await expect(
        dialog.getByText(label, { exact: true }).locator("+ dd"),
      ).toHaveText("Sin informar");
    }
    const edit = dialog.getByRole("button", { name: "Editar viaje" });
    if (manualDistanceEnabled && role === "ADMIN") {
      await edit.click();
      const distance = page.getByRole("textbox", {
        name: /Kilómetros recorridos/,
      });
      await expect(distance).toHaveValue("350");
      await expect(page.getByLabel(selector)).toHaveCount(0);
      await expect(page.getByLabel("Odómetro al salir")).toHaveCount(0);
      await distance.fill("355");
      await expect(
        page.getByText("El recorrido no coincide con horarios al 100%."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(
        page.getByRole("heading", { name: /Viaje actualizado/ }),
      ).toBeVisible();
      expect(patch).toMatchObject({
        mileageMode: "DISTANCE",
        distanceKm: 355,
        version: 1,
      });
      expect(patch).not.toHaveProperty("startKm");
      expect(patch).not.toHaveProperty("endKm");
    } else {
      await expect(edit).toHaveCount(0);
    }
  });
}

test("el chofer carga los dos odómetros", async ({ page }) => {
  await loadApp(page, "/new-trip", {
    "GET /auth/me": (r) => r.fulfill({ json: { ...user, role: "DRIVER" } }),
  });
  await expect(page.getByLabel("Odómetro al salir")).toBeVisible();
  await expect(page.getByLabel("Odómetro al llegar")).toBeVisible();
  await expect(page.getByLabel(selector)).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`alta de administración a ${width} px respeta el método y su disponibilidad`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const previews = [];
    let body;
    await loadApp(page, "/new-trip", {
      "POST /trips/km100-preview": (r) => {
        previews.push(r.request().postDataJSON());
        return r.fulfill({
          json: {
            mode: "FULL",
            suggestedKm: 350,
            intervals: [],
            missingYears: [],
            calendarToken: "direct-test",
          },
        });
      },
      "POST /trips": (r) => {
        body = r.request().postDataJSON();
        return r.fulfill({ json: direct });
      },
    });
    await expect(page.getByLabel("Odómetro al salir")).toBeVisible();
    const method = page.getByLabel(selector);
    if (!manualDistanceEnabled) {
      await expect(method).toHaveCount(0);
      return;
    }
    await expect(method).toHaveValue("ODOMETER");
    await page.getByLabel("Odómetro al salir").fill("92300");
    await method.selectOption("DISTANCE");
    await expect(page.getByLabel("Odómetro al salir")).toHaveCount(0);
    await expect(page.getByLabel("Odómetro al llegar")).toHaveCount(0);
    await page.getByLabel(/Acoplado de este viaje/).selectOption("");
    await page.getByPlaceholder("Localidad de salida").fill(trip.origin);
    await page.getByPlaceholder("Localidad de llegada").fill(trip.destination);
    await page.getByLabel(/Fecha y hora de salida/).fill("2026-10-11T09:00");
    await page.getByLabel(/Fecha y hora de llegada/).fill("2026-10-11T13:00");
    const distance = page.getByRole("textbox", {
      name: /Kilómetros recorridos/,
    });
    await distance.fill("350");
    await expect(
      page.getByText("Todo el recorrido corresponde al 100%."),
    ).toBeVisible();
    expect(previews.at(-1)).toEqual({
      departureAt: "2026-10-11T12:00:00.000Z",
      arrivalAt: "2026-10-11T16:00:00.000Z",
      mileageMode: "DISTANCE",
      distanceKm: 350,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390)
      await method.evaluate((el) => el.parentElement.scrollIntoView());
    await page.screenshot({ path: testInfo.outputPath("formulario.png") });
    await page.getByRole("button", { name: "Guardar viaje" }).click();
    await expect(
      page.getByRole("heading", { name: /Viaje guardado/ }),
    ).toBeVisible();
    expect(body).toMatchObject({
      mileageMode: "DISTANCE",
      distanceKm: 350,
      km100: 350,
      km100CalendarToken: "direct-test",
    });
    expect(body).not.toHaveProperty("startKm");
    expect(body).not.toHaveProperty("endKm");
  });
}
