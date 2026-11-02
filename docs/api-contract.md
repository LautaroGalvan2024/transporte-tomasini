# Contrato de integración

Respuestas JSON directas. Errores `{error:{message,code?,fields?:Record<string,string>}}`. Header mutaciones `X-Tomasini-Request: 1`; cookie de sesión. Todas las fechas de instantes ISO UTC; fechas de vencimiento YYYY-MM-DD. Zona negocio America/Argentina/Buenos_Aires. DTO canónico de frontend en frontend/src/types.ts.

- POST /api/auth/login {username,password} => User; GET /auth/me => User; POST /auth/logout => 204; POST /auth/password {currentPassword,newPassword} => 204.
- GET /dashboard => Dashboard.
- GET /trucks => {items:Truck[]}; POST /trucks {plate,label,initialOdometer,initialOdometerAt} => Truck; PATCH /trucks/:id {plate?,label?,active?} => Truck. Lectura inicial administrada sin borrar historial.
- GET /drivers => {items:Driver[]} (chofer obtiene solo su perfil); POST /drivers {name,username,password,phone?,assignedTruckId?} => Driver; PATCH /drivers/:id {name?,username?,phone?,assignedTruckId?,active?} => Driver; POST /drivers/:id/password {password} => 204 (provisoria, revoca sesiones).
- GET /trips?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=&truckId=&reviewed=yes|no&page=&pageSize= => TripList. Total y sumas sobre TODO el filtro, no solo página; activos por defecto.
- POST /trips {clientRequestId(UUID),driverId?(solo admin),truckId,origin,destination,departureAt,arrivalAt,startKm,endKm,allowance?,notes?} => Trip.
- PATCH /trips/:id mismos campos + version => Trip; POST /trips/:id/review {version} => Trip; POST /trips/:id/cancel {version,reason} => Trip (admin).
- GET /trips/:id/history => {items:Audit[]}; GET /trips/export?mismos filtros => XLSX (admin).
- GET /obligations => {items:Obligation[]}; POST /obligations {title,kind,truckId?|driverId?,dueDate?,dueKm?,intervalMonths?,intervalKm?,warningDays?,warningKm?,notes?,initialRecord?:{performedAt,odometer?,notes?}} => Obligation.
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

Solo invitaciones DRIVER permiten `driverId`. Vincular un chofer activo existente conserva sus identidades User/Driver, camión y viajes; al aceptar se reemplazan su usuario/contraseña y se revocan sus sesiones. Crear otro enlace para ese chofer revoca los pendientes anteriores; aceptar, desactivar el chofer o restablecer su contraseña también invalida otros enlaces pendientes. La interfaz debe explicar el reemplazo de acceso. Un chofer inactivo debe reactivarse antes de invitarlo.

Los tokens son aleatorios de 256 bits, se persiste únicamente SHA-256 y se consumen una sola vez dentro de una transacción. Token desconocido devuelve 404; usado, vencido o revocado devuelve 410, ambos con código `INVITATION_UNAVAILABLE`. Usuario ocupado devuelve 409 `USERNAME_TAKEN` sin consumir la invitación.

Frontend usa enum ADMIN/DRIVER, SERVICE/DOCUMENT, OVERDUE/UPCOMING/OK/UNCONFIGURED, ACTIVE/CANCELLED. Dinero ARS nullable decimal, exportado numéricamente. Listados sin paginación de flota/devueltos completos por tamaño acotado. Las restricciones y permisos SIEMPRE backend.
