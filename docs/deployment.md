# Despliegue de Transporte Tomasini

## Recursos propios y protección de las aplicaciones existentes

El destino acordado es la VPS `72.60.50.213`. Tomasini utiliza su propia base PostgreSQL, roles, usuario Linux, runtime Node, servicio, virtual host, certificado y tareas programadas. El frontend compilado y la API se sirven bajo un único origen HTTPS; el navegador nunca se conecta a PostgreSQL.

| Recurso                   | Tomasini                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| Aplicación pública        | `https://tomasini.72-60-50-213.sslip.io`                              |
| API y frontend internos   | `127.0.0.1:3102`                                                      |
| Carpeta                   | `/opt/tomasini`                                                       |
| Usuario y servicio        | `tomasini`, `tomasini.service`                                        |
| Base productiva / esquema | `tomasini_prod` / `tomasini`                                          |
| Roles                     | `tomasini_prod_app`, `tomasini_prod_migrator`, `tomasini_prod_backup` |
| Configuración privada     | `/opt/tomasini/private/api.env`                                       |
| Credencial inicial        | `/opt/tomasini/private/bootstrap/admin-inicial.json`                  |

El instalador no modifica sitios, datos ni procesos de Mozzi o Horizontes. Las únicas modificaciones compartidas son el agregado de un virtual host propio y reglas HBA limitadas a los tres roles de Tomasini, con validación y recargas; nunca reinicia Nginx ni PostgreSQL. Captura huellas de los archivos preexistentes de Nginx, PID de servicios y comprobaciones HTTP antes de actuar, y las coteja en las etapas críticas. Compartir VPS conserva un riesgo de recursos comunes; se limitan conexiones, memoria y CPU.

Inspección de solo lectura del 02/11/2026: se observaron aproximadamente 6,7 GiB de memoria disponible y 86 GiB de disco libre; el puerto 3102 no estaba ocupado. Mozzi web/API respondieron 200 y sus huellas Nginx coincidieron con la referencia de Horizontes. Son datos históricos; el instalador repite las verificaciones. SSH por clave funciona; `sudo -n` requiere contraseña, que deberá ingresarse directamente en una terminal.

## Desarrollo local

Se usa un cluster PostgreSQL 16.15 exclusivo en `.local/postgres-data`, puerto `55440`, con marcador que verifica su pertenencia a este checkout. Los binarios portables existentes de Horizontes se leen, sin cambiar sus archivos ni conectarse a sus bases. Se puede seleccionar otra distribución compatible con `TOMASINI_PG_BIN`.

La implementación actual mantiene desarrollo, shadow y tests en ese cluster local. Solo producción utiliza la VPS; no se crean bases de desarrollo de Tomasini en el PostgreSQL compartido.

```powershell
node scripts/db.mjs setup
npm run db:migrate --workspace @tomasini/backend
node scripts/db.mjs grant
node scripts/db.mjs check
npm run dev
```

`setup` genera credenciales privadas e independientes y `backend/.env.development`, sin imprimirlas ni sobrescribir una configuración previa. El rol app solo tiene DML, el migrador es propietario del esquema, y las reglas HBA rechazan sus conexiones a bases ajenas. `grant` retira expresamente el acceso al historial de Prisma. La API usa `3002` y el frontend `5175`. El arranque comprueba los puertos y falla si están ocupados; no detiene procesos ajenos ni ejecuta migraciones.

```powershell
node scripts/db.mjs backup-restore-check
node scripts/db.mjs stop
```

La prueba de respaldo restaura únicamente en `tomasini_restore_check`, dentro del cluster local propio; rechaza una base de ese nombre preexistente y compara tablas y cantidades. Solo elimina la base creada por esa misma ejecución. No usa la VPS, una base productiva ni una base de otro proyecto.

## Preparar y publicar

1. Ejecutar tipos, pruebas y compilación. Revisar SQL, configuración y diff. El release debe incluir `backend/dist`, `frontend/dist`, Prisma, scripts del backend, `infra`, los manifests y el lockfile; no `.env`, `.local`, `.git`, datos, dependencias de Windows ni credenciales.
2. Preparar el tar del release y un runtime oficial Node 24 Linux x64; verificar el SHA-256 del runtime contra la publicación oficial. Ambos hashes se pasan al instalador, que los vuelve a verificar.
3. Ejecutar `scripts/start-deploy.ps1 -ReleaseManifest <archivo.tar.gz.json>`. Abre una terminal visible específicamente para ingresar sudo en SSH. El launcher valida los hashes del release, runtime, instalador y exportador; la transferencia usa una carpeta remota nueva identificada por hash. La contraseña nunca se pide por chat ni se almacena.
4. `infra/install_vps.py` rechaza recursos Tomasini preexistentes. Instala dependencias bajo usuario propio, crea únicamente base/roles nuevos, aplica las migraciones revisadas con rol migrador, quita su LOGIN/contraseña y arranca la API con el rol app. No ejecuta semillas demo.
5. Verificar `/api/ready`, acceso, cambio de contraseña inicial, permisos, un viaje de prueba, vencimientos, Excel y un correo real de prueba cuando SMTP esté configurado. Revisar también las comprobaciones de Mozzi y Horizontes.

El servidor de aplicación recibe solo `DATABASE_URL` del rol app. Las credenciales migradoras son temporales y no quedan en el archivo de runtime. Las migraciones futuras requieren un procedimiento de release separado: este instalador es exclusivamente inicial y no debe volver a ejecutarse sobre una instalación existente.

`node scripts/fetch-runtime.mjs` descarga Node 24.21.0 Linux x64 y verifica su huella contra `SHASUMS256.txt` del sitio oficial. `node scripts/package-release.mjs` crea un tar con una selección explícita de archivos compilados y fuentes necesarias, excluyendo configuración privada, datos y dependencias locales; también genera su manifiesto. Ejecutarlo únicamente después de las verificaciones finales, sin editar el código mientras se empaqueta.

La instalación de dependencias y Prisma usa scopes propios limitados a 1 GiB y 40 % de CPU. Al terminar, el release queda propiedad de root y sin escritura para la aplicación. El script de respaldo privilegiado se copia a una carpeta root antes de instalar dependencias. La credencial inicial queda en una carpeta root con acceso restringido; la aplicación no puede leerla ni modificarla.

Después del éxito, `infra/export_artifacts.py` entrega copias privadas de la credencial inicial, recibo, evidencia anterior/posterior y primer respaldo al usuario SSH `mozzi`, mediante archivos nuevos 0600 en carpeta 0700. El launcher descarga por SCP a `.local`, con ACL exclusiva del usuario Windows, verifica huellas y elimina únicamente esas copias remotas de entrega. Los originales root permanecen. La contraseña no pasa por stdout ni aparece en el recibo.

El flujo vigente ejecuta instalación y exportación con **una sola autenticación sudo**: el instalador verifica el hash del exportador y lo ejecuta conservando su contexto root después de completar la instalación. No depende de que otro comando `sudo -n` pueda reutilizar una contraseña. Un error de exportación devuelve un estado separado y nunca revierte una aplicación ya instalada.

El estado queda en `.local/deployments/<primeros-16-caracteres-del-hash>/state.json`. La credencial está separada en `.local/production-access/<hash-corto>/admin-inicial.json`. Si falla la entrega después de la instalación, el estado lo indica expresamente: no volver a ejecutar el instalador.

Para una instalación comprobada con estado `installed_handoff_pending` y sin archivos de entrega, `scripts/start-handoff.ps1 -ReleaseManifest <manifiesto>` abre una terminal para autenticar únicamente la exportación. No instala, migra ni reinicia servicios. El exportador vuelve a verificar el recibo y el respaldo antes de entregar archivos.

La primera instalación del 02/11/2026 detectó un fallo de preparación: `runuser` estaba en `/usr/sbin`, ausente del PATH restringido. Se corrigió usando su ruta absoluta y conservando el PATH administrativo durante la preparación. La recuperación `--resume-release` solo admite ese estado previo a dependencias, roles, base y servicios, coteja todos los archivos contra el tar y conserva el error original. Una fase distinta o cualquier recurso posterior impide continuar automáticamente; no se borran recursos ni se repite la inicialización.

Para comprobar la recuperación del respaldo real descargado:

```powershell
node scripts/restore-production-backup.mjs --evidence="C:\ruta\Transporte Tomasini\.local\deployments\hash-corto"
```

Este comando valida recibo y huella, restaura solamente en `tomasini_prod_restore_check` del cluster local propio, verifica tablas, lectura de usuarios e historial de migraciones, y retira únicamente la base temporal creada por esa ejecución. No ejecuta operaciones contra la VPS. Guarda `restore-verification.json` sin datos personales. Una base temporal o evidencia preexistente impide repetirlo automáticamente.

Ante una falla, se detienen únicamente las unidades nuevas, se deshabilitan sus roles y se retira el enlace del virtual host nuevo. El bloque HBA se revierte solo cuando el archivo aún coincide exactamente con la modificación de esta ejecución. Se conservan la base, el release, certificados y el estado de error para revisar; no se resetea ni borra información. No se intenta reparar ni reiniciar Mozzi o Horizontes.

## Actualizar la aplicación existente

Para la ampliación aditiva de invitaciones, usar `infra/update_vps.py` y los launchers de actualización. El instalador inicial no sirve para actualizar una aplicación con datos.

Después de verificar y compilar el código final:

```powershell
node scripts/package-update.mjs --previous-manifest=".local/releases/tomasini-2026-11-02T14-30-57-695Z.tar.gz.json"
& '.\scripts\start-update.ps1' -UpdateManifest '<ruta del archivo .update.json generado>'
```

El plan generado registra el hash exacto de las versiones anterior/nueva, el esquema y cada migración. Rechaza cambios en SQL ya publicado. Esta revisión permite exclusivamente `202611020002_invitations`: crea la tabla, índices y relaciones nuevas, compatible con el código anterior. Un cambio destructivo o una ampliación diferente requiere un plan revisado.

El actualizador verifica la versión activa, el historial SQL y los servicios existentes antes de preparar un nuevo release. Instala dependencias y genera Prisma bajo cuotas; no entrega la configuración ni credenciales de producción a npm. Antes de migrar crea un respaldo nuevo `update-<hash>-before.dump`, separado de las copias diarias y validado con su SHA-256 y el listado de `pg_restore`.

La migración se ejecuta con una identidad Linux transitoria distinta de la aplicación y un archivo de ambiente root 0600. Se habilita temporalmente el rol `tomasini_prod_migrator` y se revocan LOGIN, contraseña y sesiones propias al terminar, incluso ante errores. El archivo temporal se retira. No se crean usuarios iniciales ni se ejecutan semillas.

El release nuevo queda propiedad de root y sin escritura para el proceso de aplicación. El cambio de `current` es atómico y se reinicia únicamente `tomasini.service`. Se comprueban readiness, HTML/assets publicados, preservación de usuarios/datos, la misma huella de `api.env` —incluido cualquier SMTP configurado por el usuario— y los PID/configuraciones/respuestas de Mozzi y Horizontes. No se modifica HBA, Nginx, certificados ni unidades de servicios durante esta actualización.

Si falla después de activar código nuevo, se restablece el enlace anterior y se reinicia únicamente Tomasini. No se ejecuta SQL inverso ni se restaura automáticamente una base encima de datos actuales: la ampliación aditiva permanece compatible con el release anterior. Ambos releases, el respaldo y la evidencia se conservan para revisión.

Una única autenticación sudo cubre actualización y entrega. Se descargan recibo, evidencia antes/después, plan y respaldo previo con ACL privada; no se vuelve a exportar la credencial inicial. El estado local queda en `.local/deployments/<hash-corto>/state.json`. El respaldo previo se verifica con `scripts/restore-production-backup.mjs` en el cluster local exclusivo. Ante un fallo, el actualizador prepara diagnóstico redactado privado para que pueda revisarse sin otra autenticación sudo.

## GitHub Actions: releases de código sin cambios de esquema

El repositorio `LautaroGalvan2024/transporte-tomasini` ejecuta verificaciones al recibir cambios y publica únicamente desde `main`. La clave Ed25519 de Actions pertenece al usuario exclusivo `tomasini-ci`; nunca se copia a GitHub la clave operativa de Mozzi. La clave privada se genera localmente en `.local/ci` y se carga como secreto `TOMASINI_DEPLOY_KEY` del environment de producción, restringido a `main`. Las variables son `TOMASINI_DEPLOY_HOST`, `TOMASINI_DEPLOY_USER` y `TOMASINI_DEPLOY_KNOWN_HOSTS`; las huellas del host deben estar verificadas previamente, sin aceptar claves nuevas automáticamente.

El único comando SSH admitido es `deploy SHA256 COMMIT`, con un tar.gz en stdin. La clave tiene `restrict` y un forced command fijo; no habilita shell interactivo, PTY, forwarding ni SCP. El usuario tiene una sola regla sudo: un entrypoint root, sin argumentos, que vuelve a validar el protocolo. El código operativo en `/opt/tomasini/ops/ci` pertenece a root y no se actualiza desde el release subido.

El receptor limita el archivo comprimido a 3 MiB, el contenido a 64 MiB y 5.000 entradas; rechaza rutas ajenas, duplicados, enlaces y archivos especiales. También limita la descompresión antes de interpretar los encabezados tar. El esquema Prisma y todos sus archivos de migración deben coincidir exactamente con el release activo y el historial aplicado. Una migración nueva requiere despliegue manual revisado; CI no habilita el migrador, ejecuta SQL de escritura ni inicializa usuarios.

La preparación Linux usa `DynamicUser`, un volumen ext4 exclusivo de 768 MiB respaldado por un archivo privado, RAM máxima de 1 GiB y CPU del 40 %. Solo el código de entrada y Node son visibles mediante bind mounts de lectura; los hogares y datos de otras aplicaciones quedan ocultos. `/tmp` y `/var/tmp` apuntan a subdirectorios del mismo volumen limitado; antes de ejecutar npm se verifica que ambos pertenecen a ese dispositivo. Se conservan hasta 1 MiB de log privado y se detiene un build que emita más de 8 MiB. El árbol generado se revisa antes de copiarlo al release root-owned; los hardlinks normales de esbuild solo se admiten cuando todos sus nombres están dentro del workspace. El volumen propio se desmonta al terminar; un build fallido conserva su imagen para revisión. La composición de `DynamicUser`, `StateDirectory` y mounts sigue la [documentación de systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

Antes de activar código, se crea un respaldo nuevo y se comprueban `api.env`, datos, historial y PID/configuración/HTTP de Mozzi y Horizontes. Solo se cambia `current` y reinicia `tomasini.service`. Un fallo posterior devuelve el código anterior; nunca restaura automáticamente una base ni ejecuta SQL inverso. El recibo privado, respaldo y diagnóstico quedan en `/opt/tomasini/private/ci/<hash>` y `/opt/tomasini/backups`; stdout contiene únicamente estado, commit y hashes de versiones. Releases y respaldos de despliegue se conservan: revisar espacio antes de retirarlos y mantener siempre el activo y el anterior.

Bootstrap único, después de revisar los helpers:

```powershell
& '.\scripts\prepare-ci-setup.ps1' -PublicKeyPath '.local/ci/tomasini-ci-ed25519.pub'
& '.\scripts\start-setup-ci.ps1' -SetupManifest '<launcher.json generado>'
```

El bootstrap requiere una sola autenticación sudo, crea recursos exclusivos y no reinicia la aplicación. Antes de habilitar la clave ejecuta `npm ci` y Prisma generate completos sobre el código público del release actual, en el mismo sandbox; verifica permisos, runtime, enlaces y esquema. El recibo público se descarga sin otra autenticación. Si algún paso falla, no se repite automáticamente: se deshabilita el acceso recién creado y se conserva evidencia. Tras configurarlo, comprobar con la clave CI que un comando como `true` es rechazado; luego verificar un despliegue real de `main` y el recibo antes de considerar terminado el flujo.

## Correo, respaldos y operación

- `tomasini-notifications.timer` despierta cada 15 minutos. El backend decide cuándo corresponde el resumen de las 08:00 de Argentina y maneja reintentos/deduplicación. Configurar `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` en `api.env` con editor/entrada privada; no enviarlas por chat ni versionarlas. Hasta completar y probar SMTP, los avisos externos no están operativos.
- `tomasini-backup.timer` ejecuta `infra/backup.py` diariamente a las 03:15 de Argentina. Usa un rol de lectura propio, escribe dumps privados, valida su listado y conserva 14 copias diarias completas. Una copia parcial nunca se sobrescribe automáticamente. La instalación ejecuta el primer respaldo.
- Esas copias están en la misma VPS: protegen frente a errores de aplicación, pero no cubren la pérdida completa del servidor. Para continuidad ante pérdida de la VPS se debe configurar una copia cifrada fuera de ella y ensayar su recuperación antes de considerarla cubierta.
- La restauración se ensaya en una base aislada; no restaurar un dump encima de producción. Confirmar huella, esquema y conteos, más una lectura de aplicación, antes de una recuperación real.
- `tomasini-certificate.timer` renueva solo el certificado de Tomasini, usando directorios ACME propios y una recarga de Nginx precedida por `nginx -t`.
- Consultar `systemctl status tomasini` y las unidades/timers con prefijo `tomasini-`; los errores de correo quedan además registrados en la aplicación. No imprimir archivos de credenciales en diagnósticos.

## Verificaciones de infraestructura

```powershell
node --test scripts/test-infra.mjs
node --test scripts/test-migrations.mjs
& 'C:\Users\Nico\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s infra -p 'test_*.py' -v
node scripts/db.mjs check
node scripts/db.mjs backup-restore-check
```

Las pruebas offline comprueban rechazo de puertos ocupados sin afectar al proceso existente, HBA acotado, vhost exclusivo, límites de recursos, rechazo de archivos tar que escapan de su destino, conservación de archivos existentes y detención ante cambios de configuración. La comprobación local usa conexiones PostgreSQL reales. Estas pruebas no certifican por sí solas un despliegue remoto ni la entrega de correo.

La prueba de migraciones necesita `node scripts/db.mjs setup-test`, la migración inicial sobre `.env.test` y `node scripts/db.mjs grant-test`. Verifica rechazo de base ajena/rol equivocado y que dos ejecuciones sin pendientes conservan exactamente el historial aplicado; solo admite `tomasini_test` en el cluster local de puerto 55440.
