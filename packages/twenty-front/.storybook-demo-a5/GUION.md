# Guion ejecutivo · Diez minutos

| Tiempo | Acción en pantalla | Qué decir |
| --- | --- | --- |
| 0:00–0:40 | Abre **Presentación → Inicio**. | «Este recorrido muestra cinco interfaces de nuestro CRM. Los nombres, conversaciones y Leads son ficticios. Hoy veremos el flujo de trabajo con datos en memoria». |
| 0:40–2:00 | Abre **Commercial Teams**. Señala el coordinador y los dos ejecutivos del equipo. Abre **Rename** y, si conviene, cambia el nombre de ejemplo. | «Así organizamos un equipo comercial y su coordinación. La membresía determina quién pertenece al equipo. El Role de cada persona se administra por separado». |
| 2:00–3:15 | Abre **Roles** y señala el nombre, la descripción y la sección de permisos. | «Este es el editor estándar de Twenty. El Role establece las capacidades que se pueden conceder por objeto y campo. Ahora veremos sobre qué registros puede ejercerlas cada perfil». |
| 3:15–5:00 | En **Record Access**, muestra el objeto Lead y compara los tres Roles de ejemplo. Si hay tiempo, señala Folio ISO como objeto con política propia. | «El Ejecutivo trabaja sobre sus registros. El Coordinador puede abarcar los propios y los de su equipo. El Supervisor tiene alcance sobre todos los registros configurados, sujeto a los permisos estándar de Twenty. Lead y Folio ISO tienen propietario y política independientes». |
| 5:00–7:00 | En **INCONNECT Messaging**, abre **Comercio Demo · Norte**. Muestra mensajes entrantes y salientes, el adjunto de ejemplo y el Lead vinculado. Pasa por **Favorites** y **Pending**. | «El ejecutivo revisa el historial de WhatsApp y el contexto comercial desde el CRM. Favorito y No leído son personales. Pendiente es compartido y en esta versión se cambia manualmente. El envío está deshabilitado en este recorrido». |
| 7:00–9:25 | En **INCONNECT Lead Management**, elige **Leads · Equipo Demo**. Pulsa **Consultar Leads** y **Seleccionar primeros 50 elegibles**. Elige **EVEN**, marca ambos ejecutivos y pulsa **Obtener vista previa**. | «La propuesta deja 25 Leads con cada ejecutivo. De los 50 seleccionados, 40 ya pueden conservar su dueño y sólo 10 requerirían un cambio. La pantalla muestra cero procesados y la confirmación está deshabilitada. Estamos viendo la propuesta calculada, sin transferencias». |
| 9:25–10:00 | Deja visible el resultado 25/25. | «Las cinco interfaces están desarrolladas y las hemos recorrido con datos ficticios. La validación operativa se acredita por separado. El distribuidor sigue aceptado en fuente, con instalación del Store y pruebas físicas pendientes. Telefonía y llamadas son una integración futura». |

## Estado para responder preguntas

| Módulo | Qué acredita esta presentación | Estado operativo |
| --- | --- | --- |
| Commercial Teams | Editor real de equipos, coordinador y ejecutivos con cambios locales. | Fuente implementada. Hay antecedentes de validación local. A5 no revalida un entorno ni acredita despliegue. |
| Roles | Editor estándar de Twenty con un Role de ejemplo. | Los permisos efectivos dependen de los Roles y la configuración de cada workspace. |
| Record Access | Configuración real de políticas por Role y objeto con Apollo en memoria. | Fuente implementada. La autorización efectiva y su aplicación en SQL, ORM y caché quedan fuera de la validación visual. |
| INCONNECT Messaging | Bandeja, conversación y contexto CRM reales con mensajes ficticios. | Mensajería base integrada en fuente. A5 mantiene envío y conexión en tiempo real deshabilitados. Attention R4 sigue aceptado en fuente con activación operativa pendiente. |
| INCONNECT Lead Management | Distribuidor real con cálculo EVEN y controles originales. | MVP **ACCEPTED SOURCE-ONLY**. Quedan pendientes la instalación autorizada del Store y la validación física de persistencia, transferencia, auditoría y autorización. |
| Telefonía y llamadas | Integración posterior, fuera del recorrido. | Requisito de backlog **REQ-TEL-001**. Diseño e implementación pendientes. |

[Estado canónico del proyecto](../../twenty-server/docs/INCONNECT_PROJECT_STATUS.md) · [Backlog de telefonía](../../twenty-server/docs/INCONNECT_PRODUCT_BACKLOG.md#req-tel-001--inconnect-telephony--softphone)

## Capturas de respaldo

- **Commercial Teams:** equipo abierto, con el coordinador y los dos ejecutivos visibles.
- **Roles:** editor del Role de ejemplo, con la sección de permisos visible.
- **Record Access:** políticas Lead de los tres Roles con sus alcances.
- **Messaging:** chat Norte abierto, con bandeja, historial y contexto CRM visibles.
- **Lead Management:** resultado EVEN con 25 por ejecutivo, 40 conservados, 10 cambios previstos y cero procesados. Mantén visible el aviso de datos ficticios.
