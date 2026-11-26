# INCONNECT Voice V2 — piloto de llamadas entrantes

Voice V2 está instalado y habilitado en DEV-LOCAL-R1. Se preservaron las 11
llamadas, 22 tramos y 372 segundos de Voice V1.4. El túnel, Nginx, Redis y
Twilio están configurados. La primera llamada real timbró, identificó el
Lead y estableció la conversación. El cierre de esa llamada se corrigió
en R1. [Estado operativo de Voice V2](INCONNECT_VOICE_V2_DEV_LOCAL_INSTALL.md)
[Estado del proyecto](INCONNECT_PROJECT_STATUS.md)

## Telefonía y datos

- El webhook POST `/auth/inconnect-voice/inbound` valida la firma Twilio con
  el formulario original y la URL pública exacta. Exige cuenta, destino,
  dirección y número de origen aprobados. F13 normaliza el identificador
  internacional antes de compararlo. Una llamada de un origen ajeno al
  piloto recibe Reject y queda fuera del historial del CRM. La firma
  autentica a Twilio y el formulario. El ANI del proveedor funciona como
  restricción del piloto, con las limitaciones de identificación de la red
  telefónica.
- La coincidencia exige un solo teléfono primario exacto entre los Leads
  activos, con límite 2 para detectar ambigüedad. El SQL sólo devuelve
  un Lead que siga siendo legible por el operador y cuyo propietario sea
  ese mismo miembro. La consulta reutiliza la metadata, permisos de Twenty y
  el facade de Record Access. La salida del clasificador interno de
  coincidencias es un conteo acotado. La reserva, la decisión, la entrega de
  identidad y la autorización previa al puente vuelven a exigir alcance y
  coincidencia. Un fallo de resolución se guarda como `failed`. Si el
  operador está offline o el Lead es ambiguo, desconocido, ajeno o inaccesible,
  se registra `no-answer` con `routing-denied`, sin asociación ni selección.
  Si la reserva encuentra otra llamada activa, registra `busy` con el vínculo
  autorizado. La distribución y creación comercial quedan fuera del piloto.
- Voice conserva el ID de llamada lógica y persiste dos tramos cuando se
  crea el tramo navegador. El SID del llamante es la raíz y el primer
  callback firmado válido fija el SID hijo. La llave única por cuenta y SID
  y el lock transaccional evitan dos llamadas lógicas. El replay del webhook
  inicial se cierra sin volver a instruir un Dial. Si la respuesta inicial
  se pierde después del commit, puede perderse esa oferta. El SID de la
  raíz y el resultado conservan trazabilidad.
- El índice parcial existente excluye entrantes y salientes del mismo
  miembro por workspace. El trámite entrante usa `Dial > Client` con
  `answerOnBridge=true`, 25 s de timbrado configurado, límite de 300 s
  de conversación y `record=do-not-record`. Twilio puede añadir margen al
  timeout de Dial. Accept y Decline se guardan antes de actuar en el SDK.
  La URL de screening de Client vuelve a comprobar la sesión, la decisión
  y el Lead antes de permitir el puente. El intento de puente sin aprobación
  recibe Hangup.
- `inbound-progress` recibe los callbacks de Dial, Client, screening y
  cierre del tramo raíz. Los callbacks quedan correlacionados por cuenta,
  workspace, llamada lógica y SID raíz/hijo, según su tipo. La respuesta
  final de Dial con `DialBridged=true` acredita el puente. Su
  `DialCallDuration` tiene prioridad. Si falta el action, la terminación
  confirmada del padre cierra el intento. Con screening y puente
  confirmado, un GET del tramo navegador vinculado puede aportar su
  duración como respaldo. Un Dial tardío puede completar o sustituir esa
  duración de respaldo. Un callback de Client por sí solo no libera una
  llamada: el evento terminal dispara una lectura del padre y la
  exclusión se conserva si sigue activo. Se conserva `declined` y se
  distingue `canceled`, `no-answer`, `busy` y `failed`. Un evento
  duplicado con el mismo resultado y duración deja la fila intacta.
- **Calls** usa la visibilidad del Lead actual y conserva el histórico
  vinculado. **Recents** aplica miembro, objeto, teléfono exacto vigente y
  número aprobado antes de paginar. Los registros sin actor ni Lead quedan
  en persistencia técnica, fuera de las vistas de operadores. La entrada
  entrante muestra su dirección y el origen. Redial permanece en salientes.

## Device y operador

`INCONNECT_VOICE_ENABLE_INBOUND` habilita sólo recepción. El
`INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID` es la concesión funcional
explícita de recepción para un único UserWorkspace del entorno piloto.
Se comprueban sesión Twenty actual, tipo humano, miembro activo, workspace
y ausencia de impersonación o restricción de aplicación. La concesión está
deshabilitada por defecto y no añade flags de Role. El permiso de marcación
y la selección de Outbound conservan su propia autoridad.

El operador abre **Phone → Receive calls** una vez para registrar el Device
global de esa sesión. El Device usa `incomingAllow` y una identidad Twilio
distinta por sesión. El navegador sólo comunica registro efectivo cuando el
SDK confirma `registered`. El backend mantiene una concesión Redis única
por operador, con reemplazo atómico, credencial Twenty cifrada, 35 s de
expiración y heartbeat normal de 10 s. La indisponibilidad de Redis impide
ofrecer llamadas. Se retira la concesión al detener la recepción y caduca si
se pierde la pestaña; una pestaña antigua no puede renovar ni revocar a la
nueva. Twilio realiza la entrega efectiva. El servicio vuelve a validar la
sesión Twenty y el Lead, incluso cuando el navegador ya informó registro.

Los eventos del SDK intentan reconectar y renovar el token, que dura
300 s. El Device permanece montado durante la navegación. Si el mismo
operador tiene ambos permisos, las intenciones Outbound nuevas pueden
autorizar esa misma identidad registrada. La recepción no solicita acceso
al micrófono al abrir Twenty, sino al aceptar o al usar el control de Audio
por decisión explícita. Twilio usa el timbre del SDK cuando lo permite
el navegador. La interfaz expande el softphone sólo después de autorizar
la identidad del Lead, admite cancelación remota y muestra el cronómetro
cuando ya coinciden la apertura del medio en navegador y la autorización
del puente. La duración final procede de Twilio. La autorización previa al puente y la
apertura del medio no aportan un timestamp del puente con precisión de
proveedor durante la llamada.

[Device y registro](https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice) ·
[TwiML Client](https://www.twilio.com/docs/voice/twiml/client) ·
[TwiML Dial](https://www.twilio.com/docs/voice/twiml/dial) ·
[Firma de webhooks](https://www.twilio.com/docs/usage/security#validating-requests)

### R1 · cierre de la primera llamada real

El 26 de noviembre de 2026, la llamada de las 16:25 de Ciudad de México
quedó enlazada al Lead y autorizada para el puente. El SID raíz termina
en `ecea83e9` y el del navegador en `75ca0a6b`. Twilio confirmó ambos
tramos completados. El evento terminal de Client recibió HTTP 200. El
action de Dial (`completed`, `DialBridged=true`, `DialCallDuration=16`)
y el callback terminal del padre recibieron HTTP 503. PostgreSQL
rechazó la sentencia de cierre porque el `CASE` infería el parámetro de
duración como texto al asignarlo a una columna `integer`. La fila
conservó `answered` y el índice de exclusión vigente bloqueó el resto.

La conciliación aplicó el cierre a esa fila tras releer ambos tramos
terminales y el action autenticado. El resultado quedó en `answered`
con 16 segundos y se preservaron los intentos Busy. Los 17 segundos del
tramo navegador y los 18 del tramo raíz son métricas distintas de la
duración de Dial. La recuperación utilizó el mismo store que los
callbacks. No se modificó el esquema ni la configuración de Twilio.

El 409 de una saliente previo a `Device.connect` podía destruir el
Device registrado en el navegador. R1 conserva el registro ante un
rechazo de reserva que todavía no abrió una llamada SDK. Los eventos
`disconnect`, `cancel` y `reject` liberan la llamada local y mantienen el
Device sano. El SDK estaba configurado para omitir logs detallados en la
primera prueba, por lo que no se atribuye esa desconexión histórica a un
evento concreto del navegador. Calls y Recents muestran **Incoming call
answered** para las entrantes atendidas.

R1 quedó aplicado en DEV-LOCAL-R1 con las dos direcciones activas. Su
despliegue dejó 20 llamadas, 32 tramos, 388 segundos y cero activas, con
los cuatro Busy preservados y el índice de exclusión válido.

### Cierre funcional y visual del 26 de noviembre de 2026

El operador confirmó llamadas entrantes y salientes consecutivas,
aceptación, rechazo, cancelación y finalización sin que se repitiera el
bloqueo. El preflight de cierre, en solo lectura sobre DEV-LOCAL-R1,
confirmó los siete intentos siguientes con estado `finished` y dos
tramos correlacionados en cada uno. Las horas son de Ciudad de México.

| Hora | Dirección | Resultado persistido | Duración |
| --- | --- | --- | --- |
| 16:57:44 | Entrante | `answered` | 21 s |
| 17:00:09 | Saliente | `answered` | 8 s |
| 17:00:44 | Entrante | `answered` | 12 s |
| 17:01:14 | Saliente | `answered` | 10 s |
| 17:01:45 | Entrante | `answered` | 4 s |
| 17:02:14 | Entrante | `declined` | — |
| 17:02:29 | Entrante | `no-answer` | — |

El intento que el operador canceló antes de contestar quedó en el
historial como `no-answer`, sin duración. El total quedó en **27 llamadas,
46 tramos, 443 segundos y cero activas**. Inbound y Outbound conservaron
sus flags persistentes.

El softphone muestra **Decline** a la izquierda con un círculo rojo y
**Accept** a la derecha con uno verde. Conserva sus etiquetas y distingue
la llamada entrante con un icono. El número se formatea solo al mostrarlo.
En el cierre atendido muestra **Call completed**, el cronómetro
**Connected time** y los accesos a **Keypad** y **Recents**. Audio se
oculta en el estado terminal. El regreso a Phone conserva el Device
registrado. Las futuras acciones Hold y Transfer quedan fuera de este
cambio.

Pasaron 15 pruebas focalizadas del proveedor de Voice, typecheck, lint y
formato. La vista previa offline en Chrome comprobó los dos estados,
los temas claro y oscuro, un viewport de 320 × 240 y escala de 150 %.
El Vite de DEV-LOCAL-R1 sirve los componentes nuevos.

## Upgrade y exposición en DEV-LOCAL-R1

El [procedimiento dedicado de instalación de Voice V2](INCONNECT_VOICE_V2_DEV_LOCAL_INSTALL.md)
registra el preflight, el comando exacto, la configuración de red y los
pasos para la primera llamada.

El [Slow de instancia 1795694400000](../src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795694400000-add-inconnect-voice-inbound.ts)
modifica en sitio las tablas de llamadas y tramos. Conserva el índice activo
y los registros, referencias y timestamps de V1.4. Añade la dirección, el
resultado de rechazo, datos de decisión y los tipos de tramo entrante. No
requiere Workspace Command, cambios de Role, cambios de Lead ni codegen.
El `down` restaura las restricciones originales y se rechaza mientras
exista historial entrante.

Reutilizar el [procedimiento dedicado de Voice V1.4](INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md#alcance-exacto)
para identidad de DEV-LOCAL-R1, preflight, respaldo del snapshot, cero
llamadas activas, build recuperable, preservación de datos y tracking en
la transacción. El ejecutable V1.4 está limitado a V1.4. La selección y
ejecución física de este nuevo Slow requiere una ventana dedicada
autorizada, con confirmación exacta de runner, cursor y comando. No
ejecutar la cadena de upgrades sin delimitar el paso. Confirmar las
huellas de las filas V1.4 y el índice único después del upgrade. Conservar
el build anterior para recuperación con Inbound apagado; conservar el
historial aunque se revierta la aplicación. PHYS-A0 sigue NO-GO.

El [snippet de Nginx](INCONNECT_VOICE_V2_NGINX.conf) añade las dos ubicaciones
exactas de Voice Inbound al servidor dedicado. El mismo Quick Tunnel publica
ese servidor, incluidas las rutas de Outbound existentes. Las ubicaciones
aceptan POST y conservan la URI original, el query, el encabezado
`X-Twilio-Signature` y el formulario. Las rutas de sesión, disponibilidad e
historial permanecen en el origen autenticado de Twenty. Mantener los
cuerpos, firmas, queries de correlación y números fuera de logs públicos.

## Configuración Twilio y primera llamada real

1. Autorizar e instalar el esquema exacto en DEV-LOCAL-R1. Verificar el build
   de backend y el frontend dedicado, con ambas direcciones temporalmente
   deshabilitadas durante el mantenimiento. Restablecer el estado persistente
   de salida aprobado tras el mantenimiento, con su destino intacto.
2. Conservar credenciales y TwiML App de desarrollo en el backend. En el
   archivo privado de la API configurar también
   `INCONNECT_VOICE_INBOUND_URL=https://<host-dev>/auth/inconnect-voice/inbound`,
   `INCONNECT_VOICE_INBOUND_NUMBER=<receptor-E.164>`,
   `INCONNECT_VOICE_INBOUND_TEST_SOURCE=<origen-E.164>` e
   `INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID=<UserWorkspace-del-operador>`.
   El receptor autorizado tiene Voice y es el mismo Caller ID contratado de
   Twenty DEV. El origen debe estar aprobado, ser distinto del receptor y
   coincidir exactamente con un Lead visible del propio operador. Conservar
   estas variables durante una desactivación para permitir callbacks
   pendientes y lectura del histórico.
3. En **Twilio Console → Phone Numbers → Active Numbers**, seleccionar
   únicamente el receptor dedicado de la misma cuenta configurada en Nest.
   En **Voice Configuration → A call comes in** elegir Webhook, URL
   `https://<host-dev>/auth/inconnect-voice/inbound`, HTTP POST. En **Call
   status changes** elegir
   `https://<host-dev>/auth/inconnect-voice/inbound-progress`, HTTP POST.
   Los callbacks del tramo navegador y el screening se generan en TwiML.
   Conservar el destino y la TwiML App de salida y dejar vacío el fallback
   hacia cualquier operación comercial. Verificar que la ACL Redis de la
   API admite el prefijo `inconnectVoice:inbound:` y GET, SET, DEL y EVAL.
4. Tras aprobar la exposición exacta y la ruta en Twilio, arrancar
   DEV-LOCAL-R1 con `INCONNECT_VOICE_ENABLE_INBOUND=true`. En navegador entrar
   como el operador, abrir **Phone → Receive calls** y comprobar el indicador
   de registro. Hacer una llamada manual desde el origen de prueba al número
   dedicado. Aceptar, comprobar audio en ambos sentidos, navegar durante
   la llamada y colgar. Revisar Calls y Recents, duración y dirección.
   Repetir manualmente para Decline, cancelación remota y timeout. Durante
   una llamada activa, verificar que una segunda pestaña no puede iniciar
   una saliente. Salir o detener recepción y confirmar que el piloto queda
   indisponible. Cada llamada de comprobación la realiza el usuario.

[Configurar un número Voice](https://help.twilio.com/articles/223135027-Configuring-phone-numbers-to-receive-voice-calls) ·
[Callbacks de Voice](https://www.twilio.com/docs/usage/webhooks/voice-webhooks)

## Validación de fuente

Pasaron 54 pruebas de backend y 40 de frontend, incluido el alcance
focalizado de V1.4. Se usaron dobles de PostgreSQL, Redis, Twilio y el
Device. Pasaron el typecheck y lint acotados de servidor y frontend,
formato y comprobaciones de enlaces y whitespace. Jest de frontend
registró dos avisos de React sobre `act(...)` en la suite del provider.
La evidencia por comando y el inventario quedan en
`.cache/inconnect-voice-v2/`.

Quedan por comprobar el DDL en el destino dedicado, los contratos de los
callbacks observados en Twilio, el timbre y audio bidireccional en el
navegador, el tiempo y cierre real, y la conciliación con el historial
persistido de DEV-LOCAL-R1.

## V2.1, V3 y V3.1

V2.1 mantiene al propietario disponible como primera opción. Si está
ocupado, se ofrecerá por Round Robin a ejecutivos disponibles de su Commercial
Team. Con origen sin coincidencia, se usará Round Robin general entre agentes
elegibles. El cursor de telefonía será independiente del de asignación
comercial. Offline, coincidencias múltiples, rechazo, timeout y ausencia de
agentes requieren decisión explícita antes de activar la distribución.
Los errores de resolución siguen siendo fallos de autoridad.

Para V3, Twilio Conference permite Hold por participante y conservar al
llamante durante la incorporación, consulta, fallo o retiro de un agente.
El piloto usa Client directo y deja la topología como decisión del adaptador
Twilio. En V3 deberán modelarse la conferencia, los intentos de transferencia
y el historial de participantes, relajando la unicidad por clase de tramo
sólo para los nuevos flujos. La llamada lógica, autorización, sesión,
histórico e integración del softphone se pueden conservar.

V3.1 requiere grabación entrante y saliente, SID de grabación vinculado a la
llamada lógica, callback de disponibilidad, reproducción y descarga
autorizadas. Twilio ofrece callbacks de grabación por Dial y Conference. Se
decidirán el consentimiento y aviso, el modelo de retención y acceso, y los
costos antes de activar las grabaciones de la operación. Voice V2 mantiene
`do-not-record`.

[Conference](https://www.twilio.com/docs/voice/twiml/conference) ·
[Participantes de Conference](https://www.twilio.com/docs/voice/api/conference-participant-resource)
