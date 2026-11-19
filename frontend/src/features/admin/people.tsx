import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Link2,
  X,
  CircleAlert,
  FileCheck2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Truck as TruckIcon,
  Trash2,
  UserRoundCog,
  UserRound,
} from "lucide-react";
import { api, send, ApiError } from "../../api";
import type {
  Driver,
  Invitation,
  InvitationList,
  PageProps,
  Truck,
  UserAccess,
  Role,
} from "../../types";
import { EmptyState, Field, Modal, PasswordField, formatDate } from "../../ui";
import { dateLabel } from "./formatting";
import {
  useLoad,
  PageHeading,
  usePageSize,
  Pagination,
  usePagination,
  LoadState,
  FormError,
  useFormStatus,
  FormFooter,
} from "./shared";

function UserRoleForm({
  account,
  onClose,
  onSaved,
}: {
  account: UserAccess;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<Role>(account.role);
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy || role === account.role) return;
    form.begin();
    try {
      await send(`/users/${account.id}`, "PATCH", { role });
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title="Cambiar rol"
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-access-person">
          <UserRoundCog size={24} />
          <div>
            <strong>{account.name}</strong>
            <span>{account.username}</span>
          </div>
        </div>
        <Field label="Rol del usuario" error={form.fields.role}>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="DRIVER">Chofer</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </Field>
        <p className="admin-form-intro">
          {role === "ADMIN"
            ? "Podrá administrar usuarios, camiones, viajes y vencimientos, y cargar sus propios viajes."
            : "Podrá cargar y consultar sus viajes, con el camión que le asignes."}
        </p>
        {role !== account.role && (
          <div className="admin-callout">
            <CircleAlert size={18} />
            <span>
              Deberá volver a ingresar para usar el nuevo rol. Su camión
              habitual, viajes e historial se conservan.
              {!account.active && " El acceso seguirá desactivado."}
            </span>
          </div>
        )}
        <FormError message={form.message} />
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button primary"
            disabled={form.busy || role === account.role}
          >
            {form.busy ? "Guardando…" : "Guardar rol"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UserStatusForm({
  account,
  onClose,
  onSaved,
}: {
  account: UserAccess;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        `/users/${account.id}`,
        account.active ? "DELETE" : "PATCH",
        account.active ? undefined : { active: true },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={account.active ? "Desactivar usuario" : "Reactivar usuario"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-access-person">
          <UserRound size={24} />
          <div>
            <strong>{account.name}</strong>
            <span>
              {account.username} ·{" "}
              {account.role === "ADMIN" ? "Administrador" : "Chofer"}
            </span>
          </div>
        </div>
        <p className="admin-form-intro">
          {account.active
            ? "Se cerrará su sesión y no podrá volver a ingresar. Quedará sin camión habitual. Sus viajes e historial seguirán guardados. Podés reactivar el acceso cuando lo necesites."
            : "Podrá volver a ingresar con su usuario y contraseña, con el rol indicado. Podés asignarle un camión desde Usuarios cuando lo necesite."}
        </p>
        <FormError message={form.message} />
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className={`button ${account.active ? "danger" : "primary"}`}
            disabled={form.busy}
          >
            {form.busy
              ? "Guardando…"
              : account.active
                ? "Desactivar usuario"
                : "Reactivar usuario"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UserTruckForm({
  account,
  trucks,
  onClose,
  onSaved,
}: {
  account: UserAccess;
  trucks: Truck[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [assignedTruckId, setAssignedTruckId] = useState(
    account.assignedTruckId || "",
  );
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(`/users/${account.id}/truck`, "PATCH", {
        assignedTruckId: assignedTruckId || null,
      });
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={account.assignedTruckId ? "Cambiar camión" : "Asignar camión"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-access-person">
          <TruckIcon size={24} />
          <div>
            <strong>{account.name}</strong>
            <span>{account.username}</span>
          </div>
        </div>
        <Field label="Camión habitual" error={form.fields.assignedTruckId}>
          <select
            value={assignedTruckId}
            onChange={(event) => setAssignedTruckId(event.target.value)}
            disabled={form.busy}
          >
            <option value="">Sin camión</option>
            {trucks
              .filter((truck) => truck.active || truck.id === assignedTruckId)
              .map((truck) => (
                <option
                  key={truck.id}
                  value={truck.id}
                  disabled={!truck.active}
                >
                  {truck.plate} · {truck.label}
                  {!truck.active && " (inactivo)"}
                </option>
              ))}
          </select>
        </Field>
        <FormError message={form.message} />
        <FormFooter busy={form.busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

const cuilLabel = (value: string | null | undefined) =>
  value
    ? `${value.slice(0, 2)}-${value.slice(2, 10)}-${value.slice(10)}`
    : "Sin informar";

function UserCuilForm({
  account,
  onClose,
  onSaved,
}: {
  account: UserAccess;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(account);
  const [value, setValue] = useState(
    account.cuil ? cuilLabel(account.cuil) : "",
  );
  const [conflict, setConflict] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const form = useFormStatus();
  async function refreshReference() {
    if (form.busy) return;
    form.begin();
    try {
      const result = await api<{ items: UserAccess[] }>("/users");
      const latest = result.items.find((item) => item.id === account.id);
      if (!latest) throw new Error("No se encontró el usuario.");
      setReference(latest);
      setConflict(false);
      setRefreshed(true);
      form.clear();
    } catch (error) {
      form.fail(error);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy || conflict) return;
    const normalized = value.replace(/[\s-]/gu, "");
    if (normalized !== "" && !/^\d{11}$/.test(normalized)) {
      form.fail(
        new ApiError("Revisá el CUIL.", 400, {
          cuil: "Ingresá los 11 dígitos, con o sin guiones.",
        }),
      );
      return;
    }
    form.begin();
    try {
      await send(`/users/${account.id}/cuil`, "PATCH", {
        cuil: normalized || null,
        expectedUpdatedAt: reference.updatedAt,
      });
      onSaved();
    } catch (error) {
      setConflict(
        error instanceof ApiError && error.code === "CUIL_VERSION_CONFLICT",
      );
      form.fail(error);
    }
  }
  return (
    <Modal
      title="CUIL del conductor"
      dismissible={!form.busy}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-access-person">
          <FileCheck2 size={24} />
          <div>
            <strong>{account.name}</strong>
            <span>{account.username}</span>
          </div>
        </div>
        <p className="admin-form-intro">
          Se usará en el encabezado de la planilla para el contador. Podés
          dejarlo vacío si todavía no lo tenés.
        </p>
        <Field
          label="CUIL (opcional)"
          error={form.fields.cuil}
          hint="11 dígitos. Ejemplo de formato: 20-12345678-9."
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            value={value}
            disabled={form.busy}
            placeholder="00-00000000-0"
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        {!reference.driverId && (
          <p className="admin-field-note">
            Al guardar un CUIL, esta persona quedará disponible como conductor
            para sus viajes. Conserva su rol y su acceso actual.
          </p>
        )}
        {refreshed && (
          <div className="admin-cuil-reference" role="status">
            <strong>CUIL guardado ahora: {cuilLabel(reference.cuil)}</strong>
            <span>
              Conservamos lo que escribiste. Revisalo antes de guardar.
            </span>
          </div>
        )}
        <FormError message={form.message} />
        {conflict && (
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={() => void refreshReference()}
          >
            <RefreshCw size={17} />
            Actualizar referencia
          </button>
        )}
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={form.busy || conflict}
          >
            {form.busy ? "Guardando…" : "Guardar CUIL"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersPage({ user, onNotify }: PageProps) {
  const accounts = useLoad<{ items: UserAccess[] }>("/users");
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<UserAccess | null>(null);
  const [statusAccount, setStatusAccount] = useState<UserAccess | null>(null);
  const [truckAccount, setTruckAccount] = useState<UserAccess | null>(null);
  const [cuilAccount, setCuilAccount] = useState<UserAccess | null>(null);
  const [inviting, setInviting] = useState(false);
  const pageSize = usePageSize(360, 104);
  const items =
    accounts.data?.items.filter(
      (item) =>
        (role === "all" || item.role === role) &&
        (status === "all" || item.active === (status === "active")),
    ) || [];
  const paged = usePagination(items, pageSize, `${role}:${status}`);
  return (
    <div className="admin-page">
      <PageHeading
        title="Usuarios"
        action={
          <button className="button primary" onClick={() => setInviting(true)}>
            <Link2 size={18} />
            Invitar usuario
          </button>
        }
      />
      <div className="admin-toolbar admin-user-toolbar">
        <span className="admin-result-count">
          {items.length} {items.length === 1 ? "usuario" : "usuarios"}
        </span>
        <div className="admin-user-filters">
          <label>
            <span className="sr-only">Filtrar por rol</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="all">Todos los roles</option>
              <option value="ADMIN">Administradores</option>
              <option value="DRIVER">Choferes</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Desactivados</option>
            </select>
          </label>
        </div>
      </div>
      <LoadState
        loading={accounts.loading && !accounts.data}
        error={accounts.error || trucks.error}
        retry={() => {
          accounts.reload();
          trucks.reload();
        }}
      />
      {accounts.data && !accounts.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-user-row">
            <span>Usuario</span>
            <span>Rol y camión</span>
            <span>Acceso</span>
            <span>Acciones</span>
          </div>
          {paged.items.map((account) => (
            <article
              key={account.id}
              className="admin-record-row admin-user-row"
            >
              <div className="admin-row-identity">
                <span className="admin-avatar">
                  {account.name
                    .split(" ")
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </span>
                <div>
                  <h2>{account.name}</h2>
                  <p>
                    {account.username}
                    {account.id === user.id ? " · Vos" : ""}
                  </p>
                  {(account.driverId || account.active) && (
                    <button
                      type="button"
                      className="admin-cuil-link"
                      onClick={() => setCuilAccount(account)}
                      aria-label={`Editar CUIL de ${account.name}`}
                    >
                      <FileCheck2 size={14} aria-hidden="true" />
                      {account.cuil
                        ? `CUIL ${cuilLabel(account.cuil)}`
                        : "Completar CUIL"}
                    </button>
                  )}
                </div>
              </div>
              <div className="admin-row-secondary admin-row-value">
                <span className="admin-user-role">
                  {account.role === "ADMIN" ? (
                    <ShieldCheck size={17} />
                  ) : (
                    <UserRound size={17} />
                  )}
                  {account.role === "ADMIN" ? "Administrador" : "Chofer"}
                </span>
                <small>
                  {trucks.data?.items.find(
                    (truck) => truck.id === account.assignedTruckId,
                  )?.plate || "Sin camión"}
                </small>
              </div>
              <span
                className={`badge ${account.active ? "success" : "neutral"}`}
              >
                {account.active ? "Activo" : "Desactivado"}
              </span>
              <div className="admin-row-actions">
                {account.active && (
                  <button
                    className="button ghost"
                    onClick={() => setTruckAccount(account)}
                    disabled={trucks.loading || !!trucks.error}
                    aria-label={`${account.assignedTruckId ? "Cambiar" : "Asignar"} camión de ${account.name}`}
                  >
                    <TruckIcon size={17} />
                    {account.assignedTruckId
                      ? "Cambiar camión"
                      : "Asignar camión"}
                  </button>
                )}
                {account.id === user.id ? (
                  <span className="admin-self-account">Tu cuenta</span>
                ) : (
                  <>
                    <button
                      className="button ghost admin-icon-button"
                      onClick={() => setEditing(account)}
                      title="Cambiar rol"
                      aria-label={`Cambiar rol de ${account.name}`}
                    >
                      <UserRoundCog size={17} />
                    </button>
                    <button
                      className={`button ghost admin-icon-button ${account.active ? "admin-destructive-action" : ""}`}
                      onClick={() => setStatusAccount(account)}
                      title={
                        account.active
                          ? "Desactivar usuario"
                          : "Reactivar usuario"
                      }
                      aria-label={`${account.active ? "Desactivar" : "Reactivar"} a ${account.name}`}
                    >
                      {account.active ? (
                        <Trash2 size={17} />
                      ) : (
                        <RotateCcw size={17} />
                      )}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!items.length && (
            <EmptyState
              title="No hay usuarios con estos filtros"
              description="Probá con otro rol o estado."
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={items.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {cuilAccount && (
        <UserCuilForm
          account={cuilAccount}
          onClose={() => setCuilAccount(null)}
          onSaved={() => {
            setCuilAccount(null);
            accounts.reload();
            drivers.reload();
            onNotify("CUIL actualizado.");
          }}
        />
      )}
      {truckAccount && (
        <UserTruckForm
          account={truckAccount}
          trucks={trucks.data?.items || []}
          onClose={() => setTruckAccount(null)}
          onSaved={() => {
            setTruckAccount(null);
            accounts.reload();
            drivers.reload();
            onNotify("Camión habitual actualizado");
          }}
        />
      )}
      {editing && (
        <UserRoleForm
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            accounts.reload();
            drivers.reload();
            onNotify("Rol actualizado");
          }}
        />
      )}
      {statusAccount && (
        <UserStatusForm
          account={statusAccount}
          onClose={() => setStatusAccount(null)}
          onSaved={() => {
            if (statusAccount.active) setStatus("active");
            setStatusAccount(null);
            accounts.reload();
            drivers.reload();
            onNotify(
              statusAccount.active
                ? "Usuario desactivado. El historial se conserva."
                : "Usuario reactivado",
            );
          }}
        />
      )}
      {inviting && (
        <InvitationForm
          drivers={drivers.data?.items || []}
          onClose={() => setInviting(false)}
          onSaved={accounts.reload}
        />
      )}
    </div>
  );
}

function DriverForm({
  driver,
  trucks,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  trucks: Truck[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(driver?.name || "");
  const [username, setUsername] = useState(driver?.username || "");
  const [phone, setPhone] = useState(driver?.phone || "");
  const [assignedTruckId, setAssignedTruckId] = useState(
    driver?.assignedTruckId || "",
  );
  const [password, setPassword] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        driver ? `/drivers/${driver.id}` : "/drivers",
        driver ? "PATCH" : "POST",
        {
          name: name.trim(),
          username: username.trim(),
          phone: phone.trim() || null,
          assignedTruckId: assignedTruckId || null,
          ...(!driver ? { password } : {}),
        },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={driver ? "Editar chofer" : "Agregar chofer"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <FormError message={form.message} />
        <Field label="Nombre y apellido" error={form.fields.name}>
          <input
            required
            autoComplete="name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid2">
          <Field
            label="Usuario o DNI"
            hint="Un nombre sin espacios o el DNI sin puntos."
            error={form.fields.username}
          >
            <input
              required
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Teléfono (opcional)" error={form.fields.phone}>
            <input
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Camión habitual" error={form.fields.assignedTruckId}>
          <select
            value={assignedTruckId}
            onChange={(event) => setAssignedTruckId(event.target.value)}
          >
            <option value="">Sin asignar por ahora</option>
            {trucks
              .filter((truck) => truck.active || truck.id === assignedTruckId)
              .map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate} · {truck.label}
                  {truck.active ? "" : " (inactivo)"}
                </option>
              ))}
          </select>
        </Field>
        {!driver && (
          <PasswordField
            label="Contraseña provisoria"
            hint="Al ingresar por primera vez, el chofer deberá cambiarla. Mínimo 12 caracteres."
            error={form.fields.password}
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label={driver ? "Guardar cambios" : "Crear acceso"}
        />
      </form>
    </Modal>
  );
}

function PasswordForm({
  driver,
  onClose,
  onSaved,
}: {
  driver: Driver;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (password !== repeat) {
      form.fail(new Error("Las contraseñas deben ser iguales."));
      return;
    }
    form.begin();
    try {
      await send(`/drivers/${driver.id}/password`, "POST", { password });
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title="Restablecer acceso"
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <p className="admin-form-intro">
          Definí una contraseña provisoria para <strong>{driver.name}</strong>.
          Sus sesiones actuales se cerrarán y deberá cambiarla al ingresar.
        </p>
        <FormError message={form.message} />
        <PasswordField
          label="Nueva contraseña provisoria"
          error={form.fields.password}
          hint="Mínimo 12 caracteres."
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordField
          label="Repetir contraseña"
          required
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label="Restablecer acceso"
        />
      </form>
    </Modal>
  );
}

function InvitationForm({
  drivers,
  onClose,
  onSaved,
}: {
  drivers: Driver[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<"DRIVER" | "ADMIN">("DRIVER");
  const [driverId, setDriverId] = useState("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [created, setCreated] = useState<{
    invitation: Invitation;
    joinUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      const result = await send<{ invitation: Invitation; joinUrl: string }>(
        "/invitations",
        "POST",
        {
          role,
          name: name.trim() || null,
          driverId: role === "DRIVER" ? driverId || null : null,
          expiresInDays: Number(expiresInDays),
        },
      );
      setCreated(result);
      form.setBusy(false);
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.joinUrl);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Seleccioná el enlace y copialo manualmente.");
    }
  }
  return (
    <Modal
      title={created ? "Invitación creada" : "Invitar al equipo"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      {created ? (
        <div className="admin-form">
          <div className="admin-invite-success">
            <CheckCircle2 size={28} />
            <div>
              <strong>
                {created.invitation.name ||
                  created.invitation.driverName ||
                  (created.invitation.role === "ADMIN"
                    ? "Administrador"
                    : "Chofer")}
              </strong>
              <p>Vence el {formatDate(created.invitation.expiresAt, true)}.</p>
            </div>
          </div>
          <Field
            label="Enlace de invitación"
            hint="Copialo ahora. Por seguridad, no se podrá volver a consultar."
          >
            <input
              className="admin-invite-link"
              readOnly
              value={created.joinUrl}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <FormError message={copyError} />
          <p className="admin-field-note">
            Compartilo en privado con la persona invitada. Podrá elegir su
            usuario y contraseña.
          </p>
          <div className="admin-form-footer">
            <button className="button secondary" onClick={onClose}>
              Cerrar
            </button>
            <button className="button primary" onClick={copy}>
              {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
              {copied ? "Enlace copiado" : "Copiar enlace"}
            </button>
          </div>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
          <FormError message={form.message} />
          <div className="grid2">
            <Field label="Tipo de acceso" error={form.fields.role}>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as "DRIVER" | "ADMIN");
                  setDriverId("");
                }}
              >
                <option value="DRIVER">Chofer</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </Field>
            <Field label="El enlace vence en" error={form.fields.expiresInDays}>
              <select
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              >
                <option value="1">1 día</option>
                <option value="7">7 días</option>
                <option value="15">15 días</option>
                <option value="30">30 días</option>
              </select>
            </Field>
          </div>
          {role === "DRIVER" && (
            <Field label="Persona" error={form.fields.driverId}>
              <select
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
              >
                <option value="">Nuevo chofer</option>
                {drivers
                  .filter((driver) => driver.active && driver.role === "DRIVER")
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {!driverId && (
            <Field
              label="Nombre y apellido (opcional)"
              error={form.fields.name}
            >
              <input
                value={name}
                maxLength={100}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          {driverId && (
            <div className="admin-callout" role="note">
              <CircleAlert size={19} />
              <p>
                Este enlace reemplaza los anteriores para este chofer. Al
                aceptarlo, se cambiarán su usuario y contraseña y se cerrarán
                sus sesiones, sin perder sus viajes.
              </p>
            </div>
          )}
          {role === "ADMIN" && (
            <p className="admin-field-note">
              Tendrá acceso a viajes, flota, equipo, vencimientos y
              preferencias.
            </p>
          )}
          <FormFooter
            busy={form.busy}
            onClose={onClose}
            label="Crear invitación"
          />
        </form>
      )}
    </Modal>
  );
}

function InvitationsPanel({
  revision,
  onNotify,
}: {
  revision: number;
  onNotify: PageProps["onNotify"];
}) {
  const pageSize = usePageSize(430, 88);
  const [page, setPage] = useState(1);
  const state = useLoad<InvitationList>(
    `/invitations?page=${page}&pageSize=${pageSize}`,
  );
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const form = useFormStatus();
  useEffect(() => {
    setPage(1);
    state.reload();
  }, [revision]);
  useEffect(() => setPage(1), [pageSize]);
  useEffect(() => {
    if (state.data && page > 1 && !state.data.items.length)
      setPage(Math.max(1, Math.ceil(state.data.total / pageSize)));
  }, [state.data, page, pageSize]);
  async function revoke() {
    if (!revoking || form.busy) return;
    form.begin();
    try {
      await send(`/invitations/${revoking.id}/revoke`, "POST", {});
      setRevoking(null);
      form.setBusy(false);
      state.reload();
      onNotify("Invitación revocada");
    } catch (error) {
      form.fail(error);
    }
  }
  const labels = {
    PENDING: "Pendiente",
    ACCEPTED: "Aceptada",
    REVOKED: "Revocada",
    EXPIRED: "Vencida",
  };
  return (
    <>
      <LoadState
        loading={state.loading && !state.data}
        error={state.error}
        retry={state.reload}
      />
      {state.data && !state.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-invitation-row">
            <span>Invitación</span>
            <span>Acceso</span>
            <span>Vencimiento</span>
            <span>Estado</span>
            <span />
          </div>
          {state.data.items.map((item) => (
            <article
              key={item.id}
              className="admin-record-row admin-invitation-row"
            >
              <div className="admin-row-identity">
                <span className="admin-item-symbol">
                  <Link2 size={21} />
                </span>
                <div>
                  <h2>
                    {item.name ||
                      item.driverName ||
                      (item.role === "ADMIN"
                        ? "Nuevo administrador"
                        : "Nuevo chofer")}
                  </h2>
                  <p>Creada {dateLabel(item.createdAt)}</p>
                </div>
              </div>
              <span>{item.role === "ADMIN" ? "Administrador" : "Chofer"}</span>
              <div className="admin-row-value">
                <small className="admin-mobile-label">Vence</small>
                {dateLabel(item.expiresAt)}
              </div>
              <span
                className={`badge ${item.status === "ACCEPTED" ? "success" : item.status === "PENDING" ? "warning" : "neutral"}`}
              >
                {labels[item.status]}
              </span>
              {item.status === "PENDING" ? (
                <button
                  className="button ghost"
                  onClick={() => {
                    form.clear();
                    setRevoking(item);
                  }}
                >
                  <X size={17} />
                  Revocar
                </button>
              ) : (
                <span />
              )}
            </article>
          ))}
          {!state.data.items.length && (
            <EmptyState
              title="Todavía no hay invitaciones"
              description="Creá un enlace para sumar un chofer o administrador."
              icon={<Link2 size={26} />}
            />
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={state.data.total}
            onPage={setPage}
            busy={state.loading}
          />
        </section>
      )}
      {revoking && (
        <Modal
          title="Revocar invitación"
          onClose={() => {
            if (!form.busy) setRevoking(null);
          }}
        >
          <div className="admin-form">
            <p>
              El enlace de{" "}
              {revoking.name || revoking.driverName || "esta invitación"} dejará
              de funcionar. Podés crear una nueva invitación después.
            </p>
            <FormError message={form.message} />
            <div className="admin-form-footer">
              <button
                className="button secondary"
                disabled={form.busy}
                onClick={() => setRevoking(null)}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                disabled={form.busy}
                onClick={revoke}
              >
                {form.busy ? "Revocando…" : "Revocar enlace"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function DriversPage({ onNotify, onNavigate }: PageProps) {
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const [tab, setTab] = useState("drivers");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const [passwordDriver, setPasswordDriver] = useState<Driver | null>(null);
  const [inviting, setInviting] = useState(false);
  const [revision, setRevision] = useState(0);
  const pageSize = usePageSize(430, 86);
  const items =
    drivers.data?.items.filter(
      (driver) => status === "all" || driver.active === (status === "active"),
    ) || [];
  const paged = usePagination(items, pageSize, status);
  return (
    <div className="admin-page">
      <PageHeading
        title="Equipo"
        action={
          <div className="admin-heading-actions">
            {tab === "drivers" && (
              <button
                className="button secondary"
                onClick={() => setEditing("new")}
              >
                <Plus size={18} />
                Agregar chofer
              </button>
            )}
            <button
              className="button primary"
              onClick={() => setInviting(true)}
            >
              <Link2 size={18} />
              Invitar
            </button>
          </div>
        }
      />
      <div className="admin-toolbar admin-team-toolbar">
        <div className="admin-tabs" aria-label="Equipo y accesos">
          <button
            className={tab === "drivers" ? "active" : ""}
            aria-pressed={tab === "drivers"}
            onClick={() => setTab("drivers")}
          >
            Choferes <span>{drivers.data ? items.length : "—"}</span>
          </button>
          <button
            className={tab === "invitations" ? "active" : ""}
            aria-pressed={tab === "invitations"}
            onClick={() => setTab("invitations")}
          >
            Invitaciones
          </button>
        </div>
        {tab === "drivers" && (
          <div className="admin-user-filters">
            <label>
              <span className="sr-only">Filtrar choferes por estado</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">Activos</option>
                <option value="inactive">Desactivados</option>
                <option value="all">Todos los estados</option>
              </select>
            </label>
          </div>
        )}
      </div>
      <LoadState
        loading={drivers.loading && !drivers.data}
        error={drivers.error || trucks.error}
        retry={() => {
          drivers.reload();
          trucks.reload();
        }}
      />
      {tab === "drivers" && drivers.data && !drivers.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-driver-row">
            <span>Chofer</span>
            <span>Camión habitual</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {paged.items.map((driver) => (
            <article
              className="admin-record-row admin-driver-row"
              key={driver.id}
            >
              <div className="admin-row-identity">
                <span className="admin-avatar">
                  {driver.name
                    .split(" ")
                    .slice(0, 2)
                    .map((name) => name[0])
                    .join("")}
                </span>
                <div>
                  <h2>{driver.name}</h2>
                  <p>
                    {driver.username}
                    {driver.phone && (
                      <>
                        {" "}
                        · <a href={`tel:${driver.phone}`}>{driver.phone}</a>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <span className="admin-row-secondary">
                {trucks.data?.items.find(
                  (truck) => truck.id === driver.assignedTruckId,
                )?.plate || "Sin asignar"}
              </span>
              <span
                className={`badge ${driver.active ? "success" : "neutral"}`}
              >
                {!driver.active
                  ? "Inactivo"
                  : driver.role === "ADMIN"
                    ? "Administrador"
                    : "Activo"}
              </span>
              <div className="admin-row-actions">
                <button
                  className="button ghost"
                  onClick={() =>
                    driver.role === "ADMIN"
                      ? onNavigate("users")
                      : setEditing(driver)
                  }
                >
                  <Pencil size={17} />
                  {driver.role === "ADMIN" ? "Gestionar usuario" : "Editar"}
                </button>
                {driver.role === "DRIVER" && (
                  <button
                    className="button ghost"
                    onClick={() => setPasswordDriver(driver)}
                  >
                    Restablecer acceso
                  </button>
                )}
              </div>
            </article>
          ))}
          {!items.length && (
            <EmptyState
              title={
                drivers.data.items.length
                  ? "No hay choferes con este filtro"
                  : "Todavía no hay choferes"
              }
              description={
                drivers.data.items.length
                  ? "Probá con otro estado."
                  : "Agregá un chofer o enviale una invitación."
              }
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={items.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {tab === "invitations" && (
        <InvitationsPanel revision={revision} onNotify={onNotify} />
      )}
      {editing && (
        <DriverForm
          driver={editing === "new" ? null : editing}
          trucks={trucks.data?.items || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            drivers.reload();
            onNotify(
              editing === "new"
                ? "Acceso del chofer creado"
                : "Chofer actualizado",
            );
          }}
        />
      )}
      {passwordDriver && (
        <PasswordForm
          driver={passwordDriver}
          onClose={() => setPasswordDriver(null)}
          onSaved={() => {
            setPasswordDriver(null);
            onNotify(
              "Acceso restablecido. Compartí la contraseña provisoria con el chofer.",
            );
          }}
        />
      )}
      {inviting && (
        <InvitationForm
          drivers={drivers.data?.items || []}
          onClose={() => setInviting(false)}
          onSaved={() => {
            setRevision((value) => value + 1);
            setTab("invitations");
          }}
        />
      )}
    </div>
  );
}
