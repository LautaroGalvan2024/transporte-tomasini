# GitHub Actions: verificación y publicación de Tomasini

Repositorio: [LautaroGalvan2024/transporte-tomasini](https://github.com/LautaroGalvan2024/transporte-tomasini).

## Al abrir un PR y al integrar en main

`CI` verifica cada PR dirigido a `main` y permite ejecuciones manuales. La rama de producción requiere un PR con la comprobación **Build, tests and isolated PostgreSQL** de GitHub Actions aprobada y al día. No se exige otro revisor para repositorios operados por una sola persona. Al hacer merge, [Deploy Tomasini](https://github.com/LautaroGalvan2024/transporte-tomasini/actions/workflows/deploy.yml) vuelve a verificar el commit exacto de `main` y lo publica. También puede ejecutarse manualmente eligiendo `main`. Las demás ramas y los forks no reciben las credenciales de producción.

Ambos usan Ubuntu 24.04, Node.js **24.21.0**, `npm ci` y el mismo `scripts/ci-check.mjs`:

1. `npm run check`: tipos, pruebas unitarias y build de frontend/backend.
2. Pruebas de infraestructura Python, de puertos y de los límites del publicador.
3. PostgreSQL 16.15 en un contenedor efímero del runner, publicado únicamente en `127.0.0.1:55440`.
4. Creación de `tomasini_test`, esquema propio, `tomasini_test_migrator` y `tomasini_test_app`. La aplicación no es superusuario ni dueña de la base y no tiene permiso de crear objetos. El administrador del contenedor se usa únicamente para preparar estos recursos.
5. Migraciones mediante el wrapper que valida base/rol; pruebas integrales de API e invitaciones en serie; pruebas de no repetición y rechazo de destinos de migración ajenos.

Las contraseñas de app/migrador se generan en cada ejecución, se enmascaran y se guardan temporalmente en `backend/.env.test` con permisos 0600. El archivo se elimina al terminar y el contenedor desaparece con el job. La contraseña visible del administrador del servicio es un valor desechable exclusivo del runner: no corresponde a ninguna cuenta de la VPS.

CI no utiliza ni se conecta a bases, SMTP o servicios de producción. No ejecuta `db push`, reset ni semillas. No sube `.env`, `.local`, bases, contraseñas o `node_modules` como artefactos.

Además, únicamente `CI` ensaya el sandbox real de despliegue en el runner efímero Ubuntu 24.04/systemd 255. `infra/ci_sandbox_smoke.py` exige un runner Linux alojado por GitHub, rechaza cualquier `/opt/tomasini` existente y crea una instalación ficticia con los archivos permitidos del release. Ejecuta el mismo `build_isolated(probe=True)` que el bootstrap: usuario dinámico, imagen ext4 limitada, temporales dentro de esa imagen, runtime de solo lectura, `npm ci` y generación Prisma. Comprueba los artefactos y el esquema y elimina solo los recursos propios. No recibe secretos ni habilita SSH, instala servicios persistentes o publica la aplicación. El workflow de producción no repite este ensayo adicional. Las guardas usan las [variables oficiales de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

## Configuración inicial de GitHub

En **Settings → Environments → production**, permitir despliegues únicamente desde la rama `main`. Para publicación automática no configurar aprobación humana obligatoria, salvo que se quiera cambiar deliberadamente ese comportamiento.

| Tipo                     | Nombre                        | Valor                                                                                        |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Secret del environment   | `TOMASINI_DEPLOY_KEY`         | Llave privada OpenSSH exclusiva de este repositorio y receptor. Nunca usar la de Mozzi.      |
| Variable del environment | `TOMASINI_DEPLOY_HOST`        | `72.60.50.213`                                                                               |
| Variable del environment | `TOMASINI_DEPLOY_USER`        | `tomasini-ci`                                                                                |
| Variable del environment | `TOMASINI_DEPLOY_KNOWN_HOSTS` | Línea OpenSSH completa del host, cuya huella se verificó previamente por un canal confiable. |

El workflow nunca ejecuta `ssh-keyscan` para decidir en quién confiar. Una clave de servidor diferente detiene el despliegue. La llave local del runner vive en un directorio temporal 0700 y archivo 0600; se elimina en `finally`.

La preparación inicial del receptor en la VPS es un procedimiento administrativo separado. Debe instalar el código revisado de `infra/ci_deploy.py` fuera del alcance del usuario de aplicación, registrar la llave pública exclusiva con comando forzado y limitar sudo al receptor. `tomasini-ci` no tiene shell, PTY, forwarding ni acceso general de administración. Los workflows no instalan ni modifican ese receptor.

Para actualizar el receptor, ejecutar `scripts/upgrade-ci-receiver.ps1` desde el checkout revisado. Pide sudo en una terminal local y verifica las huellas del receptor y del módulo de migraciones. Admite el receptor original, la versión de campos opcionales instalada en la VPS y un reintento de la actualización revisada. Conserva la llave y regla sudo existentes. El recibo local debe indicar `verified` en el estado y contener las huellas verificadas antes de integrar el PR de aplicación.

## Publicación y conservación de datos

El job tiene `contents: read`, environment `production` y concurrencia `tomasini-production` con `cancel-in-progress: false`. Una publicación en curso termina antes de comenzar otra. GitHub puede reemplazar una ejecución pendiente por una más reciente dentro del mismo grupo; no se garantiza publicar cada commit intermedio. [Comportamiento documentado de concurrencia](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

Antes de enviar, el publicador comprueba que el checkout coincide con `github.sha` y que ese commit sigue siendo la punta actual de `main`, consultando la API oficial con un token de solo lectura. Una reejecución antigua se detiene. El empaquetador existente incluye solamente los archivos de aplicación seleccionados; el publicador verifica SHA-256 y tamaño máximo de 3 MiB.

El único comando remoto es:

```text
deploy <sha256-del-tar-gz> <commit-git-de-40-caracteres>
```

El `.tar.gz` viaja por stdin, sin SCP ni shell remota. SSH usa host verificado, una sola identidad, sin agente ni forwarding. El token de GitHub y la llave privada no se pasan a los procesos de empaquetado ni al ambiente del servidor.

El receptor coteja el esquema y el historial ya aplicado con el release activo. Los cambios de código y los nuevos campos opcionales descritos más abajo se publican sin contraseña ni sesión de consola. Crea y valida un respaldo antes de modificar el esquema o activar la versión, cambia `current` de forma atómica y reinicia únicamente `tomasini.service`. Comprueba la continuidad de Mozzi y Horizontes. Si falla la activación, puede restituir el código anterior porque las columnas nuevas son opcionales; no deshace una migración confirmada ni restaura la base sobre datos posteriores.

El último paso de Actions compara el HTML, JavaScript y CSS públicos de `transporte-tomasini.com` con el build del commit. Comprueba tanto allí como en `transporte-tomasini-api.com` el estado JSON de `/api/ready` y el rechazo de una descarga mensual sin sesión. También verifica que el dominio de la API responda 404 en la raíz y que los alias `www` y el enlace anterior redirijan al dominio correspondiente con la ruta y los parámetros originales.

El resumen de Actions muestra únicamente commit, SHA del release y versión anterior confirmados por el receptor. Si SSH se interrumpe o falta confirmación, revisar el recibo y diagnóstico privado en la VPS antes de reintentar: una interrupción del runner no demuestra que la publicación remota haya fallado. No reutilizar el instalador inicial ni restaurar bases automáticamente.

## Agregar un campo desde un PR

1. Agregar el campo opcional al modelo existente en `backend/prisma/schema.prisma`. Por ejemplo, `diasEspera Int?` en `Trip`.
2. Crear una carpeta posterior a la última migración, por ejemplo `backend/prisma/migrations/202701150001_dias_espera/`. Incluir el archivo `ci.json`:

   ```json
   {
     "version": 1,
     "operations": [
       {
         "op": "addNullableColumn",
         "table": "Trip",
         "column": "diasEspera",
         "type": "Int",
         "nonnegative": true
       }
     ]
   }
   ```

3. Generar `migration.sql` con el módulo del repositorio, sin modificar migraciones existentes. En Linux:

   ```sh
   python3 infra/ci_migrations.py backend/prisma/migrations/202701150001_dias_espera/ci.json > backend/prisma/migrations/202701150001_dias_espera/migration.sql
   ```

   El SQL debe conservar sus bytes UTF-8, sin BOM y con finales de línea LF. Revisar y subir ambos archivos con el cambio del modelo. El ejemplo es ilustrativo: no hay que agregarlo para publicar código.

4. CI contrasta el plan, el SQL y el esquema, y prueba la migración en PostgreSQL aislado. Después del merge, el receptor instalado en la VPS vuelve a generar el SQL desde el plan y lo aplica junto con el registro de Prisma en una sola transacción, comprobando base, esquema, rol e historial. El rol migrador de producción sigue sin LOGIN ni contraseña. Ni el release ni GitHub reciben la credencial de un propietario de la base.

La política admite columnas opcionales `Int`, `BigInt`, `String` y `Boolean` en tablas existentes del esquema Tomasini; los enteros pueden exigir valores no negativos. Borrados, renombres, columnas obligatorias, nuevas tablas, SQL libre y modificaciones del historial quedan fuera de esta política: CI los detiene. Seguir el [procedimiento revisado de migración](deployment.md) si se necesita uno de esos cambios.

## Viajes con distancia directa

La operación revisada `enableTripManualDistance` corresponde exclusivamente a `202611200001_trip_manual_distance`. Su único parámetro es el nombre de la operación. El receptor genera el SQL fijo y coteja los tres campos de `Trip` con el esquema. La restricción admite ambos odómetros o una distancia manual de 0 a 9.999.999 km. El ensayo de CI aplica la migración sobre un viaje ficticio creado con el esquema anterior, compara todos sus campos y ejercita los límites en PostgreSQL.

El primer PR publica los lectores y conserva la creación por odómetro. Confirmar el commit de este primer despliegue en el recibo de la VPS y en el sitio público antes de integrar el segundo PR que habilita la carga administrativa. Cada despliegue conserva su propio respaldo y recibo.

La ampliación al chofer sigue la misma secuencia. `202611200002_trip_distance_source` usa la operación revisada `addNullableColumn` para agregar `Trip.distanceSource`, sin reescribir viajes anteriores. La primera entrega instala la columna y los lectores de kilometraje para mantenimiento. Conserva habilitada la carga histórica administrativa. Una vez verificado ese commit en la VPS y en el sitio, la segunda habilita la carga operativa en API y formulario. Un retorno a la primera entrega conserva la lectura de los registros creados por la segunda.

Si falla la primera activación, el receptor pausa las escrituras de Tomasini y comprueba con el rol de aplicación que todos los viajes tienen dos lecturas antes de restituir la versión anterior. Si hay un viaje con odómetros ausentes, conserva la versión compatible para recuperar hacia adelante. Esta comprobación también se aplica cuando una migración quedó confirmada en un intento anterior. Si falla la segunda activación, el primer release ya puede leer y exportar los viajes guardados.

## Operación del calendario de feriados

La migración `202611170001_km100_holidays` usa el contrato anterior sin ampliarlo: agrega `Trip.km100 Int?` no negativo, `Trip.km100Context String?` y `Setting.holidayCalendar String?`. No crea tablas ni completa viajes anteriores. Los contextos y el calendario se validan como JSON en la aplicación. La propuesta publicada de 2026 y las bases calculadas de años posteriores se ofrecen al leer, incluso si la configuración ya existía. Requieren confirmación administrativa; GET y el arranque no escriben ni ejecutan migraciones. La generación recurrente no necesita nuevas migraciones ni precargas por cada año y conserva los calendarios confirmados.

La migración posterior `202611170002_driver_cuil` agrega `Driver.cuil String?` bajo la misma política de columnas opcionales. Los perfiles anteriores quedan sin CUIL hasta que administración lo complete; las planillas leen ese dato del perfil al descargarse.

`backend/scripts/run-notifications.ts`, invocado por el timer propio de avisos existente, consulta las propuestas del año actual y siguiente como máximo una vez por día argentino. Lo hace antes del trabajo de correo, con un bloque de error separado, sin depender de SMTP, destinatario ni hora de envío. Cada descarga tiene un límite de ocho segundos y 512 KiB; no se agrega un servicio, timer ni correo. Una fuente caída conserva el calendario activo y no impide ejecutar los avisos habituales; el siguiente intento automático será otro día, o administración puede usar «Consultar fuente anual».

La búsqueda sólo prepara novedades: en **Configuración → Feriados** se revisan y confirman, conservando días especiales y ajustes administrativos. Un archivo anual aún no publicado (404) es un estado informativo: la base nacional calculada permanece disponible y no se cuenta como falla del sincronizador. El estado de consulta y los errores aparecen una sola vez en la tarjeta de la fuente; los logs del runner informan cantidades y resultado sin secretos. El aviso administrativo global sólo indica el año actual sin confirmar o con novedades; no aparece por años futuros ni propuestas antiguas. Confirmar o modificar el calendario no recalcula viajes guardados; los provisionales se resuelven expresamente antes de revisarlos. El [contrato de API](api-contract.md#kilómetros-al-100-y-feriados) detalla datos, permisos y exportación.

## Referencias y versiones fijadas

Acciones verificadas contra sus releases y commits oficiales el 2 de noviembre de 2026; se ejecutan por SHA completo, no por tags móviles:

| Acción                                                                          | Versión | SHA                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1)     | 7.0.1   | [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1)   |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0) | 7.1.0   | [`949feb2413d6458794dcd2491c4babbbce0c15c1`](https://github.com/actions/setup-node/commit/949feb2413d6458794dcd2491c4babbbce0c15c1) |

La imagen oficial `postgres:16.15-bookworm` también se fija por digest: `sha256:e8a07d2c7579b038938cdba6c539e580e5001caf9ea203d397b5cc83e76bd938`, consultado en el [registro oficial de Docker Hub](https://hub.docker.com/v2/repositories/library/postgres/tags/16.15-bookworm). La configuración del servicio sigue el [patrón oficial de PostgreSQL para Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers). Revisar estos pins deliberadamente al actualizar herramientas.
