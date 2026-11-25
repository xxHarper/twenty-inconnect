# INCONNECT Voice V1.2

Voice V1.2 está instalado en DEV-LOCAL-R1 desde el 24 de noviembre de 2026
y quedó validado funcionalmente el 25 de noviembre con los límites del
piloto documentados abajo. Nest está saludable y Voice Outbound sigue
deshabilitado. El piloto conservó el operador y el destino aprobados en R9.
[Evidencia de Voice V1.1](INCONNECT_VOICE_V0_R2.md#evidencia-funcional-del-24-de-noviembre-de-2026)

## Instalación física del 24 de noviembre de 2026

- El Fast `1795521600000` quedó instalado en el PostgreSQL dedicado. El
  respaldo privado se verificó por catálogo y SHA-256. La reejecución
  devolvió `already-installed` sin otro respaldo ni escrituras. Se
  confirmaron las dos tablas, cuatro FKs validadas, el índice de historial
  y el índice único parcial de exclusión. El intento 1 quedó `completed`
  en instancia y workspace, con el cursor anterior conservado.
  Las 161 filas de tracking ajenas a Voice coincidieron con el respaldo.
- Dos sesiones PostgreSQL probaron la exclusión para el mismo ejecutivo.
  El índice devolvió `23505`, la sesión concurrente devolvió `55P03` por
  plazo de lock y pudo insertar al liberarse la primera. Las transacciones
  se revirtieron y el historial quedó libre de fixtures.
- La URL se sincronizó con la TwiML App **Twenty INCONNECT Voice DEV** y
  `app.env`, con método POST. Se respaldó el `dist` anterior y se
  reinició únicamente Nest. Se verificaron `/healthz`, salida deshabilitada
  en archivo y proceso y los módulos actuales servidos por Vite.
- El callback público devolvió 403 con firma ausente o inválida. El
  servicio del build desplegado aceptó firmas válidas para `number` y
  `dial` con salida deshabilitada. Se comprobaron timbrado, respuesta,
  cierre con duración y duplicados en una transacción que se revirtió.

La instalación se comprobó después con la sesión real del operador y con
llamadas manuales al destino aprobado. PHYS-A0 sigue en NO-GO. La evidencia
local de instalación está en
`.cache/inconnect-voice-v1.2/physical-install/`.

## Piloto telefónico del 24 de noviembre de 2026

El preflight autenticado devolvió HTTP 200 `disabled` y el historial del
Lead de prueba estaba vacío. El observador confirmó `ready` a las 17:17:25
y HTTP 200 `disabled` a las 17:24:13, hora de Ciudad de México. El supervisor
restauró Nest con salida deshabilitada y el hash de `app.env` coincidió antes
y después de la ventana.

El operador vio en **Calls** tres intentos, tres contestadas y 80 segundos
confirmados. El recurso Call de Twilio confirmó los tres tramos al destino
y su relación con el tramo navegador. El 25 de noviembre se cotejaron los
SID padre e hijo exactos de las tres filas persistidas en PostgreSQL con
una lectura del proveedor.

| Llamada | Tramo navegador | Tramo destino | Observación del operador |
| --- | ---: | ---: | --- |
| Primera | 77 s · `completed` | 69 s · `completed` | Contestó personalmente. |
| Segunda | 41 s · `completed` | 7 s · `completed` | Entró el buzón al dejar sonar. Colgó desde Twenty. |
| Tercera | 21 s · `completed` | 4 s · `completed` | Entró el buzón tras rechazar desde el celular. Colgó desde Twenty. |

Los 80 segundos suman únicamente los tramos al destino. El buzón produjo
una respuesta telefónica efectiva. La identidad de quien contestó procede
del operador, ya que Twilio no informó `answered_by` en estas llamadas.
El piloto confirmó que se pudo volver a marcar tras finalizar cada llamada.
Twilio registró tres tramos al destino. La bitácora disponible no contiene
una respuesta HTTP 409 que acredite un intento simultáneo desde otra pestaña.
La exclusión física en PostgreSQL conserva su evidencia previa.

**Called by.** Las tres filas conservan el mismo autor histórico y su
`actorLabel` vacío. Voice captura `firstName` y `lastName` del usuario
autenticado al reservar la llamada. El perfil global del operador tenía
ambos campos vacíos en la comprobación del 25 de noviembre. Calls muestra
`Workspace member` en ese caso. El nombre del perfil se administra por el
flujo normal de Twenty. Añadir un nombre aportaría una etiqueta a los
intentos posteriores sin cambiar permisos ni reescribir el historial.

Las evidencias sin credenciales, números ni SID están en
`.cache/inconnect-voice-v1.2/phone-window/` y
`.cache/inconnect-voice-v1.2/recovery-2026-11-25/`.

## Recuperación del 25 de noviembre de 2026

Después de un apagado completo se verificó la identidad de Gate A y se
recuperaron PostgreSQL 55432, Redis 56379, Nest 33000, Vite 33001 y Nginx
34080, todos en loopback. El lanzador manual todavía fijaba el hash del
Nginx previo a V1.2. Se comparó la configuración con su respaldo y se
ejecutó una copia del lanzador con sólo el hash del parche de progreso ya
aprobado. El original y la configuración de Nginx quedaron intactos.
`app.env` conservó el mismo hash y el valor `false`, también verificado en
el nuevo proceso Nest.

Una transacción de solo lectura confirmó tablas, constraints, índices y el
intento 1 `completed` del Fast de Voice en instancia y workspace. Ambos
cursores conservan el Slow `1789040000001`. Persisten las tres llamadas
del Lead con sus tramos correlacionados y los 80 s de conexión confirmada.

El nombre público anterior devolvió NXDOMAIN. El Quick Tunnel de reemplazo
quedó activo hacia `127.0.0.1:34080`. DNS público y HTTPS confirmaron el
rechazo de webhooks sin firma, métodos ajenos, rutas fuera del allowlist y
queries que no cumplen el contrato. La URL `POST` verificada es
`https://caution-self-sing-blue.trycloudflare.com/auth/inconnect-voice/twiml`.
Tras la autorización se respaldaron y sincronizaron `INCONNECT_VOICE_URL`
y `VoiceUrl` de **Twenty INCONNECT Voice DEV**. Se verificó POST y que los
demás valores coincidieran con los respaldos. Sólo se reinició Nest, con
salida deshabilitada. A las 10:13, hora de Ciudad de México, Nest y el túnel
respondían HTTP 200. TwiML y ambos orígenes de progreso (`number`, `dial`)
rechazaron firmas ausentes e inválidas con HTTP 403. Los métodos y rutas
fuera del contrato devolvieron 404 o 405. La evidencia local está en
`.cache/inconnect-voice-v1.2/final-validation-2026-11-25/`.

### Ventana supervisada del 25 de noviembre de 2026

El operador se autenticó antes de abrir la ventana. El observador confirmó
HTTP 200 `ready` a las 10:20:29 y HTTP 200 `disabled` a las 10:25:18, hora
de Ciudad de México. Nest restauró la salida deshabilitada y `app.env`
conservó el hash posterior a la sincronización del túnel.

| Intento | Resultado del historial | Tramo destino de Twilio |
| --- | --- | --- |
| 1 | `answered`, 54 s | `completed`, 54 s |
| 2 | `no-answer`, sin hora de respuesta ni duración | `no-answer`, 0 s |
| 3 | `answered`, 5 s | `completed`, 5 s |

Se cotejaron las tres filas persistidas con los SID padre e hijo exactos.
La ventana aportó tres intentos, dos contestadas y 59 segundos. Con los
datos del piloto previo, el Lead acumula seis intentos, cinco contestadas
y 139 segundos. Los tres intentos nuevos quedaron finalizados y el Lead
quedó sin intentos activos.

El operador confirmó el softphone, el cronómetro a partir de la respuesta,
el bloqueo de la segunda pestaña, la acción de colgar desde Twenty y la
actualización de Calls. El primer intento persistió la hora de respuesta
del destino a las 10:22:45. Twilio registró exactamente tres tramos del
navegador y tres tramos al destino para el operador y ventana. El bloqueo
observado no produjo una cuarta llamada. Quedó sin captura independiente
el HTTP 409 de esa interacción. El 409 está cubierto por las pruebas de
fuente y la exclusión por dos sesiones PostgreSQL en la instalación física.

El operador indicó que no pudo desactivar el buzón y que el intento que
preparó como `No answer` conectó con él. La evidencia del proveedor y el
historial sí contienen un `no-answer`, pero no permite asignarlo con
certeza al paso manual previsto. El escenario específico de dejar sonar un
destino sin buzón queda pendiente de reproducción controlada y ya tiene
cobertura en fuente. La acción de colgar se confirmó en la interfaz. Los
estados terminales acreditados fueron `completed`, `no-answer` y
`completed`, en orden de creación del historial. Ninguno fue `canceled`.
Queda pendiente la reproducción física de ese estado del proveedor.

## Intento y tramos

- `core.inconnectVoiceCall` guarda el intento con UUID interno, workspace,
  ObjectMetadata, registro CRM, autor histórico, dirección, cuenta y TwiML App
  de Voice, identidades telefónicas, fechas, estado, resultado y duración. Se
  registra antes de entregar el token y la intención al navegador. El UUID
  sirve también para localizar la intención cifrada de un solo uso.
- `core.inconnectVoiceCallLeg` vincula el tramo navegador y el tramo telefónico
  con el UUID interno. La clave de proveedor usa cuenta y CallSid. Las FKs
  exigen que el tramo y su padre pertenezcan a la misma llamada y cuenta.
- El índice único parcial de workspace y miembro serializa la reserva entre
  pestañas. La reserva de 45 s se puede cancelar o expirar solamente mientras
  conserva el estado `reserved`. TwiML requiere consumir la intención,
  revalidar la sesión y el destino y confirmar en una transacción el cambio
  de estado junto con el CallSid padre. Si falla el enrutamiento tras consumir
  la intención, la transición técnica afecta únicamente una reserva sin
  iniciar. Una llamada iniciada conserva la capacidad ocupada hasta evidencia
  terminal correlacionada.
- El vínculo al Lead original y la autoría se fijan en el intento. Calls
  vuelve a comprobar la autoridad actual con Common Find One y aplica el
  predicado del facade de Record Access al conjunto SQL antes de calcular
  totales y paginar. El historial sólo devuelve la identidad visible del
  autor capturada de la sesión, datos temporales, dirección y resultado.
  La proyección excluye los teléfonos, las credenciales y los SID.
- El operador de Voice ya configurado puede consultar el historial. Para
  autorizar a otros lectores explícitamente, el entorno privado admite
  `INCONNECT_VOICE_HISTORY_USER_WORKSPACE_IDS` con UUID de UserWorkspace
  separados por coma. Esta autorización funcional se intersecta con la
  sesión humana, el workspace, los permisos de Twenty y el alcance vigente
  de Record Access. La opción de lectura conserva el límite del operador
  de salida. No se configuraron lectores adicionales durante el desarrollo.

## Evidencia y recuperación

El callback de `<Number>` solicita `initiated`, `ringing`, `answered` y
`completed`. Se valida la firma de la URL pública exacta, cuenta, UUID
interno, TwiML App configurada y CallSid padre persistido. El primer evento
correlacionado fija el CallSid hijo. La escritura bloquea la llamada, lee
el vínculo de nuevo y confirma la transacción antes del HTTP 200. El action
de `<Dial>` añade evidencia terminal firmada y responde con TwiML vacío.
La conexión del navegador sigue gobernando mute, reconexión y colgado.
[TwiML Number](https://www.twilio.com/docs/voice/twiml/number)
[TwiML Dial](https://www.twilio.com/docs/voice/twiml/dial)

Twilio numera los eventos de progreso por tramo y puede entregarlos en otro
orden. La transición persistida usa precedencia de estados por tramo y
completa datos faltantes compatibles, por ejemplo un `answered` posterior a
la entrega de `completed`. La réplica de un evento no crea otro intento.
`completed` en el hijo confirma respuesta telefónica, que puede incluir
buzón o IVR. La duración viene del callback de Number o del recurso Call
del hijo. El cronómetro usa el timestamp de respuesta del destino y una
referencia monotónica del navegador. Si falta ese evento, el historial
puede acreditar un resultado y duración sin deducir una hora de respuesta.
[Recurso Call](https://www.twilio.com/docs/voice/api/call-resource)

El softphone consulta la llamada conocida por un intervalo acotado. Ante
evidencia incompleta, los lectores activos del historial actualizan la
página y el iniciador puede pedir recuperación. Otro intento explícito
también puede recuperar la llamada que todavía bloquea al mismo iniciador.
Una actualización atómica en PostgreSQL limita las consultas al proveedor
entre pestañas, con esperas de 20, 45 y 300 segundos. Cada ejecución consulta
el hijo exacto o busca como máximo dos hijos del padre persistido. Una
respuesta ambigua, vacía, no correlacionada o fallida conserva el estado
pendiente. Una llamada cuya evidencia terminal no puede recuperarse puede
seguir bloqueando la marcación. La recuperación usa únicamente lecturas del
proveedor y puede operar con nuevas salidas deshabilitadas si se conserva
la configuración de Voice sobre la misma cuenta y TwiML App.

## Validación de fuente

Las suites focalizadas utilizan fixtures firmados, PostgreSQL interceptado
en la frontera del driver, un cliente Twilio simulado y React con SDK
simulado. Se cubren exclusión y adquisición por reserva, correlación,
idempotencia, eventos desordenados, autorización del historial, totales,
paginación y regresión del softphone al navegar y colgar. Pasaron 21 pruebas
de backend y 17 de frontend, junto con TypeScript, Oxlint y formato en los
archivos del cambio.
El registro local de comandos, fuentes, recursos, salidas y resultados
Jest está en `.cache/inconnect-voice-v1.2/`.

## Instalación exclusiva en DEV-LOCAL-R1

El Fast Instance Command registrado es
`2.32.0_CreateInconnectVoiceHistoryFastInstanceCommand_1795521600000`.
[DDL y reversión](../src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1795521600000-create-inconnect-voice-history.ts)

El `up` crea **dos tablas**, el índice parcial de exclusión y el índice de
historial. La FK de ObjectMetadata depende del índice único compuesto ya
definido por Record Access. No cambia tablas CRM, propietarios, permisos,
Redis ni configuraciones de proveedores. No hay backfill de llamadas previas.
El `down` elimina ambas tablas y su historial y requiere autorización
destructiva específica.

1. El preflight de solo lectura confirmó el clúster dedicado, la ausencia
   de las dos tablas e índices de Voice, las dependencias y el registro
   previo. En Twenty `2.32.0` todos los Fast preceden a los Slow. El Slow
   `1789040000001` ya estaba completado y era el cursor de instancia y del
   único workspace provisionado. Cambiar la fecha del Fast dentro de
   `2.32.0` conserva ese orden. La lectura de cursores conserva ese Slow
   cuando existe evidencia vigente en el ámbito correspondiente. La
   secuencia normal detecta tracking faltante o fallido de Voice antes de
   continuar desde un cursor posterior.
2. La entrada de mantenimiento ejecuta solamente el `up` registrado de
   Voice. Usa un QueryRunner dedicado a `127.0.0.1:55432`,
   `twenty_inconnect_dev_local_r1` y el `system_identifier` de Gate A.
   Prueba identidad y continuidad de sesión, toma un advisory lock dentro
   de la transacción y bloquea las tablas de dependencias y tracking
   contra escrituras concurrentes. Ejecuta como el rol de aplicación dueño
   del esquema. Verifica que el esquema y tracking parten de un estado
   íntegro y que los cursores coinciden con el preflight. Desde un snapshot
   exportado de esa conexión crea un archivo privado con `pg_dump` y valida
   su catálogo con `pg_restore --list` antes del DDL. El respaldo y su hash
   quedan en `voice-v1.2-backup.*` bajo el directorio privado de DEV-LOCAL-R1.

   El DDL y el tracking se confirman juntos. El instalador usa el
   constructor de filas de tracking de Twenty y comprueba el intento 1
   completado para instancia y workspaces provisionados, con fechas
   asignadas por PostgreSQL. Verifica columnas, constraints, índices, dueño,
   filas y conservación de cursores antes de confirmar. Una reejecución
   con estado completo verifica el esquema y tracking y termina sin
   escrituras. Estado parcial, deriva o fallo causan reversión. El ejecutor
   exacto operativo y la secuencia agregada quedan fuera de este recorrido.

   La opción `--plan` imprime el DDL sin conectarse. La opción `--install`
   requiere autorización final específica para el respaldo, DDL y
   tracking de Voice.

   ```bash
   cd /home/alberto/projects/twenty-inconnect/packages/twenty-server
   export PATH="/home/alberto/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin"
   TS_NODE_PROJECT=tsconfig.json node -r ts-node/register/transpile-only \
     -r tsconfig-paths/register src/database/scripts/inconnect-voice-v12/install.ts \
     --install 1795521600000
   ```

   Si falla antes del commit, verificar la ausencia de cambios parciales
   antes de reintentar. Si se pierde la conexión al confirmar, cotejar
   esquema y tracking antes de declarar el resultado. Después de un commit,
   la recuperación de aplicación usa el build anterior con salida
   deshabilitada y conserva tablas y tracking. Cualquier uso de
   `pg_restore` requiere autorización propia y verificación del destino.
3. Con autorización de build y reinicio, preparar el artefacto en Linux y
   conservar el build previo de la API. Usar el target
   `yarn nx run twenty-server:build`, la configuración privada dedicada
   y las entradas independientes de Nest y Vite descritas en Operaciones.
   Arrancar Nest en `127.0.0.1:33000` con
   `DISABLE_DB_MIGRATIONS=true`, `DISABLE_CRON_JOBS_REGISTRATION=true` e
   `INCONNECT_VOICE_ENABLE_OUTBOUND=false`. Mantener el Vite dedicado
   en `127.0.0.1:33001`. Verificar `/healthz`, el status autenticado
   de Voice con HTTP 200 `disabled` y Calls en el Lead autorizado.
   [Operación de DEV-LOCAL-R1](INCONNECT_OPERATIONS_AND_UPGRADES.md#dev-local-r1--operación-del-crm-real)

### Exposición mínima del callback

La regla pública de Voice admite la ruta exacta
`POST /auth/inconnect-voice/call-progress`, con el mismo host
HTTPS y origen dedicado de `/auth/inconnect-voice/twiml`. Nginx debe enviar
la query original `?id=<uuid>&source=number|dial`, el encabezado
`X-Twilio-Signature` y el formulario sin transformación. Usar coincidencia
exacta de ruta, permitir sólo POST, acotar el formulario al límite actual y
desactivar caché. Cloudflare debe permitir sólo esa ruta adicional en el
hostname de Voice, con el mismo destino dedicado y conservando los límites
existentes. Status, session e historial siguen en la superficie autenticada
del CRM. Registrar el paso del formulario y las respuestas 403/503 sin
guardar bodies, firmas, números ni tokens. La TwiML App conserva `VoiceUrl`
y el nuevo URL se genera desde TwiML por llamada.

La configuración dedicada de Nginx se respaldó, verificó y recargó el
24 de noviembre de 2026. El reemplazo del Quick Tunnel hacia
`127.0.0.1:34080` quedó disponible. `INCONNECT_VOICE_URL` en `app.env` y
`VoiceUrl` en la TwiML App de DEV se sincronizaron ese día con el hostname
registrado en el `validated.json` privado de aquel túnel. La recuperación
del 25 de noviembre documenta la sincronización del hostname vigente.

### Validación real autorizada

Abrir `http://127.0.0.1:33001/` en el navegador con la sesión del operador
de R7, abrir el Lead de prueba, entrar en **Calls** y copiar el UUID del
Lead desde la URL. Desde el checkout en una terminal WSL, comprobar
el estado y el historial antes de solicitar la ventana. El operador
introduce sus credenciales directamente en la terminal.

```bash
python3 packages/twenty-server/scripts/observe-voice-v12-dev-local.py --check <UUID-del-Lead>
```

Al autorizar la ventana, volver a ejecutar el mismo comando sin
`--check`. El observador reutiliza la autenticación, señal de control y
cierre de R9. También muestra el estado, resultado y segundos de los
intentos nuevos del Lead. Mantener la terminal abierta y pulsar Enter al
terminar la serie o al detectar un fallo. El supervisor de R9 controla
la activación temporal.

1. Abrir la ventana supervisada para el operador y destino de prueba ya
   aprobados. Desde un Lead autorizado marcar, observar timbrado, contestar
   desde el destino y confirmar el cronómetro de conexión efectiva y
   el audio bidireccional.
2. Navegar entre Leads y Messaging, minimizar y expandir y probar mute y
   unmute. Intentar marcar en otra pestaña y observar el conflicto sin un
   segundo tramo hacia el destino. Conservar el estado HTTP 409 de
   `POST /auth/inconnect-voice/session` y la hora, sin exportar tokens,
   cookies, cabeceras ni cuerpos de solicitudes.
3. Colgar. Confirmar el resultado, la duración del tramo destino y el
   historial del Lead original. Comprobar actualización del panel e
   historial y verificar la persistencia al recargar. Abrir un Lead fuera
   de alcance y comprobar que Calls no queda disponible para ese registro.
4. Marcar otra vez después de la confirmación. Dejar que la segunda llamada
   termine sin contestar. Si responde un buzón o IVR, verificar el resultado
   como contestada. En la tercera llamada, cancelar antes de contestar
   y comprobar la liberación de la capacidad de marcar. Cotejar cada
   resultado con el tramo hijo. Recargar el CRM y verificar el historial.
   Los duplicados y eventos desordenados se pueden verificar con fixtures
   firmados y aislados, sin otra llamada real.
5. Cerrar la ventana supervisada y confirmar HTTP 200 `disabled`. Dejar
   intacto `app.env` y, si existe una llamada previa pendiente, comprobar
   con autorización su cierre por callback o recuperación con salidas
   deshabilitadas.

### Reproducción controlada de No answer y Canceled

Hacer las dos pruebas en otra ventana autorizada, con el destino aprobado
y un tramo de prueba que pueda timbrar sin buzón, IVR ni desvío. Si el
operador puede desactivar el buzón y los desvíos en el destino ya aprobado,
usar ese mismo número. Cualquier destino distinto requiere autorización.

1. **No answer.** Dejar el destino sonando sin contestar, rechazar ni colgar
   desde Twenty. El TwiML actual usa el plazo por defecto de `<Dial>`, de 30 s
   más el margen de 5 s de Twilio. Esperar `no-answer` en el tramo destino y
   un intento nuevo sin duración de conversación.
   [Plazo de Dial](https://www.twilio.com/docs/voice/twiml/dial#timeout)
2. **Canceled.** Esperar el timbrado confirmado y colgar desde Twenty antes
   de que alguien conteste. Comparar el estado terminal del hijo con Calls.
   Si Twilio informa otro resultado, conservarlo. Twilio documenta `canceled`
   al cancelar mediante REST un Call aún en `ringing`. Si se necesita
   garantizar ese estado del proveedor, pedir autorización específica para
   cancelar exclusivamente el CallSid hijo previamente correlacionado,
   mientras siga en `ringing`. El caso debe quedar sin duración de
   conversación y liberar la reserva al finalizar.
   [Estados del recurso Call](https://www.twilio.com/docs/voice/api/call-resource#call-status-values)

## Roadmap

- [Voice V1.3](INCONNECT_VOICE_V1_3.md) incorpora DTMF y selección de
  dispositivos. El informe de V1.3 recoge el piloto del operador y sus límites.
- V2 incorpora entrada, disponibilidad, identificación de Leads y Round
  Robin general y por Commercial Team.
- V3 incorpora transferencias directas y asistidas, espera y grabaciones.
- V4 incorpora supervisión, estadísticas y productividad.
