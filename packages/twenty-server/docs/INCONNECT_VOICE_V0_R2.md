# INCONNECT Voice V0-R2 en DEV-LOCAL-R1

**Estado al 18 de noviembre de 2026 · SOURCE-ONLY.** La API activa registrada
devolvió HTTP 404 en `GET /auth/inconnect-voice/status`. Falta instalar el
build que incluye R2 y reiniciar la API con autorización específica.
El webhook público, la activación de Twilio Voice y la primera llamada
siguen pendientes. [Estado canónico y alcance de las pruebas](INCONNECT_PROJECT_STATUS.md#checkpoint-del-18-de-noviembre-de-2026)

El botón Llamar comprueba disponibilidad en el backend. El primer intento explícito requiere una sesión humana permitida, autorización vigente sobre el Lead y su campo Phone, y coincidencia con el destino de prueba aprobado. El backend emite un Access Token de 300 segundos y una intención de 45 segundos. El SDK envía sólo el identificador opaco de la intención. El callback verifica la firma, consume la intención y vuelve a validar la sesión y el Phone antes de devolver TwiML. La llamada permite hasta 300 segundos y usa `do-not-record`.

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
| `INCONNECT_VOICE_ENABLE_OUTBOUND` | `false` hasta autorizar la llamada real |

El backend requiere la clave de cifrado vigente de Twenty (`ENCRYPTION_KEY` o el `APP_SECRET` de una instalación legacy) y Redis dedicado con `SET`, `GET`, `DEL` y `EVAL` para intenciones efímeras. Después del reinicio autorizado de la API, comprobar el endpoint autenticado con salida deshabilitada. La activación y la primera llamada a ese único destino requieren aprobación independiente.
