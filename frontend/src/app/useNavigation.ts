import { useCallback, useEffect, useRef, useState } from "react";
import {
  holidayYearFromLocation,
  type HolidayNavigation,
} from "../holiday-types";
import type { Destination } from "./destinations";

const pathnamePage = () => location.pathname.split("/")[1] || "home";
type Editor = "trip" | "holidays";
type PendingAction = { kind: "navigate"; target: string } | { kind: "logout" };
export function useNavigation() {
  const [page, setPage] = useState(pathnamePage);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editTrip, setEditTrip] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [holidayNavigation, setHolidayNavigation] =
    useState<HolidayNavigation | null>(null);
  const navigationRef = useRef({ page, editor });
  navigationRef.current = { page, editor };
  const markTrip = useCallback(
    (dirty: boolean) => setEditor(dirty ? "trip" : null),
    [],
  );
  const markHolidays = useCallback(
    (dirty: boolean) => setEditor(dirty ? "holidays" : null),
    [],
  );
  useEffect(() => {
    const pop = () => {
      const target = pathnamePage();
      if (navigationRef.current.editor) {
        const targetWithQuery = target + location.search;
        history.pushState(
          {},
          "",
          navigationRef.current.page === "home"
            ? "/"
            : `/${navigationRef.current.page}`,
        );
        setPendingAction({ kind: "navigate", target: targetWithQuery });
        return;
      }
      setPage(target);
      setNavigationRevision((value) => value + 1);
      const holidayYear = holidayYearFromLocation();
      if (target === "settings" && holidayYear !== null)
        setHolidayNavigation({ year: holidayYear, request: Date.now() });
      if (target !== "new-trip") setEditTrip(null);
      setMobileMenu(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const performNavigate = useCallback((next: string) => {
    const nextPage = next.split("?")[0];
    setEditor(null);
    if (nextPage !== "new-trip") setEditTrip(null);
    setPage(nextPage);
    setNavigationRevision((value) => value + 1);
    setMobileMenu(false);
    history.pushState({}, "", next === "home" ? "/" : `/${next}`);
    const holidayYear = holidayYearFromLocation();
    setHolidayNavigation(
      nextPage === "settings" && holidayYear !== null
        ? { year: holidayYear, request: Date.now() }
        : null,
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const navigate = useCallback(
    (next: Destination) => {
      if (editor) {
        setPendingAction({ kind: "navigate", target: next });
        return;
      }
      performNavigate(next);
    },
    [editor, performNavigate],
  );

  return {
    page,
    mobileMenu,
    setMobileMenu,
    editTrip,
    setEditTrip,
    editor,
    markTrip,
    markHolidays,
    pendingAction,
    setPendingAction,
    navigationRevision,
    holidayNavigation,
    performNavigate,
    navigate,
  };
}
