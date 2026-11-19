import { expect, test } from "@playwright/test";
import {
  deferred,
  fillTrip,
  loadApp,
  settings,
  trip,
  trips,
  truck,
  user,
} from "./app.mjs";

test("un conflicto al editar conserva el borrador hasta confirmar la recarga", async ({
  page,
}) => {
  let current = trip;
  let patch;
  await loadApp(page, "/trips", {
    "GET /trips": (r) =>
      r.fulfill({ json: { ...trips, items: [trip], total: 1 } }),
    ["GET /trips/" + trip.id]: (r) => r.fulfill({ json: current }),
    ["PATCH /trips/" + trip.id]: (r) => {
      patch = r.request().postDataJSON();
      current = { ...trip, version: 2, origin: "Villa María" };
      return r.fulfill({
        status: 409,
        json: {
          error: { code: "VERSION_CONFLICT", message: "El viaje cambió." },
        },
      });
    },
  });
  await page
    .getByRole("button", { name: /Rosario.*Santa Fe/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Editar viaje" }).click();
  const origin = page.getByPlaceholder("Localidad de salida");
  await expect(origin).toHaveValue(trip.origin);
  await origin.fill("Alta Gracia");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const reload = page.getByRole("button", { name: "Cargar la versión actual" });
  await reload.click();
  await page.getByRole("button", { name: "Conservar mi carga" }).click();
  await expect(origin).toHaveValue("Alta Gracia");
  expect(patch).toMatchObject({
    version: 1,
    origin: "Alta Gracia",
    departureAt: trip.departureAt,
  });
  expect(patch).not.toHaveProperty("clientRequestId");
  await reload.click();
  await page.getByRole("button", { name: "Cargar versión guardada" }).click();
  await expect(origin).toHaveValue("Villa María");
});

test("reintentar un alta ambigua conserva el cuerpo y el identificador", async ({
  page,
}) => {
  const requests = [];
  await loadApp(page, "/new-trip", {
    "POST /trips": (route) => {
      requests.push(route.request().postData());
      return requests.length === 1
        ? route.abort()
        : route.fulfill({ json: trip });
    },
  });
  await fillTrip(page);
  await page.getByRole("button", { name: "Guardar viaje" }).click();
  await expect(
    page.getByText(/No pudimos confirmar el guardado/),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Localidad de salida")).toBeDisabled();
  await page.getByRole("button", { name: "Reintentar guardado" }).click();
  await expect(
    page.getByRole("heading", { name: /Viaje guardado/ }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
  expect(JSON.parse(requests[0])).toMatchObject({
    clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    controlCount: 0,
    trailerId: null,
    allowance: null,
    startKm: 100,
    endKm: 160,
  });
});

test("reauth y cancelación de salida conservan el borrador", async ({
  page,
}) => {
  await loadApp(page, "/new-trip", {
    "POST /trips": (r) =>
      r.fulfill({
        status: 401,
        json: { error: { message: "Sesión vencida", code: "UNAUTHENTICATED" } },
      }),
    "POST /auth/login": (r) => r.fulfill({ json: user }),
  });
  await fillTrip(page);
  await page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("button", { name: "Viajes", exact: true })
    .click();
  await page.getByRole("button", { name: "Seguir cargando" }).click();
  await page.getByRole("button", { name: "Guardar viaje" }).click();
  const dialog = page.getByRole("dialog", { name: /Volvé a ingresar/ });
  await dialog
    .getByLabel("Contraseña", { exact: true })
    .fill("prueba-ficticia");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByPlaceholder("Localidad de salida")).toHaveValue(
    trip.origin,
  );
  await expect(page).toHaveURL(/\/new-trip$/);
});

test("el reintento del catálogo conserva el regreso actual al listado", async ({
  page,
}) => {
  await loadApp(page, "/new-trip", {
    "GET /trucks": (r) =>
      r.fulfill({
        status: 503,
        json: { error: { message: "Carga de prueba" } },
      }),
  });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page).toHaveURL(/\/trips$/);
});

test("el alta de vencimiento conserva los plazos iniciales cuando llega la configuración", async ({
  page,
}) => {
  const gate = deferred();
  let body;
  await loadApp(page, "/obligations", {
    "GET /settings": async (r) => {
      await gate.promise;
      await r.fulfill({ json: settings });
    },
    "POST /obligations": (r) => {
      body = r.request().postDataJSON();
      return r.fulfill({ json: { id: "obligation-fixture" } });
    },
  });
  await page.getByRole("button", { name: "Agregar vencimiento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("Ej. Cambio de aceite y filtros")
    .fill("Servicio ficticio");
  await dialog.locator("select").nth(1).selectOption(truck.id);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/settings",
  );
  gate.resolve();
  await (await response).finished();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByLabel(/días de anticipación/)).toHaveValue("30");
  await expect(dialog.getByLabel(/km de anticipación/)).toHaveValue("1000");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByRole("button", { name: "Agregar vencimiento" }).click();
  await expect(dialog).toHaveCount(0);
  expect(body).toMatchObject({
    warningDays: 30,
    warningKm: 1000,
    truckId: truck.id,
  });
});

test("Escape conserva el cierre actual del alta de acoplado con un envío pendiente", async ({
  page,
}) => {
  const gate = deferred();
  await loadApp(page, "/fleet", {
    "POST /trailers": async (r) => {
      await gate.promise;
      await r.fulfill({ json: { id: "trailer-fixture" } });
    },
  });
  await page.getByRole("button", { name: "Acoplados", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Agregar acoplado",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Patente", { exact: true }).fill("QA001");
  await dialog.getByLabel("Acoplado / modelo", { exact: true }).fill("Prueba");
  const request = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/trailers",
  );
  await dialog.locator("button.primary").click();
  await request;
  try {
    await expect(
      dialog.getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    gate.resolve();
  }
});
