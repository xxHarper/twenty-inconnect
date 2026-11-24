# INCONNECT Voice V0 en DEV-LOCAL-R1

**Estado al 24 de noviembre de 2026.** La salida desde un Lead quedó validada
de extremo a extremo en DEV-LOCAL-R1 con una llamada estable y audio
bidireccional. Voice quedó en `DISABLED` al cerrar el piloto. El alcance se
limita al desarrollo y al único destino aprobado. Producción sigue sin
autorización. [Estado canónico](INCONNECT_PROJECT_STATUS.md#checkpoint-del-24-de-noviembre-de-2026)

El botón Llamar comprueba disponibilidad en el backend. El primer intento explícito requiere una sesión humana permitida, autorización vigente sobre el Lead y su campo Phone, y coincidencia con el destino de prueba aprobado. El backend emite un Access Token de 300 segundos y una intención de 45 segundos. El SDK envía sólo el identificador opaco de la intención. El callback verifica la firma, consume la intención y vuelve a validar la sesión y el Phone antes de devolver TwiML. La llamada permite hasta 300 segundos y usa `do-not-record`.

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
