# INCONNECT Voice V0 en DEV-LOCAL-R1

**Estado al 24 de noviembre de 2026.** La salida desde un Lead quedó validada
de extremo a extremo en DEV-LOCAL-R1 con una llamada estable y audio
bidireccional. Voice quedó en `DISABLED` al cerrar el piloto. El alcance se
limita al desarrollo y al único destino aprobado. Producción sigue sin
autorización. [Estado canónico](INCONNECT_PROJECT_STATUS.md#checkpoint-del-24-de-noviembre-de-2026)

El botón Llamar comprueba disponibilidad en el backend. El primer intento explícito requiere una sesión humana permitida, autorización vigente sobre el Lead y su campo Phone, y coincidencia con el destino de prueba aprobado. El backend emite un Access Token de 300 segundos y una intención de 45 segundos. El SDK envía sólo el identificador opaco de la intención. El callback verifica la firma, consume la intención y vuelve a validar la sesión y el Phone antes de devolver TwiML. La llamada permite hasta 300 segundos y usa `do-not-record`.

## Voice V1.1 — softphone global

**Voice V1.1 quedó validado funcionalmente en DEV-LOCAL-R1 el 24 de noviembre
de 2026.** El operador completó dos llamadas salientes reales al destino
autorizado durante una ventana supervisada R9. Voice volvió a `DISABLED`
al cerrar la ventana.

**Llamar** en el Lead abre un panel flotante en la esquina inferior derecha.
**Place call** confirma la marcación. El panel conserva el Lead de origen al
navegar por el CRM y muestra su etiqueta de texto y teléfono cuando la lectura
actual del CRM los autoriza. Minimizarlo mantiene visibles el estado, el
cronómetro y los controles de silencio y colgado.

- El layout principal mantiene un dispositivo Twilio por sesión de usuario,
  miembro y workspace en la pestaña. Cada marcación solicita una intención de
  un uso y un token nuevos por el flujo de V0. El dispositivo reutilizable
  recibe el token antes de marcar. Evitar renovarlo en plena llamada reduce el
  riesgo de un corte breve de audio. [Twilio Device](https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice#deviceupdatetokentoken)
- **Browser connected to Twilio** y **Browser time** corresponden a la
  conexión de audio del navegador. El cronómetro empieza con la evidencia
  del SDK, conserva la referencia temporal durante una reconexión y se
  detiene al terminar. **Ringing** aparece cuando el SDK reporta ese estado.
  El flujo V0 no acredita la respuesta del destino. La duración y el
  resultado telefónicos quedan para V1.2. [Twilio Call](https://www.twilio.com/docs/voice/sdks/javascript/twiliocall)
- El cambio local de sesión limpia el panel y termina la llamada. Mientras
  el panel está abierto, se comprueban la disponibilidad de Voice y la
  lectura autorizada del Lead original sin usar la caché. Cada comprobación
  se repite 15 segundos después de la respuesta anterior y tiene un plazo de
  15 segundos. Una comprobación fallida durante la llamada quita los datos
  y termina la sesión del SDK. Una revocación remota se detecta mediante
  estas consultas del navegador.
- El bloqueo de marcación simultánea es local a la pestaña. Una exclusión
  entre pestañas o dispositivos requiere autoridad de backend. Recargar o
  cerrar la pestaña termina el ciclo de vida local.

### Evidencia funcional del 24 de noviembre de 2026

| Llamada | Resultado confirmado por el operador |
| --- | --- |
| Primera | Audio bidireccional. Panel flotante minimizado y expandido, navegación entre Leads y Messaging sin interrupción, Lead de origen conservado, cronómetro continuo, silencio y reactivación, y colgado desde otra pantalla. |
| Segunda | Nueva llamada con estado limpio y audio bidireccional. |

El operador reportó ambas llamadas exitosas y ninguna falla durante el
recorrido. Antes de abrir la ventana, se comprobó la vigencia del túnel R9 y
que Vite servía seis módulos de V1.1 con fuentes idénticas al checkout.
El observador autenticado confirmó HTTP 200 `ready` a las **12:52:50** y
HTTP 200 `disabled` a las **12:56:39** (Ciudad de México). El único servicio
reiniciado fue NestJS. El proceso restaurado quedó saludable con
`INCONNECT_VOICE_ENABLE_OUTBOUND=false` y el valor persistente de `app.env`
quedó intacto. El registro de las dos llamadas procede del operador y el
estado de la ventana procede del observador y de la comprobación de Nest.

**Voice V1.2 instalado en DEV-LOCAL-R1.** El piloto del 24 de noviembre
confirmó tres llamadas conectadas y sus 80 segundos en el historial del Lead.
[Voice V1.2, DDL y validación](INCONNECT_VOICE_V1_2.md)

### Prueba manual de Voice V1.1

Usar DEV-LOCAL-R1 con el frontend V1.1, el operador y destino ya aprobados y
una ventana de salida expresamente autorizada según el procedimiento vigente.

1. Abrir el Lead con el teléfono aprobado. Pulsar **Llamar**, revisar el nombre
   y número en el panel y pulsar **Place call**. Conceder acceso al micrófono si
   el navegador lo solicita.
2. Contestar en el teléfono de prueba y confirmar que ambos extremos se oyen.
   Comprobar el estado del SDK y que **Browser time** avanza.
3. Minimizar el panel. Ir a la lista de Leads, abrir otro Lead y pulsar
   **Llamar** en éste para expandir el panel. Verificar que sigue mostrando
   el Lead original, que el tiempo sigue avanzando y que continúa el audio.
4. Navegar a Messaging u otra pantalla disponible. Desde el panel minimizado,
   pulsar **Mute** y confirmar que el teléfono de prueba deja de oír al
   ejecutivo. Pulsar **Unmute** y confirmar que vuelve a oírlo.
5. Expandir el panel y pulsar **Hang up** desde esa pantalla. Comprobar que
   termina el audio en ambos extremos y que el cronómetro queda detenido.
6. Volver al Lead con el destino aprobado y marcar de nuevo. Confirmar que
   el nuevo intento inicia con el micrófono activo y su propio cronómetro.
   Colgar y cerrar la ventana autorizada del piloto.

## Evidencia de Voice V0

Las llamadas se realizaron manualmente el 24 de noviembre de 2026 desde el
softphone del Lead en DEV-LOCAL-R1. Twilio registró las siguientes duraciones
por tramo.

| Llamada | Navegador → Twilio | Twilio → celular | Resultado observado |
| --- | ---: | ---: | --- |
| Primera | 14 s · `completed` | 4 s · `completed` | El operador contestó y reportó una desconexión temprana. |
| Segunda | 55 s · `completed` | 47 s · `completed` | El operador contestó, confirmó audio en ambos sentidos y no observó desconexión prematura. |

La segunda llamada terminó a las **11:46:37** en Ciudad de México. A las
**11:47:06**, el observador confirmó HTTP 200 con `disabled` tras la reversión
de Nest. En ambas ventanas R9 habilitó temporalmente el entorno del proceso y
mantuvo `INCONNECT_VOICE_ENABLE_OUTBOUND=false` en `app.env`. El supervisor
revirtió al cierre del operador, al vencimiento de la ventana de 10 minutos o
al perder la señal del observador. La salida se limitó al operador y al
destino configurados en R7. El TwiML fijó `timeLimit=300` y `record=do-not-record`.

R9 conserva la evidencia privada en `first-real-call.json` y
`second-real-call.json` bajo el directorio dedicado de DEV-LOCAL-R1. Los
registros documentan los dos tramos, sus tiempos y el cierre autenticado,
sin guardar números, credenciales, tokens ni audio.

### Correcciones durante el piloto

- **Lectura de Phone.** La selección del campo compuesto ahora incluye el
  número principal, el código de país y el prefijo. Common Find One aplica
  los permisos de objeto y campo y Record Access a la lectura del Lead.
  Voice normaliza el número y lo compara con el único destino aprobado.
- **ACL de Redis dedicado.** Redis rechazaba el almacenamiento de la
  intención con `NOPERM`. El usuario de Nest recibió un selector persistido
  para `inconnectVoice:intent:*` limitado a `SET`, `GET`, `DEL` y `EVAL`.
  La emisión almacena la intención cifrada con `SET ... EX 45 NX`. El Lua
  del callback la recupera y elimina de forma atómica. La comprobación
  focal con un valor sintético acreditó un único consumo.
- **Diagnósticos del softphone y del backend.** El navegador verifica el
  acceso al micrófono antes de pedir la intención, limita la espera en cada
  etapa y muestra la etapa y el código disponible si falla. El endpoint
  conserva el error público genérico y Nest registra sólo la etapa y una
  causa segura de la emisión fallida.

## Operador en la consola de Twilio

1. Elegir la cuenta o subcuenta que se usará para Voice. Obtener su Account SID y crear una API Key para firmar Access Tokens de Voice en esa cuenta. Guardar el secreto y el Auth Token de la cuenta en el almacén privado local. El Auth Token sirve para validar la firma de las solicitudes del proveedor.
2. Preparar una TwiML App de salida. Su `VoiceUrl` debe ser la URL HTTPS exacta que termine en `/auth/inconnect-voice/twiml`, sin query string, con método `POST`. Configurar esa URL una vez autorizada y disponible la exposición de este endpoint.
3. Confirmar un caller ID autorizado en la cuenta y el número de destino de prueba. Revisar las restricciones del plan, los permisos geográficos de Voice para ese destino y, en cuentas de prueba, los requisitos de números verificados.

[Access Tokens y VoiceGrant](https://www.twilio.com/docs/iam/access-tokens#voice) · [Firma de webhooks](https://www.twilio.com/docs/usage/security#validating-requests) · [Permisos geográficos de Voice](https://www.twilio.com/docs/sip-trunking/voice-dialing-geographic-permissions) · [Voice de prueba](https://www.twilio.com/docs/usage/trials/try-out-voice)

## Codex en DEV-LOCAL-R1 tras autorización

Resolver los UUID en el workspace real y cargar estas variables sólo en el entorno privado del proceso Nest. El identificador de usuario es el del vínculo UserWorkspace autenticado. La aplicación no publica estos valores en la configuración del frontend.

Configurar credenciales específicas de Voice mediante `INCONNECT_VOICE_*`.
La API Key de Voice firma los Access Tokens y el Auth Token de la cuenta
o subcuenta seleccionada verifica el webhook. Los valores se guardan en el
almacén privado de DEV-LOCAL-R1, fuera del checkout y de los logs. La
configuración de credenciales y autoridad de WhatsApp se administra por
separado. [Operación local](INCONNECT_OPERATIONS_AND_UPGRADES.md#dev-local-r1--operación-del-crm-real)

| Variable | Valor |
| --- | --- |
| `INCONNECT_VOICE_ACCOUNT_SID` | Account SID de Voice (`AC…`) |
| `INCONNECT_VOICE_API_KEY_SID` | SID de API Key de Voice (`SK…`) |
| `INCONNECT_VOICE_API_KEY_SECRET` | Secreto de esa API Key |
| `INCONNECT_VOICE_AUTH_TOKEN` | Auth Token de esa cuenta, para verificar firmas |
| `INCONNECT_VOICE_TWIML_APP_SID` | TwiML App SID de salida (`AP…`) |
| `INCONNECT_VOICE_URL` | `VoiceUrl` HTTPS exacta configurada en Twilio |
| `INCONNECT_VOICE_CALLER_ID` | Caller ID autorizado en E.164 |
| `INCONNECT_VOICE_ALLOWED_DESTINATION` | Único destino E.164 aprobado para V0 |
| `INCONNECT_VOICE_WORKSPACE_ID` | UUID de DEV-LOCAL-R1 |
| `INCONNECT_VOICE_USER_WORKSPACE_ID` | UUID del operador autorizado para V0 |
| `INCONNECT_VOICE_LEAD_OBJECT_ID` | UUID de ObjectMetadata de Lead |
| `INCONNECT_VOICE_PHONE_FIELD_ID` | UUID de FieldMetadata de Phone |
| `INCONNECT_VOICE_ENABLE_OUTBOUND` | `false` en `app.env`. Cada habilitación temporal del proceso requiere autorización expresa |

El backend requiere la clave de cifrado vigente de Twenty (`ENCRYPTION_KEY` o el `APP_SECRET` de una instalación legacy) y Redis dedicado con `SET`, `GET`, `DEL` y `EVAL` para intenciones efímeras. Después del reinicio autorizado de la API, comprobar el endpoint autenticado con salida deshabilitada. Cada nueva ventana de activación y su intento manual requieren autorización independiente.
