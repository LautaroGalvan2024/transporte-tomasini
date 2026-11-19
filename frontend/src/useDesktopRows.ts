import { useCallback, useEffect, useState } from "react";

const layouts = {
  trips: { minimum: 3, maximum: 12, compact: 8 },
  admin: { minimum: 2, maximum: 8, compact: 6 },
} as const;

export function useViewportRows(
  reserved: number,
  rowHeight: number,
  layout: keyof typeof layouts,
) {
  const measure = useCallback(() => {
    const { minimum, maximum, compact } = layouts[layout];
    if (window.innerWidth < 1100 || window.innerHeight < 700) return compact;
    const available = Math.floor((window.innerHeight - reserved) / rowHeight);
    return Math.max(minimum, Math.min(maximum, available));
  }, [layout, reserved, rowHeight]);
  const [rows, setRows] = useState(measure);
  useEffect(() => {
    const resize = () => setRows(measure());
    window.addEventListener("resize", resize);
    if (layout === "trips") resize();
    return () => window.removeEventListener("resize", resize);
  }, [layout, measure]);
  return rows;
}

export function useDesktopRows(reserved = 360, rowHeight = 64) {
  return useViewportRows(reserved, rowHeight, "trips");
}
