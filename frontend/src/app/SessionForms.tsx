import { useState, type FormEvent } from "react";
import { ArrowRight, LogOut, LockKeyhole, LoaderCircle } from "lucide-react";
import { send } from "../api";
import type { PageProps, User } from "../types";
import { ErrorState, Field, Modal, PasswordField } from "../ui";
import { Brand } from "../Brand";
import { InstalledVersion } from "../FrontendVersion";

export function Login({
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
      <section className="login-identity">
        <Brand />
        <p>Tu carga, nuestro compromiso.</p>
      </section>
      <section className="login-panel">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <div className="login-heading">
            <h1>Ingresar</h1>
          </div>
          {initialError && (
            <ErrorState message={initialError} onRetry={onRetry} />
          )}
          <form onSubmit={submit}>
            <Field label="Usuario o DNI">
              <input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. juan.perez o 30123456"
                required
                disabled={busy}
              />
            </Field>
            <PasswordField
              label="Contraseña"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña"
              required
              disabled={busy}
            />
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
          <InstalledVersion />
        </div>
      </section>
      {help && (
        <Modal title="Te ayudamos a ingresar" onClose={() => setHelp(false)}>
          <div className="modal-body">
            <p>
              Para crear tu cuenta, pedí un enlace de invitación a
              administración.
            </p>
            <p>
              Si ya tenés cuenta y no recordás la contraseña, administración
              puede recuperar tu acceso.
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

export function Account({
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
    <div className="workspace-page account-workspace">
      <div className="workspace-heading">
        <div>
          <h1>{required ? "Elegí tu contraseña" : "Mi cuenta"}</h1>
          {required && <p>Cambiá la contraseña provisoria para continuar.</p>}
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
          <InstalledVersion />
        </section>
        <form className="panel account-form" onSubmit={submit}>
          <div className="section-heading">
            <h2>{required ? "Primer ingreso" : "Cambiar contraseña"}</h2>
            <LockKeyhole size={23} />
          </div>
          <PasswordField
            label="Contraseña actual"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <PasswordField
            label="Nueva contraseña"
            hint="Usá al menos 12 caracteres. Podés combinar palabras y números."
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordField
            label="Repetir nueva contraseña"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
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
    </div>
  );
}

export function Reauthenticate({
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
        <PasswordField
          label="Contraseña"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={busy}
        />
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
