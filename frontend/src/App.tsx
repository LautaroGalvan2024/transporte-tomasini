import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CircleCheck,
  Clock3,
  Eye,
  EyeOff,
  Gauge,
  House,
  LogOut,
  Menu,
  Plus,
  Route,
  Settings2,
  ShieldCheck,
  Truck as TruckIcon,
  UserRound,
  Users,
  X,
  FileSpreadsheet,
  CalendarDays,
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
import { api, send } from "./api";
import type { Dashboard, PageProps, User } from "./types";
import {
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  formatKm,
  Loading,
  Modal,
  StatusBadge,
} from "./ui";
import { useData } from "./useData";
import { TripForm, TripsPage } from "./pages/Trips";
import {
  AdminDashboard,
  FleetPage,
  DriversPage,
  ObligationsPage,
  ReportsPage,
  SettingsPage,
} from "./pages/Admin";

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? "brand-inverse" : ""}`}>
      <span className="brand-top">TRANSPORTE</span>
      <span className="brand-name">
        Tomasini<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
const destinations = [
  { id: "home", label: "Inicio", Icon: House },
  { id: "trips", label: "Viajes", Icon: Route },
  { id: "fleet", label: "Camiones", Icon: TruckIcon },
  { id: "drivers", label: "Choferes", Icon: Users },
  { id: "obligations", label: "Vencimientos", Icon: CalendarDays },
  { id: "reports", label: "Reportes", Icon: FileSpreadsheet },
  { id: "settings", label: "Configuración", Icon: Settings2 },
];
const pathnamePage = () => location.pathname.split("/")[1] || "home";

export function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState(pathnamePage),
    [mobileMenu, setMobileMenu] = useState(false),
    [toast, setToast] = useState<{ message: string; kind: string } | null>(
      null,
    ),
    [editTrip, setEditTrip] = useState<string | null>(null),
    [authError, setAuthError] = useState(""),
    [dirtyForm, setDirtyForm] = useState(false),
    [pendingNavigation, setPendingNavigation] = useState<string | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [reauth, setReauth] = useState(false);
  const navigationRef = useRef({ page, dirtyForm });
  navigationRef.current = { page, dirtyForm };
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
    const pop = () => {
      const target = pathnamePage();
      if (navigationRef.current.dirtyForm) {
        history.pushState(
          {},
          "",
          navigationRef.current.page === "home"
            ? "/"
            : `/${navigationRef.current.page}`,
        );
        setPendingNavigation(target);
        return;
      }
      setPage(target);
      if (target !== "new-trip") setEditTrip(null);
      setMobileMenu(false);
    };
    const expired = () => setReauth(true);
    window.addEventListener("popstate", pop);
    window.addEventListener("tomasini:session-expired", expired);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("tomasini:session-expired", expired);
    };
  }, []);
  const performNavigate = useCallback((next: string) => {
    setDirtyForm(false);
    if (next !== "new-trip") setEditTrip(null);
    setPage(next);
    setMobileMenu(false);
    history.pushState({}, "", next === "home" ? "/" : `/${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const navigate = useCallback(
    (next: string) => {
      if (dirtyForm) {
        setPendingNavigation(next);
        return;
      }
      performNavigate(next);
    },
    [dirtyForm, performNavigate],
  );
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
    if (dirtyForm && !force) {
      setPendingNavigation("logout");
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
        <Loading label="Preparando tu espacio…" />
      </div>
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
  const allowed =
    user.role === "ADMIN"
      ? destinations
      : [
          { id: "home", label: "Inicio", Icon: House },
          { id: "trips", label: "Mis viajes", Icon: Route },
        ];
  const isForm = page === "new-trip";
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
            onDirtyChange={setDirtyForm}
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
      case "fleet":
        return user?.role === "ADMIN" ? (
          <FleetPage {...props} />
        ) : (
          <DriverHome {...props} />
        );
      case "drivers":
        return user?.role === "ADMIN" ? (
          <DriversPage {...props} />
        ) : (
          <DriverHome {...props} />
        );
      case "obligations":
        return user?.role === "ADMIN" ? (
          <ObligationsPage {...props} />
        ) : (
          <DriverHome {...props} />
        );
      case "reports":
        return user?.role === "ADMIN" ? (
          <ReportsPage {...props} />
        ) : (
          <DriverHome {...props} />
        );
      case "settings":
        return user?.role === "ADMIN" ? (
          <SettingsPage {...props} />
        ) : (
          <DriverHome {...props} />
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
        <div className="workspace-label">
          {user.role === "ADMIN" ? "GESTIÓN DEL TRANSPORTE" : "MI ESPACIO"}
        </div>
        <nav className="side-nav" aria-label="Navegación principal">
          {allowed.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              {label}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-message">
            <ShieldCheck size={20} />
            <div>
              <strong>Todo en un mismo lugar</strong>
              <span>Tus viajes y tu camión, al día.</span>
            </div>
          </div>
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
          <div className="desktop-breadcrumb">
            Tu transporte<span>/</span>
            <strong>
              {isForm
                ? "Cargar viaje"
                : destinations.find((d) => d.id === page)?.label || "Mi cuenta"}
            </strong>
          </div>
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
              <i />
              {online ? "En línea" : "Sin conexión"}
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
          className={`main-content ${isForm ? "main-form" : ""}`}
          key={`${page}-${editTrip || ""}`}
        >
          {content()}
        </main>
        <footer className="desktop-footer">
          <span>Transporte Tomasini</span>
          <span>Un viaje a la vez.</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {[
          { id: "home", label: "Inicio", Icon: House },
          {
            id: "trips",
            label: user.role === "ADMIN" ? "Viajes" : "Mis viajes",
            Icon: Route,
          },
          {
            id: user.role === "ADMIN" ? "menu" : "account",
            label: user.role === "ADMIN" ? "Más" : "Cuenta",
            Icon: user.role === "ADMIN" ? Menu : UserRound,
          },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={
              page === id || (id === "menu" && mobileMenu) ? "active" : ""
            }
            onClick={() =>
              id === "menu" ? setMobileMenu(!mobileMenu) : navigate(id)
            }
          >
            <Icon size={23} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
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
      {pendingNavigation && (
        <Modal
          title="Tu viaje todavía no está guardado"
          onClose={() => setPendingNavigation(null)}
        >
          <div className="modal-body">
            <p>
              Si salís de esta pantalla, se perderá lo que ingresaste. Podés
              volver a la carga y guardarlo.
            </p>
            <div className="row-actions">
              <button
                className="button secondary"
                onClick={() => setPendingNavigation(null)}
              >
                Seguir cargando
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const next = pendingNavigation;
                  setPendingNavigation(null);
                  if (next === "logout") void logout(true);
                  else performNavigate(next);
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

function Login({
  onLogin,
  initialError,
  onRetry,
}: {
  onLogin: (u: User) => void;
  initialError: string;
  onRetry: () => void;
}) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onLogin(
        await send<User>("/auth/login", "POST", {
          username: username.trim(),
          password,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand inverse />
        <div className="login-story-content">
          <div className="story-eyebrow">
            <span />
            EN CADA KILÓMETRO
          </div>
          <h1>
            El camino sigue.
            <br />
            <span>Todo está en orden.</span>
          </h1>
          <p>
            Un lugar para tus viajes, tu camión
            <br className="desktop-only" /> y lo que viene.
          </p>
          <div className="road-illustration" aria-hidden="true">
            <div className="road-line" />
            <div className="road-stop">
              <span />
              <small>Salida</small>
            </div>
            <div className="road-truck">
              <TruckIcon size={48} strokeWidth={1.4} />
            </div>
            <div className="road-stop end">
              <span />
              <small>Destino</small>
            </div>
          </div>
        </div>
        <div className="login-story-footer">
          <span>TRANSPORTE TOMASINI</span>
          <span>Siempre en movimiento.</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="welcome-icon">
            <Route size={27} />
          </span>
          <div className="login-heading">
            <h2>Qué bueno verte.</h2>
            <p>Ingresá para tener todo a mano.</p>
          </div>
          {initialError && (
            <ErrorState message={initialError} onRetry={onRetry} />
          )}
          <form onSubmit={submit}>
            <Field label="Usuario">
              <input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tu nombre de usuario"
                required
                disabled={busy}
              />
            </Field>
            <Field label="Contraseña">
              <span className="password-field">
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={
                    visible ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </span>
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={20} />
                  Ingresando…
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>
          <button className="login-help" onClick={() => setHelp(true)}>
            ¿Necesitás ayuda para ingresar?
          </button>
          <div className="login-security">
            <LockKeyhole size={15} />
            <span>Tu información, segura y a mano.</span>
          </div>
        </div>
        <span className="login-copyright">
          Transporte Tomasini · Gestión de viajes
        </span>
      </section>
      {help && (
        <Modal title="Te ayudamos a ingresar" onClose={() => setHelp(false)}>
          <div className="modal-body">
            <p>Usá el usuario y la contraseña que te entregó administración.</p>
            <p>
              Si no los recordás, pedile al administrador que restablezca tu
              acceso. Tus viajes van a seguir guardados.
            </p>
            <button className="button primary" onClick={() => setHelp(false)}>
              Entendido
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DriverHome(props: PageProps) {
  const { data, error, loading, refresh } = useData<Dashboard>("/dashboard");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;
  const truck = data.assignedTruck,
    first = props.user.name.split(" ")[0];
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <span className="eyebrow">TU DÍA, MÁS SIMPLE</span>
          <h1>
            Hola, {first}
            <span className="heading-dot">.</span>
          </h1>
          <p>Todo listo para seguir en camino.</p>
        </div>
        <span className="role-pill">
          <UserRound size={16} />
          Mi espacio
        </span>
      </div>
      <div className="driver-overview">
        <section className="journey-hero">
          <div className="hero-content">
            <span className="hero-eyebrow">
              <Route size={17} />
              CADA VIAJE CUENTA
            </span>
            <h2>
              Terminaste un viaje.
              <br />
              Dejalo registrado.
            </h2>
            <p>
              Unos pocos datos y ya está.
              <br />
              La distancia se calcula automáticamente.
            </p>
            <button
              className="button white"
              onClick={() => props.onNavigate("new-trip")}
            >
              <Plus size={21} />
              Cargar viaje
              <ArrowRight size={20} />
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-truck">
              <TruckIcon size={84} strokeWidth={1.1} />
            </div>
            <span className="hero-point point-a" />
            <span className="hero-point point-b" />
          </div>
        </section>
        <section className="assigned-truck panel">
          <div className="section-label">
            <span>MI CAMIÓN</span>
            <TruckIcon size={19} />
          </div>
          {truck ? (
            <>
              <div className="truck-plate">{truck.plate}</div>
              <p className="truck-name">{truck.label}</p>
              <div className="truck-mileage">
                <Gauge size={21} />
                <span>
                  <strong>{formatKm(truck.odometer)}</strong>
                  <small>km registrados</small>
                </span>
              </div>
              <p className="reading-date">
                Última lectura · {formatDate(truck.odometerAt)}
              </p>
            </>
          ) : (
            <div className="no-assignment">
              <TruckIcon size={34} />
              <h3>Todavía sin camión asignado</h3>
              <p>Administración puede asignarte tu unidad habitual.</p>
            </div>
          )}
        </section>
      </div>
      <div className="driver-stats">
        <div>
          <span className="stat-icon">
            <Route size={22} />
          </span>
          <span>
            <strong>{formatKm(data.stats.tripsThisMonth)}</strong>
            <small>
              {data.stats.tripsThisMonth === 1 ? "viaje" : "viajes"} este mes
            </small>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <Gauge size={22} />
          </span>
          <span>
            <strong>
              {formatKm(data.stats.kilometersThisMonth)} <em>km</em>
            </strong>
            <small>recorridos este mes</small>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <CircleCheck size={22} />
          </span>
          <span>
            <strong>Todo registrado</strong>
            <small>Tu historial, siempre disponible</small>
          </span>
        </div>
      </div>
      <div className="home-bottom-grid">
        <section className="panel recent-trips">
          <div className="section-heading">
            <div>
              <span className="eyebrow">TU RECORRIDO</span>
              <h2>Últimos viajes</h2>
            </div>
            <button
              className="text-button"
              onClick={() => props.onNavigate("trips")}
            >
              Ver todos
              <ArrowUpRight size={18} />
            </button>
          </div>
          {data.recentTrips.length ? (
            <div className="recent-trip-list">
              {data.recentTrips.slice(0, 4).map((t) => (
                <button
                  className="recent-trip"
                  key={t.id}
                  onClick={() => props.onNavigate("trips")}
                >
                  <span className="trip-route-icon">
                    <Route size={21} />
                  </span>
                  <span className="recent-trip-main">
                    <strong>
                      {t.origin}
                      <ArrowRight size={14} />
                      {t.destination}
                    </strong>
                    <small>
                      {formatDate(t.departureAt)}
                      <span>·</span>
                      {t.truck.plate}
                    </small>
                  </span>
                  <span className="recent-trip-km">
                    <strong>{formatKm(t.distanceKm)}</strong>
                    <small>km</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Tu historial empieza acá"
              description="Cuando cargues tu primer viaje, lo vas a encontrar en este espacio."
              icon={<Route size={28} />}
            />
          )}
        </section>
        <section className="panel driver-reminders">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PARA TENER A MANO</span>
              <h2>Próximos controles</h2>
            </div>
            <CalendarDays size={22} />
          </div>
          {data.obligations
            .filter((o) => o.status !== "OK")
            .slice(0, 3)
            .map((o) => (
              <div className="reminder-row" key={o.id}>
                <StatusBadge status={o.status} />
                <strong>{o.title}</strong>
                <small>
                  {o.dueDate
                    ? formatDate(o.dueDate)
                    : o.dueKm
                      ? `${formatKm(o.dueKm)} km`
                      : "Administración definirá el próximo control"}
                </small>
              </div>
            ))}
          {!data.obligations.some((o) => o.status !== "OK") && (
            <div className="all-clear">
              <span>
                <ShieldCheck size={28} />
              </span>
              <h3>Sin pendientes cercanos</h3>
              <p>Los próximos controles aparecerán acá.</p>
            </div>
          )}
          <p className="reminders-foot">
            <Clock3 size={15} />
            Administración gestiona los vencimientos.
          </p>
        </section>
      </div>
    </>
  );
}

function Account({
  user,
  onNotify,
  onChanged,
  onLogout,
  required = false,
}: PageProps & {
  onChanged: () => void;
  onLogout: () => void;
  required?: boolean;
}) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== repeat) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await send("/auth/password", "POST", {
        currentPassword: current,
        newPassword: password,
      });
      onNotify("Contraseña actualizada. Tus otras sesiones se cerraron.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TU ESPACIO</span>
          <h1>{required ? "Elegí tu contraseña" : "Mi cuenta"}</h1>
          <p>
            {required
              ? "Tu acceso es personal. Cambiá la contraseña provisoria para continuar."
              : "Tus datos y la seguridad de tu acceso."}
          </p>
        </div>
      </div>
      <div className="account-layout">
        <section className="panel account-profile">
          <span className="avatar avatar-large">{user.name[0]}</span>
          <h2>{user.name}</h2>
          <p>{user.username}</p>
          <span className="badge neutral">
            {user.role === "ADMIN" ? "Administración" : "Chofer"}
          </span>
          <button className="button ghost account-signout" onClick={onLogout}>
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </section>
        <form className="panel account-form" onSubmit={submit}>
          <div className="section-heading">
            <h2>{required ? "Primer ingreso" : "Cambiar contraseña"}</h2>
            <LockKeyhole size={23} />
          </div>
          <Field label="Contraseña actual">
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Nueva contraseña"
            hint="Usá al menos 12 caracteres. Podés combinar palabras y números."
          >
            <input
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Repetir nueva contraseña">
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar contraseña"}
            <ArrowRight size={19} />
          </button>
        </form>
      </div>
    </>
  );
}

function Reauthenticate({
  user,
  onSuccess,
  onExit,
}: {
  user: User;
  onSuccess: (u: User) => void;
  onExit: () => void;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSuccess(
        await send<User>("/auth/login", "POST", {
          username: user.username,
          password,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Volvé a ingresar para continuar"
      onClose={() => {}}
      dismissible={false}
    >
      <form className="modal-body" onSubmit={submit}>
        <p>Tu sesión venció. Lo que estabas cargando sigue en la pantalla.</p>
        <p>
          <strong>{user.name}</strong> · {user.username}
        </p>
        <Field label="Contraseña">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="row-actions">
          <button type="button" className="button secondary" onClick={onExit}>
            Cerrar sesión
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Ingresando…" : "Continuar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
