# Refinado de interfaz — 2 de noviembre de 2026

## Cambios

- Logo oficial convertido a WebP sin pérdida, conservando transparencia y retirando únicamente márgenes transparentes. Barra lateral: 104 × 79 px; cabecera móvil: 70 × 53 px. Acceso e invitación usan el lema «Tu carga, nuestro compromiso.».
- Se eliminaron subtítulos decorativos, resumen duplicado del formulario, pie y tarjetas anidadas. Una superficie principal por tarea, con divisores y listas paginadas.
- Escritorio adapta cantidad de filas al espacio disponible. Formularios extensos y detalle del viaje usan pasos o pestañas; el contenido no se recorta para simular que cabe.
- Controles de 48 px y campos de 16 px. Móvil conserva desplazamiento vertical y navegación inferior; pantallas con poca altura o zoom permiten flujo normal para mantener accesibilidad.
- Equipo → Invitar permite enlaces de chofer o administrador, vencimiento de 1–30 días y revocación. El destinatario elige usuario y contraseña en dos pasos. Cambiar de enlace reinicia el formulario.
- Invitaciones de un solo uso: token aleatorio persistido únicamente como hash, rol comprobado en servidor, consumo atómico y limitación de intentos. Un enlace puede vincular un chofer existente sin perder su historial.

## Verificación realizada

Navegador local con datos ficticios y PostgreSQL exclusivo:

- Todas las vistas principales de administración en 1280×720 y 1440×900: altura y ancho del documento dentro de la ventana, sin desplazamiento general.
- Inicio del chofer y formulario en 1366×768; formulario administrativo con todos los errores obligatorios en 1280×720. Pie y guardar visibles dentro del panel.
- Filtros del historial y modales de camión, invitación, programación de vencimiento y detalle del viaje. Detalle e historial sin desplazamiento interno en 1280×720.
- Móvil 390×844 y 320×568: inicio/cuenta sin desborde horizontal; alta por invitación verificada en 390×844.
- Viaje de prueba: recorrido reciente, kilometraje final inválido, corrección sin perder campos, guardado de 80 km, confirmación y aparición en historial. Revisión administrativa de otro viaje y evento de auditoría visibles.
- Invitación local inspeccionada en ambos pasos, sin crear cuenta por navegador. El enlace de prueba se revoca al finalizar.
- Consola del navegador sin errores ni advertencias en el recorrido final.
- TypeScript, compilación de producción y 10 pruebas unitarias aprobadas. Integración sobre PostgreSQL exclusivo: 11 casos previos y 9 de invitaciones; incluye permisos, expiración, revocación, aceptación concurrente y conservación de historial.

Evidencia local en `output/qa/refinement/` (ignorada por Git): capturas de administración, chofer y alta, y mediciones en `viewport-audit.json`. No contiene enlaces de invitación ni credenciales.

Esta auditoría técnica no reemplaza una prueba de uso con los choferes reales.
