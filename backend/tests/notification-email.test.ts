import assert from "node:assert/strict";
import test from "node:test";
import { renderNotificationEmail } from "../src/notification-email.js";

test("el resumen HTML conserva los límites por fecha y km, escapa datos y enlaza la vista real", () => {
  const { html, text } = renderNotificationEmail(
    [
      {
        title: "Licencia",
        status: "UPCOMING",
        truck: null,
        trailer: null,
        driver: { name: "Ana & José" },
        dueDate: "2026-11-19",
        daysRemaining: 1,
        dueKm: null,
        kmRemaining: null,
      },
      {
        title: "<Service> & aceite",
        status: "OVERDUE",
        truck: {
          plate: "PRUEBA",
          odometer: 149900,
          odometerAt: "2026-11-17T01:00:00Z",
          maintenanceKm: 150120,
          maintenanceKmAt: "2026-11-18T01:00:00Z",
          mileageEstimated: true,
        },
        driver: null,
        trailer: null,
        dueDate: "2026-11-18",
        daysRemaining: 0,
        dueKm: 150000,
        kmRemaining: -120,
      },
    ],
    "2026-11-18",
    "https://transporte-tomasini.com",
  );
  for (const version of [html, text]) {
    assert.match(version, /1 vencido · 1 por vencer/);
    assert.match(version, /18 de noviembre de 2026 \(vence hoy\)/);
    assert.match(version, /19 de noviembre de 2026 \(en 1 día\)/);
    assert.match(version, /150\.000 km \(120 km excedidos\)/);
    assert.match(
      version,
      /Kilometraje estimado para mantenimiento: 150\.120 km · 17 de noviembre de 2026/,
    );
    assert.match(
      version,
      /Última lectura real: 149\.900 km · 16 de noviembre de 2026/,
    );
    assert.match(version, /https:\/\/transporte-tomasini\.com\/obligations/);
  }
  assert.ok(
    html.indexOf("&lt;Service&gt; &amp; aceite") < html.indexOf("Licencia"),
  );
  assert.match(html, /Chofer · Ana &amp; José/);
  assert.doesNotMatch(html, /<Service>/);
  assert.match(text, /<Service> & aceite · Camión PRUEBA/);
});
