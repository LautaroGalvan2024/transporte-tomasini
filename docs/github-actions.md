# GitHub Actions: verificación y publicación de Tomasini

Repositorio: [LautaroGalvan2024/transporte-tomasini](https://github.com/LautaroGalvan2024/transporte-tomasini).

## Al abrir un PR y al integrar en main

`CI` verifica los PR dirigidos a `main`, los pushes a otras ramas y las ejecuciones manuales. `Deploy Tomasini` verifica y publica cada push a `main`, incluidos los merges, y permite una ejecución manual seleccionando `main`. Otras ramas y forks no pueden ejecutar el job de producción.

Ambos usan Ubuntu 24.04, Node.js **24.21.0**, `npm ci` y el mismo `scripts/ci-check.mjs`:

1. `npm run check`: tipos, pruebas unitarias y build de frontend/backend.
2. Pruebas de infraestructura Python, de puertos y de los límites del publicador.
3. PostgreSQL 16.15 en un contenedor efímero del runner, publicado únicamente en `127.0.0.1:55440`.
4. Creación de `tomasini_test`, esquema propio, `tomasini_test_migrator` y `tomasini_test_app`. La aplicación no es superusuario ni dueña de la base y no tiene permiso de crear objetos. El administrador del contenedor se usa únicamente para preparar estos recursos.
5. Migraciones mediante el wrapper que valida base/rol; pruebas integrales de API e invitaciones en serie; pruebas de no repetición y rechazo de destinos de migración ajenos.

Las contraseñas de app/migrador se generan en cada ejecución, se enmascaran y se guardan temporalmente en `backend/.env.test` con permisos 0600. El archivo se elimina al terminar y el contenedor desaparece con el job. La contraseña visible del administrador del servicio es un valor desechable exclusivo del runner: no corresponde a ninguna cuenta de la VPS.

CI no utiliza ni se conecta a bases, SMTP o servicios de producción. No ejecuta `db push`, reset ni semillas. No sube `.env`, `.local`, bases, contraseñas o `node_modules` como artefactos.

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

## Publicación y conservación de datos

El job tiene `contents: read`, environment `production` y concurrencia `tomasini-production` con `cancel-in-progress: false`. Una publicación en curso termina antes de comenzar otra. GitHub puede reemplazar una ejecución pendiente por una más reciente dentro del mismo grupo; no se garantiza publicar cada commit intermedio. [Comportamiento documentado de concurrencia](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

Antes de enviar, el publicador comprueba que el checkout coincide con `github.sha` y que ese commit sigue siendo la punta actual de `main`, consultando la API oficial con un token de solo lectura. Una reejecución antigua se detiene. El empaquetador existente incluye solamente los archivos de aplicación seleccionados; el publicador verifica SHA-256 y tamaño máximo de 3 MiB.

El único comando remoto es:

```text
deploy <sha256-del-tar-gz> <commit-git-de-40-caracteres>
```

El `.tar.gz` viaja por stdin, sin SCP ni shell remota. SSH usa host verificado, una sola identidad, sin agente ni forwarding. El token de GitHub y la llave privada no se pasan a los procesos de empaquetado ni al ambiente del servidor.

El receptor exige que el esquema y **todas** las migraciones coincidan con la versión activa. Una migración nueva o modificada bloquea la publicación automática; debe revisarse y aplicarse mediante el procedimiento administrativo de actualización antes de volver a publicar. El receptor conserva usuarios, viajes, configuración SMTP, cookies y datos. Crea respaldo, prepara un release propio, cambia `current` de forma atómica y reinicia únicamente `tomasini.service`. Comprueba salud y continuidad de Mozzi/Horizontes; ante un fallo recupera el código anterior de Tomasini sin resetear la base.

El resumen de Actions muestra únicamente commit, SHA del release y versión anterior confirmados por el receptor. Si SSH se interrumpe o falta confirmación, revisar el recibo y diagnóstico privado en la VPS antes de reintentar: una interrupción del runner no demuestra que la publicación remota haya fallado. No reutilizar el instalador inicial ni restaurar bases automáticamente.

## Referencias y versiones fijadas

Acciones verificadas contra sus releases y commits oficiales el 2 de noviembre de 2026; se ejecutan por SHA completo, no por tags móviles:

| Acción                                                                          | Versión | SHA                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1)     | 7.0.1   | [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1)   |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0) | 7.1.0   | [`949feb2413d6458794dcd2491c4babbbce0c15c1`](https://github.com/actions/setup-node/commit/949feb2413d6458794dcd2491c4babbbce0c15c1) |

La imagen oficial `postgres:16.15-bookworm` también se fija por digest: `sha256:e8a07d2c7579b038938cdba6c539e580e5001caf9ea203d397b5cc83e76bd938`, consultado en el [registro oficial de Docker Hub](https://hub.docker.com/v2/repositories/library/postgres/tags/16.15-bookworm). La configuración del servicio sigue el [patrón oficial de PostgreSQL para Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers). Revisar estos pins deliberadamente al actualizar herramientas.
