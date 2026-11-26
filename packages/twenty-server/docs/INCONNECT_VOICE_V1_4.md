# INCONNECT Voice V1.4 — Phone y Recents

**Instalado en DEV-LOCAL-R1 el 25 de noviembre de 2026.** Las comprobaciones
con la sesión autenticada del operador confirmaron Phone Access, lookup,
Calls y Recents con salida deshabilitada. La URL del Quick Tunnel está
sincronizada en Nest y en la TwiML App. Twenty verificó el único miembro
de `Voice Pilot — DEV`, sus dos grants independientes y una regla Lead
`ownRecords`. La ventana real registró una llamada vinculada por
Click-to-Call, contestada con 30 s. El operador confirmó en navegador
que Phone abre el marcador global desde la barra lateral y que Keypad y
Recents están disponibles. Este refinamiento se sirve en el Vite dedicado.
La validación posterior registró una llamada vinculada de 42 s desde
el marcador global y una llamada sin Lead de 18 s desde Voice Test.
El cierre verificó Recents del piloto y la persistencia con los dos
identificadores CRM nulos. La remarcación desde Recents quedó registrada
con 8 s, dos tramos correlacionados y asociación al Lead original. Se
confirmó su visibilidad en Calls y Recents. **Voice V1.4 queda funcionalmente
validado en DEV-LOCAL-R1.** El modo persistente sigue habilitado para el
administrador original. [Evidencia del cierre](INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md#resultado-del-cierre-del-26-de-noviembre-de-2026)

## Flujo

- **Phone** vive en la navegación principal. Abre el proveedor de softphone
  existente y expande la llamada activa, con su identidad original, si ya
  existe. Click-to-call conserva el recorrido de Leads.
- **Keypad** admite teclado visual y edición o pegado. Tras 500 ms sin
  cambios y con formato válido, usa el lookup de Voice para la coincidencia
  exacta autorizada. El marcador deja al menos un segundo entre solicitudes
  para respetar el límite vigente. Se preselecciona un único resultado
  visible. Varias coincidencias requieren selección y conservan la
  paginación. Los fallos muestran un reintento. Un cambio de destino o el
  cierre cancela la búsqueda y descarta resultados obsoletos. Los números
  nacionales se validan con el valor predeterminado del piloto, `MX`.
  El backend recibe el texto original. Se descarta la respuesta si el
  destino devuelto difiere de la identidad calculada por el marcador.
- **Place call** exige confirmación después de resolver el número. El teclado
  cambia a DTMF cuando hay evidencia de conexión del destino y el SDK está
  abierto. Audio, mute, cronómetro, cierre y minimización usan los controles
  V1.3. Volver al marcador limpia número y selección.
- **Recents** pagina por fecha e ID, 20 intentos por página. Agrupa la
  presentación por fecha según idioma y zona horaria, con una fila por
  intento. **Redial** precarga el destino, mueve el foco al número y
  ejecuta una búsqueda nueva. **Place call** sigue siendo la confirmación.
- **Keypad** y **Recents** usan un selector segmentado accesible por
  teclado. El encabezado, las pestañas y los controles inferiores quedan
  fuera de la región de scroll del marcador. Con Outbound deshabilitado
  se conservan la entrada, la búsqueda, Audio y el historial, con el botón
  de llamada visible e inactivo.

## Validación del refinamiento

La recuperación del 26 de noviembre conservó el marcador con búsqueda
automática, las pestañas y el historial agrupado. Se corrigió el nombre
accesible de Redial para que incluya el número mostrado. De las nueve
pruebas focalizadas del 25 se reutilizó la evidencia de siete y se
ejecutaron nuevamente las dos que cubren Recents y Redial. El typecheck,
lint y formato del archivo corregido pasaron.

La vista previa interactiva de Chrome verificó los temas claro y oscuro,
la paginación, Audio, Redial sin llamada, el viewport de 320 × 240 y un
viewport equivalente a zoom de 150 %. Se abrió también como archivo
sin conexión. Se conservan la vista previa y las capturas en
`.cache/inconnect-voice-v1.4/sync-pilot/recovery-2026-11-26/`.
En el Vite dedicado se verificaron los módulos actuales. El lookup
autenticado devolvió una coincidencia autorizada y mantuvo la marcación
bloqueada. El operador aprobó el refinamiento tras comprobar en Twenty
las pestañas, la coincidencia automática, el historial por fecha y la
configuración de audio sin perder el número. La llamada manual inicial
quedó en Calls y Recents. La comprobación inicial de Redial cubrió la
precarga y la búsqueda. La llamada real se verificó posteriormente en
modo persistente. [Evidencia operativa](INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md#resultado-del-cierre-del-26-de-noviembre-de-2026)

## Autoridad y destinos

Se conserva el perímetro piloto de Voice para el workspace y operador
configurados. Cada solicitud toma la sesión de la autenticación Twenty y
las operaciones nuevas comprueban el miembro activo. Para consultar o
asociar Leads, el directorio usa el objeto y el campo Phones configurados
en Voice, permisos vigentes de objeto/campo y el facade de Record Access.
El SQL consulta el teléfono primario con coincidencia completa y limita el
resultado dentro del alcance. Reconoce la representación estructurada de
Twenty, E.164 y las variantes mexicanas `+52` y `+521`. Las discrepancias
entre códigos de país y de llamada quedan fuera del directorio.

`DIAL_INCONNECT_VOICE` permite marcar sin asociación cuando el conjunto
autorizado está vacío. Esa decisión es idéntica si hay un Lead restringido
o si el CRM carece del número. Un resultado visible obliga a una asociación
autorizada. Un fallo de resolución impide emitir la intención. La condición
del directorio forma parte del SQL de la reserva y del claim, para impedir
que una selección obsoleta o un Lead ahora visible omitan la asociación.
`READ_UNLINKED_INCONNECT_VOICE_HISTORY` autoriza por separado las llamadas
propias sin Lead. Ambos grants son explícitos incluso con **All Actions
Access** o permisos administrativos. El acceso a Phone conserva el
perímetro de Voice independiente de esos grants.

Recents aplica el workspace y miembro autenticados y la visibilidad CRM
vigente en SQL antes de paginar. Para exponer un número histórico vinculado
se exige que siga coincidiendo con el teléfono visible actual y con el
destino configurado del piloto. Cuando el teléfono del Lead cambió durante
el piloto, sus nueve entradas desaparecieron de Recents y siguieron en
**Calls**. Volvieron a Recents al restaurar la coincidencia exacta. La
llamada sin Lead conservó ambos identificadores CRM nulos tras restaurar
el teléfono. La pérdida
de acceso al Lead o al campo telefónico oculta la entrada vinculada de
Recents. Los registros sin Lead tienen su propia visibilidad y pueden
leerse aunque la lectura de Lead haya sido denegada. Las mutaciones de
asociación posterior y creación de Leads quedan para un flujo futuro.
El control de progreso de un intento sin Lead exige su ID opaco, el
mismo actor y el grant de marcación. Su ventana termina ocho minutos
después de la expiración de la intención.

El backend usa `normalizePhoneIdentity` de F13 con
`INCONNECT_VOICE_DEFAULT_COUNTRY` explícito, por defecto `MX`. La
identidad canónica y el destino de Twilio coinciden en E.164 para este
proveedor. Se exige que el país esté en
`INCONNECT_VOICE_MANUAL_ALLOWED_COUNTRIES` (por defecto `MX`), que el
tipo sea fijo/móvil y que el destino sea exactamente el único
`INCONNECT_VOICE_ALLOWED_DESTINATION` aprobado. El backend rechaza
entradas inválidas, extensiones, USSD, emergencias y numeración de tarifa
especial. Un país configurado por sí solo no amplía destinos.

Redis limita el lookup a uno por segundo y la emisión manual a una cada
diez segundos por identidad piloto. Reutiliza el espacio de claves de
Voice y las capacidades `SET NX EX`, `GET`, `DEL` y `EVAL` ya
previstas. El SDK recibe un token nuevo e inicia solo con un ID opaco.
La intención cifrada de 45 s liga el destino, miembro, selección y
credencial. El callback firmado consume la intención una vez y comprueba
otra vez autorización, destino y exclusión antes de producir TwiML.

## Persistencia y upgrade

Las llamadas siguen en `core.inconnectVoiceCall` y
`core.inconnectVoiceCallLeg`. Se conservan el índice único parcial que
excluye llamadas concurrentes por workspace y miembro, auditoría de
intentos, integración de tramos, callbacks y reconciliación de V1.2.
El historial previo conserva sus referencias y tiempos. Para una
marcación libre, `objectMetadataId` y `recordId` son ambos NULL.

El comando
`2.32.0_AddInconnectVoiceManualDialSlowInstanceCommand_1795608000000`
es Slow por posición. El cursor documentado de DEV-LOCAL-R1 ya pasó
todos los Fast de 2.32. La fase de datos es vacía y el runner nativo
ejecuta `up` y tracking en una misma transacción. El DDL cambia la
nulabilidad, añade el check del par y el índice de historial por actor.
El mismo `up` incorpora las definiciones estándar de permisos a
workspaces existentes con aplicación estándar. Después de confirmar
el DDL y su tracking, el Workspace Command `1795608000001` refresca y
verifica solo el mapa de definiciones de permisos. Concesiones y registros
CRM quedan fuera de este upgrade. [Comando de instancia](../src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795608000000-add-inconnect-voice-manual-dial.ts) · [Comando de workspace](../src/database/commands/upgrade-version-command/2-32/2-32-workspace-command-1795608000001-refresh-voice-permission-flags.command.ts)

### Instalación en DEV-LOCAL-R1

El procedimiento de DEV-LOCAL-R1 conserva el preflight, respaldo, DDL,
refresco, build, reinicio y verificaciones reales, además de la
recuperación y preparación del piloto.
[Resultado e instalación exclusiva](INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md)

### Validación en navegador posterior

1. Con salida deshabilitada, abrir **Phone** desde una pantalla ajena a
   Leads, probar teclado, edición, pegado, limpieza, Audio y Recents.
   Confirmar que abrir Phone y remarcar desde Recents no emiten una
   intención. Comprobar las denegaciones con un actor de prueba autorizado.
2. Para una ventana de llamadas expresamente aprobada, confirmar operador,
   destino anterior y configuración. Si ese destino coincide con un Lead
   visible para el operador, se usa la ruta vinculada. Para acreditar la
   ruta sin Lead hace falta el destino previamente autorizado y cero
   coincidencias visibles en un escenario aprobado. No se cambian Leads de
   prueba para fabricar ese escenario.
3. Verificar click-to-call, marcación global, espera, cronómetro efectivo,
   navegación, segunda pestaña concurrente, DTMF con confirmación remota
   cuando exista un destino apto, audio y colgado. Confirmar resultado,
   duración y tramos. Revisar Recents y Calls, incluyendo remarcación con
   nueva intención. Cerrar la ventana con Outbound deshabilitado.

## Evidencia de fuente

Jest focalizado cubre el backend REST y SQL con dobles de PostgreSQL,
Redis y Twilio y el frontend con SDK simulado. Las regresiones incluyen
click-to-call, exclusión, vínculo, visibilidad, replay, la llamada activa,
DTMF y audio. Pasaron 60 pruebas de servidor y 34 de frontend. El typecheck
y lint acotados pasaron en servidor, frontend y shared. Se generó el enum GraphQL desde la definición de servidor
con codegen local. El diff generado contiene únicamente los dos flags.
El inventario local de fuente y los resultados por comando quedan en
`.cache/inconnect-voice-v1.4/`.

La recepción remota de DTMF y la compatibilidad con hardware y
navegadores fuera del piloto siguen pendientes. Que aparezca el teclado
DTMF durante una llamada acredita el control en Twenty. Falta
observar que el extremo receptor interprete los tonos. `answered` acredita
la conexión del tramo destino. La detección de persona o buzón requiere
la capacidad AMD, prevista para otra fase. Se mantienen los casos de
proveedor pendientes de V1.2 y las restricciones a un operador, un destino
y DEV-LOCAL-R1. Producción requiere autorización específica. PHYS-A0 sigue
NO-GO. PG0/PG1, Stage C5 y exact-upgrade operativo siguen bloqueados. El roadmap sigue en
[REQ-TEL-001](INCONNECT_PRODUCT_BACKLOG.md#req-tel-001--inconnect-telephony--softphone).
