# Verificación de la primera versión

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
