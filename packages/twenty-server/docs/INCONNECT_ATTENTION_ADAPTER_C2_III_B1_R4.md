# INCONNECT — C2-III-B1-R4: unidad causal inbound transaccional

Fecha: 2026-10-23. **Entrega integrada SOURCE-ONLY para auditoría independiente.
No habilita tracking, no declara B1 completada y no acredita PostgreSQL físico.**

Auditoría comunicada: **REQUIRES REMEDIATION**. La remediación F1/F2/F3 del
2026-10-26 y su validación se documentan en la sección 19 para nueva revisión.

## 1. Preflight y alcance efectivo

Git exclusivamente en lectura: rama `feature/inconnect-lead-management`, HEAD
`914df6578f` (`feat(inconnect): add source-only durable inbound attention adapter`),
worktree limpio y staging vacío antes de editar. El checkpoint R3 fue realizado
por el usuario. Se conserva su aceptación independiente comunicada: 80 suites /
1.424 pruebas y 50 casos independientes; estos últimos son antecedentes y no se
cuentan como ejecuciones R4. No se reescriben documentos aceptados.

Se leyeron AGENTS.md y C2 DESIGN, I-A/B, II, III-A, B1 y R1/R2/R3; se contrastaron
controller/ingress/routing/Twilio, persister R2, processReceipt/claim/recovery y
BullMQ, entidades/DDL/guards, reader/writer y R3 reales, media/Attachments,
publicador/realtime y F13 post-persistencia, más las transacciones y envelopes
del PostgresQueryRunner TypeORM instalado. No se usa Enterprise RLS ni un flujo
syncable. No se conectó PostgreSQL ni se inició infraestructura.

La entrega implementa el conjunto causal en fuente y modifica dos puntos
operativos: la barrera de selección legacy del worker y el consumidor Outbox.
**El nuevo ejecutor no se registra en Nest/BullMQ.** Su composición de worker se
prueba con I/O simulado, incluyendo claim, transacción, commit y recuperación;
no es otra implementación del reducer ni un preflight que sólo devuelva READY.
Contiene las escrituras reales parametrizadas de Conversation/Epoch, Message,
Attachments, actividad, Outbox inbound y Receipt; invoca R3/III-A reales.

La parte detenida es el cutover operativo ENABLED, que requiere obligaciones
externas y rutas fuera de esta autorización. No se sustituye por un booleano
`trusted`, un flag ambiental o fallback legacy.

## 2. Arquitectura final y punto de sustitución

Directorio privado: `attention-adapter/inbound/transactional/`.

```text
Ingreso R2 autenticado -> Receipt durable v1 -> COMMIT recepción
    -> transporte existente, sólo receiptId
    -> identidad backend Receipt/workspace/conexión
    -> claim corto condicionado y COMMIT del claim
    -> executeTrackedInbound: runner master exclusivo, READ COMMITTED
        -> prepareTrackedInbound: unidad causal completa
        -> COMMIT confirmado -> resultado COMMITTED
    -> publicación Outbox y solicitud media independientes
    -> publisher existente -> F13 en su propia transacción -> realtime autorizado
```

`processTrackedInboundJob` recibe sólo receiptId, carga la identidad del Receipt
inbound v1 exacto desde PostgreSQL y llama a `processTrackedInboundReceipt`. Éste
compone claim, ejecución, fallos, reconciliación y trabajo posterior. No recibe
hechos, actor, versión o epoch elegidos por un job/cliente. La selección/custodia
del ámbito todavía necesita aprobación antes de conectarlo al job existente. No se crea una segunda cola ni un segundo
publicador.

El punto exacto de reemplazo es la unidad de `processReceipt`: **claim corto
terminado y antes de entrar a su callback causal legacy que bloquea Receipt**.
La composición nueva reemplaza esa unidad y sus efectos posteriores; nunca se
llama al writer después de confirmar el Message legacy. En esta entrega el
worker vigente llama `requireLegacyInboundRoute` al inicio de su unidad inbound,
antes del segundo lock Receipt. Esa barrera mantiene SHARE hasta el commit y
rechaza cualquier ruta que todavía no puede seleccionar con seguridad.

`prepareTrackedInbound` devuelve solamente PREPARED. `executeTrackedInbound`
posee connect/start/commit/rollback/release y sólo produce COMMITTED después de
que `commitTransaction()` resuelva. No hay éxito durable por un resultado III-A.

## 3. Secuencia real de locks y sesión

La unidad nueva emite:

1. Verificación C2-II de sesión; Configuration del workspace `FOR SHARE`.
2. Catálogo R2 y locator Receipt sin lock, usado sólo para localizar address.
3. Revalidación de conexión/routing actual, bajo la barrera Configuration.
4. Diferimiento del conjunto explícito de constraints aceptado.
5. Resolver/INSERT Conversation por la UNIQUE conexión/address; sentencia nueva
   de lectura de la ganadora `FOR UPDATE` y relectura separada de raíz/Epoch.
6. Lifecycle nuevo o validación de Epoch READY existente.
7. Receipt exacto `FOR UPDATE`; nueva lectura del hecho completo y del lease.
8. Message por conexión/provider ID `FOR UPDATE`, o INSERT real si está ausente;
   Attachments de intención y actividad de Conversation cuando el Message es nuevo.
9. R3 -> III-A -> II -> C1/reducer; locks comunes se reobtienen sobre las mismas
   filas. Las nuevas lecturas no reparan inversiones anteriores.
10. Ledger/Audit/estado/Outbox de atención, Outbox inbound y finalización Receipt.
11. Constraints pertinentes IMMEDIATE, control final de sesión y único COMMIT.

No se mantiene el orden Receipt -> Conversation del camino legacy. El claim
anterior sólo bloquea transporte y termina antes de Configuration. No hay lock
CRM, DispatchAttempt, segundo manager, savepoint, batch ni réplica. El ejecutor
conserva el manager original desde la creación del runner y verifica su identidad
antes/después de preparar. C2-II conserva PID/conexión/xid8/manager exactos.

El owner establece READ COMMITTED y presupuestos locales de statement 10 s y
lock 2 s, con row_security off según C2-II; el reader vuelve a verificarlos.
Son límites de fuente de esta preparación, no un SLO físico aceptado. El lease
es de cinco minutos con reloj PostgreSQL. El protocolo requiere un único evento
por Conversation/transacción y uso exclusivo del runner.

Locks implícitos de FKs, especulación/espera de UNIQUE, visibilidad de snapshots,
triggers y deadlocks reales siguen requiriendo aceptación física. En particular,
los padres de Workspace/ProviderConnection pueden adquirir key-share por FK;
ninguna prueba de mocks demuestra su interacción con escritores externos.

## 4. Conversation nueva y Epoch real

El INSERT de Conversation omite el tuple tracking, como exige el guard aceptado.
`ON CONFLICT (providerConnectionId, externalAddressNormalized) DO NOTHING`
resuelve sólo esa identidad; no silencia otros constraints. Se exige 0/1 filas
y, si insertó, el ID retornado debe ser el candidato generado por backend.

Una sentencia nueva bloquea la ganadora y valida workspace, conexión, address
e ID. Sólo si esta unidad **insertó esa misma fila** puede preparar su Epoch:

- Leer raíz bajo lock y exigir tuple NULL y pendingAt NULL para la nueva fila.
- INSERT del padre Epoch real PREPARING, versiones/política aceptadas, revisión
  cero y baseline copiado directamente desde Conversation dentro de PostgreSQL.
- `bootstrapReference = ["new-inbound-conversation-v1", receiptId, conversationId]`.
- UPDATE del puntero/status/revisión de Conversation desde ese Epoch, preservando
  pendingAt sin round-trip Date.
- UPDATE de Epoch PREPARING -> READY con activatedAt servidor.
- Releer raíz; ejecutar decoders y mapper C2-I-A y exigir READY/mismo C/puntero.

Epoch referencia inmediatamente a Conversation ya existente. El puntero inverso
usa la FK diferida aprobada; los guards verifican creación atómica del Epoch y
baseline. Message se inserta después de READY. No se fabrican padres ni se
escriben marcadores xid8; los triggers aceptados los producen.

| Agregado encontrado | Resultado de fuente |
| --- | --- |
| Nueva fila insertada aquí y pristine | Lifecycle anterior, seguido del primer inbound en la misma unidad |
| Ganadora ya existente con READY coherente | Reutilizar y validar; no crear otro Epoch |
| Histórica con tuple NULL | HISTORICAL_CONVERSATION_NOT_READY; sin bootstrap |
| Puntero distinto, Epoch ausente/contradictorio o scope cruzado | Rechazo/rollback |
| PREPARING, SUSPENDED o CLOSED | Rechazo; no transición de negocio |

No se reescriben Messages históricos, no hay preparación por lectura ni rotación
por retry. El INSERT ganador es la prueba de novedad dentro de la unidad, no un
SELECT vacío anterior ni un UUID preasignado aislado.

## 5. Message y Attachments

El mapping ORM de origen permanece dormante. Se usa INSERT raw parametrizado
sobre el **mismo QueryRunner**, enumerando workspace, Conversation, conexión,
epoch, INBOUND, providerMessageId, tipo, body literal, metadata JSON íntegra y
los cuatro campos temporales/fuente. Timestamps se pasan como strings normalizados
v1; createdAt/updatedAt y marcadores causales siguen siendo de PostgreSQL. Los
campos outbound/template ausentes conservan NULL; no se inventa HUMAN.

El lookup previo no filtra dirección o workspace para ocultar un conflicto de
la identidad única conexión/provider ID: toda ganadora debe concordar con C,
dirección y origen no NULL del Epoch actual. R3 contrasta además contenido,
metadata y tiempos exactos. Un Message histórico no recibe UPDATE técnico ni
un origen nuevo. Message existente sin Effect consumido no supera la exigencia
de creación causal de III-A.

El INSERT no ignora conflictos. Un 23505 del índice conocido de provider ID se
captura sin texto sensible y admite como máximo una ejecución nueva completa;
un constraint desconocido necesita intervención. Nunca se continúa la unidad
abortada ni se presupone que un UNIQUE demuestra contenido igual.

Attachments nuevos llevan ID backend, Message/workspace/conexión, ordinal,
tipo, locator opaco, MIME declarado y filename. La política existente decide
PENDING o FAILED por metadata/MIME, sin descargas. Replay no reinserta ni
repara adjuntos; R3 exige el conjunto de intenciones completo. LOCATION sigue
estructurado sin Attachment y Unicode sigue TEXT. El UPDATE de actividad usa
GREATEST para lastInboundAt y conserva waId cuando el hecho trae NULL; no toca
Favorite, Unread, cursor ni baseline personal.

## 6. Composición R3 / III-A y originales

Se llama `prepareDurableInboundAttentionWrite` real sobre ese runner, S, Receipt,
lease y Message. Se preservan:

- eventKey `['whatsapp-inbound-v1', Receipt.id]`.
- effectKey `['INBOUND', Message.id]` y fingerprint `['INBOUND_RECEIVED', Message.id]`.
- BACKEND/actor null y referencias T1/correlación derivadas por R3.
- Reader autoritativo II, writer III-A, proyección C1 y reducer aceptados.
- Revisiones decimales exactas/BigInt y originales propio/canónico separados.

No hay otra decisión de atención en la coordinación. APPLIED abre o renueva
PENDING; PENDING->PENDING conserva pendingAt por el writer/guard. Duplicados
no incrementan ni emiten otra Outbox de atención. CONFLICT, ok:false, rechazo
de admisión o excepción abortan la unidad; no se captura el error para confirmar
un Message aislado. III-A inserta Effect -> Audit -> AttentionReceipt, actualiza
estado cuando corresponde y emite su Outbox; conserva sus doce obligaciones
explicadas en el contrato aprobado.

La única refactorización R3 comparte las mismas comprobaciones v1 de correlación
entre dos decoders: el original PROCESSING/lease válido no cambia de contrato;
se añade un decoder separado para reconciliar PROCESSED, lease/token NULL y
processedAt válido. No se convierte PROCESSED a PROCESSING para reutilizarlo.
No se cambian II/III-A/I-A/B, C1, reducer, entidades ni Fast Commands.

## 7. Receipt, Outbox y COMMIT

Después del lock Receipt se relee y compara el hecho completo contra el locator;
la versión debe seguir siendo exactamente 1. Se exige PROCESSING, token scoped,
attemptCount positivo, unfinished y lease vigente con clock_timestamp posterior
al lock. R3 y III-A vuelven a comprobar su contrato causal.

Outbox inbound conserva tipo, aggregate MESSAGE, payload y deduplicationKey
`inconnect-messaging:receipt:${receiptId}:message` del proyecto. Se inserta sin
orIgnore para Message nuevo. Si se reutiliza Message, se exige la Outbox original
exacta por key, workspace, aggregate, tipo y payload; no se certifica equivalencia
por existencia de un UUID.

La finalización es UPDATE condicionado por id/workspace/conexión, inbound/v1,
PROCESSING/token, processedAt NULL y lease vigente con clock_timestamp. Un CTE
SELECT permite verificar envelope, affected=1 e ID exacto. Guarda processedAt
servidor y limpia lease/error; no cambia el hecho congelado ni la versión.

Message, Attachments, actividad, Epoch nuevo cuando corresponde, ledger/audit,
ambas Outbox y finalización Receipt pertenecen a un único COMMIT causal. Lecturas
repetidas no congelan el reloj: la política exige vigencia en adquisición y
finalización, con exclusión por lock hasta commit. No afirma que el instante de
commit sea anterior al deadline del lease; esa propiedad temporal necesita
política y pruebas físicas específicas.

## 8. Consumidor realtime y F13

El consumidor existente reconoce CONVERSATION_ATTENTION_CHANGED y conserva
CONVERSATION_UPDATED como hint público. Exige aggregate CONVERSATION y payload
exacto `{ conversationId: aggregateId }`; busca Conversation por workspace/id,
rechaza malformed/missing antes del fanout y valida la identidad autorizada para
este evento. No hay un stream paralelo ni payload de contenido/CRM/persona.

Cada candidato pasa otra vez por `findAuthorizedConversation`, que conserva la
autoridad Messaging/Record Access vigente. Candidatos de otro workspace se
excluyen. Los tests revocan un miembro después de enumerar candidatos y antes
de su autorización individual; no recibe hint. Una entrega fallida mantiene la
Outbox recuperable; cero destinatarios autorizados puede completar normalmente.
Las semánticas de hints antiguos se conservan.

`requestCommittedInboundWork` sólo acepta COMMITTED y solicita publicación y
media mediante dependencias del transporte existente. Cada fallo posterior
queda separado mediante allSettled. Una caída antes del enqueue deja Outbox o
Attachments PENDING para sus recoveries actuales. La publicación puede repetirse;
no se promete exactamente una entrega.

F13 permanece exclusivamente detrás de INBOUND_MESSAGE_RECEIVED en el publicador,
con su transacción CRM separada y autoridad actual. Una falla F13 mantiene ese
Outbox para retry y no revierte Message/atención ya confirmados. No se añade una
lectura, creación o autoridad CRM al coordinador. Send/Dispatch/callbacks outbound,
Pending manual, Leads, Record Access y Commercial Teams no se modifican.

## 9. Retry, recovery y commit indeterminado

El claim preparado usa el Receipt existente, READ COMMITTED y una transacción
corta: RECEIVED o PROCESSING realmente expirado, versión 1, scope exacto, menos
de diez intentos, lease/token nuevo y reloj DB. Reevalúa elegibilidad al escribir;
no reclama PROCESSED/FAILED, no renueva un lease válido ni altera hechos.
BullMQ continúa transportando receiptId; su deduplicación no demuestra consumo.

El ejecutor usa a lo sumo tres transacciones por invocación para 40P01/40001,
con pausa breve/jitter fuera de la unidad y mismo Receipt/provider/event identity.
23505 del único índice conocido de Message permite como máximo una relectura
completa nueva. 23505 desconocido, datos contradictorios y procedencia no probada
necesitan intervención. 55P03/57014/conexión no producen ausencia y quedan como
fallos acotados recuperables cuando el rollback se confirmó.

Después de rollback confirmado, release condiciona todo el scope/PROCESSING/token;
un procesador distinto nunca se sobrescribe. Retry vuelve a RECEIVED mientras
queden intentos; intervención va a FAILED. Un Receipt expirado que agotó intentos
se terminaliza mediante UPDATE condicionado, sin sobrescribir PROCESSED ni un
lease vigente. Esto evita un bucle de recovery ilimitado sobre esa fila.

Cualquier error durante COMMIT, o rollback no confirmado, produce
COMMIT_INDETERMINATE. No retorna COMMITTED ni libera/marca FAILED el Receipt.
Un rollback posterior de mejor esfuerzo **no** demuestra que el COMMIT falló.
Recovery debe leer los hechos durables con las mismas identidades: si realmente
no confirmó, un takeover legítimo tras expiración puede repetir toda la unidad;
si confirmó, PROCESSED exige reconciliación, sin fake claim ni otro eventKey.

## 10. Reconciliación separada de PROCESSED

En una transacción primaria nueva, `reconcileTrackedInbound` usa locator/Message
sólo como pistas de S y llama al reader II real. Bajo sus locks comunes exige
ambos slots consumidos, original inbound APPLIED y evaluación C1 DUPLICATE /
SAME_EVENT. Recupera los dos originales por separado; no inserta otra auditoría.

Después verifica catálogo/versión R2, hecho PROCESSED completo contra el decoder
v1 compartido, conexión actual, origen/Message/Attachments y referencias BACKEND
T1/correlación del audit original. Exige ambas Outbox originales con sus identidades,
aggregate y payload. Un original faltante o Receipt legacy PROCESSED falla como
evidencia no probada; nunca se interpreta como nueva recepción.

El hecho PROCESSED se solicita con processedAt textual; no se inventa un token
ni se transforma su estado para pasar la admisión PROCESSING de R3. El resultado
es RECONCILED; el owner termina esa unidad de lectura antes de solicitar delivery.
Un error/commit ambiguo de la reconciliación no afirma éxito. No hay transición,
Message/Epoch nuevo ni reparación automática por esta ruta.

## 11. Duplicados, carreras y fallos

Las seis suites R4 prueban al coordinador real y la composición del owner/worker,
no sustituyen reader/writer/reducer por respuestas positivas. Sus scripts verifican
SQL, orden, parámetros, cardinalidad y envelopes y retienen sus mismatches fuera
del catch productivo. Los hechos positivos proceden del ingress/capacidad/persister
R2 reales con firma Twilio local y serialización durable simulada.

Se ejercitan nueva/existente READY, ganador de UNIQUE/relectura, espera de lock,
replay con Message/Effect existentes, scope/origen NULL/otro epoch/dirección y
contenido contradictorio, histórica sin preparar, PREPARING/SUSPENDED/CLOSED,
claim válido/BUSY/takeover emitido, versiones NULL/desconocidas, conexión revocada,
revisión >int64, media, fallos por escritura/cardinalidad, finalización/lease,
rollback, retries acotados y ambigüedad de COMMIT.

La espera por promesa sólo demuestra que el código no avanza antes del lock
simulado. Los tests de UNIQUE/lease comparan las sentencias emitidas y sus
respuestas controladas; **no** prueban una carrera de dos sesiones ni MVCC.
Tampoco inventan dos Receipts válidos del mismo provider ID eludiendo la UNIQUE
real. La exclusión física de duplicados concurrentes sigue pendiente.

## 12. Selección de ingreso/procesamiento y compatibilidad

| Estado | Comportamiento preparado / barrera efectiva |
| --- | --- |
| Pre-DDL completo ausente | Worker legacy autorizado; SQL de barrera sólo usa to_jsonb de Configuration |
| DISABLED con tres columnas | Legacy autorizado, incluido v1 R2 recibido en ese modo; sin tracking |
| Instalación parcial, ausente/corrupta o consulta fallida | Rechazo; nunca ausencia interpretada como legacy |
| PREPARING / SUSPENDED | Worker inbound no entra a unidad legacy ni tracked |
| ENABLED | **Cerrado en el worker operativo**; no se instala el nuevo ejecutor |
| Receipt NULL histórico | No se promueve a v1 ni se envía a tracked |
| Receipt v1 y ENABLED en pruebas causales | Se ejercita la unidad bajo prerrequisitos simulados, no una política de rollout aprobada |
| Callbacks/media existentes | Conservan su transporte/lifecycle actual; no se inicia C/B2 |

**Incompatibilidad conservada explícitamente:** R2 sigue emitiendo v1 sólo en
DISABLED y R3 exige ENABLED para escribir atención. R4 no cambia a escondidas
la emisión aprobada ni asume que basta cambiar el gate. El futuro cutover debe
admitir v1 en ENABLED solamente tras cerrar TODOS los prerequisitos, coordinar
writers, desplegar/drenar y resolver Receipts pendientes anteriores al corte.
Cambiar una constante o registrar el source worker no satisface ese contrato.

`trackedInboundReleaseBlockers` enumera las obligaciones; no es una colección
de booleans que el caller pueda afirmar verdaderos. No se registra la policy
DIRECT_TLS_V1, no se inventa origen/proxy y no se altera TLS/TRUST_PROXY/SERVER_URL.
El camino inseguro de activación se detiene; la composición causal segura queda
implementada y auditable de manera integrada.

## 13. Revocación y escritores reales

La búsqueda de entidad/nombre físico no encontró API administrativa de gestión
de ProviderConnection en producción. Se preserva el helper inerte R2
`prepareProviderConnectionDisable`: Configuration UPDATE -> mutación scoped.
Routing, sender, dispatch, media y worker son lectores. Transport-spine DDL,
provisioning/SQL de operadores y restore son vías adicionales que una política
de despliegue deberá controlar; no se modifican indiscriminadamente.

Contrato mínimo para **toda** mutación/revocación/rotación/routing/identidad:
Configuration del workspace FOR UPDATE antes de ProviderConnection; el procesador
mantiene Configuration FOR SHARE y relee conexión después de obtenerlo hasta
commit. No tomar Configuration después de Conversation ni añadir un lock tardío
como reemplazo. Un escritor privilegiado no participante puede revocar después
del último SELECT y antes del COMMIT: esta entrega no afirma serialización global.
Revocación remota sólo en Twilio no es visible automáticamente en PostgreSQL.

Falta inventario operativo y adopción verificable por todos los escritores y
operadores. No se inspeccionan ni cambian roles/grants reales. Este bloqueo basta
para mantener la ruta tracked sin activación aunque sus tests sean verdes.

## 14. Restore, custodia y legacy

T1 conserva el supuesto de backend y operadores confiables de R2. Una fila v1
importada arbitrariamente no acredita nuevo ingreso; el número de versión no
certifica custodia. No se implementa T2 ni se pretende resistir SQL privilegiado
que copie hechos, quite guards o transplante marcadores xid8.

Antes de reanudar jobs después de restore se requiere procedimiento autorizado:
conservar backup original/custodia e integridad; verificar versión aplicación/DDL,
configuración/conexiones, scopes y completitud Receipt/Message/Epoch/ledger/
originales/Outbox; revisar leases/jobs y el contador de instalación de los xid8;
cuarentenar restauraciones parciales o de origen no probado; habilitar entradas
y consumidores sólo después de revisión. No fabricar originales C1 ni epochs.

No hay cuarentena física, export/import o procedimiento automático implementado
en R4. Se conservan los límites de R2 y el exportador actual. Receipts NULL y
Messages legacy mantienen su clasificación; historia no preparada sigue NOT_READY.
Purga, retención y borrado de workspace son trabajos separados.

## 15. Validaciones ejecutadas

Node Linux v24.16.0 en PATH. Nuevas suites y baseline se ejecutan por separado,
sin sumar reejecuciones focales. Los resultados finales y comandos concretos se
registran al cierre de la validación abajo.

Pruebas nuevas: `tracked-inbound.spec.ts`, `tracked-inbound-failures.spec.ts`,
`tracked-inbound-execution.spec.ts`, `tracked-inbound-reconciliation.spec.ts`,
`tracked-inbound-realtime.spec.ts`, `tracked-inbound-boundary.spec.ts`.

Baseline: las mismas 80 rutas explícitas R3 en `/tmp/c2-r4-baseline-paths.json`:
R3/R2 y sus regresiones, III-A/II/I-A/B/C1/reducer, schema/guards/registro y todas
las suites Messaging seleccionadas de Webhook/Receipt/Twilio/routing/worker,
Outbox/realtime/media/F13. No se selecciona `.postgres.spec.ts`, reset, PG0/PG1,
Stage C5 o exact-upgrade. No se cuenta la auditoría histórica como tests nuevos.

Resultados finales efectivamente ejecutados:

| Validación | Resultado |
| --- | --- |
| R4 nueva, seis suites | **128 PASS**, cero fallos/omisiones |
| R3/R2 y regresiones anteriores, 80 suites | **1.424 PASS**, cero fallos/omisiones |
| Total único de la entrega | **86 suites / 1.552 PASS** |
| Typecheck completo twenty-server | `tsgo --noEmit --incremental false`: exit 0 |
| Typed lint explícito | 20 TypeScript, cero errores/warnings |
| Nx lint:diff-with-main, dependencias excluidas | PASS |
| Formato explícito | 20 TypeScript PASS |
| Whitespace tracked, cached y 16 nuevos por no-index | PASS |

Desglose R4: 13 unidad causal/media/replay, 52 fallos, 22 owner/worker/recovery,
14 reconciliación, 11 realtime y 16 fronteras. No se suman reejecuciones.
La primera regresión detectó dos incompatibilidades con fixtures de hints antiguos
al ampliar una comprobación del publicador; se limitó la comprobación adicional
de identidad al nuevo evento y las 80 suites finales volvieron a pasar. Las primeras
iteraciones también corrigieron tipados/scripts de los tests nuevos; no se modificó
ningún contrato C2 aprobado para hacerlos pasar.

Desde la raíz, con Node Linux v24.16.0 en PATH, se ejecutaron:

```sh
node_modules/.bin/jest --config packages/twenty-server/jest.config.mjs --runInBand packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/inbound/transactional --json --outputFile /tmp/c2-r4-focal.json
node_modules/.bin/oxlint --type-aware -c packages/twenty-server/.oxlintrc.json <los 20 TypeScript del inventario>
node_modules/.bin/oxfmt --check <los mismos 20 TypeScript>
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-r4-nx-data NX_CACHE_DIRECTORY=/tmp/c2-r4-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
git diff --check
git diff --cached --check
```

Desde `packages/twenty-server`, `../../node_modules/.bin/tsgo --noEmit
--incremental false` y Jest `--config jest.config.mjs --runInBand --runTestsByPath`
con las 80 rutas de `/tmp/c2-r4-baseline-paths.json`, pasadas como argumentos
estructurados mediante subprocess. Resultado en `/tmp/c2-r4-baseline.json`.

Evidencia: `/tmp/c2-r4-{focal,baseline}.json` y `.log`,
`/tmp/c2-r4-typecheck.log`, `/tmp/c2-r4-lint.log`,
`/tmp/c2-r4-format-final.log`, `/tmp/c2-r4-diff-lint.log` e inventario
`/tmp/c2-r4-inventory.json`. Nx usa main...HEAD y no cubre untracked: los 20
TypeScript tienen checks explícitos. Markdown está excluido por la configuración;
se revisa estructura/whitespace sin cambiar esa exclusión. No se instaló parser
SQL ni se ejecutó SQL/UP/DOWN para estas validaciones.

## 16. Garantías de fuente y obligaciones físicas

Se acredita la composición de código y sus dependencias reales, SQL parametrizado
emitido, orden y fail-closed, conservación de identidades, PREPARED vs COMMITTED,
finalización scoped, decoder de recuperación y compatibilidad/fanout del consumidor.
Se comprueba que fallos rechazan la unidad y que el owner solicita rollback antes
de retry; un doble no demuestra que PostgreSQL efectivamente revirtió filas.

No se acredita: instalación/resolución/planes SQL, paridad instalada de catálogo,
triggers/guards/FKs/deferred constraints, xid8 servidor, envelopes reales del
driver, locks y sus FK implícitas, aislamiento/MVCC, carreras de UNIQUE/lease,
commit/rollback/caídas físicos, visibilidad post-lock, revocación global, roles,
custodia/restore, topología TLS/proxy ni entrega efectiva Twilio/Redis/FileStorage.
Todo ello necesita autorización y aislamiento físicos aceptados independientes.
Otro puerto o nombre de base de datos no establece aislamiento.

## 17. Bloqueos exactos y qué falta para cerrar B1

1. Aceptación PostgreSQL física aislada de esquema/guards/driver, unidad causal,
   locks/carreras/leases, rollback/COMMIT ambiguo y recuperación.
2. Cutover de ingreso y procesamiento: extensión revisada de emisión v1 en
   ENABLED, criterios completos de release, drenaje de Receipts/legacy, selección
   de ámbitos desde receiptId y configuración real de origen/topología. R2 no se extiende aquí.
3. Participación de todos los escritores ProviderConnection en Configuration
   UPDATE y aceptación de revocación frente al SHARE del procesamiento.
4. Coordinación de escritores outbound/manual antes de activar el gate global;
   no se inicia su implementación B2/C en esta entrega.
5. Procedimiento de custodia/restore y operación/monitoreo/reintento manual ante
   FAILED/corrupción; retención/purga y borrado siguen separados.
6. Auditoría independiente única de este conjunto R4 y autorización posterior de
   integración/ejecución. La ruta tracked no se instala por el éxito de mocks.

Estos bloqueos impiden activar, no impiden entregar la unidad causal completa en
fuente. No se declara B1 completada ni se presenta el corte cerrado como ENABLED
operacional. Se recomienda una auditoría única que revise lifecycle, SQL/orden de
locks/FKs, correlación y finales, ambigüedad/recovery y frontera de cutover.

## 18. Inventario Git

Cinco tracked modificados:

- `services/inconnect-messaging-webhook-processing.service.ts`: barrera inbound
  previa al lock causal Receipt, sin registrar ruta tracked.
- `services/inconnect-messaging-outbox.service.ts`: allowlist, payload/aggregate
  y fanout autorizado del nuevo evento.
- `attention-adapter/inbound/durable/decode-durable-inbound-fact.ts`: misma
  correlación v1 compartida y entrada separada de reconciliación PROCESSED.
- `attention-adapter/inbound/__tests__/legacy-inbound.fixtures.ts` y
  `__tests__/inconnect-messaging-webhook-processing.service.spec.ts`: I/O de
  Configuration DISABLED para las regresiones legacy existentes.

Quince TypeScript nuevos bajo `attention-adapter/inbound/transactional/`:

| Archivo | Responsabilidad |
| --- | --- |
| tracked-inbound-contract.ts | Referencias internas, errores, shape de DML y blockers de release |
| tracked-inbound-sql.ts | SQL de Conversation/Epoch/Receipt/Message/Attachments/Outbox |
| prepare-tracked-inbound.ts | Coordinador causal real y composición R3 |
| execute-tracked-inbound.ts | Ownership transaccional, retries y trabajo post-COMMIT |
| tracked-inbound-recovery.ts | Claim/release/exhaustion scoped y acotados |
| reconcile-tracked-inbound.ts | Recuperación read-only de PROCESSED/originales/ambas Outbox |
| process-tracked-inbound-receipt.ts | Composición de worker SOURCE-ONLY sin registro |
| inbound-route-boundary.ts | Selección legacy cerrada para ámbitos no liberados |
| __tests__/tracked-inbound.fixtures.ts | Driver estricto + R2/R3/II/III-A/C1/reducer reales |
| __tests__/tracked-inbound.spec.ts | Unidad causal positiva, media, replay y revisiones |
| __tests__/tracked-inbound-failures.spec.ts | Fallos de etapas, datos, lease y readiness |
| __tests__/tracked-inbound-execution.spec.ts | Worker/commit/rollback/retries y post-COMMIT |
| __tests__/tracked-inbound-reconciliation.spec.ts | Originales durables sin fake PROCESSING |
| __tests__/tracked-inbound-realtime.spec.ts | Consumidor real/fanout/revocación/malformed |
| __tests__/tracked-inbound-boundary.spec.ts | Legacy/gates/ausencia de activación |

Se añade este documento. Total: **5 modificados y 16 nuevos**, sin staging.
`git diff --stat` no incluye untracked; se revisan también por no-index y mediante
inventario explícito. No se modifica AGENTS.md, documentos aprobados, entidades,
Fast Commands, contratos II/III-A/C1/reducer, frontend, outbound/manual, seguridad
CRM ni configuración real. Git permanece read-only, sin commit, fetch ni refs.

Estado de cierre: misma rama y HEAD `914df6578f02c2895b0089c7f38478625446807b`;
5 tracked modificados y 16 untracked, staging vacío. No se hizo commit ni Git
write. No se conectó PostgreSQL ni se ejecutó SQL real, Fast Command/migración,
setup/reset/generator, servidor/worker/Redis/Twilio de red, tracking, despliegue,
export/import o modificación de roles/grants/datos. PG0/PG1/Stage C5/exact-upgrade
permanecen bloqueados. No se inicia B2 o C.

## 19. Remediación F1/P1, F2/P2 y F3/P2 — 2026-10-26

Esta sección sustituye las disposiciones defectuosas descritas en las secciones
9 y 12 y sus observaciones de validación/inventario cuando difieran. La auditoría
independiente comunicada emitió **REQUIRES REMEDIATION**. Esta reparación es
SOURCE-ONLY y se entrega para una nueva revisión; no declara R4 aceptada ni B1
completada. No inicia B2/C ni registra el worker tracked.

Preflight de esta remediación: `feature/inconnect-lead-management`, HEAD exacto
`914df6578f02c2895b0089c7f38478625446807b`, cinco tracked modificados por R4,
dieciséis archivos nuevos y staging vacío. R4 no estaba comprometida. Los cambios
preexistentes se conservaron. AGENTS.md no se modifica y Git sólo se consulta.

### 19.1 Causas confirmadas y cambio mínimo

**F1/P1.** El worker operativo confirmaba PROCESSING/attemptCount+1 antes de
consultar Configuration. `requireLegacyInboundRoute` arrojaba una excepción no
reintentable también para PREPARING/SUSPENDED/ENABLED sin ruta liberada. El catch
normal la entregaba a `releaseOrFailReceipt`: FAILED y job resuelto. Recovery sólo
seleccionaba RECEIVED o PROCESSING expirado; ese mensaje quedaba excluido.

Ahora el claim inbound consulta primero un locator sin lock. Su identidad sólo
sirve para adquirir Configuration SHARE antes del lock Receipt. Se relee el
Receipt con id/workspace/conexión/eventKind exactos bajo UPDATE; sólo esa lectura
permite cambiarlo. Configuration SHARE permanece hasta terminar el claim. Una
pausa válida conserva RECEIVED, token/deadline NULL y attemptCount intacto; guarda
`error.category=INBOUND_ROUTE_PAUSED`. No se ejecuta la unidad legacy. ENABLED
permanece cerrado en el worker operativo y produce esa misma conservación del
trabajo. Se registra la disposición en el log estructurado existente.

El gate se vuelve a consultar al entrar a la transacción de procesamiento, antes
del segundo lock Receipt y de cualquier DML causal. Su SHARE dura hasta terminar
esa unidad. Si cambió después del commit del claim, esa excepción específica sale
de la transacción; sólo después se dispone del claim con un UPDATE atómico:
id/workspace/conexión/INBOUND_MESSAGE/PROCESSING/token y attemptCount exactamente
igual al observado en el claim. El contador capturado debe ser un entero seguro
positivo. Sólo esa fila puede pasar a RECEIVED y restar **uno**; se guarda el
contador devuelto en el diagnóstico de pausa. No se asigna un contador calculado
por cliente ni se toca un owner distinto. El predicado impide una segunda
resta, valores negativos y la sobrescritura de un takeover/PROCESSED. Si no afecta
filas, no se afirma haber dispuesto el lease ajeno. No hay nuevo estado ni campo
de esquema; el diagnóstico es el JSON existente y no pretende ser un historial
inmutable nuevo de todos los claims.

El enfriamiento es de **60 segundos** desde updatedAt. Tanto la selección de
recovery (antes de ORDER/LIMIT 100) como el claim evitan filas inbound pausadas
que aún no vencen. Un job duplicado no renueva el plazo ni solicita otro job. El
cron existente de un minuto vuelve a seleccionar la fila al vencer; si continúa
bloqueada se vuelve a pausar sin consumir intentos. Cuando vuelve a DISABLED,
el siguiente recovery elegible usa la ruta legacy; ENABLED sigue esperando el
cutover autorizado. La reanudación necesita el cron/transporte existentes activos;
esta entrega no los inicia ni promete latencia de entrega. No se introduce cola,
TTL, scheduler ni coordinación externa adicionales.

Un resultado incompleto, instalación parcial, modo/protocolo/fecha incompatibles
o consulta SQL fallida no produce una pausa válida ni un fallback legacy. Un
error preclaim se propaga al transporte sin inventar un claim. STATUS_CALLBACK y
otros eventos mantienen su ruta y presupuesto previos; el enfriamiento se limita
a INBOUND_MESSAGE. Los diez claims se conservan para procesamiento real.

**F2/P2.** La colaboración durable usaba el lector C2-II en sus SELECT de
correlación y EntityManager para la versión. El primero arrojaba
AttentionReadFailure con SQLSTATE y el segundo QueryFailedError de TypeORM. El
catch de III-A reemplazaba ambos por ADMISSION_FAILED sin diagnóstico. El owner
veía un rechazo genérico y elegía INTERVENTION.

La única modificación a III-A es el catch interno de admisión: conserva exactamente
`{ok:false,callerMustRollback:true,error:{code:ADMISSION_FAILED,path:$.admission}}`.
Un WeakMap privado asocia ese mismo objeto de error a un SQLSTATE canónico,
extraído únicamente de AttentionReadFailure/QUERY_FAILED o del driverError de un
QueryFailedError real. El owner lee el diagnóstico por identidad a través del
wrapper durable existente. Un clon/JSON/cause arbitrario no adquiere diagnóstico.
No se transporta el error original, SQL, parámetros, mensaje, payload ni credenciales.
No se modifican tipos/resultados públicos, decisión de admisión, causalidad,
reducer, reader, R3 ni escrituras III-A. Una excepción arbitraria sigue siendo
ADMISSION_FAILED sin señal de retry; autoridad ausente, versiones desconocidas,
metadata contradictoria y corrupción mantienen su rechazo.

**F3/P2.** El parser del owner sólo admitía cinco caracteres SQLSTATE; descartaba
ECONNREFUSED/ETIMEDOUT de obtainMasterConnection antes de BEGIN. Sin transacción
causal iniciada, terminaba clasificando INTERVENTION.

El owner registra ahora si intentó BEGIN y conserva separadamente un código de
conectividad de una allowlist: ECONNREFUSED, ETIMEDOUT, ECONNRESET, EHOSTUNREACH,
ENETUNREACH y EAI_AGAIN. Sólo un fallo de adquisición anterior a BEGIN usa esa
política. Hay hasta tres adquisiciones/unidades por invocación, runner nuevo en
cada retry y jitter de 5–25 ms fuera de la unidad; al agotarse se entrega RETRY al
worker para su release scoped y recovery. Código desconocido, heredado/getter o
cause textual no se presume reintentable. Un código Node durante una transacción
activa no recibe automáticamente la clasificación de adquisición.

### 19.2 Matriz de disposición y presupuestos

| Condición | Disposición de fuente |
| --- | --- |
| PREPARING/SUSPENDED válidos en worker operativo | Pausa durable RECEIVED; cero claims consumidos; cooldown 60 s |
| ENABLED sin worker tracked liberado | Legacy cerrado; misma pausa, sin ejecutar tracked ni promover Receipt |
| DISABLED válido o pre-DDL completo ausente | Compatibilidad legacy autorizada; revalidación dentro de unidad |
| Gate parcial/corrupto/SQL fallido | Rechazo propagado; sin interpretarlo como pausa o ausencia |
| Receipt sin v1 o scope/autoridad inválidos para tracked | INTERVENTION/rechazo; nunca promoción a v1 |
| 40P01/40001 elegibles, incluso dentro de admit | ROLLBACK confirmado y hasta tres unidades nuevas; después RETRY scoped |
| 55P03/57014 conocidos en unidad con timeout positivo verificado | ROLLBACK confirmado; RETRY al transporte/recovery, sin continuar esa transacción |
| 08006/08003 de SQL con rollback confirmado | RETRY al transporte; nunca prueba de ausencia |
| Conectividad conocida antes de BEGIN | Hasta tres runners/adquisiciones; después RETRY, no intervención inmediata |
| SQLSTATE/código desconocido o ADMISSION_FAILED sin diagnóstico acreditado | INTERVENTION; sin retry presumido |
| UNIQUE conocido de Message | Como antes: una relectura completa nueva; conflicto repetido/desconocido requiere intervención |
| Correlación contradictoria/corrupción/versiones desconocidas | Intervención o rechazo definitivo según contrato; rollback completo |
| Lease de otro procesador | UPDATE scoped afecta cero; no se limpia ni reemplaza el nuevo owner |
| Rollback no confirmado o runner deja de acreditar unidad sin rollback | COMMIT_INDETERMINATE; no release/FAILED/COMMITTED |
| Cualquier error durante COMMIT, también constraint conocido | COMMIT_INDETERMINATE incluso si ROLLBACK posterior responde |
| PROCESSED acreditado | Reconciliación separada con mismos originales; sin fake claim ni nueva revisión |
| Diez claims reales agotados, sin lease vigente ajeno | Terminalización condicionada existente; requiere revisión operativa |

No se vuelve retryable todo ADMISSION_FAILED ni se inspeccionan textos libres.
57014 se trata bajo el contrato de unidad de trabajo presupuestada: el owner
establece statement_timeout=10 s/lock_timeout=2 s y C2-II los verifica positivos;
no se ofrece clasificación genérica de cancelaciones fuera de esa unidad.

Los retries internos no cambian Receipt/Message/provider ID/eventKey ni continúan
DML sobre una transacción abortada. Hay máximo tres unidades por invocación y
diez claims de transporte para fallos reales; las pausas de rollout no gastan
ese presupuesto. Un fallo transitorio deja trabajo recuperable mientras queden
claims; el agotamiento del presupuesto real sigue requiriendo revisión y no se
presenta como corrupción del mensaje. No se inventa un retry infinito ante una
caída prolongada de PostgreSQL.

COMMITTED sólo existe tras commit confirmado. Ante incertidumbre, el lease queda
intacto y recovery debe inspeccionar PROCESSED/originales o adquirir un takeover
legítimo después de su expiración. Un rollback de mejor esfuerzo tras COMMIT no
acredita que el commit falló. La revisión del owner también evita asumir rollback
por el mero hecho de que isTransactionActive sea false después de intentar BEGIN.

### 19.3 Matriz adversarial y evidencia

Las suites nuevas son `tracked-inbound-remediation-gate.spec.ts` y
`tracked-inbound-remediation-errors.spec.ts`; el arnés
`tracked-inbound-error-driver.fixtures.ts` usa DataSource, EntityManager,
PostgresDriver, PostgresQueryRunner y QueryFailedError **reales**, sustituyendo
exclusivamente pool/cliente PostgreSQL. No se llama initialize ni se conecta a
una base. Los scripts comprueban sentencia/orden/parámetros/envelope y retienen
sus mismatches fuera del catch productivo. Los hechos positivos siguen pasando
por ingress R2, R3, III-A, II, C1 y reducer reales.

| Casos requeridos | Evidencia de fuente |
| --- | --- |
| 1–8: gates/pre-DDL/parcial/corrupción/SQL | Worker operativo real, check antes de claim, sin writes ni FAILED por pausa |
| 9–10: gate entre claim/unidad y durante unidad | Refund condicionado después de rechazo; SHARE hasta commit, orden emitido; no se afirma una carrera PostgreSQL física |
| 11–13: reanudación/repeticiones/hot loop | Recovery real con predicado antes de LIMIT, cooldown durable, jobs duplicados y bloqueos consecutivos sin gasto |
| 14–15: callback/dos workers | Ruta no inbound sin query gate; lease vigente ajeno y predicados exactos de devolución |
| 16–23: SQLSTATE/admisión/versión/retry | Cuatro códigos inyectados en ambos SELECT reales; worker/owner/release reales; runner nuevo, límite tres y mismas identidades |
| 24–30: atomicidad/autoridad/corrupción/códigos falsificados/fugas | Ningún commit causal ante rechazo; ROLLBACK; originales III-A sin cambios; errores sin SQL/payload/cause/driver |
| 31–35: conexión pre-BEGIN | obtainMasterConnection simulado falla, reconecta y agota tres; errores desconocidos no ganan retry |
| 36–42: transacción/rollback/COMMIT/owner/FAILED | PostgresQueryRunner real; rollback confirmado vs incierto; commit ambiguo nunca se libera; intervención sólo según matriz |
| 43–45: PROCESSED/replay/identidades | Regresiones R4 de reconciliación/replay y nuevas de worker; sin claim falso, eventKey nuevo ni revisión adicional |

La comparación ejecutada contra las cinco fuentes originales antes de la
reparación dio 38 fallos/19 pases en las primeras 57 pruebas focales; las 57
pasaron con la reparación. Entre los fallos están los tres contraejemplos de
la auditoría: gate antes/después del claim, SQLSTATE dentro de los dos caminos
de admisión y ECONNREFUSED/ETIMEDOUT antes de BEGIN. Las comprobaciones de orden
nuevas también distinguen la consulta previa al claim. No se cuenta ese contraste,
las reejecuciones ni el arnés histórico de 60 casos como pruebas adicionales.

Una ejecución preliminar usó un selector plural no soportado por la versión de
Jest y seleccionó suites ajenas; se interrumpió y se excluye del conteo. Las
validaciones finales usan exclusivamente rutas explícitas `--runTestsByPath`
y una barrera de red que rechaza sockets TCP/Unix/UDP. No se usa reset, migración,
servidor/worker, Redis ni Twilio de red como validación. La interrupción posterior
de la sesión eliminó evidencia temporal; se regeneró el inventario y se volvieron
a ejecutar los checks finales sobre las fuentes guardadas.

Los resultados finales únicos y el inventario definitivo se registran al cerrar
las validaciones de esta remediación.

### 19.4 Límites y wiring retenidos

No hay PostgreSQL físico: siguen pendientes paridad de catálogo/DDL, resolución
y ejecución SQL real, triggers/FKs/guards, MVCC, carreras de UNIQUE/lease,
clock skew, lock waits, rollback/commit/caídas reales y comportamiento del pool.
El cliente simulado demuestra el lifecycle y la clasificación de TypeORM, no
persistencia, aislamiento o disponibilidad físicos. La remediación F1 original usaba el reloj de aplicación para selección y
updatedAt persistido. Esa implementación presentó N1/N2; la sección 20 la
supersede con selección y renovación del cooldown mediante reloj PostgreSQL.
Las limitaciones físicas siguen vigentes.

La composición tracked sigue siendo privada e inerte. No existe una selección
operativa que llame a processTrackedInboundReceipt en ENABLED; los tests causales
la invocan bajo prerrequisitos simulados. Esta reparación conserva esa frontera,
la emisión v1 R2 en DISABLED y el bloqueo de cutover. No acredita una política de
pausa de un futuro worker tracked registrado ni autoriza registrarlo.

Persisten exactamente los bloqueos operativos de la sección 17: aceptación
PostgreSQL aislada, cutover/emisión v1/drenaje legacy, participación de todos los
writers de conexión y aceptación de revocación gate-first, coordinación outbound/
manual, proxy/TLS/origen, custodia/restore y operación ante FAILED/corrupción.
No se modifican entidades/Fast Commands, reducer/C1/R3/reader, unidad causal
Message/Attachments/Epoch/ledger/Outbox, reconciliación, realtime/F13, Pending
manual, Send/Dispatch/callbacks, Leads, Record Access ni Commercial Teams.

### 19.5 Validación final e inventario de la remediación

Resultados efectivamente ejecutados sobre las fuentes reparadas:

| Validación | Resultado |
| --- | --- |
| Dos suites nuevas de remediación | **62 PASS**: 26 gate/worker/recovery y 36 admisión/conexión/commit |
| Seis suites R4 originales | **128 PASS** |
| Ochenta suites previas R3/R2/B1/R1/III-A/II/I-A/B/C1/reducer y Messaging seleccionadas | **1.424 PASS** |
| Total único | **88 suites / 1.614 PASS**, cero fallos, skips u omisiones |
| Typecheck completo twenty-server | `tsgo --noEmit --incremental false`, exit 0 |
| Typed lint explícito | **27 TypeScript**, cero errores y warnings |
| Formato explícito | **27 TypeScript PASS** |
| Diff lint Nx, dependencias excluidas | **PASS**; typed lint 569 archivos / formato 526 según exclusiones |
| Whitespace | tracked/staging y veinte nuevos por no-index: PASS |

La primera ejecución completa desde la raíz encontró cuatro ENOENT en dos suites
que leen fuentes relativas al cwd. Se ejecutaron después las 88 rutas desde
`packages/twenty-server`, como exige su contrato existente, sin modificar esos
tests. En typed lint se eliminó una variable sin uso del arnés nuevo. La primera
comprobación de formato/diff lint pidió un segundo pase de formato de dos
fixtures modificados; se corrigieron únicamente esos archivos y se volvieron a
comprobar. Ninguna reejecución se suma al total único.

Evidencia final en `/tmp/c2-remediation/`: `paths.json`, `inventory.json`,
`regressions-final.json` y `.log`, `typecheck-final.log`, `lint-final.log`,
`format-final.log`, `diff-lint-final.log` y `whitespace.json`. El total se deriva
de assertionResults de cada una de las 88 rutas únicas, no de sumar ejecuciones.
El arnés anterior de 60 casos no forma parte de esta suma. Las pruebas físicas
`.postgres.spec.ts`, resets, PG0/PG1/Stage C5/exact-upgrade se excluyen de la lista.

Comandos finales (Node Linux v24.16.0 en PATH):

```sh
# cwd packages/twenty-server, rutas absolutas de paths.json pasadas como argv
NODE_OPTIONS='--require /tmp/c2-remediation/network-guard.cjs' ../../node_modules/.bin/jest --config jest.config.mjs --runInBand --runTestsByPath <88 rutas explícitas> --json --outputFile /tmp/c2-remediation/regressions-final.json
../../node_modules/.bin/tsgo --noEmit --incremental false
# cwd raíz, los 27 TypeScript explícitos de inventory.json
node_modules/.bin/oxlint --type-aware -c packages/twenty-server/.oxlintrc.json <27 rutas>
node_modules/.bin/oxfmt --check <27 rutas>
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-remediation/nx-data NX_CACHE_DIRECTORY=/tmp/c2-remediation/nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
git diff --check
git diff --cached --check
# Cada untracked por separado: git diff --no-index --check -- /dev/null <ruta>
```

Nx compara main...HEAD y no cubre untracked; por eso se ejecutaron también los
checks explícitos del inventario. No se ejecutan dependencias de setup ni build
para estos checks. Markdown está excluido por la configuración y se revisa
manualmente junto con whitespace, sin cambiar esa exclusión.

La remediación toca catorce rutas respecto al R4 recibido, bajo
`src/modules/inconnect-messaging/` salvo el documento:

- `attention-adapter/inbound/transactional/inbound-route-boundary.ts`:
  identificación explícita de pausa válida y enfriamiento.
- `services/inconnect-messaging-webhook-processing.service.ts`:
  gate antes de claim, revalidación y refund scoped; límite diez inbound.
- `services/inconnect-messaging-webhook-receipt.service.ts`:
  exclusión SQL de pausas aún no vencidas, sólo inbound.
- `attention-adapter/inbound/transactional/execute-tracked-inbound.ts`:
  diagnóstico de admisión y clasificación pre-BEGIN separada.
- `attention-adapter/persistence/writer/prepare-attention-write.ts`:
  único ajuste mínimo del catch interno III-A.
- Nuevo `attention-adapter/persistence/writer/attention-admission-diagnostic.ts`:
  diagnóstico privado por identidad, sin cambio público III-A.
- Nuevos `tracked-inbound-remediation-gate.spec.ts`,
  `tracked-inbound-remediation-errors.spec.ts` y
  `tracked-inbound-error-driver.fixtures.ts` en `transactional/__tests__/`.
- `transactional/__tests__/tracked-inbound-boundary.spec.ts`:
  la aserción anterior FAILED por gate se reemplaza por conservación RECEIVED.
- `attention-adapter/inbound/__tests__/legacy-inbound.fixtures.ts`,
  `__tests__/inconnect-messaging-webhook-processing.service.spec.ts` y
  `__tests__/inconnect-messaging-webhook-receipt.service.spec.ts`:
  proyecciones completas del gate y expectativa del filtro recovery.
- Este documento `docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R4.md`:
  causas, matriz, alcance, evidencia y limitaciones.

Inventario conjunto con R4 conservado: **ocho tracked modificados y veinte nuevos**
(27 TypeScript y este documento), staging vacío, misma rama y HEAD del preflight.
No se modifica AGENTS.md ni se escribe Git, y no se hace commit. No se ejecutan
PostgreSQL/SQL real, Fast Commands, migraciones, setup/reset, infraestructura,
Twilio de red, tracking, despliegue ni cambios de datos/roles/grants reales.

Se recomienda auditoría independiente focal de F1/F2/F3: predicados/refund y
cooldown frente a takeover; señal SQLSTATE dentro de ambos SELECT de admisión y
conservación pública III-A; límites pre-BEGIN/rollback/COMMIT y disposición
integrada del worker. El resultado de tests no sustituye esa auditoría ni levanta
los bloqueos físicos y de cutover/revocación/proxy/restore de las secciones 17 y
19.4. El worker tracked permanece desactivado.


## 20. Remediación focal N1/P1 y N2/P2 — 2026-10-26

**SOURCE-ONLY; pendiente de reauditoría focal independiente.** No declara R4
aceptada ni B1 completada. No inicia B2/C ni registra/activa el worker tracked.
La composición causal y las reparaciones F1/F2/F3 se conservan.

Preflight read-only confirmado: rama `feature/inconnect-lead-management`, HEAD
`914df6578f02c2895b0089c7f38478625446807b`, ocho tracked modificados, veinte
untracked y staging vacío. Se consultaron AGENTS.md, el contrato R4 y la revisión,
contraejemplos y fuentes de `/tmp/c2-r4-independent/`. TypeORM instalado: **0.3.31**.
No se escribió Git ni se modificó AGENTS.md.

### 20.1 N1: referencia SQL y recovery

El callback Raw recibía `InconnectMessagingWebhookReceiptEntity.error`, que se
insertaba sin escape. El SQL original declaraba el alias con comillas y lo
referenciaba de esta forma:

```sql
FROM "core"."inconnectMessagingWebhookReceipt" "InconnectMessagingWebhookReceiptEntity"
-- Dentro del OR de RECEIVED:
OR InconnectMessagingWebhookReceiptEntity.error->>'category' IS DISTINCT FROM $2
```

La referencia sin comillas no identifica el alias declarado. El defecto existe
incluso con tabla vacía y afecta la consulta completa, incluidos PROCESSING y
callbacks; no se observó un SQLSTATE en PostgreSQL físico.

`inboundRoutePauseFilter()` escapa cada componente del path de metadata recibido
por Raw, incluidas comillas internas, sin hardcodear el nombre/capitalización del
alias de TypeORM. Los otros identificadores son columnas del esquema existente;
no hay identificadores o SQL de usuario. La misma condición se aplica al locator
y a la relectura bajo lock del claim. El OR limita el cooldown a INBOUND_MESSAGE /
RECEIVED; otros eventos/estados no adquieren ese enfriamiento.

SQL íntegro de recovery capturado en el cliente pg simulado (sólo saltos de línea
para legibilidad):

```sql
SELECT "InconnectMessagingWebhookReceiptEntity"."id" AS "InconnectMessagingWebhookReceiptEntity_id",
  "InconnectMessagingWebhookReceiptEntity"."workspaceId" AS "InconnectMessagingWebhookReceiptEntity_workspaceId",
  "InconnectMessagingWebhookReceiptEntity"."providerConnectionId" AS "InconnectMessagingWebhookReceiptEntity_providerConnectionId",
  "InconnectMessagingWebhookReceiptEntity"."eventKind" AS "InconnectMessagingWebhookReceiptEntity_eventKind"
FROM "core"."inconnectMessagingWebhookReceipt" "InconnectMessagingWebhookReceiptEntity"
WHERE (((("InconnectMessagingWebhookReceiptEntity"."processingState" = $1) AND (("InconnectMessagingWebhookReceiptEntity"."eventKind" <> 'INBOUND_MESSAGE' OR "InconnectMessagingWebhookReceiptEntity"."processingState" <> 'RECEIVED' OR "InconnectMessagingWebhookReceiptEntity"."error"->>'category' IS DISTINCT
FROM $2 OR "InconnectMessagingWebhookReceiptEntity"."updatedAt" <= clock_timestamp() - ($3 * INTERVAL '1 millisecond'))))) OR ((("InconnectMessagingWebhookReceiptEntity"."processingState" = $4) AND ("InconnectMessagingWebhookReceiptEntity"."leaseExpiresAt" <= $5))))
ORDER BY "InconnectMessagingWebhookReceiptEntity"."firstReceivedAt" ASC LIMIT 100
```

Parámetros separados: `$1=RECEIVED`, `$2=INBOUND_ROUTE_PAUSED`, `$3=60000`,
`$4=PROCESSING`, `$5=now` del contrato existente de recuperación de leases.
Se mantiene el parámetro de categoría y la parametrización de todos los valores;
el antiguo `pauseBefore` calculado en Node se sustituye por la duración ligada
y `clock_timestamp()` para que selección y renovación del cooldown compartan
reloj. La comparación de leases y el argumento opcional `now` no se rediseñan.
Se conservan JSONB `error.category`, filtro antes de ORDER/LIMIT 100, callbacks,
RECEIVED normal y PROCESSING expirado. Un error real del Repository se propaga;
no retorna un conjunto vacío ficticio.

### 20.2 N2: escritura explícita y condiciones

Antes, la segunda pausa asignaba RECEIVED, lease NULL y el mismo JSON de error.
`SubjectChangedColumnsComputer`/`EntityPersistExecutor` de TypeORM 0.3.31 no
encuentran cambios y `Repository.save` omite el UPDATE; updatedAt conserva t0.
No empieza otra ventana y cada job vuelve a consultar/bloquear inmediatamente.

Se reemplaza únicamente esa escritura de pausa por `Repository.update`, que usa
el UpdateQueryBuilder real y asigna explícitamente `updatedAt=clock_timestamp()`.
No cambia el hecho inbound, `ingressContractVersion`, attempts ni el esquema.
El Configuration SHARE sigue precediendo al Receipt UPDATE lock dentro de la
misma transacción. La relectura scoped bajo lock es la autoridad del UPDATE.

SQL íntegro de una renovación RECEIVED, capturado en pg simulado:

```sql
UPDATE "core"."inconnectMessagingWebhookReceipt"
SET "processingState" = $1,
    "leaseToken" = $2,
    "leaseExpiresAt" = $3,
    "error" = $4,
    "updatedAt" = clock_timestamp()
WHERE ("id" = $5
  AND "workspaceId" = $6
  AND "providerConnectionId" = $7
  AND "eventKind" = $8
  AND "processingState" = $9
  AND "leaseToken" IS NULL
  AND "leaseExpiresAt" IS NULL
  AND "attemptCount" = $10
  AND "error" IS NOT DISTINCT FROM CAST($11 AS jsonb)
  AND ("processingState" <> 'RECEIVED' OR "error"->>'category' IS DISTINCT FROM $12 OR "updatedAt" <= clock_timestamp() - ($13 * INTERVAL '1 millisecond')))
```

Bindings: `$1=RECEIVED`, `$2=NULL`, `$3=NULL`, `$4` es el JSON de pausa,
`$5=Receipt.id`, `$6=workspaceId`, `$7=providerConnectionId`, `$8=INBOUND_MESSAGE`,
`$9=RECEIVED`, `$10=attemptCount` leído bajo lock, `$11` es el JSON anterior
serializado (JSON null para una pausa inicial sin error), `$12=INBOUND_ROUTE_PAUSED`,
`$13=60000`. Ni error ni scope se interpolan en el SQL.

La fila debe coincidir por identidad/workspace/conexión/kind/estado/contador;
RECEIVED exige ambos campos de lease NULL. El JSON anterior debe seguir siendo
igual en PostgreSQL. Si ya estaba pausada, su **marca anterior** debe ser menor o
igual al reloj DB menos 60 segundos. El row lock mantiene estable esa marca
entre relectura y UPDATE; no se hace igualdad contra una Date truncada a
milisegundos. Un diagnóstico distinto sólo puede pasar por la transición inicial
autorizada por el gate y la relectura bajo lock; un cambio posterior al JSON
observado no pasa el CAS.

La recuperación inicial de PROCESSING expirado conserva su política F1: además
del estado/token/contador exactos, el UPDATE exige
`"leaseExpiresAt" <= clock_timestamp()`, en lugar del IS NULL de RECEIVED.
No se borra un lease vigente ni se sobrescribe un token nuevo. La comprobación
previa de lease del worker se conserva; el reloj DB vuelve a verificar la
expiración en la escritura de pausa.

Se acepta exactamente affected=1 para registrar la disposición; affected=0 es
una no escritura y no afirma una pausa durable. Un conteo ausente, NULL o distinto
de 0/1 falla explícitamente. Un error SQL se propaga y hace rollback de la unidad
de claim; no se convierte en éxito ni entra al tratamiento normal de FAILED.

### 20.3 Ventanas repetidas, duplicados y ownership temporal

La primera pausa persiste su marca DB. Cada segunda/tercera pausa vencida emite
un UPDATE real aun si todos los demás atributos son idénticos. Durante cada
ventana vigente, locator y recovery excluyen la fila; a los 60 segundos vuelve a
ser elegible. Reiniciar el worker no cambia la marca persistida. Dos jobs después
de una renovación no la amplían. Si dos workers vieron la marca antigua, el
segundo relee bajo lock y observa la ventana nueva, sin otra renovación. El
UPDATE contiene además el predicado de vencimiento. Las pruebas simulan las
respuestas de lock/serialización del driver; no acreditan MVCC de dos sesiones.

DISABLED conserva la ruta legacy después del cooldown vigente; PREPARING,
SUSPENDED y ENABLED sin cutover siguen pausando, sin consumir intentos y sin
escrituras causales. STATUS_CALLBACK conserva claim/recovery anteriores y no
consulta el gate inbound.

**Refund tardío revisado:** la expiración habilita un takeover, pero no revoca
por sí misma el token persistido. Tras rollback confirmado por la ruta existente,
el refund de F1 puede devolver una vez el claim aunque haya vencido, siempre que
id/workspace/conexión/inbound/PROCESSING/token/attemptCount todavía coincidan.
Ese UPDATE atómico resta exactamente uno y cambia a RECEIVED/lease NULL; una
repetición ya no coincide. Si otro worker tomó posesión, el token/contador o
estado cambian y afecta cero, antes o después de esperar el lock. PROCESSED y
FAILED tampoco coinciden. No se reproduce daño adicional que justifique exigir
un deadline vigente; añadirlo impediría devolver un claim aún propio y gastaría
el intento de pausa. Se conserva esa política CAS y se documenta en fuente. Su
updatedAt ahora usa también `clock_timestamp()` para el cooldown coherente.
Esto no convierte al token vencido en autoridad para procesar/escribir atención;
la unidad causal y la finalización tracked mantienen sus validaciones originales.

### 20.4 Cambios y evidencia ORM

Rutas modificadas por esta remediación, relativas a `src/modules/inconnect-messaging/`:

- `attention-adapter/inbound/transactional/inbound-route-boundary.ts`: filtro SQL
  compartido con escape y reloj DB; gate sin cambio.
- `services/inconnect-messaging-webhook-receipt.service.ts`: uso del filtro en
  Repository.find real, manteniendo orden/límite y leases existentes.
- `services/inconnect-messaging-webhook-processing.service.ts`: selección del
  cooldown en SQL, relectura bajo lock y UPDATE de pausa condicionado; reloj DB
  del refund, sin cambiar sus predicados/contador.
- Nuevos `transactional/__tests__/inbound-cooldown-orm.fixtures.ts` y
  `inbound-cooldown-orm.spec.ts` bajo `attention-adapter/inbound/`: DataSource,
  EntityManager, Repository, Select/UpdateQueryBuilder, persistencia save y
  PostgresQueryRunner reales. Metadata de columnas de la entidad real sin cargar
  su grafo de relaciones. Sólo pool/cliente pg están simulados; no initialize.
- `transactional/__tests__/tracked-inbound-remediation-gate.spec.ts`: se elimina
  el save doble que siempre refrescaba updatedAt y el examen aislado de Raw.
  Su escenario recovery pasa por el Repository real del nuevo arnés.
- `transactional/__tests__/tracked-inbound-boundary.spec.ts` y
  `attention-adapter/inbound/__tests__/legacy-inbound.fixtures.ts`: el contrato
  previo “ningún UPDATE” se precisa como un UPDATE de pausa, con scope y sin
  escrituras causales. Los dobles restantes sólo acreditan lifecycle.
- Este documento: sección 20 y reconciliación de la limitación histórica 19.4.

La nueva suite contiene **40 pruebas**: SQL completo y bindings exactos con tabla
vacía; estados/eventos/ventanas/categorías; error Repository; primera/segunda/
tercera pausa para tres gates; reinicio y skew del reloj de aplicación; duplicados
y dos workers; CAS por scope/estado/token/error/ventana/contador; lease vigente y
expirado; DISABLED y callback; refund tardío/duplicado/takeover; affected 0/NULL/2;
error SQL sin éxito durable. Todas inspeccionan consultas y/o escrituras realmente
emitidas por TypeORM; el modelo pg sólo calcula respuestas controladas después
de recibirlas. No se sustituye Repository.save por una escritura artificial.

Se conservó una copia temporal del arnés independiente. Sus expectativas quedan
idénticas; sólo se adaptó su doble pg para reconocer el reloj DB, filtros en los
SELECT de locator/relectura y condiciones nuevas del UPDATE. Sin esta adaptación,
el arnés original presupone un parámetro Date para pauseBefore y no modela el
nuevo SQL; su ejecución directa dio 8 fallos/16 pases, que no se ocultan como
éxito. Con el doble adaptado y snapshots anteriores leídos del cache SWC, sin
alterar fuentes del repositorio, se reproducen exactamente **6 fallos/18 pases**:
las tres renovaciones por gate, recovery tras segunda pausa, duplicados que
releen gate y alias JSONB. Con fuentes corregidas pasan **24/24**. Junto con las
45 pruebas independientes F2/F3 originales sin cambios: **69/69 PASS**.
Esas pruebas externas y las reejecuciones no se suman como pruebas nuevas.

### 20.5 Validación final y límites

Resultados únicos sobre la entrega (sin sumar reejecuciones ni arnés externo):

| Validación | Resultado |
| --- | --- |
| Nueva suite N1/N2 con TypeORM real | **40 PASS** |
| F1/F2/F3, dos suites previas | **62 PASS** |
| Seis suites R4 originales | **128 PASS** |
| Ochenta suites anteriores R3/R2/III-A/II/I-A/B/C1/reducer/Messaging/schema/guards/registro | **1.424 PASS** |
| Total único | **89 suites / 1.654 PASS**, cero fallos, pendientes o skips |
| Typecheck completo twenty-server | `tsgo --project packages/twenty-server/tsconfig.json --noEmit --incremental false`: exit 0 |
| Typed lint explícito | **29 TypeScript**, cero errores/warnings |
| Formato explícito | **29 TypeScript PASS** |
| Nx diff lint sin dependencias | **PASS** |
| Whitespace | tracked/staging y 22 untracked: **PASS** |

Las primeras comprobaciones ajustaron únicamente el arnés: fechas construidas
antes de fijar el reloj simulado y tipos de opciones de columnas al mapear la
metadata real a EntitySchema. Se conservan las expectativas de elegibilidad,
escrituras y estado. La única expectativa histórica modificada es la descrita
en 20.4: ahora debe existir un UPDATE de pausa y seguir sin DML causal.

Las interrupciones de sesión eliminaron `/tmp`, incluidos el arnés independiente
y sus snapshots después de ejecutar el contraste 6-fallos/24-pases y el conjunto
69/69. Esa evidencia temporal no se presenta como conservada ni como una nueva
auditoría. Se regeneraron inventario, captura SQL, las 89 rutas explícitas y
checks finales en `node_modules/.cache/c2-r4-n1n2/` (ignorado por Git), con JSON
de resultados por assertionResults. Artefactos: `paths.json`, `inventory.json`,
`regressions.json`/`.log`, `typecheck.log`, `typed-lint.log`, `format.log`,
`diff-lint.log`, `checks.json` y `whitespace.json`. No se suman estas repeticiones.

Comandos (Node Linux v24.16.0 en PATH):

```sh
# cwd packages/twenty-server; 89 rutas absolutas de paths.json por argv
NODE_OPTIONS='--require <evidence>/network-guard.cjs' ../../node_modules/.bin/jest --config jest.config.mjs --runInBand --runTestsByPath <89 rutas> --json --outputFile <evidence>/regressions.json
# cwd raíz
node_modules/.bin/tsgo --project packages/twenty-server/tsconfig.json --noEmit --incremental false
node_modules/.bin/oxlint --type-aware -c packages/twenty-server/.oxlintrc.json <29 TypeScript del inventario>
node_modules/.bin/oxfmt --check <29 TypeScript del inventario>
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=<evidence>/nx-data NX_CACHE_DIRECTORY=<evidence>/nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
git diff --check
git diff --cached --check
# Cada untracked: salida vacía y exit 0/1 son normales con --no-index.
git diff --no-index --check -- /dev/null <ruta>
```

`<evidence>` es la ruta absoluta de `node_modules/.cache/c2-r4-n1n2/` dentro de
este checkout. Nx compara main...HEAD y no cubre untracked; por eso se comprueban
además los 29 TypeScript explícitos. Markdown se revisa manualmente y mediante
whitespace, conforme a la exclusión existente.

Estado Git final read-only: misma rama/HEAD, **ocho tracked modificados y veintidós
untracked** (dos archivos nuevos adicionales a los veinte recibidos), staging
vacío; ningún commit. El inventario conjunto incluye cambios preexistentes R4 y
F1/F2/F3. `git diff --stat` tracked: 8 archivos, 261 inserciones/14 eliminaciones;
no incluye los 22 untracked. Esta remediación cambia sólo las nueve rutas
identificadas en 20.4, incluido el documento.

No se ejecutó PostgreSQL ni SQL físico, ni migrations/Fast Commands/generadores,
setup/reset, Redis, servidores/consumidores, Twilio por red, PG0/PG1/Stage C5 ni
exact-upgrade. Jest se ejecuta con barrera de sockets TCP/Unix/UDP y rutas
explícitas, excluyendo pruebas físicas/reset. El cliente simulado acredita la
emisión ORM, no instalación SQL, constraints/triggers, persistencia física,
MVCC, exclusión entre sesiones, timeouts/caídas o paridad de catálogo.

No se modifica Conversation/Epoch/R3/writer/reducer/Message/Attachments/Outbox,
fanout, reconciliación, Roles/Record Access, datos o configuración reales. Los
bloqueos operativos de 17/19.4 siguen vigentes: aceptación PostgreSQL aislada y
autorizada, cutover/drenaje/emisión v1, participación de escritores en gate-first
y revocación, coordinación manual/outbound, TLS/proxy/origen y custodia/restore.

Se recomienda reauditoría independiente focal de **N1/N2**, SQL final emitido,
ventanas repetidas, CAS/ownership/refund tardío y conservación de F1/F2/F3. Esta
entrega queda lista sólo como fuente revisable; la aprobación R4/B1 y cualquier
activación siguen pendientes y separadas.

### 20.6 Remediación mínima N3/P2 — 2026-10-26

Esta subsección registra evidencia del implementador para reauditoría focal;
no constituye una auditoría independiente, aceptación de R4 ni cierre de B1.
La auditoría recibida mantiene el veredicto **REQUIRES REMEDIATION** por N3.
Las validaciones anteriores de 20.5 son históricas y no detectaron este defecto.

**Causa y cambio exacto.** En `claimReceipt`, el CAS de la primera pausa usaba
`JSON.stringify(receipt.error ?? null)`. Para una columna SQL NULL esto produce
el texto `"null"`; `CAST($n AS jsonb)` lo convierte en JSONB null, que es un valor
no SQL NULL. Por tanto, `"error" IS NOT DISTINCT FROM CAST($n AS jsonb)` devolvía
false y el UPDATE afectaba cero filas: no quedaba cooldown durable.

Ahora el parámetro se prepara así:

```typescript
previousPauseError:
  receipt.error === null ? null : JSON.stringify(receipt.error)
```

El `null` de JavaScript llega como parámetro SQL NULL real. Un objeto anterior
se serializa como texto JSON para el mismo CAST parametrizado. Se conserva
`IS NOT DISTINCT FROM`, sin ampliar el CAS con un OR ni quitar predicados.
Además, si el campo hidratado está inesperadamente ausente (`undefined`), se
retorna sin UPDATE ni claim: ausencia no demuestra SQL NULL. Esto evita depender
de la conversión de `undefined` a SQL NULL que también realiza pg.

El único cambio productivo está en ese guard y binding. Permanecen exactamente
los predicados de id, workspace, conexión, tipo, estado, token/expiración de
lease, attemptCount, error anterior y ventana de **60.000 ms**, el UPDATE
explícito N2 y `updatedAt = clock_timestamp()`. N1 conserva su alias escapado.

**Fixture corregido.** `inbound-cooldown-orm.fixtures.ts` antes comprobaba
`JSON.stringify(state.error) === previous`, permitiendo el falso positivo
SQL NULL frente al texto `"null"`. Ahora conserva por separado la identidad
SQL NULL/JSONB null, aunque ambos se hidraten como `null`, interpreta el
parámetro del CAST y compara los valores JSON parseados con igualdad profunda
independiente del orden de claves. Registra `affected` después de evaluar todos
los predicados. No devuelve affected=1 incondicionalmente. El override de
rowCount existente sigue reservado para pruebas explícitas de resultados
incompletos/error; no se usa en los cuatro casos N3 ni en las tres ventanas.

| Valor físico anterior | Parámetro | Resultado del CAS |
| --- | --- | --- |
| SQL NULL | `null` real | true |
| SQL NULL | texto `"null"` | false |
| JSONB null | `null` real | false |
| JSONB null | texto `"null"` | true |
| JSONB null | texto JSON `"\"null\""` | false (es un string JSON) |
| JSONB `{}` | texto `"{}"` | true |
| JSONB `{}` | `null` real | false |
| Objeto JSONB válido | mismo objeto serializado, claves reordenadas | true |
| Objeto contradictorio | objeto anterior serializado | false |

**Límite real de hidratación.** El parser JSONB OID 3802 de pg aplica JSON.parse:
JSONB null se convierte en `null`, igual que SQL NULL; PostgresDriver de TypeORM
no incorpora un discriminador de nulidad física. Se comprueba con el parser
real, Repository real y `preparePersistentValue(null, column)`. No se atribuye
al worker una distinción que no posee. Para un JSONB null anómalo, el binding
nuevo es SQL NULL y el CAS devuelve affected=0: no sobrescribe la fila, no
consume intentos ni anuncia pausa durable. **Esa fila no adquiere cooldown y
puede seguir siendo recuperable.** Resolver ese dato anómalo/discriminador
requeriría un alcance aparte; esta remediación preserva el caso normal SQL NULL
emitido por R2/legacy y los objetos de error, sin relajar concurrencia. La
bandera de nulidad del doble sólo sirve como oráculo de prueba, nunca se inyecta
en la entidad hidratada ni en el worker. El campo ausente también queda sin
pausa durable; se verifica el retorno seguro sin inferir su valor.

**Cuatro contraejemplos originales conservados.** Se encontró
`/tmp/c2-r4-independent/`. Se ejecutaron los cuatro casos N3 de
`null-initial.spec.ts`, sin modificar sus expectativas ni su fixture:

| Caso con error SQL NULL | Binding anterior | Binding nuevo |
| --- | --- | --- |
| RECEIVED nuevo, PREPARING | affected=0, FAIL | affected=1, PASS |
| RECEIVED nuevo, SUSPENDED | affected=0, FAIL | affected=1, PASS |
| RECEIVED nuevo, ENABLED cerrado | affected=0, FAIL | affected=1, PASS |
| PROCESSING vencido, PREPARING | affected=0, FAIL | affected=1, PASS |

Antes de editar el worker se reprodujeron **4 FAIL**. Los cuatro equivalentes
nuevos en la suite del repositorio, ya con el fixture corregido, también dieron
**4 FAIL** con el binding anterior. Después pasan ambos grupos. Los casos nuevos
comprueban el parámetro null real, affected=1, reloj de base simulado, lease
liberado cuando corresponde, cero consumo de intentos, diez jobs duplicados,
exclusión de recovery a 59.999 ms y elegibilidad al completar 60.000 ms.

Los **seis casos N1/N2** de `gate-orm.spec.ts` pasan sin cambiar expectativas:
alias sobre tabla vacía, tres modos con tres ventanas, reinicio y duplicados.
También pasan los **34 casos** de `ownership.spec.ts`, incluidos scope,
takeover, estados terminales, refund protegido, clock skew, DISABLED y callback.
La ejecución externa selecciona los cuatro N3 y esos cuarenta casos: **44 PASS**.
Los otros tres tests de `null-initial.spec.ts` no forman parte de esa selección
(diagnóstico del bucle anterior y controles del binding/driver); no se alteraron
para convertir expectativas históricas del defecto en expectativas nuevas.

**Secuencia de tres ventanas desde SQL NULL.** Las tres variantes PREPARING,
SUSPENDED y ENABLED de la suite ORM del repositorio parten ahora de error SQL
NULL y attemptCount=0. Cada UPDATE exige affected=1:

| Pausa | Reloj de base simulado | Dentro de la ventana | Fin de ventana |
| --- | --- | --- | --- |
| Primera | t=0; updatedAt=t | duplicados sin UPDATE/attempt; recovery=0 a t+59.999 | recovery=1 a t+60.000 |
| Segunda | t=60.000; mismo diagnóstico renovado | duplicados sin UPDATE/attempt; recovery=0 a t+59.999 | recovery=1 a t+60.000 |
| Tercera | t=120.000; mismo diagnóstico renovado | cambio a DISABLED; aún sin claim dentro de ventana | a t=180.000 permite claim legacy con attemptCount=1 |

Se conserva el hecho original (metadata, versión, idempotencyKey, payloadHash y
firstReceivedAt). La suite incluye CAS contradictorio affected=0 sin log durable,
objetos anteriores, ausencia inesperada y contraste JSONB null. Las regresiones
anteriores mantienen takeover sin sobrescritura, PROCESSED/FAILED, scope y
STATUS_CALLBACK. TypeORM ejecuta Repository, QueryBuilder y PostgresQueryRunner
reales; sólo la frontera cliente pg se simula.

**Validación SOURCE-ONLY de esta remediación.**

| Conjunto | Resultado único |
| --- | --- |
| Suite ORM N1/N2/N3 | **58 PASS** (40 anteriores + 18 nuevas) |
| F1/F2/F3, dos suites | **62 PASS** |
| Seis suites R4 originales | **128 PASS** |
| Ochenta suites R3/R2 y anteriores | **1.424 PASS** |
| Total del repositorio | **89 suites / 1.672 PASS**, cero fallos, pendientes o skips |
| Typecheck completo twenty-server | PASS; tsgo, noEmit, incremental false |
| Typed lint y formato explícitos | **29 TypeScript PASS**, cero errores/warnings |
| Nx diff lint sin dependencias | PASS; se complementa con los 29 archivos explícitos |
| Whitespace tracked, staging y 22 untracked | PASS |

El total cuenta cada assertionResults una vez; excluye los 44 casos externos y
las reejecuciones focales. Se reutilizan las 89 rutas explícitas del baseline
independiente, sin pruebas PostgreSQL físicas ni reset. Evidencia temporal nueva:
`/tmp/c2-r4-n3/`, con `original-four-before.json`,
`repository-four-before.json`, `external-after.json`, `focused-final.json`,
`regressions.json`, sus logs, `paths.json`, `typescript-paths.json`,
`typecheck.log`, `typed-lint.log`, `format.log`, `diff-lint.log`, `checks.json`,
`inventory-before.json`, `inventory-after.json` y `whitespace.json`.
`old-worker.ts` conserva el worker recibido antes de esta corrección. Los
comandos son los de 20.5, usando este directorio de evidencia en `/tmp`; Jest
mantiene la barrera de sockets TCP/Unix/UDP. Esta es reproducción por el
implementador de pruebas ajenas conservadas, no una nueva auditoría independiente.

Inventario Git read-only: rama `feature/inconnect-lead-management`, HEAD
`914df6578f02c2895b0089c7f38478625446807b`, **8 tracked modificados,
22 untracked, staging vacío**; sin escrituras Git ni commit. Comparación por
SHA-256 contra el inicio: cambian únicamente el worker, el fixture ORM, la suite
ORM y esta subsección del documento R4; no se agregan ni eliminan rutas.

Se conservan F1 (preclaim sin consumo de attempts y refund protegido), F2
(SQLSTATE seguro), F3 (reconexión pre-BEGIN acotada), COMMIT indeterminado,
correlación y originales R3, unidad causal R4, Outbox/realtime, media/F13 y
compatibilidad legacy. El worker tracked sigue desactivado. No se modifica
reducer, C1, reader/writer funcional, Conversation/Epoch, Message, Attachments,
Send/Dispatch ni atención manual.

No se conectó PostgreSQL real ni se ejecutó SQL físico, Fast Commands,
migraciones, servidores, workers, Redis, Twilio por red, tracking o despliegue.
PG0/PG1/Stage C5/exact-upgrade siguen bloqueados; tampoco se inicia B2 ni C.
Persistencia física, MVCC, locks reales y garantías de PostgreSQL requieren una
fase separada con autorización específica. Permanecen los bloqueos operativos
de 17/19.4. **N3 corregido en SOURCE-ONLY y listo para reauditoría focal**;
R4 no se declara aceptada y B1 no se declara completada.
