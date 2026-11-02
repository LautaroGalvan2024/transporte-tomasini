# Transporte Tomasini

Aplicación web para registrar viajes, revisar kilómetros y controlar servicios y documentación de camiones y choferes. Interfaz en español, clara, azul oscuro y gris, diseñada para celular y escritorio.

## Sitio publicado

[Abrir Transporte Tomasini](https://tomasini.72-60-50-213.sslip.io).

Publicado y verificado el 2 de noviembre de 2026. El administrador inicial debe cambiar su contraseña al ingresar; el acceso está guardado únicamente en el archivo privado `.local/production-access/3e2a233979d5a9df/admin-inicial.json`. Producción inicia sin datos ficticios. Desde administración se cargan los camiones, choferes y vencimientos reales. El correo externo queda pendiente de configurar SMTP y el destinatario.

## Puesta en marcha local

Requiere Node 24 y PostgreSQL 16. La infraestructura de desarrollo utiliza un cluster exclusivo dentro de `.local/`; no se conecta a Mozzi ni a Horizontes.

```powershell
npm ci
node scripts/db.mjs setup
npm run db:migrate --workspace @tomasini/backend
node scripts/db.mjs grant
npm run dev
```

Abrir `http://127.0.0.1:5175`. El backend escucha en `127.0.0.1:3002` y PostgreSQL local en `127.0.0.1:55440`. El arranque verifica que los puertos estén libres y no mata procesos ajenos.

El comando `setup` genera los archivos privados de conexión, sin imprimir contraseñas. Para usar otros binarios PostgreSQL, configurar `TOMASINI_PG_BIN`; por defecto lee la distribución portable ya disponible en esta computadora.

## Datos de demostración

```powershell
npm run seed:demo --workspace @tomasini/backend -- --local-demo
```

Solo funciona en la base local `tomasini_dev` vacía. Crea tres camiones, tres choferes y registros ficticios. Las credenciales aleatorias quedan en `.local/demo-credentials.json`, fuera de Git. No volver a ejecutar la semilla sobre datos existentes y no publicar esas credenciales. La instalación productiva nunca carga la demo.

## Uso

- **Chofer:** carga viajes realizados, consulta su historial y corrige registros aún no revisados. El camión habitual se ofrece por defecto; las lecturas del odómetro se confirman manualmente.
- **Administración:** gestiona camiones y choferes, revisa/corrige/anula viajes, mantiene vencimientos y servicios, consulta historial y descarga Excel.
- Los avisos se calculan por fecha, kilómetros o ambos; se aplica el primero que alcance el límite. La lectura actual se deriva del historial cronológico, incluyendo servicios, y se muestra con su fecha.
- Los viáticos son importes opcionales en ARS. No se liquidan salarios ni se interpreta el convenio laboral.
- El formulario conserva la carga ante errores; un envío ambiguo se reintenta con el mismo contenido e identificador para evitar duplicados. La sesión puede recuperarse sin recargar el formulario.
- El sistema requiere conexión. No incluye seguimiento GPS, carga offline, facturación, combustible, peajes, adjuntos ni acoplados.

## Verificación

```powershell
npm run check
node --test scripts/test-infra.mjs scripts/test-migrations.mjs
& 'C:\Users\Nico\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s infra -p test_install_vps.py -v
node scripts/db.mjs backup-restore-check
```

La ruta Python corresponde al runtime disponible en esta computadora; en otro equipo usar un intérprete Python 3.12 o posterior. La integración API usa `tomasini_test` y sus credenciales exclusivas; consultar `backend/package.json` y `docs/verification.md`. Nunca ejecutar pruebas sobre producción. La auditoría de dependencias se revisa con `npm audit`.

## Arquitectura y operación

- React/TypeScript/Vite y componentes comunes en `frontend/`.
- Express/TypeScript/Zod, sesiones PostgreSQL y Prisma en `backend/`.
- Contrato de API: [docs/api-contract.md](docs/api-contract.md).
- Despliegue aislado, respaldos, límites y recuperación: [docs/deployment.md](docs/deployment.md).
- Evidencia y límites de verificación: [docs/verification.md](docs/verification.md).

El sistema utiliza el logo oficial en WebP y el lema «Tu carga, nuestro compromiso». Los nombres reales, patentes y lecturas iniciales se cargan desde administración. Las cuentas se crean mediante **Equipo → Invitar**; el usuario puede ser un nombre sin espacios o un DNI sin puntos. Se guarda como texto y admite números, incluyendo ceros iniciales. No se verifica la identidad a partir del número ingresado. Para correo real faltan la configuración SMTP privada y el destinatario; el tablero funciona independientemente del envío externo.
