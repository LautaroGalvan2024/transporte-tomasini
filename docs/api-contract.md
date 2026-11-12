# Contrato de integración

Respuestas JSON directas. Errores `{error:{message,code?,fields?:Record<string,string>}}`. Header mutaciones `X-Tomasini-Request: 1`; cookie de sesión. Todas las fechas de instantes ISO UTC; fechas de vencimiento YYYY-MM-DD. Zona negocio America/Argentina/Buenos_Aires. DTO canónico de frontend en frontend/src/types.ts.

- POST /api/auth/login {username,password} => User; GET /auth/me => User; POST /auth/logout => 204; POST /auth/password {currentPassword,newPassword} => 204.
- GET /dashboard => Dashboard.
- GET /trucks => {items:Truck[]}; POST /trucks {plate,label,initialOdometer?,initialOdometerAt?} => Truck; PATCH /trucks/:id {plate?,label?,active?} => Truck. Lectura inicial opcional: ambos valores informados o ambos nulos/omitidos, incluido cero como lectura válida.
- GET /drivers => {items:Driver[]} (chofer obtiene solo su perfil); POST /drivers {name,username,password,phone?,assignedTruckId?} => Driver; PATCH /drivers/:id {name?,username?,phone?,assignedTruckId?,active?} => Driver; POST /drivers/:id/password {password} => 204 (provisoria, revoca sesiones).
- GET /trips?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=&truckId=&trailerId=&reviewed=yes|no&page=&pageSize= => TripList. Total y sumas sobre TODO el filtro, no solo página; activos por defecto.
- POST /trips {clientRequestId(UUID),driverId?(solo admin),truckId,trailerId?:UUID|null,origin,destination,departureAt,arrivalAt,startKm,endKm,controlCount?,allowance?,notes?} => Trip. `controlCount` admite enteros de 0 a 2.147.483.647. Si se omite al crear o se envía nulo, queda sin informar. El detalle, el listado y la auditoría distinguen cero de nulo.
- PATCH /trips/:id mismos campos + version => Trip; POST /trips/:id/review {version} => Trip; POST /trips/:id/cancel {version,reason} => Trip (admin).
- GET /trips/:id/history => {items:Audit[]}; GET /trips/export con los mismos filtros => XLSX (admin; incluye todas las páginas del filtro). Por defecto devuelve la planilla del convenio 40/89 por chofer, mes de salida en Argentina y camión. La distancia sale de los odómetros, y «Control de Descarga» de `controlCount`. El CUIL y los conceptos sin registrar (km al 100 %, viático por km, simple presencia y permanencia) se dejan en blanco para completar, sin inferirlos de fechas o importes. Con `format=detail` devuelve el detalle operativo, que incluye viáticos en ARS, acoplado, observaciones y controles.
- GET /obligations => {items:Obligation[]}; POST /obligations {title,kind,truckId?|trailerId?|driverId?,dueDate?,dueKm?,intervalMonths?,intervalKm?,warningDays?,warningKm?,notes?,initialRecord?:{performedAt,odometer?,notes?}} => Obligation. Exactamente un dueño; los kilómetros son exclusivos de camiones.
- PATCH /obligations/:id mismos campos + version, active? => Obligation; GET /obligations/:id/renewals => {items:Renewal[]}; POST /obligations/:id/renewals {performedAt,odometer?,nextDueDate?,nextDueKm?,notes?,version} => Obligation. Confirma próximo vencimiento explícito; historial de servicios con lecturas de km.
- GET /settings => Settings; PATCH /settings {recipientEmail,warningDays,warningKm} => Settings; GET /notifications => {items:Notification[]} (admin).
- GET /health => {status:'ok'} (HTTP); GET /ready => verifica DB y destino.

## Invitaciones de acceso

Todos los endpoints siguientes llevan prefijo `/api`. Crear, listar y revocar requieren administración autenticada con contraseña definitiva.

- GET /invitations?page=1&pageSize=20 => `{items:Invitation[],total,page,pageSize}`. Máximo 100 por página.
- POST /invitations `{role:'ADMIN'|'DRIVER',name?:string|null,driverId?:UUID|null,expiresInDays?:number}` => `{invitation:Invitation,token:string,joinUrl:string}`. Vigencia predeterminada 7 días; acepta enteros de 1 a 30. El token y enlace se muestran **solo al crear**; nunca se recuperan del listado.
- POST /invitations/:id/revoke `{}` => `Invitation`. Repetir una revocación es seguro. Una invitación aceptada no puede revocarse.
- POST /invitations/preview `{token}` => `{role,name:string|null,driverName:string|null,expiresAt,replacesExistingAccess:boolean}`. Público, con `X-Tomasini-Request: 1` y origen de la aplicación.
- POST /invitations/accept `{token,name,username,password}` => `{accepted:true,role}` (201). Público con la misma protección de origen. No acepta `role` ni `driverId`, no inicia sesión y no exige cambiar la contraseña elegida. Luego se ingresa por el login normal.

`Invitation` contiene `{id,role,name:string|null,driverId:string|null,driverName:string|null,status:'PENDING'|'EXPIRED'|'REVOKED'|'ACCEPTED',createdAt,expiresAt,acceptedAt:string|null,revokedAt:string|null,createdByName}`. No contiene token ni hash.

El enlace entregado es `${APP_ORIGIN}/join#TOKEN`; el frontend mantiene el token en memoria y lo envía exclusivamente en el cuerpo JSON de preview/accept. No se incluye en rutas, query strings, logs ni auditorías. Los intentos públicos se limitan por IP: preview 60 y aceptación 12 cada 15 minutos.

Solo invitaciones DRIVER permiten `driverId`, vinculado a una cuenta activa cuyo rol siga siendo DRIVER. Un perfil operativo de administrador no admite este reemplazo de acceso. Vincular un chofer activo existente conserva sus identidades User/Driver, camión y viajes; al aceptar se reemplazan su usuario/contraseña y se revocan sus sesiones. Crear otro enlace para ese chofer revoca los pendientes anteriores; aceptar, desactivar el chofer o restablecer su contraseña también invalida otros enlaces pendientes. La interfaz debe explicar el reemplazo de acceso. Un chofer inactivo debe reactivarse antes de invitarlo.

Los tokens son aleatorios de 256 bits, se persiste únicamente SHA-256 y se consumen una sola vez dentro de una transacción. Token desconocido devuelve 404; usado, vencido o revocado devuelve 410, ambos con código `INVITATION_UNAVAILABLE`. Usuario ocupado devuelve 409 `USERNAME_TAKEN` sin consumir la invitación.

Frontend usa enum ADMIN/DRIVER, SERVICE/DOCUMENT, OVERDUE/UPCOMING/OK/UNCONFIGURED, ACTIVE/CANCELLED. Dinero ARS nullable decimal, exportado numéricamente. Listados sin paginación de flota/devueltos completos por tamaño acotado. Las restricciones y permisos SIEMPRE backend.

## Usuarios, roles y bajas lógicas

Todos requieren administración autenticada con contraseña definitiva y protección de origen en las mutaciones.

- GET /api/users => `{items:UserAccess[]}`. Incluye administradores sin perfil de chofer y cuentas activas/inactivas.
- PATCH /api/users/:id `{role?:'ADMIN'|'DRIVER',active?:boolean}` => `UserAccess`. Debe incluir al menos un campo; no acepta contraseñas, identificadores de chofer ni otros atributos.
- PATCH /api/users/:id/truck `{assignedTruckId:UUID|null}` => `UserAccess`. Cuerpo estricto, solo administración, incluida la cuenta propia. Requiere usuario activo y, para asignar, camión activo. Crea un único perfil operativo si falta al asignar; quitar el camión conserva ese perfil y su historial. Repetir la misma asignación es idempotente. Un `null` sin perfil no crea registros. Cambiar solo el camión no revoca sesiones.
- DELETE /api/users/:id => `UserAccess` con `active:false`. Es una baja lógica idempotente: conserva usuario, perfil, viajes, documentación y auditorías.

`UserAccess` contiene `{id,username,name,role,active,mustChangePassword,driverId:string|null,assignedTruckId:string|null,createdAt,updatedAt}`. No devuelve contraseñas, hashes ni tokens. Las fechas son instantes ISO del servidor.

La propia baja o democión devuelve 409 `SELF_ACCESS_CHANGE`; quitar al último administrador activo devuelve 409 `LAST_ADMIN`. Las mutaciones revalidan actor/sesión dentro de una transacción y coordinan cambios de cuentas, credenciales e invitaciones. Un acceso revocado durante la operación devuelve 401/403, sin completar el cambio.

Todo cambio efectivo de rol o estado revoca sesiones y enlaces pendientes vinculados a ese chofer. Una baja o pérdida del rol ADMIN también revoca invitaciones pendientes emitidas por esa cuenta. La reactivación requiere volver a ingresar y no restaura sesiones ni enlaces previos. Cambiar a DRIVER crea el perfil si faltaba; ambos cambios de rol conservan el camión asignado, el perfil y el historial. La baja desasigna el camión; reactivar no recupera asignaciones anteriores.

`Driver` añade `role` y `accountActive`. Su campo `active` indica una cuenta activa con perfil operativo, incluido ADMIN. Los administradores con perfil pueden cargar viajes y documentación manteniendo sus permisos y estadísticas globales. Los endpoints antiguos de edición y contraseña de choferes siguen exigiendo rol DRIVER (409 `DRIVER_ROLE_REQUIRED`); no permiten cambiar credenciales administrativas. Corregir viajes existentes sin cambiar el chofer sigue permitido según los permisos habituales.

Los cambios quedan auditados como entidad USER (`ROLE_CHANGED`, `DEACTIVATED`, `REACTIVATED`, `TRUCK_ASSIGNED`, `TRUCK_UNASSIGNED`), con actor, fecha del servidor y valores anteriores/posteriores seguros, incluidos perfil y asignación. Una baja o asignación repetida no duplica la auditoría.

## Baja de camiones y correcciones de odómetro

- DELETE /api/trucks/:id => `Truck` con `active:false`. Baja lógica idempotente, exclusiva de administración: conserva viajes/servicios y desasigna choferes y acoplado en la misma transacción, auditando las operaciones. PATCH con `active:true` reactiva la unidad, sin recuperar asignaciones anteriores.
- PATCH /api/trucks/:id/odometer `{odometer:number,expectedOdometer:number|null,expectedOdometerAt:ISO|null}` => `Truck`. Las referencias esperadas deben ser ambas nulas o ambas informadas. Admite la primera carga o subir/bajar la lectura de un camión activo, entre 0 y 9.999.999 km enteros. Un formulario desactualizado devuelve 409 `ODOMETER_VERSION_CONFLICT`, incluso si apareció el primer viaje mientras estaba abierto. Usuario y fecha se obtienen del servidor, nunca del formulario.

Sin lecturas, `Truck.initialOdometer`, `initialOdometerAt`, `odometer` y `odometerAt` son nulos. La primera carga manual completa los campos iniciales y audita `ODOMETER_INITIALIZED`. Los viajes y servicios aportan lecturas sin modificar esos campos: si se anula el único viaje y no hay otra lectura, el odómetro vuelve a ser desconocido. No se exige lectura inicial para registrar viajes o servicios.

Cada corrección efectiva genera un evento permanente Audit de entidad TRUCK y acción `ODOMETER_ADJUSTED`, con actor, fecha y `before/after:{version:1,odometer,odometerAt}`. Esos eventos son parte del historial de lecturas: **no deben purgarse como logs**. No se cambia el odómetro inicial ni se reescriben viajes o servicios existentes. La lectura actual se calcula por fecha entre viajes activos, servicios y ajustes; cancelar un viaje posterior vuelve a la lectura válida anterior.

Un ajuste inicia un nuevo tramo de kilometraje, permitiendo corregir hacia abajo sin invalidar el historial previo. Cada tramo mantiene sus validaciones de coherencia. Los viajes atrasados se validan en su tramo y no reemplazan una lectura posterior. Un viaje que atraviese una corrección devuelve 409 `ODOMETER_ADJUSTMENT_BOUNDARY`: debe corregirse la fecha o dividir el recorrido. Los límites de servicio no se desplazan; su estado se recalcula con la nueva lectura. Esto representa una corrección de datos, no un reemplazo físico del medidor ni un ajuste retroactivo.

`Obligation.ownerActive` indica si el camión/acoplado está activo o el perfil operativo mantiene una cuenta activa, tanto DRIVER como ADMIN. Los vencimientos de dueños inactivos siguen disponibles como historial administrativo, pero quedan fuera del tablero operativo y del correo; no admiten renovaciones hasta reactivar al dueño. Su configuración se conserva para la reactivación. `odometerMissing` identifica límites por kilómetros sin lectura disponible: no se informa `OK`; se conserva la prioridad de `OVERDUE`/`UPCOMING` por fecha y, en otro caso, se devuelve `UNCONFIGURED`. `kmRemaining` permanece nulo. El correo sigue evaluando fechas y muestra el kilometraje sin informar.

## Acoplados

Todos los endpoints llevan prefijo `/api`. El listado requiere sesión; las mutaciones y el historial requieren administración, con protección CSRF y revalidación de acceso dentro de la transacción.

- GET /trailers => `{items:Trailer[]}`.
- POST /trailers `{plate,label,assignedTruckId?:UUID|null}` => `Trailer` (201).
- PATCH /trailers/:id `{version,plate?,label?,active?}` => `Trailer`. La asignación tiene endpoint propio.
- PATCH /trailers/:id/truck `{version,assignedTruckId:UUID|null}` => `Trailer`.
- DELETE /trailers/:id => `Trailer` inactivo y sin camión; baja lógica idempotente.
- GET /trailers/:id/history => `{items:Audit[]}`, con actor, fecha, acción y valores anteriores/posteriores seguros.

`Trailer` tiene `id`, `plate`, `label`, `active`, `assignedTruckId`, `version`, `createdAt`, `updatedAt` y la referencia del camión asignado. No incluye odómetro. Las patentes se normalizan y son únicas entre camiones y acoplados, también si están dados de baja. Cada camión admite un solo acoplado; un acoplado puede quedar sin asignar. Asignar requiere ambos activos y un camión libre; ocupado devuelve 409 `TRAILER_ASSIGNMENT_CONFLICT`, sin desplazar al otro acoplado. Una versión vieja devuelve conflicto. Los cambios son efectivos al guardar, con fecha del servidor, sin reasignaciones retroactivas. Repetir la misma asignación no genera otro evento ni incrementa la versión. Baja y reactivación conservan historial; reactivar no restaura el camión.

Los documentos y servicios de acoplados pertenecen al acoplado y solo admiten fecha, meses, notas y renovaciones sin odómetro: se rechazan `dueKm`, `intervalKm`, lecturas y `nextDueKm`. Un acoplado activo sin camión conserva sus alertas. El chofer ve las obligaciones y renovaciones del acoplado actualmente asignado a su camión; perder esa asignación retira ese acceso, sin afectar el acceso al propio viaje histórico.

`Trip` añade `trailerId:UUID|null` y `trailer:{id,plate,label}|null`. Se guarda el acoplado efectivamente utilizado, independiente de la asignación de flota. En POST, omitir equivale a nulo y nunca infiere la asignación actual. En PATCH, omitir conserva el valor y nulo lo borra. Se puede seleccionar cualquier acoplado activo, aunque esté asignado a otro camión; al corregir un viaje se puede conservar el que ya estaba registrado aunque ahora esté inactivo. El mismo acoplado no puede participar en viajes activos superpuestos; llegar exactamente cuando sale el siguiente es válido. Las correcciones conservan auditoría, versión y protección de viajes revisados.

Los viajes anteriores quedan sin acoplado registrado; no se completan retrospectivamente. El Excel de detalle operativo incluye una columna Acoplado, con la patente guardada por relación o “Sin acoplado registrado”. Los hashes idempotentes anteriores siguen válidos: el acoplado solo se incorpora al hash cuando tiene un UUID y los controles cuando tienen un valor, incluido cero. El reenvío con el mismo contenido sigue funcionando tras reasignar o dar de baja el acoplado. Cambiar el acoplado o la cantidad de controles usando el mismo `clientRequestId` devuelve `IDEMPOTENCY_CONFLICT`.
