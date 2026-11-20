import { expect, test } from "@playwright/test";
import { manualDistanceEnabled } from "../src/features/trips/manual-distance-enabled.ts";
import { operationalDistanceEnabled } from "../src/features/trips/operational-distance-enabled.ts";
import { fillTripRoute, loadApp, trip, trips, truck, user } from "./app.mjs";

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

test("el chofer puede cargar los dos odómetros", async ({ page }) => {
  await loadApp(page, "/new-trip", {
    "GET /auth/me": (r) => r.fulfill({ json: { ...user, role: "DRIVER" } }),
  });
  if (operationalDistanceEnabled) {
    await expect(page.getByLabel(selector)).toHaveValue("DISTANCE");
    await page.getByLabel(selector).selectOption("ODOMETER");
    await expect(page.getByLabel(/Kilómetros recorridos/)).toHaveCount(0);
  } else {
    await expect(page.getByLabel(selector)).toHaveCount(0);
  }
  await expect(page.getByLabel("Odómetro al salir")).toBeVisible();
  await expect(page.getByLabel("Odómetro al llegar")).toBeVisible();
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
    const optIn = page.getByRole("checkbox", {
      name: "Sumar al kilometraje del camión",
    });
    if (operationalDistanceEnabled) await expect(optIn).not.toBeChecked();
    else await expect(optIn).toHaveCount(0);
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
    expect(body).not.toHaveProperty("countForMaintenance");
    expect(body).not.toHaveProperty("initialTruckOdometer");
  });
}

test("el autor asignado puede corregir sus km operativos solo en la segunda etapa", async ({
  page,
}) => {
  const own = { ...direct, distanceSource: "DRIVER" };
  let patch;
  await loadApp(page, "/trips", {
    "GET /auth/me": (r) => r.fulfill({ json: { ...user, role: "DRIVER" } }),
    "GET /trips": (r) =>
      r.fulfill({ json: { ...trips, total: 1, items: [own] } }),
    ["GET /trips/" + own.id]: (r) => r.fulfill({ json: own }),
    ["PATCH /trips/" + own.id]: (r) => {
      patch = r.request().postDataJSON();
      return r.fulfill({
        json: { ...own, distanceKm: patch.distanceKm, version: 2 },
      });
    },
  });
  await page
    .getByRole("button", { name: /Rosario.*Santa Fe/ })
    .first()
    .click();
  const detail = page.getByRole("dialog");
  await expect(
    detail.getByText("Suma para vencimientos · Chofer"),
  ).toBeVisible();
  const edit = detail.getByRole("button", { name: "Editar viaje" });
  if (!operationalDistanceEnabled) {
    await expect(edit).toHaveCount(0);
    return;
  }
  await edit.click();
  await expect(page.getByLabel(selector)).toHaveCount(0);
  await expect(page.getByLabel(/Primera lectura/)).toHaveCount(0);
  await expect(page.getByLabel(/Sumar al kilometraje/)).toHaveCount(0);
  await page.getByLabel(/Kilómetros recorridos/).fill("363");
  await expect(
    page.getByText("El recorrido no coincide con horarios al 100%."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("heading", { name: /Viaje actualizado/ }),
  ).toBeVisible();
  expect(patch).toMatchObject({
    distanceKm: 363,
    mileageMode: "DISTANCE",
    version: 1,
  });
  for (const key of [
    "countForMaintenance",
    "initialTruckOdometer",
    "startKm",
    "endKm",
  ])
    expect(patch).not.toHaveProperty(key);
});

for (const [role, width] of [
  ["DRIVER", 390],
  ["ADMIN", 1440],
]) {
  test(`alta operativa de ${role} con primera lectura a ${width} px`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !operationalDistanceEnabled,
      "La carga operativa se habilita en la segunda etapa.",
    );
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const initial = page.getByLabel(/Primera lectura del odómetro/);
    const distance = page.getByRole("textbox", {
      name: /Kilómetros recorridos/,
    });
    const save = page.getByRole("button", { name: "Guardar viaje" });
    const previews = [],
      writes = [];
    let raced = false;
    const noBase = {
      ...truck,
      odometer: null,
      odometerAt: null,
      maintenanceKm: null,
      maintenanceKmAt: null,
    };
    await loadApp(page, "/new-trip", {
      "GET /auth/me": (r) => r.fulfill({ json: { ...user, role } }),
      "GET /trucks": (r) =>
        r.fulfill({
          json: {
            items: [
              raced
                ? { ...truck, maintenanceKm: 185, mileageEstimated: true }
                : noBase,
              { ...noBase, id: "other-truck", plate: "QA002" },
            ],
          },
        }),
      "POST /trips/km100-preview": (r) => {
        previews.push(r.request().postDataJSON());
        return r.fulfill({ json: direct.km100Context });
      },
      "POST /trips": (r) => {
        writes.push(r.request().postDataJSON());
        if (role === "DRIVER" && !raced) {
          raced = true;
          return r.fulfill({
            status: 409,
            json: {
              error: {
                code: "INITIAL_ODOMETER_CONFLICT",
                message: "El camión ya tiene una lectura.",
              },
            },
          });
        }
        return r.fulfill({ json: { ...direct, distanceSource: role } });
      },
    });
    const count = page.getByRole("checkbox", { name: /Sumar al kilometraje/ });
    if (role === "ADMIN") {
      await page.getByLabel(selector).selectOption("DISTANCE");
      await expect(initial).toHaveCount(0);
      await count.check();
    } else {
      await expect(page.getByLabel(selector)).toHaveValue("DISTANCE");
      await expect(count).toHaveCount(0);
    }
    await expect(initial).toBeVisible();
    await initial.fill("99999");
    await page
      .getByRole("combobox", { name: "Camión", exact: true })
      .selectOption("other-truck");
    await expect(initial).toHaveValue("");
    await page
      .getByRole("combobox", { name: "Camión", exact: true })
      .selectOption(truck.id);
    await fillTripRoute(page);
    await distance.fill("350");
    await expect(
      page.getByText("El recorrido no coincide con horarios al 100%."),
    ).toBeVisible();
    expect(previews.at(-1)).toEqual({
      mileageMode: "DISTANCE",
      distanceKm: 350,
      departureAt: "2026-10-14T12:00:00.000Z",
      arrivalAt: "2026-10-14T13:00:00.000Z",
    });
    await save.click();
    await expect(
      page.getByText(/Ingresá una lectura inicial entre/),
    ).toBeVisible();
    await initial.fill("0");
    await page
      .getByLabel(selector)
      .evaluate((el) => el.parentElement.scrollIntoView({ block: "center" }));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("primera-lectura.png") });
    await save.click();
    if (role === "DRIVER") {
      await expect(page.getByText(/Estimado para vencimientos/)).toContainText(
        "185 km",
      );
      await expect(page.getByText(/Última lectura real/)).toContainText(
        "100 km",
      );
      await expect(initial).toHaveCount(0);
      await expect(distance).toHaveValue("350");
      await save.click();
    }
    await expect(
      page.getByRole("heading", { name: /Viaje guardado/ }),
    ).toBeVisible();
    if (role === "DRIVER") {
      expect(writes.at(-1)).not.toHaveProperty("initialTruckOdometer");
      expect(writes[0].clientRequestId).toBe(writes.at(-1).clientRequestId);
    }
    expect(writes[0]).toMatchObject({
      initialTruckOdometer: 0,
      mileageMode: "DISTANCE",
      distanceKm: 350,
    });
    if (role === "ADMIN") expect(writes[0].countForMaintenance).toBe(true);
    else expect(writes[0]).not.toHaveProperty("countForMaintenance");
    expect(writes[0]).not.toHaveProperty("startKm");
    expect(writes[0]).not.toHaveProperty("endKm");
  });
}
