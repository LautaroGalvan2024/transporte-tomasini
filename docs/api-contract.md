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

Frontend usa enum ADMIN/DRIVER, SERVICE/DOCUMENT, OVERDUE/UPCOMING/OK/UNCONFIGURED, ACTIVE/CANCELLED. Dinero ARS nullable decimal, exportado numéricamente. Listados sin paginación de flota/devueltos completos por tamaño acotado. Las restricciones y permisos SIEMPRE backend.
