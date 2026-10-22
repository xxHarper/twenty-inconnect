# INCONNECT — Fase 1B-1B-C2-III-A

Fecha: 2026-10-22. **Implementación SOURCE-ONLY, lista para revisión independiente;
no declarada aceptada.** No existe aceptación física PostgreSQL ni activación.

## 1. Base, factibilidad y alcance

Preflight read-only: rama `feature/inconnect-lead-management`, HEAD
`fea20f6015eadfee1a247173c3163adb8101aa25`, árbol limpio y staging vacío.
C2-II está registrada en HEAD. La aceptación independiente comunicada por el
usuario prevalece sobre las etiquetas históricas pendientes de los documentos.
Se mantienen intactos AGENTS.md, C2, C2-I-A/B, C2-II, lector, C1, reducer,
entidades, Fast Command y rutas operativas.

Se contrastaron el diseño completo, contratos/decoders/mappers, C2-II, las fuentes
SQL del comando 1792540800000 y sus guards con los caminos actuales de Inbound,
WebhookReceipt, Message, StatusEvent, Send, DispatchAttempt, Pending manual,
Configuration, autorización y Outbox. Son modelos operacionales core; no se
aplica un workflow syncable ni se inspecciona Enterprise RLS.

**Resultado de factibilidad estática:** es posible preparar el delta sin cambiar
los contratos aceptados. El Message y, para evidencia nueva, el StatusEvent y
avance de Message deben existir previamente en la misma transacción. C2-II
requiere el Message para leer; Effect tiene FKs inmediatas hacia esos padres.
No se puede delegar esa creación a una fase posterior al INSERT de Effect.

Los ciclos Effect↔Receipt y Effect↔ResponseIntent sí admiten preasignar UUIDs.
Receipt→Effect y Receipt→Audit son inmediatas: el orden implementado es
Effect→Audit→Receipt→Intent. El guard inmediato del Audit exige el estado previo;
el UPDATE de Conversation ocurre después. El ciclo Conversation↔Epoch debe
venir preparado por el caller; el escritor no lo crea. Se comprueban también
sus obligaciones diferidas al completar la unidad.

No se identificó una incompatibilidad estructural que obligue a modificar una
fuente aprobada. Esto es análisis de fuente y pruebas de protocolo, no una
certificación de ejecutabilidad o integridad física del esquema.

## 2. Inventario

Todos los TypeScript son nuevos en
`src/modules/inconnect-messaging/attention-adapter/persistence/writer/`:

| Archivo | Responsabilidad |
| --- | --- |
| `attention-writer.types.ts` | Entrada, colaboración de admisión, salida PREPARED y errores |
| `attention-writer-admission.ts` | Decodificación y concordancia de la admisión backend |
| `attention-writer-causality.ts` | Locks y comprobaciones causales nuevas/consumidas |
| `attention-writer-session.ts` | Reutiliza sesión C2-II; control de constraints y errores seguros |
| `attention-writer-sql.ts` | SQL parametrizado y lista de constraints relevantes |
| `prepare-attention-write.ts` | Único orquestador de lectura, decisión y persistencia |
| `index.ts` | Entrada y tipos internos, sin exportación desde barrels activos |
| `__tests__/attention-writer.fixtures.ts` | Scripts del runner y oráculo del ledger completo |
| `__tests__/attention-writer.spec.ts` | Casos funcionales, efectos, conflictos y originales |
| `__tests__/attention-writer-failures.spec.ts` | Sesión, autoridad, causalidad y fallos de cada escritura |
| `__tests__/attention-writer-replays.spec.ts` | Evidencia retenida, aliases, cobertura y captura inmutable |
| `__tests__/attention-writer-sql.spec.ts` | SQL/scopes, orden, grafo FK real e inactividad runtime |

Total: **12 TypeScript y este documento**, exclusivamente nuevos. No hay provider
Nest, registro de módulo, endpoint, resolver, API pública o consumidor operativo.

## 3. Contrato y frontera de autoridad

`prepareAttentionWrite({ queryRunner, input, causal, admit })` recibe:

- QueryRunner ya conectado, exclusivo, activo, primario PostgreSQL, profundidad 1.
- `ScopedAttentionEvent` backend normalizado, con C y epoch explícitos.
- Referencias causales backend: WebhookReceipt/lease cuando participa y UUID
  ProviderStatusEvent para evidencia. No recibe facts ni un plan previo.
- Colaboración obligatoria `admit(context)`, invocada bajo locks comunes después
  del lector. Recibe el mismo runner, evento copiado, snapshot post-lock y
  clasificación NEW/CONSUMED/CONFLICT. Debe limitarse a lectura/autorización.

`admit` devuelve null para denegar, o una admisión explícita con S, eventKey,
fingerprint, clase de autoridad actual, actor autenticado cuando procede,
referencias de autenticación/correlación y vínculo evidenceId/StatusEvent.
La evidencia nueva exige admisión outbound APPLIED; la consumida puede declarar
CONSUMED para recuperar la decisión original sin reevaluar progreso actual.
El escritor decodifica todos los campos, rechaza ausencias/extras y comprueba
su concordancia exacta con el evento, scope y causa.

**Esta colaboración es una frontera de confianza de código backend, no una
capability, garantía criptográfica o autorización ya implementada.** Cualquier
código puede construir un objeto TypeScript o una callback que mienta. No hay
implementación productiva de `admit` en esta fase. La futura integración debe
obtener autenticación y autorización vigentes por los servicios Messaging y
Record Access existentes y demostrar su composición transaccional, sin bypass.
La comparación de strings sólo evita mezclar admisiones; no autentica personas,
firmas ni callbacks y no demuestra que la máquina outbound aceptó el evento.

Se mantienen separados eventKey, effectKey, intentId lógico, UUID físico de
Intent, Message, StatusEvent, evidenceId y WebhookReceipt. No se impone
`evidenceId = StatusEvent.id` ni `providerEventKey`: la integración tendrá que
fijar y revisar una derivación estable. La admisión atestigua expresamente ese
vínculo; SQL sólo verifica los enlaces físicos disponibles. HUMAN histórico,
TEMPLATE o un authorityReference almacenado nunca sustituyen esta admisión.

Las acciones manuales/lectura requieren HUMAN y el actor del evento. Registrar
una respuesta HUMAN exige el actor congelado y admisión HUMAN; las otras
procedencias requieren BACKEND. Un callback requiere PROVIDER, no autoridad
del humano histórico de su intención. Autorización vigente y procedencia
histórica permanecen campos distintos. No se deduce HUMAN por formato.

## 4. Protocolo transaccional y colaboración causal

1. Copiar evento y decodificar/capturar referencias causales antes del primer await.
2. Crear una sesión usando `createAttentionReadSession` de C2-II y verificarla.
3. Llamar al **lector real C2-II**, que toma Configuration SHARE→Conversation
   UPDATE, relee estado/epoch y materializa sus tres slots con enlaces completos.
4. Verificar continuidad de la sesión exterior; evaluar con
   `evaluateAttentionProjection(read.plan, read.facts)` y el reducer aceptado.
5. Obtener y validar la admisión backend; verificar nuevamente la sesión.
6. Si participa un WebhookReceipt, bloquearlo UPDATE, validar C, eventKind,
   leaseToken/PROCESSING y vencimiento. Después bloquear el Message UPDATE y
   contrastar los campos causales con lo leído por C2-II. StatusEvent se verifica
   mediante un punto exacto y SHARE después de Message.
7. Preasignar UUIDs físicos y validar el Audit completo con el decoder C2-I-A,
   incluyendo capacidad. Su timestamp provisional para esta validación local se
   toma del Epoch; nunca se persiste: SQL usa el timestamp PostgreSQL real.
8. Diferir explícitamente los constraints nombrados; insertar sólo el delta.
9. Forzar esos constraints IMMEDIATE después de cerrar los ciclos y Outbox,
   verificando la sesión antes/después de cada SET.
10. Devolver PREPARED. El caller todavía debe completar su propia unidad causal,
    confirmar y sólo entonces responder/publicar mediante los mecanismos vigentes.

Se hereda el protocolo de C2-II: manager original, DataSource PostgreSQL
inicializado, conexión ya adquirida y estable, master, runner no liberado,
transacción activa de profundidad 1; aislamiento real READ COMMITTED, primario
fuera de recovery, read-write, row_security off, presupuestos SQL positivos,
PID y xid8 completo estables. No se cambia rol, RLS, timeouts ni aislamiento.
No hay connect/start/commit/rollback/release, savepoint, transacción anidada,
retry interno o segundo lector de facts. El runner es de uso exclusivo del caller.

El control de sesión exterior cubre también la llamada al lector y a `admit`.
Las consultas nuevas de causalidad no reconstruyen slots ni interpretan ausencia
ledger: comprueban padres físicos y testigos exigidos por los guards. Un EXISTS
por S/effectKey/fingerprint/StatusEvent comprueba el vínculo consumido retenido;
no se usa para decidir novedad o deduplicación. Sólo C2-II suministra facts C1.

**Precondición no demostrable por flags del runner:** si el caller ya insertó
Message o avanzó transporte antes de entrar, tuvo que adquirir primero los
locks comunes y los locks causales en orden C2. Reobtenerlos dentro del lector
no corrige una inversión anterior. No se ofrece un flag “already locked”.

| Dato | Quién lo produce y cuándo |
| --- | --- |
| Configuration/Conversation/Epoch preparado | Caller/lifecycle autorizado, antes del Message; escritor sólo valida |
| WebhookReceipt durable/autenticado | Recepción existente, posiblemente en una unidad anterior; claim puede ser separado y terminar antes del protocolo |
| Inbound Message nuevo con epoch | Caller, después de Configuration→Conversation→Receipt y antes de C2-II; INSERT de esta transacción |
| Message outbound nuevo | Caller Send futuro, con autorización actual y contenido/backend; INSERT de esta transacción antes de C2-II |
| Avance outbound y ProviderStatusEvent nuevos | Caller de evidencia futuro, bajo locks, máquina outbound real y mismo runner; UPDATE/INSERT antes de C2-II |
| Admisión actual y vínculo lógico de evidencia | Colaboración explícita `admit`, de sólo lectura/autorización dentro de la unidad |
| Effect/Audit/Receipt/ResponseIntent, cambio de atención y Outbox de atención | Este escritor, exclusivamente desde el delta C1 |
| DispatchAttempt inicial, adjuntos/staging, Outbox de Message y finalización de Receipt | Responsabilidad causal de C2-III-B/C; este escritor no los crea ni certifica |

En especial, no deben llamar al escritor después del commit de Message para
simular atomicidad. Tampoco debe crearse un Message/StatusEvent/Intent/Epoch
sintético ni ejecutar un UPDATE técnico de Message para satisfacer un marcador.
El estado outbound y sus hechos tienen que provenir de una operación real.

## 5. Causalidad xid8, eventos nuevos y replays

El escritor nunca genera, suministra ni actualiza
`attentionCreatedTransactionId`/`attentionUpdatedTransactionId`. PostgreSQL los
asigna por los triggers C2-I-B. Las consultas causales piden sólo los booleanos
`im_at_own_write(...)`, separados de `attentionRevision` de negocio.
No se usa xmin, low32, Number/int64 ni un ID transaccional del caller.
La SELECT de sesión heredada preserva el xid8 completo como texto.

- Nuevo INBOUND_RECEIVED/RESPONSE_INTENDED: Message exacto de S y dirección,
  con creación de la transacción actual. Respuesta exige formato concordante.
- Nueva PROVIDER_EVIDENCE: Message exacto e intención leída por C2-II;
  StatusEvent exacto del mismo Message/S, normalizado, appliedToProjection,
  creación actual y Message actualizado en la unidad, con estado outbound igual
  al normalizado. Además, admisión APPLIED por el futuro caller.
- Evidencia consumida: se conserva el StatusEvent originalmente enlazado al
  Effect. No se exige recrearlo, actualizar Message ni presentar otra vez
  progreso APPLIED. C2-II valida registro y evidencia histórica; el nuevo
  chequeo exige el vínculo físico exacto. El estado actual puede haber avanzado.
- Un nuevo Receipt de transporte de un alias puede diferir del WebhookReceipt
  histórico del StatusEvent original; el lease nuevo se valida por separado.
  Recuperación backend sin nuevo claim permite causal.webhook null para
  evidencia consumida. Inbound de este contrato exige Receipt con lease.

Los testigos xid8 y appliedToProjection no demuestran autenticidad, admisión
outbound verdadera o autorización. Esas obligaciones siguen en la frontera
anterior y necesitan implementación/pruebas de integración futuras.

## 6. SQL y traducción a filas

`C = workspaceId + conversationId + providerConnectionId`.
`S = C + trackingEpochId`. Los identificadores SQL son constantes privadas;
UUIDs, identidades, referencias y resultado son parámetros `$n` tipados.
Todas las inserciones ledger contienen S completo. No hay orIgnore, upsert,
ON CONFLICT, truncamiento, TTL, purga, selección temporal ni recálculo histórico.

| Sentencia | Scope y datos |
| --- | --- |
| Webhook lock | `$1..$3=C`, `$4=Receipt`, `$5=lease`; JOIN a Conversation demuestra C completo |
| Message causal | `$1..$4=S`, `$5=Message`; epoch de origen exacto, UPDATE lock |
| Status causal | `$1..$4=S` mediante Message, `$5=Message`, `$6=Status`, `$7=effectKey`, `$8=fingerprint` |
| Effect INSERT | S; UUID, effectKey/fingerprint, canonicalReceiptId, eventKind y referencias causales según kind |
| Audit INSERT | S; UUID de intento, claves/fingerprint, JSON kind/reason/audit íntegro, versión 1, autoridad actual y referencias |
| Receipt INSERT SELECT | S/eventKey; Effect por S/effectKey/fingerprint; UUID del Audit propio; RETURNING id/effectId |
| Intent INSERT | S; UUID físico, intentId, Message, contenido, coveredRevision, procedencia/actor/referencia, formato y registeredEffectId |
| Conversation UPDATE | C/puntero epoch y before status/revision exactos; cambia sólo estado/revisión, pendingAt y updatedAt |
| Outbox INSERT | S entra en la función de clave; workspace/Conversation, tipo y payload constantes; estado PENDING |

Los writes se envuelven en `WITH written AS (...) SELECT ... FROM written`.
Esto conserva la forma estructurada SELECT del driver TypeORM 0.3.31 también
para UPDATE, cuyo raw directo sería `[rows,rowCount]`. Se exige records/raw
idénticos, affected concordante y exactamente un ID correcto. SET CONSTRAINTS
usa su envelope propio: records/raw vacío y affected null, con verificación de
sesión alrededor. Esa forma real del driver está inspeccionada en fuente,
pero todavía no validada contra PostgreSQL.

Las columnas técnicas/timestamps se omiten en INSERT. Conversation abre pendingAt
por su guard PostgreSQL sólo al pasar ATTENDED→PENDING; PENDING→PENDING conserva
`c.pendingAt`, y ATTENDED lo deja NULL. No hay Date ni timestamp transportado
por JavaScript. Revisiones continúan text decimal exacto con aritmética C1 BigInt.

## 7. Idempotencia y originales

C2-II resuelve Receipt/eventKey, Effect/effectKey e Intent/intentId o Message.
El escritor no decide duplicación mediante errores UNIQUE ni vuelve a ejecutar
el reducer contra un original y el estado vivo.

| Decisión C1 | Escrituras preparadas |
| --- | --- |
| Nuevo APPLIED o IGNORED | Effect, Audit y Receipt canónico; Intent sólo al registrar respuesta |
| Alias nuevo | Audit DUPLICATE propio y Receipt alias; reutiliza Effect por S y fingerprint |
| Replay canónico o alias ya existente | Audit del intento actual; no sustituye originales ni crea nuevo Receipt/Effect/Intent |
| CONFLICT sin nueva operación causal dependiente | Audit sólo; ninguna clave de dominio reservada |
| CONFLICT con Message creado en la unidad, o conflicto de evidencia | CAUSAL_OPERATION_REJECTED; ninguna escritura del writer y rollback obligatorio del caller |

El último caso evita confirmar un envío sin su intención o avanzar/terminar un
callback antes de resolver su causa. Por ejemplo: Message outbound recién
insertado, revisión viva 2, intención que cubre 1 → C1 STALE_RESPONSE_INTENT;
confirmar sólo Audit dejaría Message sin Effect y violaría MESSAGE_COMPLETE.
El escritor rechaza la unidad en lugar de fabricar intención/Effect. Para
registrar duraderamente ese rechazo fuera del rollback haría falta una unidad
explícita diferente, trabajo de integración pendiente. Un callback sin Intent
permanece reintentable y no puede terminar PROCESSED por este error.

`outcome` describe el intento actual; `snapshot` es su estado actual. `originals`
contiene separadamente el primer resultado del Receipt y el canónico del Effect,
existentes o preparados por el delta actual. Un alias nuevo recibe original
DUPLICATE; el Effect conserva APPLIED/IGNORED. Un CONFLICT devuelve originales
null. Las filas históricas no se actualizan; no se amplía coveredRevision ni
se cambia actor, contenido, formato o procedencia de una intención consumida.
`rows` identifica el Audit nuevo y filas nuevas/vínculo de un Receipt nuevo;
en un replay sin Receipt nuevo, effectId puede ser null aunque exista el Effect.

## 8. Ciclos, una unidad y Outbox

Los UUIDs se preasignan dentro del escritor antes del primer write. Effect lleva
el UUID del futuro canónico; Audit ya existe al insertar Receipt; Intent lleva
el UUID de su Effect, y éste su intentId lógico. Al completar, se fuerzan
IMMEDIATE las cuatro FKs diferidas y los ocho constraint triggers diferidos de
C2-I-B: doce nombres explícitos, incluyendo el ciclo Epoch/puntero preparado
por el caller. Se dejan IMMEDIATE al devolver; no se cambia el resto de
constraints. No se deja un ciclo incompleto para resolver después del commit.

El guard de Audit exige before vigente y un único evento por Conversation en la
transacción superior, aun con cambio de revisión cero. El contrato v1 del caller
sigue siendo una Conversation/un evento por unidad completa, sin batch ni
savepoints. El escritor no puede demostrar qué locks o transiciones sobre otros
agregados tomó un caller previamente; respetar esa precondición es obligatorio.

Sólo `audit.attentionChanged` produce UPDATE de Conversation y una Outbox nueva
`CONVERSATION_ATTENTION_CHANGED`, aggregateType CONVERSATION, aggregateId del
Conversation y payload exacto `{ conversationId }`. La clave se construye por
`core.im_at_outbox_key(S,effectKey)`, usando la misma implementación que el guard:

```text
["attention-outbox-v1", workspaceId, conversationId, providerConnectionId,
 trackingEpochId, effectKey, "CONVERSATION_ATTENTION_CHANGED"]
```

Audit/estado/Outbox deben satisfacer los guards de la misma transacción antes
de PREPARED. No se emite salida por RESPONSE_REGISTERED, IGNORED o DUPLICATE.
La UNIQUE global de Outbox no se silencia ni reutiliza sin comprobación.
No se llama Redis, Twilio, enqueue ni publicador. El publicador vigente todavía
no reconoce este tipo: su allowlist/fanout autorizado es obligación de III-B/C.

La Outbox causal de Message y DispatchAttempt no están certificados por PREPARED.
El futuro caller debe producirlos atómicamente según su operación. Un resultado
del escritor no es éxito público de Send/Inbound ni autoriza submit/publicación.

## 9. Errores, rollback y límites de retry

Salida técnica: `ok:false`, `callerMustRollback:true`, error seguro code/path y
SQLSTATE cuando existe. Nunca contiene SQL, parámetros, mensaje del driver,
resultado parcial ni facts reinterpretados como ausencia. Se conservan errores
del lector/gates/epoch, y se añaden AUTHORITY_REQUIRED, ADMISSION_FAILED,
CAUSALITY_VIOLATION, CAUSAL_OPERATION_REJECTED, WRITE_FAILED e INCOMPLETE_WRITE.
Un error de programación se propaga y también obliga a abortar.

**El caller debe abortar ante cualquier error, incluso si PostgreSQL todavía
no marcó la transacción abortada.** El escritor no ejecuta rollback ni simula que
ocurrió. Los statements anteriores pueden haber corrido; un resultado fallido
no autoriza commit ni continuar/reparar dentro de esa unidad. El PREPARED tampoco
confirma commit: un fallo posterior del caller o de un constraint restante sigue
pudiendo revertirlo todo. La unidad debe mantener los locks hasta terminar.

23505 se devuelve como error, incluso para claves conocidas: rollback y, como
máximo, una relectura/evaluación completa en otra transacción según C2. Conflictos
estructurales desconocidos no se convierten en duplicate. 40P01/40001 requieren
retry completo del caller con las mismas identidades/cobertura, reautorización y
plan nuevo; C2 propone máximo tres intentos totales. Timeout/cancelación/conexión
perdida no producen ausencia. No se implementa aquí un bucle operativo ni se
inventan presupuestos, TTL o purga. Commit indeterminado deberá reconciliarse
por las mismas claves en otra unidad, sin cambiar intención para forzar APPLIED.

## 10. Validación ejecutada

Node Linux v24.16.0 en PATH. No se ejecutó SQL real, conectó PostgreSQL, llamó
UP/DOWN ni inició servicios como parte de estas pruebas.

| Validación | Resultado |
| --- | --- |
| Writer focal | **4 suites / 95 pruebas PASS** |
| Lector C2-II | 3 suites / 101 PASS |
| C2-I-A | 3 suites / 126 PASS |
| C1 | 2 suites / 63 PASS |
| Reducer | 2 suites / 78 PASS |
| C2-I-B schema/guards/xid8 | 3 suites / 67 PASS |
| Registro, persistencia y Pending legacy | 3 suites / 31 PASS |
| Conjunto Jest | **20 suites / 561 pruebas PASS**, cero fallos/omisiones |
| Typecheck completo twenty-server | tsgo --noEmit --incremental false: exit 0 |
| Typed lint explícito | 12 TypeScript; cero errores/warnings |
| Formato explícito | 12 TypeScript PASS |

Los scripts comparan SQL, parámetros, orden, cardinalidad y envelope; la espera
del lock usa una promesa controlada. Las decisiones se contrastan con el reducer
real sobre ledger completo, independiente de C1 delta. Un oráculo adicional
extrae las 15 FKs de la fuente real y contrasta padres inmediatos, referencias
preasignadas y ciclos declarados, respetando el FK nullable de StatusEvent.
No es un intérprete SQL ni prueba de instalación/rollback PostgreSQL.

Se cubren nuevos eventos/efectos, aliases/replays, originales separados,
consumo IGNORED, conflictos y Message ya usado, Human FREEFORM/TEMPLATE,
AUTOMATION/LEGACY_UNKNOWN, DELIVERED/READ, SENT/FAILED/UNKNOWN, lectura personal,
revisión vieja/enorme, gates, causalidad, admisión, mutación de inputs,
continuidad de sesión, fallos de cada DML/Outbox/constraints y UNIQUE.
Ningún mock afirma que los writes previos se revirtieron: se exige error sin
resultado parcial, cero statements posteriores y ownership exclusivo del caller.

Durante la validación se corrigieron fixtures que omitían el Receipt de una
intención cuya eventKey reutilizaban, una ruta relativa de test y una expectativa
del oráculo que trataba una FK nullable como padre obligatorio. Typecheck detectó
Array.at fuera del lib configurado; se sustituyó. La revisión de SQL detectó y
corrigió un parámetro C sin referencia en el lookup de WebhookReceipt. No se
modificó ninguna fuente aceptada para resolver estas comprobaciones.

Comandos desde `packages/twenty-server`, con
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-iii-a-jest-cache src/modules/inconnect-messaging/attention-adapter/persistence/writer
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-iii-a-jest-cache src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-schema.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-guards.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-transaction-identity.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/inconnect-messaging-instance-command-registration.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-persistence.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-work-state.service.spec.ts --json --outputFile /tmp/c2-iii-a-jest-results.json
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/persistence/writer
```

Desde raíz:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-iii-a-nx-data NX_CACHE_DIRECTORY=/tmp/c2-iii-a-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
node_modules/.bin/oxfmt --check packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/persistence/writer
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
```

Logs/JSON en `/tmp/c2-iii-a-{writer-jest,jest,typecheck,typed-lint,diff-lint}.log`
y `/tmp/c2-iii-a-jest-results.json`. oxfmt se aplicó sólo al directorio nuevo;
Markdown está excluido y se revisa estructuralmente y por whitespace. Diff lint
usa main...HEAD: los untracked requieren lint/formato explícitos. Los resultados
finales de diff lint/whitespace y Git se registran abajo tras completar esa revisión.

## 11. Obligaciones concretas de C2-III-B/C

- Implementar admisión/autorización actuales a través de Messaging/Record Access,
  demostrando runner/snapshot/caches vigentes. Los servicios actuales de
  autorización usan repositorios/globales: llamarlos desde una callback no
  demuestra por sí mismo que sus consultas compartan la transacción del writer.
- Definir la derivación backend estable de intentId/evidenceId, contenido y
  autenticación/correlación; conservar esas identidades entre reintentos.
- Adquirir Configuration antes de Conversation incluso antes de crear Message;
  resolver identidades de routing sin usar prelecturas como decisión. Preparar
  Conversation/Epoch por un lifecycle autorizado fuera de este escritor.
- Reorganizar webhook processing: hoy conserva Receipt antes de Message y no
  adquiere el protocolo común antes de los INSERTs inbound. Revalidar lease
  después de Configuration→Conversation; Message y StatusEvent deben preceder
  C2-II sin invertir locks.
- Reorganizar **claim y complete** de Dispatch: ambos toman Attempt antes de
  Message. No basta añadir Conversation al final. Todas las rutas con ambas
  filas deben respetar Message→Attempt; claims aislados deben terminar antes
  del procesamiento. Revisar también los locks implícitos de FKs, staging,
  recuperación/UNKNOWN y los distintos caminos de transporte que no atienden.
- Componer Send: reautorizar, congelar cobertura bajo lock, insertar Message
  tracked, DispatchAttempt inicial, staging/adjuntos, writer y Outbox causal
  antes del único commit; ninguna llamada al proveedor dentro de la unidad.
- Componer callbacks nuevos con admisión outbound real, UPDATE Message,
  StatusEvent y Outbox de estado; deduplicar ledger antes de descartar un replay
  como callback outbound duplicado/regresivo. Un conflicto no termina Receipt.
- Componer Inbound Message + atención + Outbox INBOUND_MESSAGE_RECEIVED y
  finalización del Receipt en la misma unidad. CRM/F13 continúa post-commit.
- Diseñar API manual con intención/revisión observada; rechazar el booleano
  legacy antes de su no-op en agregados preparados. Favorite/Unread independientes.
- Ampliar allowlist de Outbox para el tipo nuevo y su hint CONVERSATION_UPDATED,
  conservando reautorización por destinatario; no introducir un segundo realtime.
- Fijar respuesta pública sólo después de commit, política operativa de retry,
  recuperación de commit ambiguo, despliegue/drenaje, gates, bootstrap y rollout.
  Retención/purga/borrado de workspace siguen siendo trabajos separados.

Nada de lo anterior se implementa ni activa automáticamente en C2-III-A.

## 12. Condiciones para aceptación física posterior

Requiere nueva autorización específica, aislamiento físico aceptado y objetivo
PostgreSQL desechable; otro puerto o nombre no bastan. Deben comprobarse:
instalación real de 1792540800000 y funciones/constraints; sintaxis y resolución
SQL; envelopes del driver CTE/SET; ciclos completos y rechazos anticipados por
SET IMMEDIATE; comparación xid8 superior unsigned, asignación/inmutabilidad,
commit/rollback/caídas; auditoría y Outbox atómicas; unicidades/NULL/scopes y
bytes de índices; timestamps exactos; waits y lecturas post-lock; deadlocks y
leases con los demás writers; permisos/RLS y reautorización real; variantes de
callback, progreso APPLIED verdadero y replay; tamaño/coste de las consultas.

Las pruebas de mocks y fuente no prueban que una transacción real revierta,
que locks serialicen, que no existan datos omitidos o que los triggers instalados
se ejecuten correctamente. Tampoco certifican entrega del proveedor, publicación,
bootstrap, drenaje o configuración de ningún entorno. No se ejecutó PostgreSQL,
Fast Command, migración, generador, setup, servidor, worker, Redis o Twilio.
PG0, PG1, Stage C5 y exact-upgrade permanecen bloqueados.

La entrega solicita revisión independiente de SOURCE-ONLY, particularmente la
frontera `admit`, causas nuevas frente a consumidas, contratos de caller, orden
FK/Audit/Conversation y validación de ciclos/Outbox. No se declara C2-III-A
aceptada, no se hace commit ni se inicia C2-III-B/C.

## 13. Revisión final y Git

Diff lint Nx terminó con exit 0: 523 archivos en typed lint y 481 en formato
según sus exclusiones. Los 12 TypeScript nuevos tienen además typed lint y
formato explícitos PASS. Whitespace de tracked y de los 13 nuevos por
`git diff --no-index --check /dev/null <archivo>`: PASS. Markdown se revisó por
estructura y whitespace, sin cambiar su exclusión de oxfmt. No hay referencias
al writer fuera de su propio directorio en fuentes TypeScript.

Estado final: misma rama y HEAD del preflight, **13 archivos untracked**,
cero modificaciones tracked y staging vacío. `git diff --stat` y
`git diff --cached --stat` están vacíos porque no se añadieron los archivos al
índice; status y revisión no-index incluyen los nuevos contenidos.
Git permaneció exclusivamente read-only. No se hizo commit ni activó runtime.

La composición futura debe conservar INITIALLY DEFERRED para los guards/ciclos
causales antes de insertar un Message tracked. Si el caller los hubiera forzado
IMMEDIATE antes de producir esa causa, el INSERT podría fallar antes de entrar
al escritor; no se propone un bypass. El writer explicita el diferimiento de
su conjunto al comenzar el delta y lo cierra antes de devolver PREPARED.
