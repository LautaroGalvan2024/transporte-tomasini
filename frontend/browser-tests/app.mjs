import { expect } from "@playwright/test";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultBuild = fileURLToPath(new URL("../dist/", import.meta.url));
export const truck = {
  id: "truck-fixture",
  plate: "QA001",
  label: "Unidad de prueba",
  active: true,
  odometer: 100,
  odometerAt: "2026-10-30T12:00:00Z",
  maintenanceKm: 100,
  maintenanceKmAt: "2026-10-30T12:00:00Z",
  mileageEstimated: false,
};
export const user = {
  id: "user-fixture",
  username: "prueba",
  name: "Cuenta de Prueba",
  role: "ADMIN",
  active: true,
  mustChangePassword: false,
  driverId: "driver-fixture",
};
export const driver = {
  id: user.driverId,
  userId: user.id,
  name: user.name,
  username: user.username,
  role: user.role,
  active: true,
  accountActive: true,
  assignedTruckId: truck.id,
  truck,
};
export const settings = {
  warningDays: 15,
  warningKm: 500,
  sendHour: 8,
  timezone: "America/Argentina/Buenos_Aires",
  smtpConfigured: false,
  recipientEmail: null,
};
export const trips = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 6,
  totals: { distanceKm: 0, count: 0, allowance: "0.00" },
};
export const trip = {
  id: "trip-fixture",
  createdById: user.id,
  mileageMode: "ODOMETER",
  distanceSource: null,
  origin: "Rosario",
  destination: "Santa Fe",
  driverId: driver.id,
  driver,
  truck,
  truckId: truck.id,
  trailer: null,
  trailerId: null,
  status: "ACTIVE",
  startKm: 100,
  endKm: 160,
  distanceKm: 60,
  km100: 0,
  km100Context: null,
  controlCount: 0,
  allowance: null,
  notes: null,
  departureAt: "2026-10-14T12:00:00Z",
  arrivalAt: "2026-10-14T13:00:00Z",
  reviewedAt: null,
  version: 1,
  createdAt: "2026-10-14T13:10:00Z",
};

const fixtures = {
  "/auth/me": user,
  "/trucks": { items: [truck] },
  "/trailers": { items: [] },
  "/drivers": { items: [driver] },
  "/users": { items: [] },
  "/invitations": { items: [], total: 0, page: 1, pageSize: 6 },
  "/trips": trips,
  "/settings": settings,
  "/notifications": { items: [] },
  "/obligations": { items: [] },
  "/holiday-calendar/status": {
    currentYear: 2026,
    needsConfirmation: false,
    years: [],
  },
  "/trips/km100-preview": {
    mode: "NONE",
    suggestedKm: 0,
    intervals: [],
    missingYears: [],
    calendarToken: "calendar-fixture",
  },
  "/dashboard": {
    stats: {
      tripsThisMonth: 0,
      kilometersThisMonth: 0,
      pendingReviews: 0,
      overdue: 0,
      upcoming: 0,
      allowanceThisMonth: "0.00",
    },
    recentTrips: [],
    obligations: [],
    trucks: [truck],
    currentDriver: driver,
    assignedTruck: truck,
  },
};

// Serve the production bundle and intercept every API call, including writes.
export async function loadApp(
  page,
  url,
  handlers = {},
  build = process.env.TOMASINI_BROWSER_BUILD || defaultBuild,
) {
  await page.route("**/*", async (route) => {
    const { origin, pathname } = new URL(route.request().url());
    if (origin !== "https://tomasini.invalid") return route.abort();
    if (pathname.startsWith("/api/")) {
      const endpoint = pathname.slice(4);
      const method = route.request().method();
      const handler = handlers[method + " " + endpoint];
      if (handler) return handler(route);
      const fixture = fixtures[endpoint];
      if (fixture && (method === "GET" || endpoint === "/trips/km100-preview"))
        return route.fulfill({ json: fixture });
      throw new Error("Unexpected fixture request: " + method + " " + endpoint);
    }
    const asset =
      /^\/(assets|brand)\/[\w.-]+$/.test(pathname) ||
      ["/manifest.webmanifest", "/frontend-version.json"].includes(pathname);
    return route.fulfill({
      path: join(resolve(build), asset ? pathname.slice(1) : "index.html"),
    });
  });
  await page.goto(url);
}

export function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export async function fillTripRoute(page) {
  await page.getByLabel(/Acoplado de este viaje/).selectOption("");
  await page.getByPlaceholder("Localidad de salida").fill(trip.origin);
  await page.getByPlaceholder("Localidad de llegada").fill(trip.destination);
  await page.getByLabel(/Fecha y hora de salida/).fill("2026-10-14T09:00");
  await page.getByLabel(/Fecha y hora de llegada/).fill("2026-10-14T10:00");
}

export async function fillTrip(page) {
  await fillTripRoute(page);
  await page.getByLabel(/Odómetro al salir/).fill("100");
  const preview = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/trips/km100-preview",
  );
  await page.getByLabel(/Odómetro al llegar/).fill("160");
  await preview;
  await page.getByLabel("Controles", { exact: true }).fill("0");
  await expect(
    page.getByRole("button", { name: "Guardar viaje" }),
  ).toBeEnabled();
}
