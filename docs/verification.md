# Verificación de la primera versión

## Calendarios recurrentes y aviso anual — 17 de noviembre de 2026

- Tipos y builds correctos; 47 pruebas unitarias backend, 18 frontend y 89 pruebas de integración con PostgreSQL aislado. Se verificaron reglas móviles, años posteriores a 2030, fechas coincidentes, hidratación de JSON existente, consultas sin escritura y preservación de confirmados.
- El adaptador diferencia archivo anual no publicado (404) de error técnico. Ambos conservan la base o el calendario disponible; una fuente oficial posterior crea una propuesta revisable. Las consultas repetidas no reabren calendarios ya confirmados.
- Chromium con administrador ficticio, 390 × 844 y 1440 × 1000: año 2027 vacío de una instalación anterior muestra 16 fechas sin aviso global; consulta 404 informativa y error 503 único, sin pérdida de fechas; navegación a 2035 y 2200 sin límite de precarga. Un cambio de año simulado en la respuesta de estado al navegador mostró el aviso del año actual, y una confirmación real por API/PostgreSQL lo retiró. Sin errores JS ni desbordes. Evidencia local ignorada en `output/qa/holiday-fix/`.
- No hay migración SQL ni modificación de calendarios confirmados en producción. Las propuestas calculadas se ofrecen al leer y se materializan sólo con una operación administrativa o sincronización existente.

## Km al 100%, calendario de feriados y CUIL — 17 de noviembre de 2026

- `npm run check`: tipos, 35 pruebas unitarias backend, 13 frontend y ambos builds aprobados. Las 84 pruebas de integración pasaron en PostgreSQL exclusivo `tomasini_test`; incluyen permisos, CSRF, idempotencia, valores históricos nulos, resolución administrativa de provisionales, concurrencia de calendario/CUIL y exportación mensual.
- Dos migraciones declarativas y cuatro columnas opcionales verificadas con la política de CI, SQL canónico sin BOM y finales LF. Aplicadas mediante el wrapper con comprobación de base/rol en `tomasini_test`. Dos pruebas de migraciones comprobaron rechazo de destinos ajenos y reejecución sin alterar el historial. También pasaron 68 pruebas de infraestructura Python y cinco de publicación/puertos en Node.
- Chromium, con cuentas y unidades ficticias a 390 × 844 y 1440 × 1000: alerta de año sin confirmar y enlace directo, revisión de propuesta, alta de día especial, confirmación y desaparición del aviso. La carga parcial exigió km válidos, el domingo calculó toda la distancia y un año pendiente permitió guardar como provisional. Administración confirmó ese año, validó los km desde el formulario y marcó el viaje revisado.
- CUIL probado desde Usuarios en celular y escritorio: validación de formato, normalización, guardado, presencia en la descarga mensual real y vaciado a nulo. La exportación conserva km totales y km al 100% por separado; los valores provisionales/históricos faltantes y sus totales incompletos quedan vacíos en la planilla del contador.
- Capturas inspeccionadas sin desbordes ni errores JavaScript. Evidencias privadas en `output/qa/km100/`, incluidos la planilla y los recorridos de prueba. Fixtures retirados y calendario de pruebas restaurado; sin cuentas de choferes reales ni correos reales. La verificación de publicación corresponde al workflow **Deploy Tomasini** del PR.

## Aviso de actualización del frontend — 16 de noviembre de 2026

- Chromium probó dos builds con huellas distintas en escritorio y celular. La primera visita abrió normalmente. Tanto una pestaña con el build anterior como un usuario que volvió más tarde tuvieron que pulsar «Recargar página». La ruta, la sesión y el fragmento de invitación se conservaron tras la recarga.
- El aviso mantuvo el foco cuando había otro diálogo abierto. Al cancelar el aviso nativo de salida durante la carga de un viaje se conservó el borrador. Se comprobaron la recuperación de red, el regreso a una pestaña oculta y el funcionamiento con almacenamiento de solo lectura.
- En el servidor Express de producción con PostgreSQL local aislado, el manifiesto y las tres rutas de entrada probadas devolvieron la misma versión y `Cache-Control: no-store`. Las capturas están en `output/qa/version/`.

## Planilla mensual del contador — 16 de noviembre de 2026

- Con PostgreSQL exclusivo `tomasini_test`, pasaron las 57 pruebas de integración. La exportación cubre cambios de mes según la zona horaria argentina, chofer, estado de revisión, anulaciones y viajes en más de un camión.
- Desde Reportes, en escritorio (1440 × 1000) y celular (390 × 844), los filtros operativos vacíos permitieron descargar el mes elegido. Cada clic produjo un archivo con una sola hoja y los 30 viajes de prueba, en orden y con sus dos patentes. Otro mes mostró el aviso correspondiente. El detalle operativo conservó los filtros elegidos.
- Excel de escritorio recalculó 4.635 km y 30 controles. La impresión en Carta horizontal ocupó dos páginas, repitió los encabezados y dejó los totales y las firmas al final. Evidencias locales en `output/qa/mensual/`.

## Controles y planilla de kilometraje — 11 de noviembre de 2026

Publicado y verificado en producción el 11/11/2026 a las 21:03 (Argentina): release `4c4f6ed59eb09169124a857a319a92437e47d673e28a57fb71d1bdfd4ca14334`. El primer intento se interrumpió durante la preparación de dependencias; la recuperación verificó que la migración seguía pendiente, conservó la preparación previa y reconstruyó desde el mismo paquete. El recibo confirma la migración de controles en `tomasini_prod` y el cierre del rol migrador. El sitio público entregó los archivos exactos del release, la API respondió 200 y la descarga sin sesión devolvió 401. Se verificaron los servicios vecinos y se restauró el respaldo previo en el clúster local aislado. La evidencia privada se encuentra en `.local/deployments/4c4f6ed59eb09169/resume-preparation/`.

- Verificación local: tipos y compilación de frontend/backend, 18 pruebas de dominio y exportación, 56 pruebas de integración sobre PostgreSQL aislado, 4 de infraestructura y migraciones en Node y 43 de infraestructura en Python. El wrapper rechazó destinos ajenos y conservó el historial ante reejecución. En `tomasini_dev`, las 12 tablas y las 77 filas previas conservaron todas sus columnas originales, verificadas antes y después de la migración.
- Chromium con cuentas ficticias, a 390 y 1440 px: alta por ambos roles, validación de enteros, persistencia de cero, detalle, revisión administrativa, filtros y descarga de ambos reportes. Los fixtures se retiraron de `tomasini_test`. La suite también verificó valores nulos anteriores, idempotencia y auditoría.
- Excel de escritorio abrió la descarga del navegador y la imprimió en una página Carta horizontal. Los cuatro viajes sumaron 1.665 km y 6 controles. Se cotejaron las columnas, montos sin datos, totales y ambas firmas con el PDF. Las pruebas del generador cubren cambio de mes en hora argentina, más de 24 viajes, folios separados y controles incompletos. Muestra y capturas en `output/qa/controles/`.

## Acoplados y kilometraje opcional — 4 de noviembre de 2026

Implementación verificada localmente y publicada el 04/11/2026. La evidencia productiva figura al final de esta sección.

- `npm run check`: tipos de ambos proyectos, 15 pruebas de dominio y compilación de producción aprobados. Las suites PostgreSQL se ejecutaron por separado.
- `npm run test:integration --workspace @tomasini/backend`: 56 pruebas aprobadas, ninguna omitida. Incluyen alta sin lectura y con cero, primera lectura concurrente, viajes/servicios sin lectura inicial, anulación, asignaciones concurrentes, patentes compartidas entre tipos, bajas/reactivación, permisos, CSRF, documentos y servicios de acoplados, solapamiento de viajes, idempotencia anterior/nueva y Excel.
- Correo comprobado con transporte simulado: alertas por fecha de camiones sin lectura y acoplados activos sin camión. Sin correo real ni participación de choferes reales.
- Migración `202611040001_trailers_optional_odometer` aplicada con comprobación de base y rol a `tomasini_test` y `tomasini_dev`, exclusivamente en el cluster local de puerto 55440. Comparación antes/después de todas las columnas originales: 11 tablas y 77 filas existentes conservadas exactamente; comprobante privado `.local/fleet-migration-verification.json`.
- `node --test scripts/test-infra.mjs scripts/test-migrations.mjs`: 4 pruebas aprobadas, incluidos rechazo de destinos ajenos y repetición de migraciones sin modificar el historial aplicado. `node scripts/db.mjs check` aprobó el aislamiento.
- Navegador Chromium con cuentas y unidades ficticias en `tomasini_test`: alta de camión sin kilómetros, alta y reasignación de acoplado, historial, servicio por fecha con registro inicial sin odómetro, carga posterior de kilometraje y primer viaje del chofer con acoplado. Fixtures retirados al finalizar.
- Capturas inspeccionadas de flota, formularios, historial, viajes y reportes; flota a 320, 390, 768 y 1440 px, sin desbordamiento horizontal. Sin errores JavaScript en el recorrido. Evidencia local en `output/qa/fleet/`, excluida de Git.

Publicación productiva completada a las 10:04 de Argentina mediante el procedimiento manual revisado de `docs/deployment.md`:

- Release `71f33333af6d35484139b0c706360e976b9f5208c89c4c83261642107db67bd1`, activo en `https://tomasini.72-60-50-213.sslip.io`. Migración `202611040001_trailers_optional_odometer` aplicada exclusivamente a `tomasini_prod` con rol migrador propio y revocación de LOGIN/contraseña al terminar.
- Tipos, 15 pruebas de dominio y compilación repetidos antes de empaquetar; 40 pruebas de infraestructura aprobadas, incluida la recuperación sin volver a código incompatible después de iniciar la migración.
- Pausa exclusiva de API y timer de correos de Tomasini para respaldar y migrar. El timer recuperó su estado activo. Configuración privada, HBA y unidad de servicio conservados.
- Comparación exacta de las columnas originales de 11 tablas y 38 filas antes/después de migrar, antes de reabrir escrituras. Los campos y relaciones nuevos no alteraron datos anteriores.
- Lectura real de camiones, acoplados, obligaciones y viajes mediante los DTO del backend nuevo con `tomasini_prod_app`, identidad de base/rol comprobada y modo de solo lectura verificado. Sin altas ficticias ni operaciones con choferes reales en producción.
- Readiness público 200, HTML/JavaScript/CSS idénticos al paquete publicado y acceso anónimo a camiones/acoplados rechazado con 401. Pantalla pública de ingreso inspeccionada a 390 y 1440 px, sin errores JavaScript ni desbordamiento horizontal. Los recorridos autenticados completos se verificaron con las cuentas ficticias locales descritas arriba.
- Mozzi y Horizontes conservaron PID, procesos hijos de PM2 y huellas de configuración Nginx; sus cuatro comprobaciones web/API respondieron 200. No se modificaron ni reiniciaron sus servicios ni PostgreSQL/Nginx compartidos.
- Respaldo productivo previo descargado con SHA-256 comprobado y restaurado en `tomasini_prod_restore_check`, exclusivamente en PostgreSQL local de puerto 55440. Los conteos de todas las tablas originales coincidieron; se retiró la base temporal y se detuvo únicamente el cluster local propio.
- Evidencia privada en `.local/deployments/71f33333af6d3548/`: recibo, plan, controles antes/después, `data-preservation.json`, `data-access.json`, respaldo, `restore-verification.json`, `public-verification.json` y `fleet-completion.json`. Capturas públicas en `output/qa/fleet-production/`, excluidas de Git.

Fecha: 2 de noviembre de 2026. Todos los datos utilizados en las pruebas de aplicación son ficticios y pertenecen a PostgreSQL local exclusivo de Tomasini.

## Comprobaciones automatizadas

- TypeScript estricto de frontend y backend, generación Prisma y compilación de producción.
- Siete pruebas de dominio: fecha argentina, límites por fecha/km, calendario y bisiestos, orden cronológico, viajes ya realizados, destinos SQL y contraseñas.
- Integración PostgreSQL separada: autenticación, CSRF, permisos y propiedad, idempotencia concurrente, revisión/versionado, correcciones/anulación, cronología y cambios de camión, mantenimiento/renovaciones, valores nulos, horarios nocturnos, exportación XLSX y revocación de sesiones.
- Correo probado con un transporte simulado: selección de pendientes, reintentos y deduplicación. Ningún correo real enviado.
- Infraestructura: rechazo de puertos ocupados, validación de migraciones y repetición sin modificar historial, extracción segura del release, HBA exclusivo, archivos preexistentes, cuotas y reversión.
- Respaldo y restauración reales en una base local temporal identificada: comparación de tablas y cantidades; no se restauró sobre datos existentes.
- Auditoría npm sin vulnerabilidades reportadas al finalizar la instalación de dependencias.

## Pruebas en navegador

- Acceso individual de chofer y administrador.
- Viaje con odómetro final incorrecto: error comprensible y conservación de todos los datos.
- Viaje corregido: confirmación visible, registro en historial y actualización del kilometraje.
- Cambio de camión desde la cuenta del chofer: actualiza la última lectura de referencia y mantiene vacías las lecturas a ingresar.
- Aviso al intentar abandonar una carga y conservación del borrador al elegir continuar.
- Protección del borrador al usar Atrás en el navegador; el diálogo permite continuar sin perder campos.
- Sesión ficticia vencida deliberadamente desde la base local: reingreso en diálogo, preservación del formulario y guardado posterior correcto.
- Renovación de seguro: pasó de vencido a vigente y quedó registrada en su historial.
- Descarga real de Excel desde los filtros de reportes.
- Reportes, flota y vencimientos comprobados a 320, 390, 768 y 1440 px, sin desbordamiento horizontal general.
- Inicio y formulario del chofer revisados visualmente. Se aumentó el tamaño y contraste de los textos secundarios después de la primera inspección.
- Medición DOM de los botones del formulario móvil: áreas táctiles mínimas de 48 × 48 px, incluidos accesos secundarios. Chofer y camión visibles en la carga móvil.

Las capturas locales de revisión se conservan bajo `output/qa/` y están excluidas de Git y del paquete productivo.

## Publicación y recuperación comprobadas

- Sitio HTTPS operativo: `https://tomasini.72-60-50-213.sslip.io`. Servicio `tomasini` y base `tomasini_prod` exclusivos. No se cargaron datos ficticios en producción.
- Release `3e2a233979d5a9dfc463b9581f0b291763fb6f499362a82913b293a7d8c72dbe`, publicado el 02/11/2026. Readiness público, HTML, JavaScript y CSS respondieron correctamente; la pantalla de acceso se revisó en el navegador sin errores de consola.
- Autenticación inicial administrativa comprobada: cookie Secure/HttpOnly/SameSite=Strict, bloqueo de operaciones hasta cambiar la contraseña, acceso anónimo rechazado, cierre y revocación de sesión correctos. La contraseña inicial permanece sin cambiar para que el titular complete ese paso.
- Mozzi web/API y Horizontes web/API respondieron 200 antes y después. Coincidieron los PID originales de Nginx, PostgreSQL, PM2/Mozzi y Horizontes, y las huellas de toda la configuración Nginx preexistente. Solo se añadieron recursos y reglas propios de Tomasini.
- Primer respaldo productivo descargado por SCP con huella verificada y restaurado realmente en una base local aislada. Se comprobaron tablas, administrador e historial de migraciones; se retiró únicamente esa base temporal.
- Evidencia privada en `.local/deployments/3e2a233979d5a9df/`: recibo, comprobaciones anteriores/posteriores, respaldo, `restore-verification.json` y `smoke-production.json`. Acceso inicial separado y protegido por ACL del usuario Windows.

El primer intento se detuvo antes de npm por la ruta de `runuser`; se corrigió y se retomó exclusivamente esa fase tras validar el estado. La entrega privada requirió una conexión aparte porque sudo no reutilizó la autenticación. Ambos casos quedaron documentados y el flujo futuro fue corregido; las once pruebas de infraestructura posteriores pasaron. No se reinicializaron bases ni aplicaciones existentes.

## Lo que estas pruebas no certifican

- La prueba de usabilidad de menos de tres minutos debe hacerse con los choferes reales; no se simula su participación.
- La entrega externa de correos necesita SMTP real configurado y una prueba de entrega. SMTP no garantiza entrega exactamente una vez ante una caída entre aceptación y confirmación en base de datos.
- Las copias en la VPS no cubren la pérdida completa de ese servidor. La copia externa requiere un destino operativo.
- La prueba funcional completa se realizó con datos ficticios locales. La aceptación con datos reales y la revisión visual del titular siguen pendientes.
