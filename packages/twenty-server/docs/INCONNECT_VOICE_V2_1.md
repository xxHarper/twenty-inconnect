# Voice V2.1 · disponibilidad y distribución telefónica

Estado del 27 de noviembre de 2026. Voice V2.1, R1 y UI/UX Polish
quedaron cerrados para el piloto en DEV-LOCAL-R1 sobre Voice V2
`8e7c6f470a44908d760efed255eafb90151983b0`. Inbound y Outbound
siguen habilitados de forma persistente. [Cierre de Voice V2](INCONNECT_VOICE_V2.md)

## Cierre del piloto en DEV-LOCAL-R1

El operador aprobó las pruebas manuales de R1 y el refinamiento visual.
Confirmó que el propietario desconectado dejó de recibir ofertas, que
funcionó el fallback a su Commercial Team y que el pool general alternó
entre las dos cuentas al retirar temporalmente la coincidencia del Lead
sintético. El selector y el refinamiento visual quedan aprobados.

La lectura del PostgreSQL dedicado cotejó las seis llamadas posteriores
a R1 y sus tramos raíz y de navegador. Las horas son de Ciudad de México.

| Hora | CRM | Ofertas en orden | Resultado de la llamada | Duración | Tramos |
| --- | --- | --- | --- | --- | --- |
| 10:52:57 | Lead sintético | Voice Test | Atendida por Voice Test | 15 s | 2 |
| 10:54:15 | Lead sintético | Administrador, Voice Test | Sin respuesta en ambas ofertas | — | 3 |
| 10:56:09 | Sin vínculo | Administrador | Sin respuesta | — | 2 |
| 10:56:35 | Sin vínculo | Voice Test | Sin respuesta | — | 2 |
| 10:56:48 | Sin vínculo | Administrador | Sin respuesta | — | 2 |
| 10:56:55 | Sin vínculo | Voice Test | Sin respuesta | — | 2 |

Las cuatro llamadas generales tienen `recordId` y `objectMetadataId`
nulos. El cursor general quedó en Voice Test, como la última oferta de
la alternancia. El tramo de navegador de cada oferta quedó enlazado a su
oferta y al tramo raíz correspondiente. Los 15 s de la llamada atendida
coinciden con la duración de su oferta.

El teléfono primario del Lead sintético seguía en el número temporal
terminado en 2572. Se restauró el compuesto original terminado en
2571 mediante el procedimiento autorizado. La lectura autenticada
confirmó igualdad de los cuatro componentes con el respaldo y el
lookup volvió a devolver exactamente el Lead sintético. Las cuatro
llamadas generales conservaron su historial sin vínculo.

El cierre quedó en **41 llamadas, 14 ofertas, 74 tramos y 504 s**,
con cero reservas activas o vencidas sin cerrar y cero ofertas abiertas.
Ninguno de los dos operadores tenía una concesión de recepción en Redis
al comprobar el cierre. Se conservaron el Administrador original y
Voice Test como Executive activos de **Voice V2.1 — DEV**.
Inbound y Outbound se verificaron en disco y en el proceso.
La evidencia quedó en `voice-v21-closure.CuKKB2BC` bajo el runtime
privado de DEV-LOCAL-R1.

Queda pendiente la concurrencia de dos llamadas telefónicas reales.
La prueba física transaccional ya acredita la exclusión de reservas.
Para afirmar una conversación atendida por el pool general, queda
pendiente un tramo con puente y duración confirmados por Twilio.
La ventana acredita el rechazo y la continuación tras timeout por
separado. Falta observar un rechazo seguido de una segunda oferta
en una llamada real. La redacción de CRM está cubierta por pruebas
focalizadas y la aprobación manual del flujo. Falta evidencia visual
individual de la vista del segundo agente para un Lead ajeno.
PHYS-A0 sigue **NO-GO** y Voice V3 permanece sin iniciar.

[Manifiesto exacto para el commit](INCONNECT_VOICE_V2_1_COMMIT_FILES.txt)

## R1 · cierre de recepción y selector de Phone

R1 está operativo en DEV-LOCAL-R1 el 27 de noviembre de 2026. Inventario
al reinicio y a la salida **35 llamadas, 61 tramos, 489 s y cero activas**.
Inbound y Outbound siguen habilitados en disco y en Nest.

La persistencia anterior acredita una oferta directa al administrador
a las 10:18:22, atendida con 21 s. La preferencia Unavailable del
administrador quedó escrita antes de las 10:19:28 y Voice Test
atendió esa oferta de equipo con 20 s. A las 10:20:37 el propietario
no respondió y Voice Test atendió la segunda oferta de la misma
llamada con 5 s. El registro de las 10:22:50 acredita un rechazo
sin segunda oferta. A las 10:23:10 y 10:23:11 se registró
`team-no-agent`. La ventana de diagnóstico precedió a la prueba del
pool general documentada en el cierre.

El AOF registró la eliminación de la concesión del administrador
después de las 10:23:00. A las 10:23:23 volvió a aparecer una concesión.
La oferta directa de las 10:23:50 quedó vinculada a otra sesión
registrada, con la preferencia Available anterior aún vigente.
El cierre previo eliminaba la concesión de una sesión pero conservaba
la preferencia, de modo que otra sesión podía volver a ofrecer
recepción. La acción de cierre también mostraba el estado local
antes de recibir confirmación. El rastro del servidor no identifica
la pestaña que abrió la segunda sesión ni fija el minuto del clic.

Offline ahora persiste la intención del operador y revoca la única
concesión de recepción aunque la posea otra pestaña. El backend
coordina esto con reserva y screening. Tras confirmar Offline, una
renovación vieja no revive la concesión y una nueva sesión exige
seleccionar Available. La otra pestaña deja de anunciar recepción
al consultar el estado o al renovar. Una señal Twilio emitida antes
del cierre puede estar en tránsito. La sesión revocada no puede
aceptarla ni completar un puente nuevo. Las llamadas ya admitidas
conservan su progreso. El frontend retira el Device después de la
llamada activa. Busy y Ringing siguen derivados de la reserva.
Unavailable pausa nuevas ofertas conservando el registro.

Phone muestra un selector bajo el encabezado, accesible en Keypad
y Recents. Da la prioridad visual al estado efectivo y muestra
conexión en una indicación secundaria con tooltip. Available sólo
aparece como estado vigente cuando lo confirma el backend.
Los nuevos textos, y los textos de conexión y controles visibles
de Voice revisados, tienen catálogo español.

Pasaron las suites focalizadas, typecheck de servidor y frontend,
lint y formato acotados. La prueba física creó una concesión
local sin conectar un Device, la revocó desde otra sesión
autenticada del administrador y comprobó 403 al intentar renovarla
o iniciar otra mientras seguía Offline. La preferencia anterior
se restauró. Chrome verificó el selector, el timbrado y ambas
pestañas en una vista previa aislada con temas claro y oscuro,
ancho de 320 px y escala de 150 %. No hubo llamadas automáticas,
cambios de Twilio ni nuevas migraciones. Evidencia privada en
`voice-v21-r1.dSM3xmQA`.

## Instalación física y habilitación

El instalador dedicado aplicó sólo el Slow `1795780800000` después de
verificar el clúster `twenty_inconnect_dev_local_r1` en 55432 y cero
reservas activas. La copia del build V2 pasó la verificación de 16 162
archivos. El respaldo PostgreSQL `voice-v2.1-backup.BTU3Sd` se tomó
desde el snapshot de la misma transacción y se verificó el catálogo del
archivo. La inspección confirmó ambas filas de tracking y cursores,
constraints e índices. El inventario anterior y posterior fue idéntico,
con **27 llamadas, 46 tramos, 443 s y cero activas**.

La primera ejecución del instalador revirtió al contar constraints
`NOT NULL` de PostgreSQL 18 en la comprobación de forma. La inspección
confirmó `ready` antes de corregir el filtro y volver a ejecutar.
Las transacciones de prueba posteriores revelaron un callback terminal
sin marca de tiempo. La oferta ahora conserva el tiempo de recepción
en ese caso. Antes de reservar un siguiente agente, el SQL vuelve a
calcular el tiempo disponible después de comprobar su presencia.

El administrador original y `voice-pilot-dev@inconnect.test` se
configuraron por sus identidades reales de UserWorkspace. Ambos son
Executive activos en **Voice V2.1 — DEV** y participan en recepción y
Round Robin. Voice Test conserva el rol editable y los grants de
marcación e historial sin Lead ya otorgados. Su regla Lead
`ownRecords` y los permisos de lectura se verificaron. El equipo se
creó con la API de Commercial Teams. Antes del cambio ninguno tenía
equipo. El snapshot y el procedimiento de restauración se guardaron
en el runtime privado.

Los dos flags de Voice están en `true` en disco y en Nest. La TwiML
App y el número DEV siguen en el Quick Tunnel vigente. Los GET de
verificación coincidieron y los cuatro POST sin firma devolvieron 403.
Las comprobaciones de Nest, Vite y el túnel devolvieron 200. La ACL
ya cubría sesión, preferencia e intención de Voice V2.1. No requirió
ampliación. Admin obtuvo por API Phone, Calls y Recents, salientes
`ready` y disponibilidad entrante `offline` con preferencia inicial
`unavailable`. La credencial privada antigua de Voice Test devolvió
`FORBIDDEN`. La prueba manual usa la sesión existente o la contraseña
que Voice Test eligió al aceptar la invitación.

## Prueba manual desde dos navegadores

1. Abrir [Twenty DEV-LOCAL-R1](http://127.0.0.1:33001) en dos perfiles,
   con el administrador y con Voice Test. En Phone, elegir **Disponible**
   en ambas sesiones y esperar a que se confirme el estado efectivo.
   Todas las llamadas manuales parten del
   celular autorizado terminado en 2571 y entran al número DEV.
2. Con ambos disponibles, la coincidencia conocida ofrece primero al
   administrador propietario. Con el administrador **No disponible**,
   o **Desconectado**, ofrece a Voice Test si está disponible. Si se
   cierra una pestaña sin notificar, la concesión caduca en 35 s.
   Voice Test puede ver el número de la llamada y el Lead ajeno debe
   quedar fuera de su vista.
3. Con ambos disponibles, el administrador puede pulsar **Rechazar**
   o dejar pasar el timbrado. En ambos casos Voice Test es el siguiente
   candidato del equipo. Cancelar desde el celular detiene la oferta.
   Con ambos en **No disponible**, la llamada concluye sin asignación.
   Tras colgar una llamada atendida, Phone vuelve a la preferencia
   vigente si el Device sigue registrado.
4. Para rotación general, activar el escenario sin Lead de abajo.
   Hacer dos llamadas secuenciales, completar cada una y comprobar
   que rota entre las sesiones disponibles. Restaurar el teléfono al
   terminar. Para reproducir simultaneidad real con el propietario
   ocupado, puede hacer falta un segundo origen autorizado si la
   red del celular actual no permite sostener ambas llamadas.

### Escenario sin Lead

En WSL, el helper privado del piloto opera sólo sobre el Lead sintético.
Mientras cambia el compuesto telefónico deshabilita temporalmente ambas
direcciones. Verifica cero activas, comprueba por SQL dedicado que el
origen tiene cero coincidencias y confirma el lookup del administrador.
Si venía con las dos direcciones activas, las recupera al terminar una
comprobación satisfactoria.

```bash
pilot=/home/alberto/twenty-inconnect-dev-local-r1/voice-v21-install.FPBI4Kl1
python3 "$pilot/lead-scenario.py" stage
# Hacer las llamadas manuales acordadas desde el origen autorizado.
python3 "$pilot/lead-scenario.py" restore
```

Durante el ensayo, el campo primario vacío produjo cero coincidencias
y el valor estructurado original se restauró. El helper sólo usa el
valor alternativo terminado en 2572 si la actualización nativa deja
intacto el teléfono original. El 2572 jamás se usa para llamadas o
mensajes. **Estado al cierre: el teléfono original está restaurado.**

## Recuperación de DEV-LOCAL-R1

Tras el apagado se verificó la identidad del clúster PostgreSQL dedicado
en disco y a través de SQL en 55432. Redis en 56379 respondió por socket
y TCP con la misma identidad y permitió `GET`, `SET`, `DEL` y `EVAL`
para el prefijo Voice Inbound. Se recuperaron Nest en 33000, Vite en
33001 y Nginx en 34080 con el include entrante de V2. Nest arrancó con
migraciones y registro de cron deshabilitados.

El Quick Tunnel nuevo, con métricas en 32998, publicó
`survey-floating-garden-leisure.trycloudflare.com`. Se respaldaron la
TwiML App DEV, el número de entrada y la configuración local en el
runtime privado `voice-v2-recovery-20261127.7Ry25IJK`. El GET autenticado
posterior confirmó el cambio de las tres URLs Voice. Nest, Vite y
`/ready` de cloudflared respondieron 200. Las cuatro rutas públicas
rechazaron POST sin firma con 403, incluido un callback de salida con su
query canónico. Ambos flags persistentes y efectivos quedaron en
`true`. El inventario conservó 27 llamadas, 46 tramos, 443 s y cero
activas. La recuperación usó las rutas de V2 y no originó llamadas.
[Procedimiento de V2](INCONNECT_VOICE_V2_DEV_LOCAL_INSTALL.md)

## Presencia y selección

- **Phone** conserva el Device global durante navegación. El backend distingue
  preferencia manual, registro efectivo y estado telefónico. Cada combinación
  cuenta, workspace y UserWorkspace tiene una preferencia persistida en Redis
  y una concesión cifrada de 35 s. La preferencia inicial de V2.1 es
  Unavailable. El SDK comunica Registered tras confirmar signaling, y mantiene
  heartbeat de 10 s. La pestaña vigente es la única que puede renovar o
  retirar la concesión. Otra pestaña puede leer disponibilidad y modificar la
  preferencia de la misma persona. La sesión expirada, la ausencia de
  registro y la autoridad inválida impiden nuevas ofertas.
- La reserva activa manda sobre la presencia y la preferencia. Una oferta
  entrante sin puente se ve como Ringing. Una reserva saliente o una
  llamada conectada se ve como Busy. Al terminar, el backend devuelve
  Offline si falta un registro vigente, o la preferencia vigente si lo hay.
  La preferencia afecta nuevas ofertas.
- El webhook firmado y con ANI aprobado activa una consulta interna acotada
  a la identidad telefónica primaria exacta F13 y Owner del Lead. Usa
  metadata actual, el Owner configurado por Record Access y un máximo de
  dos coincidencias. El resultado distingue coincidencia única, ausencia
  real, ambigüedad, configuración incompleta y error de resolución.
- La coincidencia única ofrece primero al propietario que pueda recibir.
  Ante una reserva activa del propietario, considera sólo ejecutivos del
  mismo Commercial Team con membresía activa y elegibilidad telefónica.
  La ausencia confirmada usa el pool general explícito. La ambigüedad, el
  error y la falta de candidatos terminan con resultado persistido. Se
  conserva el Lead sin mutaciones y los cursores comerciales.
- La rotación ordena por Workspace Member ID, comienza tras el último
  reservado y vuelve al inicio. La fila del cursor se bloquea y avanza
  únicamente al confirmar la reserva telefónica. Oferta, cursor, llamada y
  tramo raíz quedan en una transacción. El índice parcial compartido con
  salientes y el lock de reserva por workspace excluyen reservas dobles.
  Un conflicto, un candidato que perdió disponibilidad o un error antes
  del commit no avanza el cursor.
- Una llamada lógica conserva su SID raíz. Cada oferta guarda su orden,
  agente, sesión, pool, resultado y duración si corresponde. El SID hijo
  se guarda como tramo con referencia a la oferta. Las candidaturas que
  nunca llegan a reserva no generan historial individual. La cancelación
  firmada antes de la primera reserva registra el cierre del mismo SID.
  Los callbacks de una oferta anterior no modifican la vigente. R1
  conserva prioridad para el action Dial que acredita puente y duración, y
  usa la terminación comprobada del padre como respaldo.

## Autoridad visible

La concesión para recibir, la elegibilidad del pool, la marcación, la
lectura de Leads y el historial son independientes. El receptor autorizado
puede aceptar una oferta con el número del llamante, aunque su permiso
actual o Record Access impidan mostrar el ID y nombre del Lead. Callbacks,
ofertas y tramos se correlacionan por cuenta, workspace, agente, sesión,
llamada y SIDs. Un callback operativo nunca representa a un humano.

Calls aplica la autorización vigente del Lead en SQL y conserva el
historial histórico admitido. La concesión de Calls existente admite
lectores explícitos. Un operador con acceso sólo por recepción ve sus
llamadas entrantes vinculadas cuando también puede leer el Lead. Recents
se limita al participante, con el teléfono histórico y el alcance actual
del Lead para vinculadas, y con el permiso de historial no vinculado para
las que carecen de Lead. Los intentos previos de distribución son
trazabilidad interna. Salientes de agentes adicionales exigen concesión
explícita y el permiso de marcación vigente. No hay cambios de Roles ni
reasignación o creación de Leads.

## Políticas habilitadas en el piloto

Fallback del propietario Offline o Unavailable al mismo Commercial Team
y reintentos por rechazo o timeout están aprobados y habilitados en
DEV-LOCAL-R1. La variante exige un Dial firmado sin puente, una llamada
raíz aún activa, una oferta vigente y el mismo pool autorizado antes de
probar otro agente. Una cancelación, respuesta confirmada o agotamiento
del pool o del presupuesto termina la distribución. El agente que ya
recibió una oferta queda fuera de intentos siguientes.

La configuración del piloto es **20 s por agente, hasta 3 ofertas y
60 s de distribución**, incluido el tiempo entre ofertas. Las últimas
ofertas pueden tener un timbrado más corto según el tiempo restante.

La espera de timbrado se configura mediante `INCONNECT_VOICE_RING_SECONDS`
(20 s por defecto, 8–25 s). La distribución usa
`INCONNECT_VOICE_DISTRIBUTION_ATTEMPTS` (2 por defecto, 1–5) y
`INCONNECT_VOICE_DISTRIBUTION_SECONDS` (55 s por defecto, hasta 90 s).
Twilio puede añadir margen al timbrado. Tras una respuesta HTTP perdida
después del commit, una oferta puede quedar sin entregar hasta que
Twilio confirme la terminación del padre. [Dial y callbacks](https://www.twilio.com/docs/voice/twiml/dial)

## Instalación dedicada y casos de prueba DEV

El Slow exacto `1795780800000` amplía las tablas existentes y agrega
ofertas y cursores. El instalador `dist/database/scripts/inconnect-voice-v21/install.js`
ofrece `--plan`, `--inspect` y `--install 1795780800000`. El último
exige flags deshabilitados, API detenida, ausencia de otros clientes,
identidad exacta, cero llamadas activas, respaldo del snapshot verificado
y comparación de huellas de historial, índices principales, grants y
tracking en la misma transacción del DDL y sus dos filas de upgrade.
La reversión de esquema se bloquea si existe distribución persistida.

1. Con autorización específica, respaldar el build V2, construir V2.1,
   comparar el plan del Slow y ejecutar el procedimiento dedicado
   únicamente en el clúster DEV-LOCAL-R1. Mantener el control persistente
   de Voice y las rutas Nginx ya aprobadas. V2.1 usa el mismo formato de
   callback firmado con el UUID de oferta en el parámetro de correlación.
2. Confirmar los IDs reales de UserWorkspace del administrador original
   y Voice Test. Configurar ambos en
   `INCONNECT_VOICE_RECEIVE_USER_WORKSPACE_IDS`. Incluir sólo los aprobados
   para rotación general o de equipo en
   `INCONNECT_VOICE_ROUND_ROBIN_USER_WORKSPACE_IDS`. Si Voice Test va a
   marcar, añadirlo a `INCONNECT_VOICE_DIAL_USER_WORKSPACE_IDS` y verificar
   el permiso vigente de marcación. Aplicar el permiso de historial no
   vinculado únicamente si el escenario exige Recents sin Lead.
3. Para el escenario B, confirmar que el propietario del Lead sintético
   pertenece al equipo de prueba y que Voice Test figura como Executive
   activo del mismo equipo. Comparar la pertenencia con el respaldo del piloto antes de modificarla.
4. Abrir las dos sesiones. Activar Receive calls y Available en ambas.
   Verificar Offline, Unavailable, expiración y reconexión. Llamar
   manualmente desde el origen autorizado con el propietario libre y
   comprobar la oferta directa. Repetir con el propietario reservado y
   comprobar la oferta a Voice Test con datos CRM redactados si el Lead
   queda fuera de su Record Access.
5. Para C, usar únicamente el procedimiento aprobado sobre el Lead
   sintético, con respaldo del número original y restauración. No originar
   ni enviar mensajes al número temporal terminado en 2572. Si la
   exclusión y rotación concurrentes requieren un segundo origen real o
   un segundo destino para el escenario B, identificarlo y autorizarlo
   por separado antes de probar.

PHYS-A0 sigue NO-GO.

## Validación e inventario

Las 111 pruebas focalizadas aceptadas fueron la línea base. En esta
ventana se ejecutaron las dos suites afectadas por las correcciones,
15 casos, y pasó typecheck de servidor, lint y formato acotados, y
`git diff --check`.

La prueba física ejecutó los stores reales sobre PostgreSQL dedicado con
transacciones revertidas. Se observó bloqueo concurrente entre entrada y
salida, exclusión única por agente, cursores independientes, dos ofertas
y tres tramos de una llamada, cancelación, callbacks tardíos, recuperación
de la reserva y agotamiento del límite de 60 s mientras se comprobaba
al siguiente candidato. Las huellas completas de llamadas, tramos,
ofertas y cursores quedaron idénticas. La instalación y la prueba física
no originaron llamadas Twilio. El timbrado y el audio quedan para el
piloto manual.

- Runtime Voice. `inconnect-voice-config.ts`, `inconnect-voice-actor.ts`,
  `inconnect-voice.service.ts`, `inconnect-voice-directory.service.ts`,
  `inconnect-voice-call.store.ts`, `inconnect-voice-provider.service.ts`,
  `inconnect-voice.module.ts`, `inconnect-voice-availability.ts`,
  `inconnect-voice-routing.service.ts`, `inconnect-voice-distribution.store.ts`
  y los archivos `inconnect-voice-inbound*`.
- Phone. `VoiceGlobalSoftphone.tsx`, `VoiceSoftphone.tsx`,
  `useVoiceInboundRegistration.ts`, `voiceApi.ts` y
  `VoiceCallProvider.test.tsx`.
- Instalación. Slow `1795780800000`, registro de Instance Commands,
  instalador `inconnect-voice-v21/`, helpers de inspección de Voice
  y `inconnect-voice-dev.py`.
- Evidencia local. La carpeta `.cache/inconnect-voice-v2.1/` guarda
  inventario y hashes, estado y diff de Git, comandos, salidas y
  resultados JSON. La configuración y los respaldos operativos están
  en `voice-v21-install.FPBI4Kl1` bajo el runtime privado. Allí están
  el snapshot del equipo, las huellas, el resultado de la prueba física,
  el helper de Lead y la evidencia de activación. Para recuperar la
  configuración original de Commercial Teams, deshabilitar ambas
  direcciones, ejecutar `pilot-configure.py restore-team` con
  `VOICE_EVIDENCE` apuntando a ese directorio y
  `PYTHONPATH` apuntando a `.cache/inconnect-voice-v1.4/sync-pilot`.
  El script verifica los miembros exactos y elimina sólo el equipo DEV
  que se creó para estas pruebas.

## Evolución

- En **V3**, transferencias directas y asistidas entre ejecutivos y
  coordinadores, Hold, recuperación de transferencias e historial de
  participantes. Conference permitiría mantener al llamante en un puente
  mientras entran/salen agentes. Eso requiere identificadores de
  Conference y participante, autorización por participante, y control de
  las transiciones de Hold y Transfer. La llamada lógica y las ofertas
  de V2.1 mantienen sus identidades. El agente que contestó la primera
  oferta sigue siendo un hecho histórico.
- En **V3.1**, grabación entrante y saliente, reproducción en Twenty,
  correlación con la llamada lógica, permisos de acceso y descarga,
  aviso, consentimiento, retención y costos.
- En **V4**, supervisión de agentes, disponibilidad, llamadas activas y
  métricas individuales y por Commercial Team.

## Commit manual del cierre

Ejecutar estos comandos desde WSL. El manifiesto usa rutas literales.
Los pasos comprueban la rama y el índice antes de preparar el commit.

```bash
(
  set -euo pipefail
  cd /home/alberto/projects/twenty-inconnect
  manifest=packages/twenty-server/docs/INCONNECT_VOICE_V2_1_COMMIT_FILES.txt

  test "$(git branch --show-current)" = feature/inconnect-lead-management
  git diff --cached --quiet
  git --literal-pathspecs add --pathspec-from-file="$manifest"
  diff -u <(LC_ALL=C sort "$manifest") <(git diff --cached --name-only | LC_ALL=C sort)
  git diff --cached --check
  git diff --cached --stat

  git commit -m "feat(voice): close Voice V2.1 multi-agent pilot and R1"
  git push origin HEAD:refs/heads/feature/inconnect-lead-management
)
```
