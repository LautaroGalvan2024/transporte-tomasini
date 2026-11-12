import writeXlsxFile, {
  type CellObject,
  type Row,
  type Sheet,
  type SheetData,
} from "write-excel-file/node";
import { BUSINESS_TIMEZONE } from "./config.js";
import { ensure } from "./errors.js";

export interface MileageTrip {
  driverId: string;
  truckId: string;
  driver: { user: { name: string } };
  truck: { plate: string };
  departureAt: Date;
  arrivalAt: Date;
  origin: string;
  destination: string;
  startKm: number;
  endKm: number;
  controlCount: number | null;
}

const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const localTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const monthLabel = new Intl.DateTimeFormat("es-AR", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "long",
});
const slotsPerPage = 24;
const maxFormPages = 250;
type FormLine = { trip: MileageTrip; slots: number };
const headers = [
  "FECHA",
  "HORA",
  "Sale de",
  "FECHA",
  "HORA",
  "Llega a",
  "Km\nRecorr.\n4.2.3",
  "Km\nal 100%\n4.2.3",
  "Viático\nx km\n4.2.4",
  "Control de\nDescarga\n4.2.6",
  "Simple\nPresencia\n4.2.5 B",
  "Permanencia\nfuera\nResidencia",
];
const columns = [11, 7, 18, 11, 7, 18, 10.5, 10.5, 10.5, 13, 11, 14].map(
  (width) => ({ width }),
);

// The reference was printed on US Letter. Keep the header, grid and signatures on one page.
const printOptions: NonNullable<Parameters<typeof writeXlsxFile>[1]> = {
  fontFamily: "Calibri",
  fontSize: 10,
  features: [
    {
      files: {
        transform: {
          "xl/worksheets/sheet{id}.xml": {
            transformElementAttributes(tag, attrs) {
              if (tag === "pageSetup")
                return {
                  ...attrs,
                  paperSize: 1,
                  fitToWidth: 1,
                  fitToHeight: 1,
                };
              return attrs;
            },
            transform(xml) {
              return xml.replace(
                "<sheetViews>",
                '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>',
              );
            },
          },
        },
      },
    },
  ],
};

function dateAndTime(instant: Date): CellObject[] {
  const date = new Date(localDate.format(instant) + "T00:00:00Z");
  const [hours, minutes] = localTime.format(instant).split(":").map(Number);
  return [
    { value: date, type: Date, format: "dd/mm/yy" },
    { value: (hours * 60 + minutes) / 1440, type: Number, format: "hh:mm" },
  ];
}

const compact = (value: string) => value.trim().replace(/\s+/gu, " ");

// Reserve room for wrapped routes, including long locality or customer names.
function routeLines(value: string) {
  let lines = 1;
  let used = 0;
  for (const word of compact(value).split(" ")) {
    if (used && used + 1 + word.length > 16) {
      lines++;
      used = 0;
    }
    used += (used ? 1 : 0) + word.length;
    while (used > 16) {
      lines++;
      used -= 16;
    }
  }
  return lines;
}

function grid(cells: CellObject[], height: number): Row {
  return cells.map((cell, i) => ({
    ...cell,
    height,
    align: cell.align ?? "center",
    alignVertical: "center",
    borderColor: "#000000",
    borderStyle: "thin",
    ...(i === 0 ? { leftBorderStyle: "medium" as const } : {}),
    ...(i === headers.length - 1
      ? { rightBorderStyle: "medium" as const }
      : {}),
  }));
}

function tripLine(trip: MileageTrip, slots: number) {
  return grid(
    [
      ...dateAndTime(trip.departureAt),
      { value: compact(trip.origin), type: String, wrap: true },
      ...dateAndTime(trip.arrivalAt),
      { value: compact(trip.destination), type: String, wrap: true },
      { value: trip.endKm - trip.startKm, type: Number },
      {},
      {},
      { value: trip.controlCount ?? undefined, type: Number },
      {},
      {},
    ],
    15 * slots,
  );
}

const emptyLine = grid(
  headers.map(() => ({})),
  15,
);
function mergedRow(...cells: CellObject[]): Row {
  return cells.flatMap((cell) => [
    cell,
    ...Array((cell.columnSpan ?? 1) - 1).fill(null),
  ]);
}
function formSheet(lines: FormLine[], sheetNumber: number): Sheet<Buffer> {
  const first = lines[0]?.trip;
  const month = first ? localDate.format(first.departureAt).slice(0, 7) : "";
  const driver = first ? compact(first.driver.user.name) : "";
  const plate = first?.truck.plate ?? "";
  const heading = (
    value: string,
    columnSpan: number,
    height = 23,
  ): CellObject => ({
    value,
    type: String,
    columnSpan,
    height,
    alignVertical: "center",
    wrap: true,
  });
  const signatureLine = {
    columnSpan: 3,
    bottomBorderStyle: "thin" as const,
    bottomBorderColor: "#000000",
  };
  const data: SheetData = [
    mergedRow(
      {
        ...heading("CONVENCIÓN COLECTIVA DE TRABAJO 40/89", 6),
        textDecoration: { underline: true },
      },
      heading("NRO DE ÍTEMS 4/2/3, 4/2/4, 4/2/5, 4/2/6, 4/2/17 y 6.1.2.", 6),
    ),
    mergedRow(
      heading("EMPLEADOR: TOMASINI NORBERTO DAVID", 6),
      heading("CUIT: 20-22054852-0", 2),
      heading(first ? monthLabel.format(first.departureAt) : "", 2),
      heading("N°", 1),
      { bottomBorderStyle: "thin", bottomBorderColor: "#000000" },
    ),
    mergedRow(
      heading(
        "NOMBRE DEL CONDUCTOR: " + driver,
        6,
        driver.length > 40 ? 45 : 26,
      ),
      heading("CUIL:", 1),
      { columnSpan: 2 },
      heading("N° DE PATENTE: " + plate, 3),
    ),
    grid(
      headers.map((value) => ({
        value,
        type: String,
        wrap: true,
        topBorderStyle: "medium",
      })),
      44,
    ),
  ];
  let usedSlots = 0;
  for (const { trip, slots } of lines) {
    data.push(tripLine(trip, slots));
    usedSlots += slots;
  }
  for (let i = usedSlots; i < slotsPerPage; i++) data.push(emptyLine);
  const last = data.length;
  const totals = headers.map((_, i): CellObject => {
    if (i < 6)
      return i === 5 ? { value: "TOTALES", type: String, align: "left" } : {};
    const letter = "GHIJKL"[i - 6];
    const range = `${letter}5:${letter}${last}`;
    // An incomplete count must not look like the total number of controls performed.
    const complete =
      letter === "J"
        ? `AND(COUNT(${range})>0,COUNT(${range})=COUNT(A5:A${last}))`
        : `COUNT(${range})`;
    return { type: "Formula", value: `IF(${complete},SUM(${range}),"")` };
  });
  data.push(
    grid(
      totals.map((cell) => ({ ...cell, bottomBorderStyle: "medium" })),
      16,
    ),
  );
  data.push([{ height: 20 }]);
  data.push(
    mergedRow(
      heading("FIRMA DEL EMPLEADOR", 3),
      signatureLine,
      heading("FIRMA DEL TRABAJADOR", 3),
      signatureLine,
    ),
  );
  // Number first for unique, valid Excel tab names even for namesakes and multiple folios.
  const safeDriver = driver.replace(/[\\/:*?\[\]'"\x00-\x1f]/g, " ").trim();
  const prefix = String(sheetNumber) + " " + month + " ";
  const sheet = first
    ? (prefix + safeDriver)
        .slice(0, 31)
        .replace(/[\uD800-\uDBFF]$/u, "")
        .trimEnd()
    : "Planilla de km";
  return {
    sheet,
    data,
    columns,
    showGridLines: false,
    orientation: "landscape",
  };
}

// The query supplies chronological departure order within each driver's month and truck.
export function mileageReport(trips: MileageTrip[]) {
  const groups = new Map<string, MileageTrip[]>();
  for (const trip of trips) {
    const key = [
      trip.driverId,
      trip.truckId,
      localDate.format(trip.departureAt).slice(0, 7),
    ].join("/");
    const group = groups.get(key);
    if (group) group.push(trip);
    else groups.set(key, [trip]);
  }
  const pages: FormLine[][] = [];
  function startPage() {
    ensure(
      pages.length < maxFormPages,
      400,
      "La descarga supera las 250 planillas. Acotá el período o elegí un chofer o un camión.",
    );
    const page: FormLine[] = [];
    pages.push(page);
    return page;
  }
  for (const group of groups.values()) {
    let page = startPage(),
      slots = 0;
    for (const trip of group) {
      const lines = Math.max(
        routeLines(trip.origin),
        routeLines(trip.destination),
      );
      if (page.length && slots + lines > slotsPerPage) {
        page = startPage();
        slots = 0;
      }
      page.push({ trip, slots: lines });
      slots += lines;
    }
  }
  if (!pages.length) startPage();
  return writeXlsxFile(
    pages.map((page, i) => formSheet(page, i + 1)),
    printOptions,
  ).toBuffer();
}
