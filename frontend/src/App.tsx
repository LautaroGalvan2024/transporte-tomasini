import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  ChevronRight,
  CircleCheck,
  Download,
  House,
  LogOut,
  Menu,
  Route,
  Settings2,
  ShieldCheck,
  Truck as TruckIcon,
  UserRound,
  Users,
  X,
  FileSpreadsheet,
  CalendarDays,
} from "lucide-react";
import { api, send } from "./api";
import type { PageProps, User } from "./types";
import { Loading, Modal } from "./ui";
import { TripForm, TripsPage } from "./pages/Trips";
import {
  AdminDashboard,
  FleetPage,
  DriversPage,
  UsersPage,
  ObligationsPage,
  ReportsPage,
  SettingsPage,
} from "./pages/Admin";
import { Brand } from "./Brand";
import { InstalledVersion } from "./FrontendVersion";
import { useInstallShortcut } from "./InstallShortcut";
import { JoinPage } from "./pages/Join";
import { HolidayCalendarBanner } from "./pages/Holidays";
import { Login, Account, Reauthenticate } from "./app/SessionForms";
import { DriverHome } from "./app/DriverHome";
import { useNavigation } from "./app/useNavigation";
import type { Destination } from "./app/destinations";

type MenuDestination = {
  id: Destination | "menu" | "install-shortcut";
  label: string;
  Icon: typeof House;
};
const shortcutItem: MenuDestination = {
  id: "install-shortcut",
  label: "Crear acceso directo",
  Icon: Download,
};
const destinations = [
  { id: "home", label: "Inicio", Icon: House },
  { id: "trips", label: "Viajes", Icon: Route },
  { id: "fleet", label: "Flota", Icon: TruckIcon },
  { id: "drivers", label: "Equipo", Icon: Users },
  { id: "users", label: "Usuarios", Icon: ShieldCheck },
  { id: "obligations", label: "Vencimientos", Icon: CalendarDays },
  { id: "reports", label: "Reportes", Icon: FileSpreadsheet },
  { id: "settings", label: "Configuración", Icon: Settings2 },
] satisfies MenuDestination[];

export function App() {
  const {
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
  } = useNavigation();
  const shortcut = useInstallShortcut();
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [toast, setToast] = useState<{ message: string; kind: string } | null>(
      null,
    ),
    [authError, setAuthError] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [reauth, setReauth] = useState(false),
    [joinRevision, setJoinRevision] = useState(0);
  const check = useCallback(() => {
    setChecking(true);
    setAuthError("");
    api<User>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (e.status !== 401) setAuthError(e.message);
        setUser(null);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    check();
  }, [check]);
  useEffect(() => {
    const expired = () => setReauth(true);
    const invitationChanged = () => setJoinRevision((value) => value + 1);
    window.addEventListener("tomasini:session-expired", expired);
    window.addEventListener("hashchange", invitationChanged);
    return () => {
      window.removeEventListener("tomasini:session-expired", expired);
      window.removeEventListener("hashchange", invitationChanged);
    };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const notify = useCallback(
    (message: string, kind: "success" | "error" = "success") =>
      setToast({ message, kind }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(id);
  }, [toast]);
  async function logout(force = false) {
    if (editor && !force) {
      setPendingAction({ kind: "logout" });
      return;
    }
    try {
      await send("/auth/logout", "POST");
      setUser(null);
      setEditTrip(null);
      performNavigate("home");
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setUser(null);
        setReauth(false);
        performNavigate("home");
      } else notify((e as Error).message, "error");
    }
  }
  if (checking)
    return (
      <div className="boot-screen">
        <Brand />
        <Loading label="Cargando…" />
      </div>
    );
  if (page === "join")
    return (
      <JoinPage
        key={joinRevision}
        currentUser={user}
        onSignout={async () => {
          try {
            await send("/auth/logout", "POST");
          } catch (error) {
            if ((error as { status?: number }).status !== 401) throw error;
          }
          setUser(null);
          setReauth(false);
        }}
        onLogin={() => performNavigate("home")}
      />
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          navigate("home");
        }}
        initialError={authError}
        onRetry={check}
      />
    );
  const props: PageProps = { user, onNavigate: navigate, onNotify: notify };
  const allowed: MenuDestination[] =
    user.role === "ADMIN"
      ? destinations
      : [
          { id: "home", label: "Inicio", Icon: House },
          { id: "trips", label: "Mis viajes", Icon: Route },
        ];
  const isForm = page === "new-trip";
  function menuButton({ id, label, Icon }: MenuDestination, mobile: boolean) {
    const isShortcut = id === "install-shortcut";
    const active = !isShortcut && (id === "menu" ? mobileMenu : page === id);
    return (
      <button
        key={id}
        type="button"
        className={`${mobile ? "" : "nav-item"}${active ? " active" : ""}`.trim()}
        disabled={isShortcut && shortcut.busy}
        onClick={() => {
          if (isShortcut) void shortcut.open();
          else if (id === "menu") setMobileMenu((open) => !open);
          else navigate(id);
        }}
      >
        <Icon size={mobile ? 23 : 20} aria-hidden="true" />
        <span>{label}</span>
        {!mobile && active && <span className="nav-dot" />}
      </button>
    );
  }
  function content() {
    if (user?.mustChangePassword)
      return (
        <Account
          {...props}
          onLogout={() => logout()}
          onChanged={() => check()}
          required
        />
      );
    switch (page) {
      case "home":
        return user?.role === "ADMIN" ? (
          <AdminDashboard {...props} />
        ) : (
          <DriverHome {...props} />
        );
      case "new-trip":
        return (
          <TripForm
            {...props}
            tripId={editTrip}
            onDirtyChange={markTrip}
            onDone={() => performNavigate("trips")}
            onCancel={() => performNavigate("trips")}
          />
        );
      case "trips":
        return (
          <TripsPage
            {...props}
            onNew={() => {
              setEditTrip(null);
              navigate("new-trip");
            }}
            onEdit={(id) => {
              setEditTrip(id);
              navigate("new-trip");
            }}
          />
        );
      case "account":
        return (
          <Account {...props} onLogout={() => logout()} onChanged={check} />
        );
    }
    if (props.user.role !== "ADMIN") return <DriverHome {...props} />;
    switch (page) {
      case "fleet":
        return <FleetPage {...props} />;
      case "drivers":
        return <DriversPage {...props} />;
      case "users":
        return <UsersPage {...props} />;
      case "obligations":
        return <ObligationsPage {...props} />;
      case "reports":
        return <ReportsPage {...props} />;
      case "settings":
        return (
          <SettingsPage
            {...props}
            holidayNavigation={holidayNavigation}
            onDirtyChange={markHolidays}
          />
        );
      default:
        return <DriverHome {...props} />;
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir al contenido
      </a>
      <aside className="sidebar">
        <button
          className="brand-button"
          onClick={() => navigate("home")}
          aria-label="Tomasini · Inicio"
        >
          <Brand />
        </button>
        <nav className="side-nav" aria-label="Navegación principal">
          {[allowed[0], shortcutItem, ...allowed.slice(1)].map((item) =>
            menuButton(item, false),
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="profile-button"
            onClick={() => navigate("account")}
          >
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.role === "ADMIN" ? "Administración" : "Chofer"}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button className="logout-button" onClick={() => logout()}>
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <button
            className="brand-button mobile-brand"
            onClick={() => navigate("home")}
          >
            <Brand />
          </button>
          <div className="topbar-right">
            <span className="today-label">
              {new Intl.DateTimeFormat("es-AR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "America/Argentina/Buenos_Aires",
              }).format(new Date())}
            </span>
            <span className={`online-status ${online ? "" : "offline"}`}>
              <InstalledVersion />
              {!online && <span role="status">Sin conexión</span>}
            </span>
            <button
              className="top-avatar"
              onClick={() => navigate("account")}
              aria-label="Mi cuenta"
            >
              {user.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main
          id="main"
          className={`main-content main-page-${page} ${isForm ? "main-form" : ""}`}
          key={`${page}-${editTrip || ""}-${navigationRevision}`}
        >
          {user.role === "ADMIN" && !user.mustChangePassword && (
            <HolidayCalendarBanner
              onReview={(year) =>
                navigate(`settings?tab=holidays&year=${year}`)
              }
            />
          )}
          {content()}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {(
          [
            { id: "home", label: "Inicio", Icon: House },
            {
              id: "trips",
              label: user.role === "ADMIN" ? "Viajes" : "Mis viajes",
              Icon: Route,
            },
            shortcutItem,
            {
              id: user.role === "ADMIN" ? "menu" : "account",
              label: user.role === "ADMIN" ? "Más" : "Cuenta",
              Icon: user.role === "ADMIN" ? Menu : UserRound,
            },
          ] satisfies MenuDestination[]
        ).map((item) => menuButton(item, true))}
      </nav>
      {shortcut.dialog}
      {mobileMenu && (
        <Modal title="Administración" onClose={() => setMobileMenu(false)}>
          <nav className="mobile-menu-list">
            {destinations
              .filter((d) => !["home", "trips"].includes(d.id))
              .map(({ id, label, Icon }) => (
                <button key={id} onClick={() => navigate(id)}>
                  <Icon size={21} />
                  {label}
                  <ChevronRight size={18} />
                </button>
              ))}
            <button onClick={() => navigate("account")}>
              <UserRound size={21} />
              Mi cuenta
              <ChevronRight size={18} />
            </button>
            <button onClick={() => logout()}>
              <LogOut size={21} />
              Cerrar sesión
            </button>
          </nav>
        </Modal>
      )}
      {reauth && (
        <Reauthenticate
          user={user}
          onSuccess={(u) => {
            setUser(u);
            setReauth(false);
            notify("Sesión recuperada. Podés continuar donde estabas.");
          }}
          onExit={() => {
            setReauth(false);
            void logout();
          }}
        />
      )}
      {pendingAction && (
        <Modal
          title={
            editor === "trip"
              ? "Tu viaje todavía no está guardado"
              : "Hay cambios sin guardar"
          }
          onClose={() => setPendingAction(null)}
        >
          <div className="modal-body">
            <p>
              {editor === "trip"
                ? "Si salís de esta pantalla, se perderá lo que ingresaste. Podés volver a la carga y guardarlo."
                : "Si salís de esta pantalla, se perderán los cambios que todavía no guardaste en el calendario."}
            </p>
            <div className="row-actions">
              <button
                className="button secondary"
                onClick={() => setPendingAction(null)}
              >
                {editor === "trip" ? "Seguir cargando" : "Seguir editando"}
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const next = pendingAction;
                  setPendingAction(null);
                  if (next.kind === "logout") void logout(true);
                  else performNavigate(next.target);
                }}
              >
                Salir sin guardar
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "success" ? (
            <CircleCheck size={22} />
          ) : (
            <Bell size={22} />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Cerrar aviso">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
