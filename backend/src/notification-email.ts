import { businessDay } from "./domain.js";
import type { obligationDtos } from "./models.js";

type Obligation = Awaited<ReturnType<typeof obligationDtos>>[number];
type Alert = Pick<
  Obligation,
  "status" | "title" | "dueDate" | "dueKm" | "daysRemaining" | "kmRemaining"
> & {
  truck: Pick<
    NonNullable<Obligation["truck"]>,
    "plate" | "odometer" | "odometerAt"
  > | null;
  trailer: Pick<NonNullable<Obligation["trailer"]>, "plate"> | null;
  driver: Pick<NonNullable<Obligation["driver"]>, "name"> | null;
};

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const numberFormat = new Intl.NumberFormat("es-AR");
const formatDate = (day: string) =>
  dateFormat.format(new Date(day + "T00:00:00Z"));
const km = (n: number) => numberFormat.format(n) + " km";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function describeAlert(alert: Alert) {
  const { truck, trailer, driver, dueDate, dueKm, daysRemaining, kmRemaining } =
    alert;
  const owner = truck
    ? "Camión " + truck.plate
    : trailer
      ? "Acoplado " + trailer.plate
      : driver
        ? "Chofer · " + driver.name
        : "Sin asignar";
  const details: string[] = [];
  if (dueDate) {
    const days = Math.abs(daysRemaining ?? 0);
    const duration = days + (days === 1 ? " día" : " días");
    const timing =
      daysRemaining === null
        ? ""
        : daysRemaining === 0
          ? "vence hoy"
          : daysRemaining < 0
            ? "hace " + duration
            : "en " + duration;
    details.push(
      "Fecha límite: " +
        formatDate(dueDate) +
        (timing ? " (" + timing + ")" : ""),
    );
  }
  if (dueKm !== null) {
    const balance =
      kmRemaining === null
        ? ""
        : kmRemaining === 0
          ? "límite alcanzado"
          : kmRemaining < 0
            ? km(-kmRemaining) + " excedidos"
            : "restan " + km(kmRemaining);
    details.push(
      "Límite: " + km(dueKm) + (balance ? " (" + balance + ")" : ""),
    );
    if (truck)
      details.push(
        truck.odometer !== null && truck.odometerAt
          ? "Última lectura: " +
              km(truck.odometer) +
              " · " +
              formatDate(businessDay(new Date(truck.odometerAt)))
          : "Kilometraje sin informar. Falta una lectura para evaluar el límite.",
      );
  }
  return { title: alert.title, owner, details };
}

export function renderNotificationEmail(
  alerts: Alert[],
  today: string,
  origin: string,
) {
  const groups = [
    {
      title: "Vencidos",
      color: "#8c352e",
      entries: alerts.filter((a) => a.status === "OVERDUE").map(describeAlert),
    },
    {
      title: "Por vencer",
      color: "#79521b",
      entries: alerts.filter((a) => a.status === "UPCOMING").map(describeAlert),
    },
  ];
  const overdue = groups[0].entries.length;
  const summary = `${overdue} ${overdue === 1 ? "vencido" : "vencidos"} · ${groups[1].entries.length} por vencer`;
  const date = formatDate(today);
  const url = new URL("/obligations", origin).href;
  const activeGroups = groups.filter((g) => g.entries.length);
  const text = [
    "Transporte Tomasini · Resumen de vencimientos",
    date,
    summary,
    "",
    ...activeGroups.flatMap((g) => [
      g.title.toUpperCase(),
      ...g.entries.map((e) =>
        [e.title + " · " + e.owner, ...e.details].join("\n"),
      ),
      "",
    ]),
    "Ver vencimientos: " + url,
  ].join("\n");
  const sections = activeGroups
    .map(
      (g) => `
    <h2 style="margin:0;padding:18px 0 6px;color:${g.color};font-size:18px;line-height:24px">${g.title}</h2>
    ${g.entries
      .map(
        (
          e,
        ) => `<div style="padding:12px 0;border-bottom:1px solid #dce3eb;overflow-wrap:anywhere;word-break:break-word">
      <h3 style="margin:0;color:#112a42;font-size:16px;line-height:23px">${escapeHtml(e.title)}</h3>
      <p style="margin:1px 0 5px;font-size:14px;font-weight:bold;color:#40566c">${escapeHtml(e.owner)}</p>
      ${e.details.map((d) => `<p style="margin:2px 0;font-size:14px;line-height:21px">${escapeHtml(d)}</p>`).join("")}
    </div>`,
      )
      .join("")}`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resumen de vencimientos</title></head>
<body style="margin:0;background:#f1f4f7;color:#233448;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${summary} · ${date}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f7"><tr><td align="center" style="padding:16px 8px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;font-family:Arial,Helvetica,sans-serif;text-align:left">
<tr><td style="background:#193650;color:#fff;padding:22px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
    <div style="font-size:13px;line-height:18px;font-weight:bold;color:#d6e4ef">Transporte Tomasini</div>
    <h1 style="margin:6px 0;font-size:27px;line-height:32px;color:#fff">Vencimientos</h1>
    <p style="margin:0;font-size:14px;color:#e5edf3">${date}</p>
  </td><td width="66" align="right"><img src="${escapeHtml(new URL("/brand/tomasini-180.png", origin).href)}" width="58" height="58" alt="" style="display:block;background:#fff;border:0"></td></tr></table>
</td></tr>
<tr><td style="padding:12px 22px;background:#e8eff5;color:#193650;font-size:15px;font-weight:bold">${summary}</td></tr>
<tr><td style="padding:0 22px 24px">${sections}
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td bgcolor="#193650" style="border-radius:4px;mso-padding-alt:12px 18px">
  <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;color:#fff;text-decoration:none;font-size:15px;font-weight:bold">Ver vencimientos</a>
  </td></tr></table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { text, html };
}
