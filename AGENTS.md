# Transporte Tomasini

- Implementar el alcance acordado: viajes, revisión, mantenimiento y documentación de camiones y choferes, alertas por correo y Excel. Interfaz clara azul oscuro y gris, mobile first y escritorio diseñado.
- Aislar código, bases, roles, procesos, puertos, certificados y datos de Tomasini. Nunca modificar ni reiniciar Mozzi o Horizontes. Los ajustes compartidos admitidos son exclusivamente reglas nuevas de Tomasini, con validación y recarga sin reinicios.
- No imprimir secretos. Archivos privados en .local/ o .env ignorados. Migraciones revisadas, con comprobación explícita de base/rol; no db push, reset ni migraciones al arrancar.
- API con sesiones PostgreSQL, autorización por rol/propiedad y protección CSRF. Viajes auditables e idempotentes; revisados solo corregibles por administración.
- Probar con PostgreSQL propio y aislado. Compilar y verificar tipos, pruebas funcionales y revisión visual de celular/escritorio antes de entregar. No simular verificaciones con choferes reales.
