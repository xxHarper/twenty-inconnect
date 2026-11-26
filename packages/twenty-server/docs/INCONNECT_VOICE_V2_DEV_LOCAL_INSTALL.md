# Voice V2 en DEV-LOCAL-R1

## Estado operativo del 26 de noviembre de 2026

Voice V2 está instalado en DEV-LOCAL-R1. El Slow `1795694400000` avanzó los dos cursores y preservó **11 llamadas, 22 tramos, 372 s y cero activas**. El instalador comparó huellas de todo el histórico y tracking previo, permisos, claves e índices antes del commit. El snapshot verificado quedó en `voice-v2-backup.4gVVmE` bajo el runtime privado. PHYS-A0 sigue NO-GO.

**Número receptor `+525588972140`**, el mismo Caller ID contratado de DEV con capacidad Voice. El origen autorizado es `+525514552571` y el operador es el administrador original. Una lectura de la metadata y los datos vigentes confirmó un miembro activo y una única coincidencia de Lead cuyo propietario es ese miembro. El número tenía una URL anterior de Twenty en un Quick Tunnel que ya no resuelve, sin TwiML App asociada, trunk, fallback ni callback de estado. La lectura de actividad del número encontró como último día con una entrada registrada el 9 de noviembre y cero activas. No se encontró una integración de voz activa con Salesforce. Se respaldaron los recursos Twilio y el GET posterior confirmó que solo cambiaron los campos de Voice autorizados.

Redis conserva sus reglas anteriores y tiene el selector de Inbound persistido. Nginx se recargó tras `nginx -t`. El Quick Tunnel anterior fue detenido antes de levantar el único reemplazo. Readiness y Nest devuelven `200`. Los cuatro webhooks rechazan POST sin firma con `403` y Nginx devuelve `404` para un query fuera de contrato. Los flags **Outbound e Inbound están en `true`** en `app.env` y en el proceso Nest.

La evidencia de instalación queda en `voice-v2-maintenance.fPZn9qUj` y los respaldos de Twilio en `voice-v2-provider.aulucinu` bajo el runtime privado. El operador validó la telefonía después de R1. La [evidencia de cierre](INCONNECT_VOICE_V2.md#cierre-funcional-y-visual-del-26-de-noviembre-de-2026) registra los resultados persistidos y el refinamiento visual.

### Controles persistentes

Desde la raíz del repo en WSL, con los servicios dedicados disponibles:

```bash
voice=packages/twenty-server/scripts/inconnect-voice-dev.py
python3 "$voice" status
python3 "$voice" disable inbound
python3 "$voice" enable inbound
```

`enable` y `disable` admiten `outbound`, `inbound` y `both`. Comprueban cero llamadas activas, respaldan la configuración y reinician solo Nest cuando cambia el estado. `enable` verifica la TwiML App, las rutas públicas y, para Inbound, el número y la ACL. `status` muestra los flags del archivo y del proceso, salud, URL e inventario.

Tras reiniciar la computadora, recuperar PostgreSQL, Redis, Vite y Nginx dedicados por el procedimiento de DEV-LOCAL-R1. Usar `python3 "$voice" start` si Nest está detenido. Si el Quick Tunnel pierde su hostname, arrancar un único reemplazo hacia 34080, confirmar readiness y rutas, y sincronizar ambas URLs de `app.env`, la URL de la TwiML App y los dos webhooks del número antes de habilitar. Usar la configuración y comprobaciones de la sección de Nginx y Twilio. [Operaciones DEV-LOCAL-R1](INCONNECT_OPERATIONS_AND_UPGRADES.md#dev-local-r1--operación-del-crm-real)

## Preflight anterior a la instalación

| Componente | Evidencia observada |
| --- | --- |
| PostgreSQL `127.0.0.1:55432` | Clúster, base y owner de DEV-LOCAL-R1 verificados. `--inspect` devolvió `ready` con esquema V1.4, sus dos cursores esperados, 11 llamadas, 22 tramos, 372 s y cero activas. |
| Redis `127.0.0.1:56379` | `PONG` autenticado. Misma instancia por TCP y por el socket dedicado. `ACL DRYRUN` rechazó el acceso a la clave de prueba `inconnectVoice:inbound:acl-preflight` con `GET`, `SET`, `DEL` y `EVAL` para la cuenta de Nest. La ACL requiere el ajuste acotado descrito abajo. |
| NestJS `127.0.0.1:33000` | `/healthz` HTTP 200. Outbound `true` en `app.env` y en el proceso. Nest usa ese archivo y el selector coincide con el administrador original. Migraciones de arranque y cron deshabilitados. |
| Vite `127.0.0.1:33001` | HTTP 200 en la raíz. |
| Nginx `127.0.0.1:34080` | `GET /auth/inconnect-voice/twiml` devolvió 405. Configuración dedicada en `/home/alberto/twenty-inconnect-dev-local-r1/voice-r5-nginx/nginx.conf` con registro de acceso apagado y rechazo general 404. |
| Quick Tunnel `127.0.0.1:32998` | El proceso existente apunta a Nginx 34080. `GET /ready` devolvió 503. El hostname registrado coincide con `app.env` y las sondas públicas no obtuvieron respuesta HTTP. |
| Twilio VoiceUrl | El valor local usa `https://papua-retailers-traffic-absence.trycloudflare.com/auth/inconnect-voice/twiml`. La revisión automática bloqueó el GET autenticado de la TwiML App porque el preflight local no autorizaba explícitamente el uso de las credenciales contra el proveedor. El cotejo vigente queda pendiente. |

## Alcance exacto y tracking

El [Slow registrado](../src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795694400000-add-inconnect-voice-inbound.ts) es `2.32.0_AddInconnectVoiceInboundSlowInstanceCommand_1795694400000`. `runDataMigration()` está vacío. `up()` emite tres sentencias.

1. En `core."inconnectVoiceCall"`, quita `NOT NULL` de `actorMemberId`, añade `inboundSessionId uuid`, `inboundDecision text` con valores `accept` y `decline`, `inboundScreenedAt timestamptz`, `inboundDialSettled boolean NOT NULL DEFAULT false` y `answeredMemberId uuid`. Amplía los checks de dirección a `outbound` e `inbound` y de resultado a `answered`, `no-answer`, `busy`, `canceled`, `failed` y `declined`. Los checks nuevos permiten actor nulo solo en entrantes terminadas, exigen actor y vínculo CRM si hay sesión y ligan `answeredMemberId` al actor de una entrante atendida con screening.
2. El bloque `DO` identifica de forma estricta el único check de topología V1.4 por sus dos columnas `kind` y `parentCallSid` y lo elimina.
3. En `core."inconnectVoiceCallLeg"`, sustituye el check de `kind` para admitir `browser`, `destination`, `caller` y `browser-inbound`. El nuevo check hace raíz a `browser` y `caller`, y requiere padre en los otros dos tipos.

Las filas previas reciben `false` por DEFAULT y nulo en las demás columnas nuevas. El DDL conserva el índice único parcial por actor, los índices de historial, las claves, los FK y los checks ajenos al cambio. El par CRM de V1.4 se conserva. La fase de aplicación mantiene Roles, grants y Leads existentes. No requiere Workspace Command, refresh de permisos ni codegen.

El [instalador](../src/database/scripts/inconnect-voice-v2/install.ts) reutiliza la identidad y las dependencias de V1.2, la verificación del workspace y de los predecesores de V1.4, y la conexión y el respaldo compartidos con V1.4. Exige el workspace provisionado único, la app estándar, PostgreSQL dedicado 18, owner de las tablas y arbiter nativo de tracking, más V1.2 y V1.4 completados. Antes de instalar, el cursor global debe estar en `1795608000000` y el de workspace en el refresh `1795608000001` completado.

El modo de escritura abre una conexión inicialmente de solo lectura y una transacción explícita de escritura. Revalida el PID del backend PostgreSQL, toma el advisory lock compartido de Voice y bloquea las tablas de Voice, tracking y dependencias. Exige cero llamadas activas, API y demás clientes de la base detenidos, y ambos flags persistidos en `false`. Exporta el snapshot bloqueado y genera un `pg_dump` privado con índice de contenido y SHA-256. Tras comprobar otra vez la ausencia de otros clientes, ejecuta la fase vacía del Slow y su `up()` con el mismo QueryRunner.

El commit aplica en conjunto el DDL y dos filas `completed`, `attempt=1`, `executedByVersion=2.32.0` e `isInitial=false`. Una fila es de instancia y la otra su espejo en el workspace. Ambos cursores observados pasan a `1795694400000`. El instalador verifica los valores iniciales de V2 y compara las huellas de todas las filas previas de llamadas y tramos, permisos, grants, tracking, índices y claves. Los locks evitan escrituras concurrentes durante la comparación. El archivo de respaldo queda bajo `$runtime/voice-v2-backup.*`.

La secuencia nativa agrupa los Slow antes de los Workspace Commands. Con el nuevo espejo como cursor, un runner agregado posterior puede volver a planificar el segmento de workspace aunque el refresh V1.4 siga registrado. Este procedimiento ejecuta solo el Slow seleccionado.

Si falla antes del commit, PostgreSQL revierte DDL y tracking. Puede quedar un respaldo o evidencia local. Ante una confirmación de commit perdida o error de cierre, usar `--inspect` antes de reintentar. `ready` significa esquema V1.4 y ausencia de fila V2. `installed` significa catálogo esperado y las dos filas nuevas válidas. Un estado mixto, fallido, con alias o cursor inesperado detiene la operación para diagnóstico. No completar filas o columnas manualmente.

## Procedimiento aplicado durante la instalación

1. Cotejar con GET autenticado `voice_url`, `voice_method=POST` e identidad de la TwiML App **Twenty INCONNECT Voice DEV**. Comprobar el Quick Tunnel existente, que ya apunta a Nginx. Si recuperó un edge, conservar proceso y hostname. [Quick Tunnels](https://developers.cloudflare.com/tunnel/concepts/)
2. Confirmar cero activas y que el operador dejó de marcar. Guardar copia privada con hash del `app.env`, configuración efectiva de Nginx, configuración autorizada del número seleccionado y, si cambia la URL de salida, la configuración anterior de la TwiML App. Parar por SIGTERM únicamente el proceso de Nest verificado y comprobar que 33000 queda libre. Persistir ambos flags en `false` de forma atómica, conservando el selector, el destino y los países de Outbound. Dejar PostgreSQL, Redis y Vite operativos.
3. Durante el mantenimiento, si el túnel sigue caído y hay que reemplazarlo, detener solo el proceso dedicado verificado y levantar un único reemplazo hacia 34080. Confirmar el hostname y coordinar `INCONNECT_VOICE_URL` y el `VoiceUrl` de la TwiML App DEV. Aplicar la URL entrante seleccionada en el mismo hostname. Reservar un directorio privado para el build activo. Mover `dist` allí con Nest parado, reconstruir backend y dependencias y comprobar el artefacto y las rutas. Si falla el build, apartar el `dist` incompleto y restaurar el anterior desde el respaldo. Ejecutar desde WSL con el runtime dedicado.

```bash
set -e
repo=/home/alberto/projects/twenty-inconnect
runtime=/home/alberto/twenty-inconnect-dev-local-r1
export PATH="/home/alberto/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin"
export NX_DAEMON=false NX_NO_CLOUD=true
umask 077
cd "$repo"
test -s packages/twenty-server/dist/main.js
previous=$(mktemp -d "$runtime/voice-v2-backend.XXXXXXXX")
mv -- packages/twenty-server/dist "$previous/dist"
yarn nx run twenty-server:build --skip-nx-cache
test -s packages/twenty-server/dist/main.js
test -s packages/twenty-server/dist/modules/inconnect-voice/inconnect-voice-inbound.controller.js
test -s packages/twenty-server/dist/database/scripts/inconnect-voice-v2/install.js
```

`--plan` valida selección y muestra las tres sentencias mediante un QueryRunner en memoria. `--inspect` abre una transacción de solo lectura y admite los flags operativos vigentes. El comando pendiente de autorización es la segunda invocación.

```bash
cd "$repo/packages/twenty-server"
installer=dist/database/scripts/inconnect-voice-v2/install.js
env -i PATH="$PATH" node "$installer" --inspect
env -i PATH="$PATH" node "$installer" --install 1795694400000
env -i PATH="$PATH" node "$installer" --inspect
```

4. Confirmar `ready → installed → installed`, cero activas y el mismo inventario. Arrancar Nest en limpio con `app.env`, ambos flags deshabilitados y los límites de DEV-LOCAL-R1. Comprobar identidad, `/healthz` y el acceso autenticado a Phone, Calls y Recents. Mantener Vite y recargar el navegador.

```bash
env -i PATH="$PATH" NODE_HOST=127.0.0.1 NODE_PORT=33000 \
  PG_INSTALL_EXTENSIONS=false DISABLE_DB_MIGRATIONS=true \
  DISABLE_CRON_JOBS_REGISTRATION=true INCONNECT_VOICE_ENABLE_OUTBOUND=false \
  INCONNECT_VOICE_ENABLE_INBOUND=false node --env-file="$runtime/app.env" dist/main.js
```

5. Con el número autorizado, aplicar las configuraciones Redis, Nginx y Twilio de abajo. Validar rutas local y públicamente. Restaurar Outbound `true` solo después de confirmar consistencia, salud y VoiceUrl sincronizada. Confirmar el estado autenticado `ready` para el administrador y el único destino de salida aprobado mediante lookup sin iniciar llamada. Tras la autorización de Inbound persistente y el cotejo del número, origen y operador, persistir `INCONNECT_VOICE_ENABLE_INBOUND=true`. Ambos cambios pueden compartir el arranque final de Nest si todas las condiciones se cumplen. El proceso final debe leer los flags de `app.env` sin un override contrario.
6. Si falla tras el commit, conservar esquema, tracking y respaldo. Para recuperar el servicio antes de generar historial entrante, se puede volver al build V1.4 con ambos flags apagados y verificar salud. Si ya hay historial entrante, mantener V2 con recepción deshabilitada mientras se diagnostica. El `down` rechaza el historial entrante y cualquier reversión de esquema o restauración física requiere una autorización propia.

## ACL de Redis para recibir

Con autorización, confirmar por `CONFIG GET aclfile` el archivo de la instancia dedicada y cotejar la ACL efectiva con ese archivo. Guardar una copia privada con hash. Añadir solamente el selector `(~inconnectVoice:inbound:* +get +set +del +eval)` mediante `ACL SETUSER` sobre el usuario existente de `REDIS_URL` en 56379. Conservar los demás selectores, permisos y credenciales. Repetir `ACL DRYRUN` para los cuatro comandos y verificar que los permisos fuera de ese prefijo permanezcan iguales. Persistir con `ACL SAVE` tras verificar que no hay cambios ajenos pendientes de persistir. Si se necesita revertir, cotejar cambios posteriores, restaurar el respaldo del ACL y aplicar `ACL LOAD` en la instancia dedicada. Redis puede seguir en ejecución. El registro real del Device verifica posteriormente la concesión y su heartbeat. [Selectores de Redis](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/#selectors)

## Nginx y URLs para Twilio

Incluir [el snippet exacto](INCONNECT_VOICE_V2_NGINX.conf) dentro del único bloque `server` del Nginx dedicado en 34080. Mantener sus dos ubicaciones salientes y el 404 general. El proxy pasa la URI original, query, cuerpo y `X-Twilio-Signature` a Nest. `inbound-progress` admite la URL sin query del número y las tres variantes de correlación que genera TwiML. Nginx conserva `access_log off` y Twilio sigue autenticado por la firma en la aplicación. El Quick Tunnel publica únicamente lo que admite Nginx. [Semántica de proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)

Aplicar en el prefijo `$runtime/voice-r5-nginx/`. Guardar `nginx.conf` y cualquier include previo en un directorio privado. Copiar el snippet como `voice-v2-inbound.conf` e insertar `include voice-v2-inbound.conf;` dentro de `server`. Validar configuración antes de la recarga y recargar solo el master dedicado verificado con los mismos argumentos `-p` y `-c`.

```bash
nginx_prefix="$runtime/voice-r5-nginx/"
nginx="${nginx_prefix}runtime/usr/sbin/nginx"
"$nginx" -t -p "$nginx_prefix" -c nginx.conf
"$nginx" -s reload -p "$nginx_prefix" -c nginx.conf
```

Comprobar HTTP 405 para GET en cada webhook, 403 para POST sin firma con la configuración piloto completa, y 404 para rutas internas y variantes de path o query fuera del contrato. Repetir las comprobaciones de las dos URLs salientes. Para revertir, restaurar primero la configuración previa del número dedicado, restaurar `nginx.conf` y el include previo o retirar el include nuevo tras quitar su referencia, repetir `-t` y recargar. Si un cambio de hostname quedó a medias, restablecer un par funcional y consistente de URLs de Twilio y `app.env` antes de volver a habilitar. No restaurar como activo un hostname que ya perdió el túnel.

Las URLs del **hostname vigente** se muestran a continuación. Si se reemplaza el Quick Tunnel, recalcular ambos valores con el hostname validado.

| Campo en el número dedicado | Método | URL |
| --- | --- | --- |
| A call comes in / `voiceUrl` | POST | `https://hip-rarely-collections-sunrise.trycloudflare.com/auth/inconnect-voice/inbound` |
| Call status changes / `statusCallback` | POST | `https://hip-rarely-collections-sunrise.trycloudflare.com/auth/inconnect-voice/inbound-progress` |

En **Twilio Console → Phone Numbers → Active Numbers**, seleccionar únicamente el `IncomingPhoneNumber` con capacidad Voice de la misma cuenta DEV y confirmar E.164 y SID `PN…`. Configurar el modo Webhook, sin asociación a una TwiML App o trunk que prevalezca sobre el webhook y con fallback de voz vacío. Conservar la configuración de SMS, la TwiML App de salida y el caller ID existente. La validación firmada exige el número receptor, la cuenta y el origen aprobado. Los callbacks del tramo navegador y screening se forman en el TwiML de V2. [Recurso IncomingPhoneNumber](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource)

Usar estas variables adicionales en el `app.env` privado del backend.

| Variable | Valor |
| --- | --- |
| `INCONNECT_VOICE_INBOUND_URL` | URL HTTPS confirmada de `/auth/inconnect-voice/inbound`. |
| `INCONNECT_VOICE_INBOUND_NUMBER` | `+525588972140`, el mismo Caller ID contratado de Twenty DEV. |
| `INCONNECT_VOICE_INBOUND_TEST_SOURCE` | `+525514552571`. Debe coincidir exactamente con el teléfono primario de un solo Lead activo, legible y propiedad del operador. Si no existe esa coincidencia, resolver y autorizar por separado el cambio concreto de CRM. |
| `INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID` | ID del **UserWorkspace** activo del administrador original confirmado en Twenty. En el piloto se espera que coincida con el selector de salida actual. |
| `INCONNECT_VOICE_ENABLE_INBOUND` | `false` durante instalación y configuración. `true` persistente tras autorización y verificación del piloto. |

`INCONNECT_VOICE_ENABLE_OUTBOUND` es independiente. El origen entrante se valida mediante la lista de V2 y nunca se agrega a los destinos de salida. Conservar las demás variables de Twilio, workspace y metadata. Tras detener Inbound, conservar su configuración para callbacks e historial. El TwiML fija `do-not-record`.

## Primera llamada con el administrador original

1. Entrar a [Twenty DEV-LOCAL-R1](http://127.0.0.1:33001/) con el administrador original. Abrir **Phone → Receive calls** y esperar el estado de registro del Device en esa pestaña.
2. Desde `+525514552571`, llamar al número Twilio `+525588972140`. Confirmar que aparece el Lead correcto sin buscarlo manualmente. Pulsar **Accept** y conceder el micrófono si el navegador lo pide.
3. Hablar y escuchar en ambos sentidos. Navegar a otra pantalla de Twenty con la llamada abierta, comprobar que el softphone y el audio siguen, y colgar desde Twenty.
4. Abrir **Calls** del Lead y **Phone → Recents**. Verificar que ambas vistas muestran la entrante del Lead con resultado atendido y que la duración confirmada se refleja al finalizar. Cotejar los dos tramos cuando Twilio haya creado el tramo navegador.
5. Volver a llamar y pulsar **Decline** mientras timbra. Comprobar que se retira la oferta y que el resultado es `declined` sin conversación.
6. Volver a llamar y colgar desde el celular antes de aceptar. Comprobar que se retira la oferta sin intervención y que termina como `canceled` sin conversación. Revisar Calls y Recents tras los callbacks de cierre.

El operador puede dejar la pestaña registrada para seguir recibiendo y pulsar **Stop receiving calls** cuando quiera salir. El registro caduca al perderse la sesión. La habilitación persistente conserva un receptor, un origen, un operador y un Lead elegible por llamada. Los diagnósticos y observadores son opcionales.

## Validación de esta preparación

Pasaron 12 pruebas simuladas del instalador V2 y 5 del instalador V1.4 afectado por la reutilización. Pasaron los dos casos del provider React que emitían avisos de `act(...)`, al esperar las actualizaciones de disponibilidad al abrir Phone y cambiar de identidad. La prueba focalizada del Caller ID compartido confirmó que el origen debe seguir siendo distinto del receptor y que los flags son independientes. La evidencia de fuente está en `.cache/inconnect-voice-v2-install/`.

Referencias de procedencia del instalador. [Voice V1.2](INCONNECT_VOICE_V1_2.md) · [Instalación de V1.4](INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md) · [Contrato de operaciones](INCONNECT_OPERATIONS_AND_UPGRADES.md)
