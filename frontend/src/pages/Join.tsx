import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import { Brand } from "../Brand";
import { ApiError, send } from "../api";
import { Field, Loading } from "../ui";
import type { User } from "../types";

type Preview = {
  role: "ADMIN" | "DRIVER";
  name: string | null;
  driverName: string | null;
  expiresAt: string;
  replacesExistingAccess: boolean;
};
type Acceptance = {
  token: string;
  name: string;
  username: string;
  password: string;
};
export function JoinPage({
  onLogin,
  currentUser,
  onSignout,
}: {
  onLogin: () => void;
  currentUser: User | null;
  onSignout: () => Promise<void>;
}) {
  const [token] = useState(() => location.hash.slice(1));
  const [preview, setPreview] = useState<Preview | null>(null),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState(""),
    [revision, setRevision] = useState(0);
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [step, setStep] = useState(0),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [uncertain, setUncertain] = useState(false);
  const pendingAttempt = useRef<Acceptance | null>(null),
    submitting = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingAttempt.current = null;
      submitting.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailure("");
    if (!token) {
      setFailure("Abrí el enlace completo que te envió administración.");
      setLoading(false);
      return;
    }
    send<Preview>("/invitations/preview", "POST", { token })
      .then((p) => {
        if (alive) {
          setPreview(p);
          setName(p.name || p.driverName || "");
        }
      })
      .catch((e) => {
        if (alive) setFailure(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, revision]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current || busy) return;
    setFields({});
    setError("");
    if (step === 0) {
      const f: Record<string, string> = {};
      if (name.trim().length < 2) f.name = "Ingresá tu nombre y apellido.";
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim()))
        f.username =
          "Usá entre 3 y 40 letras, números, puntos, guiones o guion bajo.";
      if (Object.keys(f).length) {
        setFields(f);
        return;
      }
      setStep(1);
      return;
    }
    if (password.length < 12) {
      setFields({ password: "Usá al menos 12 caracteres." });
      return;
    }
    if (password !== repeat) {
      setFields({ repeat: "Las contraseñas no coinciden." });
      return;
    }
    const payload = pendingAttempt.current ?? {
      token,
      name: name.trim(),
      username: username.trim(),
      password,
    };
    pendingAttempt.current = payload;
    submitting.current = true;
    setBusy(true);
    try {
      await send("/invitations/accept", "POST", payload);
      if (!mounted.current) return;
      pendingAttempt.current = null;
      setUncertain(false);
      setPassword("");
      setRepeat("");
      setDone(true);
      history.replaceState({}, "", "/join");
    } catch (e) {
      if (!mounted.current) return;
      const err = e as ApiError;
      const ambiguous =
        err.status === 0 ||
        err.status >= 500 ||
        err.code === "INVITATION_UNAVAILABLE" ||
        (uncertain && !["USERNAME_TAKEN", "VALIDATION"].includes(err.code));
      setError(err.message);
      setFields(err.fields || {});
      setUncertain(ambiguous);
      if (!ambiguous) {
        pendingAttempt.current = null;
        if (err.fields?.username || err.fields?.name) setStep(0);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="login-page join-page">
      <section className="login-identity">
        <Brand />
        <p>Tu carga, nuestro compromiso.</p>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          {loading ? (
            <Loading label="Comprobando invitación…" />
          ) : failure ? (
            <>
              <h1>Revisá el enlace</h1>
              <p className="form-error" role="alert">
                {failure}
              </p>
              <div className="row-actions">
                <button
                  className="button secondary"
                  onClick={() => setRevision((r) => r + 1)}
                >
                  Reintentar
                </button>
                <button className="button primary" onClick={onLogin}>
                  Ir al ingreso
                </button>
              </div>
            </>
          ) : done ? (
            <div className="join-success">
              <span className="success-mark">
                <Check size={30} />
              </span>
              <h1>Cuenta creada</h1>
              <p>
                Ya podés ingresar con <strong>{username}</strong> y la
                contraseña que elegiste.
              </p>
              <button className="button primary" onClick={onLogin}>
                Ingresar
                <ArrowRight size={19} />
              </button>
            </div>
          ) : currentUser ? (
            <>
              <h1>Crear otra cuenta</h1>
              <p>
                Hay una sesión abierta de <strong>{currentUser.name}</strong>.
                Cerrala para aceptar esta invitación.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSignout();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cerrar sesión y continuar
              </button>
            </>
          ) : preview ? (
            <>
              <div className="join-heading">
                <h1>Crear mi cuenta</h1>
                <span className="badge neutral">
                  <UserRound size={14} />
                  {preview.role === "ADMIN" ? "Administración" : "Chofer"}
                </span>
              </div>
              <div className="form-tabs" aria-label="Pasos de alta">
                <button
                  type="button"
                  className={step === 0 ? "active" : ""}
                  disabled={busy || uncertain}
                  onClick={() => setStep(0)}
                >
                  1. Tus datos
                </button>
                <button
                  type="button"
                  className={step === 1 ? "active" : ""}
                  disabled={step === 0 || busy || uncertain}
                  onClick={() => setStep(1)}
                >
                  2. Contraseña
                </button>
              </div>
              <form onSubmit={submit} noValidate>
                {step === 0 ? (
                  <>
                    <Field label="Nombre y apellido" error={fields.name}>
                      <input
                        value={name}
                        maxLength={120}
                        autoComplete="name"
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy || uncertain}
                      />
                    </Field>
                    <Field
                      label="Usuario o DNI"
                      error={fields.username}
                      hint="Elegí un nombre sin espacios o tu DNI sin puntos."
                    >
                      <input
                        value={username}
                        maxLength={40}
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={busy || uncertain}
                      />
                    </Field>
                    {preview.replacesExistingAccess && (
                      <p className="field-note">
                        Esta invitación actualiza tu acceso y conserva tus
                        viajes.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <Field
                      label="Contraseña"
                      error={fields.password}
                      hint="Al menos 12 caracteres. Podés usar varias palabras."
                    >
                      <span className="password-field">
                        <input
                          type={visible ? "text" : "password"}
                          value={password}
                          maxLength={128}
                          autoComplete="new-password"
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={busy || uncertain}
                        />
                        <button
                          type="button"
                          aria-label={
                            visible
                              ? "Ocultar contraseña"
                              : "Mostrar contraseña"
                          }
                          onClick={() => setVisible((v) => !v)}
                        >
                          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                        </button>
                      </span>
                    </Field>
                    <Field label="Repetir contraseña" error={fields.repeat}>
                      <input
                        type={visible ? "text" : "password"}
                        value={repeat}
                        maxLength={128}
                        autoComplete="new-password"
                        onChange={(e) => setRepeat(e.target.value)}
                        disabled={busy || uncertain}
                      />
                    </Field>
                  </>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {uncertain && (
                  <>
                    <p className="field-note">
                      Conservamos los datos del intento para reintentarlo sin
                      cambiar tu usuario ni tu contraseña.
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={onLogin}
                    >
                      Comprobar mi acceso al ingresar
                    </button>
                  </>
                )}
                <div className="join-actions">
                  {step === 1 && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setStep(0)}
                      disabled={busy || uncertain}
                    >
                      <ArrowLeft size={18} />
                      Atrás
                    </button>
                  )}
                  <button className="button primary" disabled={busy}>
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={18} />
                        Creando cuenta…
                      </>
                    ) : step === 0 ? (
                      <>
                        Continuar
                        <ArrowRight size={18} />
                      </>
                    ) : uncertain ? (
                      <>
                        Reintentar creación
                        <ArrowRight size={18} />
                      </>
                    ) : (
                      <>
                        Crear cuenta
                        <Check size={18} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
