# Contrato de integración

Respuestas JSON directas. Errores `{error:{message,code?,fields?:Record<string,string>}}`. Header mutaciones `X-Tomasini-Request: 1`; cookie de sesión. Todas las fechas de instantes ISO UTC; fechas de vencimiento y feriados YYYY-MM-DD. Zona negocio America/Argentina/Buenos_Aires. DTO canónico de frontend en frontend/src/types.ts y, para administración de feriados, frontend/src/holiday-types.ts.

- POST /api/auth/login {username,password} => User; GET /auth/me => User; POST /auth/logout => 204; POST /auth/password {currentPassword,newPassword} => 204.
- GET /dashboard => Dashboard.
- `GET /api/trips/export?format=monthly&driverId=<uuid>&month=AAAA-MM` descarga la planilla mensual para el contador (administración). Incluye una fila por viaje vigente, pendiente o revisado, según el mes de salida en Argentina. Devuelve un XLSX con una sola pestaña y orden cronológico. Una selección inválida devuelve 400 y un mes sin viajes devuelve 404. La descarga mensual es independiente de los filtros y la paginación del listado.
- GET /trucks => {items:Truck[]}; POST /trucks {plate,label,initialOdometer?,initialOdometerAt?} => Truck; PATCH /trucks/:id {plate?,label?,active?} => Truck. Lectura inicial opcional: ambos valores informados o ambos nulos/omitidos, incluido cero como lectura válida.
- GET /drivers => {items:Driver[]} (chofer obtiene solo su perfil); POST /drivers {name,username,password,phone?,assignedTruckId?} => Driver; PATCH /drivers/:id {name?,username?,phone?,assignedTruckId?,active?} => Driver; POST /drivers/:id/password {password} => 204 (provisoria, revoca sesiones).
- GET /trips?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=&truckId=&trailerId=&reviewed=yes|no&page=&pageSize= => TripList. Total y sumas sobre TODO el filtro, no solo página; activos por defecto.
- POST /trips {clientRequestId(UUID),driverId?(solo admin),truckId,trailerId?:UUID|null,origin,destination,departureAt,arrivalAt,[campos de kilometraje],controlCount?,km100?,km100CalendarToken?,allowance?,notes?} => Trip. `controlCount` admite enteros de 0 a 2.147.483.647. Si se omite al crear o se envía nulo, queda sin informar. El detalle, el listado y la auditoría distinguen cero de nulo. Las reglas de `km100` y su comprobación previa se describen debajo.
- PATCH /trips/:id mismos campos + version => Trip; POST /trips/:id/review {version} => Trip; POST /trips/:id/cancel {version,reason} => Trip (admin).
- GET /trips/:id/history => {items:Audit[]}; GET /trips/export con los mismos filtros => XLSX (admin; incluye todas las páginas del filtro). Por defecto devuelve la planilla del convenio 40/89 por chofer, mes de salida en Argentina y camión. La distancia sale de la diferencia de odómetros o del total declarado por administración, «Km al 100%» de `km100` cuando no es provisional, «Control de Descarga» de `controlCount` y el CUIL del perfil del conductor. Si no se informó CUIL se deja en blanco, al igual que los conceptos sin registrar (viático por km, simple presencia y permanencia), sin inferirlos de fechas o importes. Con `format=detail` devuelve el detalle operativo, que incluye viáticos en ARS, acoplado, observaciones, controles y km al 100% con su estado.
- GET /obligations => {items:Obligation[]}; POST /obligations {title,kind,truckId?|trailerId?|driverId?,dueDate?,dueKm?,intervalMonths?,intervalKm?,warningDays?,warningKm?,notes?,initialRecord?:{performedAt,odometer?,notes?}} => Obligation. Exactamente un dueño; los kilómetros son exclusivos de camiones.
- PATCH /obligations/:id mismos campos + version, active? => Obligation; GET /obligations/:id/renewals => {items:Renewal[]}; POST /obligations/:id/renewals {performedAt,odometer?,nextDueDate?,nextDueKm?,notes?,version} => Obligation. Confirma próximo vencimiento explícito; historial de servicios con lecturas de km.
- GET /settings => Settings; PATCH /settings {recipientEmail,warningDays,warningKm} => Settings; GET /notifications => {items:Notification[]} (admin).
- GET /health => {status:'ok'} (HTTP); GET /ready => verifica DB y destino.

## Kilometraje del viaje

El método se elige al crear el viaje y queda fijo. Los viajes existentes usan `ODOMETER`.

- `ODOMETER` (predeterminado). El alta y la comprobación previa reciben `startKm` y `endKm`. La diferencia determina la distancia.
- `DISTANCE` (administración). El alta y la comprobación previa reciben `mileageMode: "DISTANCE"` y `distanceKm`, entero de 0 a 9.999.999. Enviar únicamente el total en los campos de kilometraje. Al corregir el viaje, administración puede actualizar `distanceKm` y los demás datos con la versión vigente.
- El DTO incluye `mileageMode` y `distanceKm` en ambos casos. Los dos odómetros son nulos en los viajes por distancia. El chofer puede consultar sus viajes de este tipo. Solo administración puede corregirlos.
- La distancia cuenta en paneles, totales, Excel y km al 100%. El horario ocupa chofer, camión y acoplado en ambos métodos. Solo las lecturas reales aportan al historial del odómetro del camión.
- La primera publicación admite leer viajes de ambos tipos. La segunda habilita la carga por distancia desde la API y el formulario administrativo.

## Kilómetros al 100% y feriados

Los endpoints de esta sección llevan prefijo `/api`, exigen sesión y contraseña definitiva, y las mutaciones conservan la protección CSRF. La comprobación previa de un viaje está disponible para ADMIN y DRIVER; gestionar el calendario requiere ADMIN.

`POST /trips/km100-preview` recibe las fechas y el mismo método de kilometraje que el alta y devuelve `{mode,suggestedKm,intervals,missingYears,calendarToken}` sin guardar un viaje ni modificar el calendario. Cada intervalo contiene `{start,end,label}` con instantes ISO UTC. La comprobación usa el intervalo completo `[salida,llegada)`, con el horario argentino: sábado desde las 13:00, domingo completo y cada día habilitado del calendario confirmado. Los solapamientos se cuentan una sola vez; terminar el lunes a las 00:00 no agrega tiempo de lunes.

| `mode`    | `suggestedKm`     | Carga del viaje                                                                                                                                     |
| --------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NONE`    | `0`               | Sin coincidencia con horarios al 100%, o sin kilómetros recorridos.                                                                                 |
| `FULL`    | Distancia del viaje | Todo el intervalo corresponde al 100%.                                                                                                              |
| `PARTIAL` | `null`            | Se exige declarar los kilómetros recorridos dentro de los horarios indicados, incluido `0` si no se circuló en ellos. No se prorratea por duración. |
| `PENDING` | `null`            | Falta confirmar al menos un año del intervalo; `missingYears` identifica cuáles. Permite guardar una declaración provisional.                       |

Un viaje de distancia cero devuelve `NONE` con cero aunque falte confirmar el año. Los demás casos requieren cobertura confirmada de todos los años del intervalo para determinar `NONE`, `FULL` o `PARTIAL`; un año sin calendario no equivale a un año sin feriados.

POST/PATCH de viajes aceptan `km100` entero entre cero y la distancia total (máximo 9.999.999) y `km100CalendarToken` opcional. El frontend envía el token obtenido en preview; si cambió el calendario activo, el servidor devuelve 409 `KM100_CALENDAR_CHANGED`. El servidor siempre vuelve a calcular: en `NONE`/`FULL` completa el valor al omitirlo o enviarlo nulo, y rechaza un valor explícito distinto; en `PARTIAL`/`PENDING` omitirlo o enviarlo nulo devuelve 400 `KM100_REQUIRED`. Valores fuera del recorrido devuelven 400 `KM100_RANGE`.

`Trip` añade `km100:number|null` y `km100Context:object|null`. El contexto es una instantánea generada por el servidor: `{schemaVersion:1,mode,calendarToken,missingYears,suggestedKm,intervals}`. Se persiste como JSON validado en una columna de texto y se devuelve como objeto; el cliente no puede enviarlo. Figura también en los valores anteriores/posteriores de la auditoría del viaje.

Los cambios del calendario no reescriben viajes. Los anteriores a esta incorporación conservan ambos campos nulos, incluso al corregir sus datos; no admiten completar `km100` por esta API (400 `KM100_LEGACY`). En viajes que ya tienen contexto, PATCH conserva el cálculo si sólo cambian datos ajenos a fechas, odómetros y km al 100%; cambiar esos datos vuelve a evaluarlo. Un viaje provisional conserva `PENDING` hasta resolverlo expresamente.

Para resolver un provisional, administración envía PATCH `/trips/:id` con `{version,km100Resolve:true,km100?,km100CalendarToken?}` y los demás cambios necesarios. Exige los años confirmados; de lo contrario devuelve 409 `KM100_CALENDAR_PENDING`. Después puede marcarse revisado con el endpoint habitual. El chofer no puede resolverlo, corregir un viaje ajeno ni modificar uno ya revisado. La revisión rechaza cualquier contexto `PENDING`; las correcciones administrativas siguen quitando la revisión y aumentando la versión.

La idempotencia del alta incorpora el `km100` expresamente declarado, incluido cero, y excluye token y contexto calculado. El reenvío de una solicitud ya guardada se resuelve antes de consultar el calendario actual; cambiar ese valor con el mismo `clientRequestId` devuelve `IDEMPOTENCY_CONFLICT`. Los hashes de solicitudes anteriores que no incluían el campo siguen siendo válidos.

En las planillas del contador (`form` y `monthly`), «Km recorridos» conserva la distancia total y «Km al 100%» es un subconjunto, sin restarse de ella. Los valores nulos anteriores y los provisionales se exportan vacíos; cero informado se exporta como número. El total de esa columna queda vacío si falta un valor en cualquier viaje del folio o de la hoja mensual. El detalle operativo sí muestra el kilometraje declarado provisional y la leyenda «Provisional: calendario pendiente». La selección mensual sigue dependiendo del mes de salida, sin dividir viajes entre meses.

### Administración del calendario

- `GET /holiday-calendar/status` devuelve `{currentYear,needsConfirmation,years:[{year,confirmedAt,hasProposal,lastCheckError}]}`. El año actual se determina en Argentina; la lista incluye el actual, el siguiente y los años guardados.
- `GET /holiday-calendar/:year` devuelve `HolidayYear`. Años de cuatro dígitos desde 1900; sin un horizonte de precarga fijo. Una consulta no inicializa filas ni confirma datos.
- `PUT /holiday-calendar/:year` recibe `{version,entries,confirm,proposalHash?}` y devuelve `HolidayYear`. Reemplaza la lista del año enviado, con control de concurrencia. `confirm:true` registra la confirmación; `false` permite guardar un borrador si nunca se confirmó y no retira una confirmación existente.
- `POST /holiday-calendar/:year/check` consulta la publicación anual y devuelve `HolidayYear`. Un 404 significa `not_published`: conserva la base calculada y no es un error de la aplicación. Una falla técnica también conserva los datos disponibles y responde 200 con estado `unavailable`; sólo devuelve 502 `HOLIDAY_SOURCE_UNAVAILABLE` si ese año no tiene ninguna propuesta ni calendario reutilizable. Cada consulta guarda su resultado y una nueva versión de edición.

`HolidayYear` contiene `{year,version,revision,confirmedAt,entries,proposal,lastCheckedAt,lastCheckError,annualSourceStatus}`. Cada entrada es `{date:'YYYY-MM-DD',name,source:'official'|'manual',enabled:boolean}`: fecha única dentro de ese año, nombre de hasta 180 caracteres y máximo 366 entradas. Todos los días habilitados aplican completos y globalmente a los choferes. Desactivar conserva la entrada para su revisión; no elimina la regla automática del fin de semana.

`proposal` es nulo o `{kind,hash,checkedAt,sourceUrl,entries}`; `kind` distingue `official` (publicación anual) de `statutory` (base calculada según las reglas nacionales). El JSON previo sin `kind` se interpreta como `official`. `annualSourceStatus` distingue `unchecked`, `available`, `not_published` y `unavailable`. La lista de propuesta conserva los días manuales y los ajustes administrativos frente a la última fuente aceptada. El cliente la muestra para revisión; al enviar sus entradas, posiblemente corregidas, junto con `proposalHash`, se consume esa propuesta y se conserva la referencia para la próxima actualización. Sin hash la propuesta sigue pendiente. Una versión de edición vieja devuelve 409 `CONFLICT`; una propuesta reemplazada devuelve 409 `HOLIDAY_PROPOSAL_CHANGED`.

`version` protege la edición y cambia con guardados y consultas a la fuente. `revision` identifica el calendario activo: aumenta al confirmar por primera vez o cambiar sus entradas confirmadas; buscar propuestas no invalida los tokens de viaje. GET y el arranque no escriben. La publicación precargada de 2026 y las bases calculadas para cualquier año posterior requieren confirmación administrativa; no hay un horizonte de precarga en 2030. La base se genera al consultar el año, incluso sobre configuraciones ya guardadas con años vacíos, sin alterar calendarios activos ni reabrir propuestas consumidas. El aviso global se limita al año actual en Argentina; no exige anticipar la confirmación del siguiente.

La base usa los feriados fijos, Carnaval, Viernes Santo y los traslados de martes/miércoles al lunes anterior y jueves/viernes al siguiente de la [Ley 27.399](https://www.argentina.gob.ar/normativa/nacional/ley-27399-281835/texto). Los trasladables que caen en fin de semana conservan su fecha hasta que exista una decisión específica bajo el [Decreto 614/2025](https://www.argentina.gob.ar/normativa/nacional/decreto-614-2025-416911/texto). Pascua se calcula con el [algoritmo gregoriano de USNO](https://aa.usno.navy.mil/faq/easter). No se adivinan excepciones futuras. El importador toma feriados nacionales de tipo inamovible o trasladable con ubicación Argentina; los días no laborables, turísticos o particulares no se incorporan automáticamente y pueden agregarse manualmente.

Las operaciones administrativas auditan `HOLIDAY_CALENDAR` con actor, instantáneas y acciones `UPDATED`, `CONFIRMED`, `CHECKED`, `NOT_PUBLISHED` o `CHECK_FAILED`. El calendario está separado de `/settings`, cuyo contrato de correo y anticipaciones no cambia. La búsqueda diaria y sus límites operativos se describen en [GitHub Actions y operación de feriados](github-actions.md#operación-del-calendario-de-feriados).

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
- PATCH /api/users/:id/cuil `{cuil:string|null,expectedUpdatedAt:ISO}` => `UserAccess`. Edición administrativa del CUIL para la planilla del contador, con las reglas descritas debajo.
- DELETE /api/users/:id => `UserAccess` con `active:false`. Es una baja lógica idempotente: conserva usuario, perfil, viajes, documentación y auditorías.

`UserAccess` contiene `{id,username,name,role,active,mustChangePassword,driverId:string|null,assignedTruckId:string|null,cuil:string|null,createdAt,updatedAt}`. No devuelve contraseñas, hashes ni tokens. Las fechas son instantes ISO del servidor.

La propia baja o democión devuelve 409 `SELF_ACCESS_CHANGE`; quitar al último administrador activo devuelve 409 `LAST_ADMIN`. Las mutaciones revalidan actor/sesión dentro de una transacción y coordinan cambios de cuentas, credenciales e invitaciones. Un acceso revocado durante la operación devuelve 401/403, sin completar el cambio.

Todo cambio efectivo de rol o estado revoca sesiones y enlaces pendientes vinculados a ese chofer. Una baja o pérdida del rol ADMIN también revoca invitaciones pendientes emitidas por esa cuenta. La reactivación requiere volver a ingresar y no restaura sesiones ni enlaces previos. Cambiar a DRIVER crea el perfil si faltaba; ambos cambios de rol conservan el camión asignado, el perfil y el historial. La baja desasigna el camión; reactivar no recupera asignaciones anteriores.

`Driver` añade `role` y `accountActive`. Su campo `active` indica una cuenta activa con perfil operativo, incluido ADMIN. Los administradores con perfil pueden cargar viajes y documentación manteniendo sus permisos y estadísticas globales. Los endpoints antiguos de edición y contraseña de choferes siguen exigiendo rol DRIVER (409 `DRIVER_ROLE_REQUIRED`); no permiten cambiar credenciales administrativas. Corregir viajes existentes sin cambiar el chofer sigue permitido según los permisos habituales.

Los cambios quedan auditados como entidad USER (`ROLE_CHANGED`, `DEACTIVATED`, `REACTIVATED`, `TRUCK_ASSIGNED`, `TRUCK_UNASSIGNED`, `CUIL_UPDATED`), con actor, fecha del servidor y valores anteriores/posteriores seguros, incluidos perfil y asignación. Una baja, asignación o edición de CUIL repetida no duplica la auditoría.

### CUIL del conductor

La ficha en **Usuarios → Completar CUIL / CUIL** permite a administración editar este dato opcional. Se eliminan espacios y guiones y se guardan exactamente once dígitos; cadena vacía, sólo separadores o `null` lo dejan sin informar. Se valida el formato, sin comprobación de dígito verificador ni consulta a padrones. Los perfiles anteriores conservan `Driver.cuil = null` hasta una carga explícita.

La escritura compara `expectedUpdatedAt` con la última versión del usuario y devuelve 409 `CUIL_VERSION_CONFLICT` si otro cambio la volvió obsoleta. El cliente debe actualizar la referencia y revisar su entrada antes de reenviar. Guardar el mismo valor normalizado es una operación sin cambios, incluso al repetir un envío. Cada cambio efectivo avanza `User.updatedAt` y audita `CUIL_UPDATED` con actor, perfil, CUIL anterior/nuevo y fechas; no revoca sesiones, cambia roles ni modifica viajes.

Un CUIL no nulo para un administrador activo sin perfil crea su único perfil de conductor, igual que asignarle un camión, conservando rol y acceso. Un nulo sin perfil no crea registros. Un usuario inactivo con perfil admite corregir este dato histórico; crear perfil en un inactivo devuelve 409 `USER_INACTIVE`.

El listado `/users` y esta edición son exclusivos de administración. `Driver` incorpora `cuil:string|null`; un chofer sólo recibe su propio perfil en `/drivers`, sin CUIL de otros conductores. Las planillas `form` y `monthly` leen el CUIL actual del perfil al descargarse y lo presentan como `00-00000000-0` en el encabezado, o vacío si no está informado. No se copia ni se deduce el dato a partir del usuario o DNI.

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
