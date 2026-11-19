import { expect, test } from "@playwright/test";
import { driver, loadApp, trip, trips, truck } from "./app.mjs";

const monthlyDriver = {
  ...driver,
  id: "monthly-driver-fixture",
  userId: "monthly-user-fixture",
  name: " José / Pérez ",
};
const reportFixtures = {
  "GET /drivers": (route) =>
    route.fulfill({ json: { items: [driver, monthlyDriver] } }),
  "GET /trips": (route) =>
    route.fulfill({
      json: {
        ...trips,
        items: [trip],
        total: 1,
        totals: { distanceKm: 60, count: 1, allowance: "0.00" },
      },
    }),
};

function exportQuery(route) {
  expect(route.request().headers()["x-tomasini-request"]).toBe("1");
  return Object.fromEntries(new URL(route.request().url()).searchParams);
}

const fulfillWorkbook = (route) =>
  route.fulfill({
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // This suite covers browser requests/downloads, not the backend XLSX encoder.
    body: "report-download-fixture",
  });

async function openMonthly(page) {
  await page.getByRole("button", { name: "Planilla para el contador" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Planilla para el contador",
  });
  await dialog
    .getByRole("combobox", { name: "Chofer", exact: true })
    .selectOption(monthlyDriver.id);
  await dialog.getByLabel("Mes de salida").fill("2026-10");
  return dialog;
}

test("el detalle operativo conserva los filtros y el nombre de la descarga", async ({
  page,
}) => {
  let request;
  await loadApp(page, "/reports", {
    ...reportFixtures,
    "GET /trips/export": (route) => {
      request = exportQuery(route);
      return fulfillWorkbook(route);
    },
  });
  await page.getByLabel("Desde", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-10-31");
  await page
    .getByRole("combobox", { name: "Chofer", exact: true })
    .selectOption(driver.id);
  await page
    .getByRole("combobox", { name: "Camión", exact: true })
    .selectOption(truck.id);
  const action = page.getByRole("button", { name: "Detalle operativo" });
  await expect(action).toBeEnabled();
  const downloaded = page.waitForEvent("download");
  await action.click();
  expect((await downloaded).suggestedFilename()).toBe(
    "Tomasini-detalle-2026-10-01-2026-10-31.xlsx",
  );
  expect(request).toEqual({
    from: "2026-10-01",
    to: "2026-10-31",
    page: "1",
    pageSize: "4",
    driverId: driver.id,
    truckId: truck.id,
    format: "detail",
  });
});

test("la planilla mensual usa su propio chofer y mes aunque los filtros operativos estén vacíos", async ({
  page,
}) => {
  let request;
  await loadApp(page, "/reports", {
    ...reportFixtures,
    "GET /trips/export": (route) => {
      request = exportQuery(route);
      return fulfillWorkbook(route);
    },
  });
  await page.getByLabel("Desde", { exact: true }).fill("");
  await page.getByLabel("Hasta", { exact: true }).fill("");
  await page
    .getByRole("combobox", { name: "Chofer", exact: true })
    .selectOption(driver.id);
  await page
    .getByRole("combobox", { name: "Camión", exact: true })
    .selectOption(truck.id);
  await expect(
    page.getByRole("button", { name: "Detalle operativo" }),
  ).toBeDisabled();
  const dialog = await openMonthly(page);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Descargar planilla" }).click();
  expect((await downloaded).suggestedFilename()).toBe(
    "Tomasini-José-Pérez-2026-10.xlsx",
  );
  expect(request).toEqual({
    driverId: monthlyDriver.id,
    month: "2026-10",
    format: "monthly",
  });
  await expect(dialog).not.toBeVisible();
});

test("un 404 mensual conserva selección y mes para reintentar sin descargar", async ({
  page,
}) => {
  const requests = [];
  const downloads = [];
  page.on("download", (download) => downloads.push(download));
  await loadApp(page, "/reports", {
    ...reportFixtures,
    "GET /trips/export": (route) => {
      requests.push(exportQuery(route));
      return requests.length === 1
        ? route.fulfill({ status: 404, json: { error: {} } })
        : fulfillWorkbook(route);
    },
  });
  const dialog = await openMonthly(page);
  const action = dialog.getByRole("button", { name: "Descargar planilla" });
  await action.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "No hay viajes de este chofer en el mes seleccionado.",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Chofer", exact: true }),
  ).toHaveValue(monthlyDriver.id);
  await expect(dialog.getByLabel("Mes de salida")).toHaveValue("2026-10");
  await expect(action).toBeEnabled();
  expect(downloads).toHaveLength(0);
  const downloaded = page.waitForEvent("download");
  await action.click();
  expect((await downloaded).suggestedFilename()).toBe(
    "Tomasini-José-Pérez-2026-10.xlsx",
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(dialog).not.toBeVisible();
});
