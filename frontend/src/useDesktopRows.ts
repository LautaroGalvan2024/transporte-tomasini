import { useEffect, useState } from "react";

/** Keep desktop lists paginated to the available viewport; mobile keeps its normal flow. */
export function useDesktopRows(reserved = 360, rowHeight = 64) {
  const measure = () =>
    window.innerWidth >= 1100 && window.innerHeight >= 700
      ? Math.max(
          3,
          Math.min(12, Math.floor((window.innerHeight - reserved) / rowHeight)),
        )
      : 8;
  const [rows, setRows] = useState(measure);
  useEffect(() => {
    const resize = () => setRows(measure());
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, [reserved, rowHeight]);
  return rows;
}
