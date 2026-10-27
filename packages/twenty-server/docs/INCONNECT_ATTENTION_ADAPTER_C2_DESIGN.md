# INCONNECT — Fase 1B-1B-C2: persistencia transaccional del ledger de atención

> Lectura vigente, 2026-10-27: este documento conserva la entrega de su fase.
> Las etiquetas de revisión pendiente y recomendaciones de siguiente fase son
> históricas; consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para los
> checkpoints posteriores hasta R4 y [guardrails](INCONNECT_ATTENTION_GUARDRAILS.md).
> Sus contratos técnicos y gates físicos permanecen; ninguna fase ni instalación
> se autoriza por esta reconciliación documental.

Fecha: 2026-10-19. Estado: **DISEÑO SOURCE-ONLY; pendiente de revisión**.

Repositorio inspeccionado: `/home/alberto/projects/twenty-inconnect`, rama
`feature/inconnect-lead-management`, HEAD
`b22374f3e40689ddfd2731455ef09ac8fe4a7133`. El árbol estaba limpio al comenzar.
Las referencias de código son relativas a este documento. La inspección fue de
fuentes y Git en lectura; no establece qué esquema está instalado en un entorno.

## 1. Resumen ejecutivo

C1 es correcto cuando sus tres slots contienen evidencia completa, autoritativa
y coherente. Si un lector omite Receipt y Effect existentes, el reductor puede
producir APPLIED donde el historial completo produce DUPLICATE. Este diseño
convierte esa precondición en obligaciones verificables del adaptador PostgreSQL:

1. Un único protocolo de escritura por Conversation, incluso para aliases,
   intenciones y hechos ignorados que no incrementan `attentionRevision`.
2. Una transacción READ COMMITTED, bloqueo de Conversation y **lectura nueva
   posterior al bloqueo** del estado y del ledger desde el primario de escritura.
3. Unicidades y FKs compuestas, conservación de identidades y validación de la
   pareja Effect/Receipt canónico antes del commit.
4. Ausencia solamente después de una consulta completa y exitosa. Errores,
   evidencia parcial, corrupción o snapshots incompatibles no producen `null`.
5. Estado, intención, Effect, Receipt, auditoría y Outbox se confirman juntos,
   junto con el Message/hecho causal que corresponda a esa operación.
6. Epoch resuelto por backend y asociado permanentemente al Message; readiness
   comprobada dentro de la transacción. Ningún epoch nuevo permite reciclar un
   Message o una intención antiguos.

Se proponen cinco tablas del módulo: Epoch, Effect, Receipt, ResponseIntent y
TransitionAudit. Estado y revisión actuales permanecen en Conversation; gate de
workspace en MessagingConfiguration; Message añade su epoch de origen. No hay
segunda cola, otro servicio de entrega, otra autoridad de permisos ni un log que
deba recorrerse completo por evento. Redis y BullMQ siguen siendo transporte.

**La regla comercial está decidida:** únicamente DELIVERED o READ válidos,
autenticados y correlacionados de una respuesta HUMAN pueden cerrar su revisión
cubierta vigente. HUMAN + TEMPLATE también puede hacerlo. SENT, ACCEPTED, FAILED,
UNKNOWN, AUTOMATION y LEGACY_UNKNOWN no confirman atención. Se conserva además
la acción manual explícita con revisión observada del dominio aceptado; no se
reinterpreta como confirmación de entrega.

Este documento no implementa tablas, entidades, triggers, servicios, migraciones,
bootstrap ni integración. No contiene SQL ejecutable. No habilita Twilio ni
atención automática. PG0, PG1 y exact-upgrade continúan bloqueados. Las garantías
descritas son obligaciones de diseño; su aceptación física requiere C2-IV
aislada y expresamente autorizada.

## 2. Mapa de componentes existentes y primitivas reutilizables

Se leyeron las reglas vigentes de AGENTS.md, contratos, identidad, reductor,
planificación, reconstrucción, evaluación y fixtures de C1. No se inspeccionó
Enterprise RLS. Las fases aceptadas se mantienen sin cambios.

| Componente real | Comportamiento observado y reutilización |
| --- | --- |
| [Tipos del dominio](../src/modules/inconnect-messaging/attention-domain/conversation-attention.types.ts) y [reductor](../src/modules/inconnect-messaging/attention-domain/transition-conversation-attention.ts) | Única semántica de transición; revisión decimal exacta; conflicto no consumido; IGNORED y aliases consumidos. No autentican entradas. |
| [Identidad v1](../src/modules/inconnect-messaging/attention-domain/attention-event-identity.ts) | Tuplas JSON ordenadas para effectKey/fingerprint. Deben conservarse sus bytes, sin normalización ni concatenaciones alternativas. |
| [Contratos C1](../src/modules/inconnect-messaging/attention-adapter/attention-adapter.types.ts), [proyección](../src/modules/inconnect-messaging/attention-adapter/attention-projection.ts) y [evaluación](../src/modules/inconnect-messaging/attention-adapter/evaluate-attention-projection.ts) | Hasta tres búsquedas lógicas; delta incremental y recuperación separada de resultados originales. Las marcas TypeScript no certifican consultas ni autoridad. |
| [Validación C1](../src/modules/inconnect-messaging/attention-adapter/attention-contract-validation.ts) y [comparador de originales](../src/modules/inconnect-messaging/attention-adapter/attention-original-result.ts) | Validación de snapshot, revisión y scope; política aprobada; igualdad por campos independiente del orden JSONB. Reutilizables después de decodificar filas desconocidas. |
| [Conversation](../src/modules/inconnect-messaging/entities/conversation.entity.ts) | `pendingAt` compartido; sin revisión ni epoch de atención. UNIQUE `(id, providerConnectionId, workspaceId)` y `(id, workspaceId)`; conexión del mismo workspace. Es el mutex natural existente. |
| [Message](../src/modules/inconnect-messaging/entities/message.entity.ts) | Conversation/conexión/workspace unidos por FK; UNIQUE parcial `(providerConnectionId, providerMessageId)` y `(workspaceId, clientRequestId)` outbound. No persiste procedencia HUMAN ni cobertura. |
| [WebhookReceipt](../src/modules/inconnect-messaging/entities/webhook-receipt.entity.ts) y [servicio](../src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service.ts) | UNIQUE conexión/eventKind/idempotencyKey, comparación de payloadHash y leases recuperables. Es recepción de transporte, no AttentionReceipt ni deduplicación semántica de atención. |
| [DispatchAttempt](../src/modules/inconnect-messaging/entities/dispatch-attempt.entity.ts) y [dispatch](../src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service.ts) | UNIQUE Message/attemptNumber; lease y frontera de submit durable. ACCEPTED se proyecta a SENT; UNKNOWN conserva incertidumbre. No recrear este pipeline. |
| [ProviderStatusEvent](../src/modules/inconnect-messaging/entities/provider-status-event.entity.ts) y [webhook processing](../src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service.ts) | Evidencia con estado original/normalizado, Message y Receipt; UNIQUE parcial webhookReceiptId. `appliedToProjection` corresponde a envío, no a atención. |
| [Máquina outbound](../src/modules/inconnect-messaging/state-machine/outbound-message-state-machine.ts) | Autoridad sobre callbacks aceptables, duplicados, regresivos y estados terminales. Atención no puede contradecirla ni reabrir FAILED. |
| [Send](../src/modules/inconnect-messaging/services/inconnect-messaging-send.service.ts) | Identidad de envío derivada de actor/Conversation/clientRequestId; fingerprint, reautorización y bloqueo de Conversation. Allí se aceptará la intención durable antes de dispatch. |
| [WorkState](../src/modules/inconnect-messaging/services/inconnect-messaging-work-state.service.ts) | `setPending` bloquea Conversation, modifica pendingAt y Outbox; repetir booleano es no-op. Ese contrato legacy no expresa intención/revisión C1. Favorite/Unread son independientes. |
| [Outbox](../src/modules/inconnect-messaging/entities/outbox-event.entity.ts) y [publicador](../src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service.ts) | UNIQUE global deduplicationKey, payload inmutable, claim/lease, recuperación y fanout con autorización vigente por destinatario. Los hints no son autoridad de estado. |
| [Autorización Messaging](../src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service.ts) | Frontera actual de operaciones humanas; Record Access se consume sólo por su fachada existente. No inferir autorización desde la intención histórica. |
| [Orquestación inbound CRM](../src/modules/inconnect-messaging/services/inconnect-messaging-inbound-auto-link.service.ts) | Ejemplo de QueryRunner con connect/start/commit/rollback/release y transacción caller-owned. Su autoridad F13 no se reutiliza para atención. CRM sigue después del commit inbound mediante Outbox. |

Los servicios anteriores usan `DataSource.transaction(async manager => ...)`,
repositorios del manager y `pessimistic_write`. El protocolo nuevo debe declarar
READ COMMITTED explícitamente; no presumir la configuración efectiva del pool.
En v1, una unidad transaccional decide un solo evento de atención de una sola
Conversation; no se ofrece batch de transiciones. Crear el baseline de una
Conversation nueva y evaluar su primer evento en esa unidad sí está permitido.
Las funciones internas de lector/escritor recibirán el manager/QueryRunner activo
del caller: no abrirán transacciones anidadas ni usarán repositorios globales
para lecturas decisorias. No hace falta un segundo DataSource para este ledger
core. El gateway transaccional Core de F13 sólo sería pertinente en una futura
composición que realmente atraviese Workspace ORM; no añade autoridad aquí.

Hay diferencias importantes respecto del protocolo propuesto: webhook processing
bloquea WebhookReceipt antes de Message; dispatch bloquea DispatchAttempt antes
de Message; el inbound no bloquea explícitamente Conversation antes de insertar
Message. Los `orIgnore()` existentes no son comprobación de igualdad de deltas.
No se trasladan esas secuencias al ledger sin el ajuste descrito en §6–§7.

Patrón aditivo consultado: Fast Commands
`1788982508902` (transport spine), `1789473600000` (template intent) y
`1790006024000` (work state), en
`src/database/commands/upgrade-version-command/2-32/`. Usan QueryRunner,
`@RegisteredInstanceCommand`, `up`/`down`, checks e índices/FKs explícitos. La
discoverability está en `instance-commands.constant.ts` y tiene prueba focal.
La futura adición usará un command nuevo y las reglas de
[UPGRADE_COMMANDS.md](UPGRADE_COMMANDS.md); no reescribirá comandos comprometidos
ni confundirá registro con ejecución. Generarlo o ejecutarlo necesita su propia
autorización. El bootstrap no debe quedar oculto dentro de un Fast Command.

## 3. Esquema físico propuesto

### 3.1 Convenciones, precisión y límites

Todos los nombres siguientes son propuestas en schema `core` con prefijo
`inconnectMessaging`. Se abrevia únicamente en este documento:

- `C = (workspaceId, conversationId, providerConnectionId)`.
- `S = (workspaceId, conversationId, providerConnectionId, trackingEpochId)`.
- `R = text` con decimal canónico `0` o entero positivo sin ceros iniciales.

Los cuatro componentes de S son UUID PostgreSQL, no identificadores elegidos por
cliente. Los IDs físicos nuevos son UUID; **no sustituyen** los effectId/receiptId
lógicos de C1, que se reconstruyen con sus tuplas v1. `intentId` permanece text,
para no confundir intención de dominio con UUID físico de una fila.

Se elige **text para revisiones**, validado por CHECK decimal y decoder, sin índice
numérico ni conversiones Number/int64. El cálculo sigue en BigInt y vuelve a
cadena canónica. Así no se impone el límite de bigint ni el de una precisión
numeric fija al dominio aceptado. Una comparación de revisión es exacta; nunca
lexicográfica para ordenar cantidades. No se ordenan transiciones por fechas.

Se proponen límites de admisión de almacenamiento v1: eventKey y effectKey hasta
1.024 bytes UTF-8 cada uno; intentId hasta 128 bytes; fingerprint, contentFingerprint
y referencias backend hasta 16 KiB por campo; resultado de auditoría hasta
64 KiB. No se indexan fingerprints ni JSONB completos. Revisiones se conservan
sin límite int64; el presupuesto total de resultado también acota recursos al
serializar una revisión extrema. Una entrada que no quepa se rechaza antes de
mutar como error explícito de capacidad; no es ausencia, conflicto consumido ni
truncamiento. Estos límites pertenecen al futuro adaptador físico, no modifican
las funciones puras. C2-I debe fijar sus errores de frontera y verificar que los
identificadores reales y las fixtures aceptadas caben.

Los índices de claves comparan texto exacto con collation determinista `C`.
No se hashean ni recortan las identidades v1. Debe comprobarse el tamaño real del
índice compuesto con claves máximas y multibyte en el PostgreSQL objetivo antes
de aceptar el DDL; 1.024 bytes es presupuesto propuesto, no garantía universal
de una instalación. No se cambia a un hash como salida silenciosa ante un fallo.

Todas las columnas son NOT NULL salvo indicación `NULL`. Instantes son
`timestamptz`, servidor/PostgreSQL; sirven para diagnóstico/retención, no orden
causal. Los timestamps históricos se copian dentro de PostgreSQL, sin perder
microsegundos al transportarlos por JavaScript Date.

### 3.2 MessagingConfiguration: gate de workspace

Se añade a la configuración singleton existente:

| Columna | Tipo / regla |
| --- | --- |
| attentionTrackingMode | varchar: DISABLED, PREPARING, ENABLED, SUSPENDED; default DISABLED |
| attentionWriterProtocolVersion | integer NULL; versión mínima de escritor, positiva al habilitar |
| attentionGateUpdatedAt | timestamptz NULL; registro del último cambio explícito del gate |

PK/workspace siguen siendo `workspaceId`. No introduce otro configurationId ni
una FK por Conversation a un identificador inventado. No tiene scope de conexión
o epoch propio: gobierna todos sus agregados. No usa
`workStateTrackingBaselineAt`, que sigue reservado a Unread personal.

Gate mutable sólo mediante procedimiento operativo autorizado y transacción.
ENABLED requiere versión soportada. Ausencia, modo/versión inválidos o
preparación parcial no implican READY. Borrado: se conserva la política actual
de configuración, pero no se puede eliminar para eludir el gate con epochs
existentes; la integración futura deberá impedir ese borrado hasta purga
explícita. No hay un permiso nuevo implícito de administración.

### 3.3 Conversation: agregado actual

| Columna añadida | Tipo / regla |
| --- | --- |
| attentionTrackingEpochId | uuid NULL; puntero al epoch activo de esta C |
| attentionStatus | varchar NULL: PENDING o ATTENDED |
| attentionRevision | R NULL |

Los tres son todos NULL antes del bootstrap o todos no nulos. Con tracking activo,
PENDING equivale a `pendingAt IS NOT NULL`; ATTENDED equivale a pendingAt NULL.
Se conserva el campo existente, sin un segundo timestamp pending persistido.
El puntero referencia `(epoch.id, C)` mediante FK compuesta diferible; el epoch
referencia la Conversation ya existente. Los UUID físicos de Conversation,
workspace y conexión no se reasignan.

El estado sólo puede cambiar mediante delta validado y auditoría correlativa.
`pendingAt` se conserva al bootstrap si existía. Durante tracking se fija con
instante servidor sólo al pasar ATTENDED→PENDING; PENDING→PENDING conserva el
inicio del período aunque incremente revisión; cerrar lo deja NULL. Esta
elección conserva la antigüedad del período pendiente y deberá reflejarse en UX.
No hay nuevo índice requerido por C1: se localiza por PK/C; cualquier índice de
lista PENDING se justificará por sus consultas autorizadas, fuera del lector.

### 3.4 inconnectMessagingAttentionEpoch

| Columna | Tipo / regla |
| --- | --- |
| id | uuid, PK; trackingEpochId de S |
| workspaceId, conversationId, providerConnectionId | uuid cada una; C |
| identityVersion | varchar; `attention-domain-v1`, inmutable |
| reducerVersion | varchar; `attention-reducer-v1`, versión de comportamiento fijada |
| successPolicy | varchar; literal histórico `PROPOSED_DELIVERED_OR_READ`, decidido |
| lifecycle | varchar: PREPARING, READY, SUSPENDED, CLOSED |
| bootstrapStatus, bootstrapRevision | varchar PENDING/ATTENDED y R; baseline inmutable |
| bootstrapPendingAt | timestamptz NULL; copia exacta del pendingAt inicial |
| bootstrapReference | text; operación backend autorizada que creó el baseline |
| createdAt | timestamptz |
| activatedAt, closedAt | timestamptz NULL; coherentes con lifecycle |

UNIQUE `(id, C)` para FKs; índice parcial UNIQUE por C para lifecycle
PREPARING/READY/SUSPENDED, como máximo un epoch no cerrado. Índice de operación
`(workspaceId, lifecycle, id)` para preparar/diagnosticar, sin barridos en C1.
FK C a Conversation `(workspaceId, id, providerConnectionId)`, usando el orden
equivalente de la clave candidata existente; workspace y conexión quedan
protegidos transitivamente. Checks: revisión canónica, status/pendingAt de
baseline coherentes, versiones conocidas e instantes compatibles con lifecycle.

El baseline no duplica el estado vivo: es el punto de arranque histórico para
auditar bootstrap y verificar la cadena. Sólo lifecycle/instantes operativos
pueden evolucionar; identidad, versiones y baseline son inmutables. No se
actualiza la política de un epoch para reevaluar claves IGNORED.

No se rota por reinicio, retry, timeout, cambio de rol ni activación repetida.
Una futura rotación requiere diseño y autorización; debe congelar el cierre
anterior y fijar un baseline explícito. Este contrato v1 rechaza mutaciones
dirigidas a epoch CLOSED o distinto del puntero actual con NOT_READY; no cambia
el epoch de origen de Messages. Pausar/reanudar conserva el mismo epoch.

### 3.5 Message: vínculo permanente al epoch

Añadir `attentionTrackingEpochId uuid NULL`, inmutable desde su INSERT. NULL
identifica Messages legacy/no rastreados, sin inferir HUMAN. Nuevos Messages de
una Conversation READY bajo gate ENABLED llevan su epoch en la misma transacción.
No se rellena ese campo para mensajes históricos durante bootstrap.

FK compuesta `(attentionTrackingEpochId, C)` → Epoch `(id, C)`; nueva clave
candidata UNIQUE `(id, S)` para referencias exactas desde ledger/intención.
No sustituye las unicidades actuales por providerMessageId ni clientRequestId.
Una FK incluye Conversation además de workspace/conexión: el triple disponible
de Message por sí solo no prueba pertenencia a la misma Conversation.

Un guard de base de datos futuro rechazará cambio de epoch, incluso NULL→UUID
por UPDATE, y el INSERT legacy sin epoch en un ámbito ENABLED/READY. Permite
actualizaciones de transporte a Messages históricos NULL, pero nunca crear desde
ellos una intención o inbound nuevo de atención. Un replay resuelve primero el
Message durable por su identidad existente y conserva su clasificación original.

### 3.6 inconnectMessagingAttentionEffect

| Columna | Tipo / regla |
| --- | --- |
| id | uuid, PK física |
| S | cuatro uuid NOT NULL |
| effectKey | text, tupla v1 exacta |
| fingerprint | text, fingerprint semántico v1 exacto |
| canonicalReceiptId | uuid; receipt que consumió primero el efecto |
| eventKind | varchar; uno de los cinco kinds del dominio |
| messageId | uuid NULL; obligatorio para INBOUND_RECEIVED, RESPONSE_INTENDED y PROVIDER_EVIDENCE |
| responseIntentId | text NULL; obligatorio para RESPONSE_INTENDED y PROVIDER_EVIDENCE; NULL en los demás |
| providerStatusEventId | uuid NULL; obligatorio sólo para PROVIDER_EVIDENCE integrado |
| createdAt | timestamptz |

UNIQUE `(S, effectKey)` y `(id, S)`; clave candidata `(id, S, responseIntentId)`
para enlazar el registro causal de una intención. Índice `(S, createdAt, id)`
para diagnóstico acotado por agregado. FKs a Epoch, Message exacto `(messageId,S)`,
ResponseIntent `(S,intentId)` y ProviderStatusEvent según §4. Checks por eventKind
de nulabilidad y direcciones/correlación comprobadas mediante guard diferido.

No almacena otra copia de canonicalEventKey ni de original: ambos se obtienen
de su canonicalReceipt y el resultado que éste referencia. Así, su
`LogicalAttentionEffect` tiene exactamente los campos exigidos por C1 sin
duplicar resultados. El original canónico sólo puede ser APPLIED o IGNORED.
Todos los campos son inmutables; no se hace upsert que reescriba fingerprint.

### 3.7 inconnectMessagingAttentionReceipt

| Columna | Tipo / regla |
| --- | --- |
| id | uuid, PK física |
| S | cuatro uuid NOT NULL |
| eventKey | text, clave exacta consumida |
| effectId | uuid; Effect del mismo S |
| originalAuditId | uuid; primer resultado propio de esta clave |
| createdAt | timestamptz |

UNIQUE `(S,eventKey)`, `(id,S)` y `(id,effectId,S)`; FK `(effectId,S)` a Effect.
FK `(originalAuditId,S,eventKey)` a Audit. Fingerprint y effectKey del receipt se
obtienen de su Effect, evitando copias divergentes; su audit también deberá
coincidir con ambos. No es WebhookReceipt y no comparte su ciclo de leases.

El receipt canónico devuelve el primer APPLIED/IGNORED; un alias devuelve su
primer DUPLICATE, con su propio before/after histórico. Una repetición exacta
no reemplaza ninguno. Todos los campos son inmutables. El índice de effectId/S
de la FK se añade si las claves candidatas no lo cubren por prefijo; no hace
falta consultar todos los aliases en el lector de transición.

### 3.8 inconnectMessagingAttentionResponseIntent

| Columna | Tipo / regla |
| --- | --- |
| id | uuid, PK física interna |
| S | cuatro uuid NOT NULL |
| intentId | text, identidad lógica de respuesta |
| messageId | uuid, Message outbound exacto |
| contentFingerprint | text, calculado por backend sobre intención aceptada |
| coveredRevision | R, congelada al aceptar intención |
| provenanceKind | varchar: HUMAN, AUTOMATION, LEGACY_UNKNOWN |
| actorWorkspaceMemberId | uuid NULL; obligatorio exclusivamente para HUMAN |
| authorityReference | text; referencia backend inmutable, no una capability reutilizable |
| format | varchar: FREEFORM, TEMPLATE |
| registeredEffectId | uuid; Effect RESPONSE_INTENDED que la registró |
| createdAt | timestamptz |

UNIQUE `(S,intentId)` y `(S,messageId)`. La vinculación inmutable de Message a un
epoch impide repetirlo en otro S; no se permite mover una intención. FK al
Message `(messageId,S)`, a Epoch y a `(registeredEffectId,S,intentId)` de Effect.
FK inversa Effect→ResponseIntent y referencia de registro se validan diferidas.
Guard diferido exige RESPONSE_INTENDED/APPLIED, mismo Message, fingerprint,
formato, procedencia y cobertura que el resultado original de registro.

La identidad de actor es histórica. WorkspaceMember vive en esquemas dinámicos:
**no se inventa una FK a un WorkspaceMember core**. Se valida pertenencia y
autorización mediante los servicios existentes al aceptar la acción. La
eliminación posterior de ese miembro no borra ni convierte la procedencia.

No se usa clientRequestId directamente como intención sin contrato de mapeo:
Send conserva su UUID derivado actual; la futura integración fija una identidad
estable de respuesta para ese envío y comprueba el fingerprint existente en
retry. No captura de nuevo la revisión, ni crea una intención nueva al reintentar
dispatch. Un retry humano que realmente cree otro Message necesita nueva
intención y cobertura actual; retryOfMessageId no hereda HUMAN ni cobertura.
Las intenciones manuales no son ResponseIntent: su identidad actor/intentId queda
en la clave MANUAL del Effect y su audit. No requieren una segunda tabla de
intenciones ni pueden usarse como correlación de una respuesta outbound.

### 3.9 inconnectMessagingAttentionTransitionAudit

| Columna | Tipo / regla |
| --- | --- |
| id | uuid, PK de intento; nunca clave idempotente de dominio |
| S | cuatro uuid NOT NULL |
| eventKey, effectKey, fingerprint | text; identidad del intento evaluado |
| result | jsonb, versión completa de kind/reason/audit del reductor |
| resultVersion | integer; 1 |
| authorityKind | varchar: HUMAN, BACKEND, PROVIDER; fuente backend verificada |
| authenticationReference | text; referencia durable de entrada/operación autenticada |
| correlationReference | text NULL; obligatoria para evidencia del proveedor |
| recordedAt | timestamptz |

UNIQUE `(id,S,eventKey)` para FK de Receipt; **sin UNIQUE sobre eventKey,
effectKey, revisión o Message**. Índices `(S,recordedAt,id)` y
`(S,eventKey,recordedAt,id)` para diagnóstico de intentos. FK a Epoch del mismo S.
No requiere referencia a Effect: un CONFLICT no tiene por qué consumirlo.

`result` conserva todo `OriginalAttentionResult` y admite adicionalmente
CONFLICT para intentos no consumidos. Incluye scope, eventKey/effectKey,
eventKind, before/after (status y revisión exacta), attentionChanged, intentId,
messageId, actorWorkspaceMemberId, coveredRevision, provenance completa,
evidence completa y successPolicy. No guarda arrays de historia, cuerpo,
teléfono, credenciales ni webhook crudo. Decoder estricto y checks/guard diferido
validan versiones, enums, revisiones, nulabilidad y concordancia con columnas.

Cada transición evaluada con autoridad y snapshot válidos registra un intento.
Receipt referencia sólo su primer intento consumido; los siguientes intentos
DUPLICATE tienen auditoría actual separada y no cambian el original. CONFLICT se
puede confirmar como auditoría sola, sin reservar claves. Un error SQL aborta la
transacción y no promete auditoría durable en ella; se reporta por observabilidad
segura, nunca se fabrica un resultado de dominio. Entradas no autenticadas o sin
epoch válido se rechazan antes de insertar auditoría de ese scope.

### 3.10 Borrado e invariantes de base de datos

Las cinco tablas no tienen soft-delete que oculte identidades al lector. FKs
internas y hacia Conversation/Message/Epoch usan NO ACTION diferible donde hay
ciclos, RESTRICT o NO ACTION en el resto; sin cascadas que eliminen sólo un
receipt/intent. ON UPDATE no permite cambiar scopes. No se añaden cascadas
directas a Workspace: su pertenencia queda encadenada por las FKs compuestas.
Esto puede bloquear la eliminación actual de un workspace con ledger; hace
falta un procedimiento de purga conjunta explícito, pendiente de autorización.

Se requerirán guards de inmutabilidad y constraint triggers diferidos, no CHECKs
que consulten otras tablas. Obligaciones a comprobar al commit:

- Pareja canónica existente y del mismo efecto/scope; original no DUPLICATE.
- Todo Receipt tiene Effect y primer audit consistente; alias original DUPLICATE.
- Registro RESPONSE_INTENDED e intención aparecen juntos y se corresponden.
- Evidence apunta al Message y ProviderStatusEvent exactos, misma conexión/epoch.
- Todo cambio del agregado corresponde a un único audit de cambio en esa
  operación, con before igual al estado bloqueado y after al nuevo; revisión
  incrementa exactamente uno. Baseline es la única excepción, identificada como
  bootstrap autorizado y no como evento sintético de C1.
- Writers legacy no pueden cambiar pendingAt/estado en tracking activo ni
  insertar Messages sin epoch. Escrituras ledger sin gate/protocolo válido se
  rechazan; no se concede autoridad por un campo `origin` o una variable de sesión.

El fence de Conversation preparada entra en vigor desde que se asigna su
puntero/baseline, aunque el workspace todavía esté PREPARING. Hasta ENABLED
ninguna ruta ordinaria puede escribir ese agregado preparado. Así, el intervalo
entre bootstrap y activación no admite un cambio legacy que invalide el baseline.

Los triggers son defensa de integridad, no reemplazan autenticación ni la
relectura decisoria. La futura implementación deberá demostrar que también
protegen escrituras parciales y borrados fuera del camino feliz. No se promete
resistencia a un administrador que deshabilite constraints o modifique el ledger
arbitrariamente. Una base ya corrupta exige SUSPENDED y reparación autorizada.

## 4. Matriz de unicidades y FKs

En las filas con S/C se expanden todas sus columnas; nunca se usa sólo un UUID
suponiendo que garantiza scope. El orden del índice referenciado deberá coincidir
con el de la FK en el DDL futuro.

| Relación / identidad | UNIQUE requerido | Referencia / protección |
| --- | --- | --- |
| ProviderConnection existente | `(id,workspaceId)` | Conversation ya la referencia con workspace. |
| Conversation existente | `(id,providerConnectionId,workspaceId)` | Epoch→Conversation conserva C; identidad padre para todos. |
| Epoch | `(id,C)`; parcial un epoch no CLOSED por C | FK C→Conversation; puntero Conversation→Epoch del mismo C, diferido. |
| Message añadido | `(id,S)` | FK `(epoch,C)`→Epoch; epoch inmutable. No mezcla Conversations aun dentro de una conexión. |
| Effect | `(S,effectKey)`, `(id,S)`, `(id,S,responseIntentId)` | FK S→Epoch; Message→`(id,S)` cuando corresponde; intención→`(S,intentId)`. |
| Receipt | `(S,eventKey)`, `(id,S)`, `(id,effectId,S)` | FK `(effectId,S)`→Effect y `(originalAuditId,S,eventKey)`→Audit. |
| Effect canónico | canonicalReceiptId NOT NULL | FK `(canonicalReceiptId,id,S)`→Receipt `(id,effectId,S)`, DEFERRABLE INITIALLY DEFERRED. |
| ResponseIntent | `(S,intentId)`, `(S,messageId)` | FK Message `(id,S)` y FK `(registeredEffectId,S,intentId)`→Effect, diferida. |
| Audit | `(id,S,eventKey)` | FK S→Epoch; ningún UNIQUE de dominio que consuma conflictos. |
| ProviderStatusEvent: clave candidata nueva | `(id,messageId,workspaceId)` | Effect `(providerStatusEventId,messageId,workspaceId)`→StatusEvent. Message `(messageId,S)` en Effect garantiza Conversation/conexión/epoch; guard contrasta evidencia normalizada y provider ID. |
| WebhookReceipt existente | `(id,workspaceId)`; conexión/eventKind/idempotencyKey | StatusEvent ya referencia `(webhookReceiptId,workspaceId)`; guard verifica que Receipt tenga la misma conexión del Message antes de admitir atención. La FK actual sola no lo demuestra. |
| Outbox existente | deduplicationKey global | Tupla versionada de `S,effectKey,tipo de salida`; nunca UUID de intento/alias/revisión como única identidad. |

Cada FK tendrá índice de búsqueda en el lado hijo si no queda cubierto por
prefijo de otro índice. Las claves candidatas adicionales sobre UUIDs son
redundantes para identidad global, pero necesarias para las FKs con scope. No
se indexa result JSONB por defecto. Los tres slots de lectura deben tener plan
de búsqueda por sus claves únicas, sin filtro temporal, paginado ni soft-delete.

FKs diferibles resuelven ciclos de inserción; **las unicidades de eventKey,
effectKey, intentId y Message serán inmediatas**. No se usa ON CONFLICT sobre
una unicidad diferible como sustituto del protocolo.

## 5. Lector transaccional autoritativo

### 5.1 Frontera de autoridad y algoritmo

El lector futuro no acepta `AttentionProjectionFacts` de un caller arbitrario.
Recibe contexto backend verificado, manager activo y evento del scope resuelto.
Un resultado interno discriminado separará PRESENT, ABSENT y errores. Sólo el
paso final puede convertir ABSENT probado en `null` para C1.

1. Autenticar la entrada y resolver workspace/conexión/Conversation. Para inbound
   y callbacks partir del Receipt/Message durable, no de IDs del payload. Para
   humanos usar la autorización Messaging actual. Las prelecturas de routing no
   deciden ausencia ni transición.
2. Iniciar la transacción caller-owned READ COMMITTED sobre el primario; fijar
   timeout y política acotada de retry. Validar manager/QueryRunner activo y su
   aislamiento real; no aceptar réplica, read-only pool ni contexto transaccional
   ajeno. Tomar locks en §7.
3. Tras obtener Conversation, ejecutar una lectura nueva de su estado y epoch;
   comprobar gate, versión de escritor, epoch actual READY y configuración v1.
   Derivar el epoch de Message para eventos con Message y exigir coincidencia.
   Reautorizar operaciones humanas y correlación de proveedor en este contexto.
4. Decodificar revisión/status/scope y validar snapshot con C1; construir
   `planAttentionProjection`. No reutilizar un plan hecho antes de esperar el lock.
5. Materializar los tres slots con **una sentencia de lectura posterior al
   bloqueo**, sobre una fila raíz obligatoria Conversation/Epoch y LEFT JOINs por
   clave. Las búsquedas son las de §5.2. Debe devolver la raíz, indicadores de
   existencia base y datos de enlaces, aunque algún dependiente falte. No usar
   INNER JOIN que haga desaparecer un Receipt corrupto y parezca ausencia.
6. Decodificar filas desconocidas y comprobar cardinalidad 0/1 por clave,
   integridad de enlaces, invariantes originales y alcance completo. Si faltó la
   raíz o un dependiente obligatorio, no crear facts. La revisión/puntero de la
   raíz debe coincidir con el snapshot usado para planear. Mantener el lock hasta
   finalizar el escritor o devolver el resultado no aplicado.
7. Formar `LogicalAttentionReceipt`, `LogicalAttentionEffect` y la intención. Los
   joins recuperan originales completos desde Audit. Llamar a reconstrucción y
   evaluación C1 sin alterar su orden de dedup/cobertura ni omitir comprobaciones.
8. Validar el delta contra las filas leídas y ejecutar §8. Nunca tratar los arrays
   proyectados como ledger completo a reemplazar.

Una implementación puede descomponer físicamente la sentencia en consultas
preparadas si prueba que todas ocurren **después** del lock, en la misma conexión,
sin writers de ese S concurrentes y sin lecturas decisorias previas. El contrato
preferido de una materialización única reduce la superficie de snapshots
incompatibles. No se combinan consultas de managers, transacciones o réplicas
distintas. Una transacción READ COMMITTED por sí sola no equivale a un snapshot
inmutable entre sentencias.

### 5.2 Hasta tres búsquedas lógicas, con enlaces constantes

| Slot | Predicado exacto | Enlaces para completar y validar el punto |
| --- | --- | --- |
| eventReceipt | Receipt por `(S,eventKey)` | Effect de ese receipt, su canónico y audit propio/canónico. Se conserva aunque su Effect difiera del solicitado. |
| effect | Effect por `(S,effectKey)` | Receipt canónico y audit original APPLIED/IGNORED. No se consultan todos sus aliases. |
| intent | PROVIDER_EVIDENCE: `(S,intentId)`; RESPONSE_INTENDED: `(S,messageId)`; demás: NONE | Message/epoch y registro causal; intención inmutable completa. La intención entrante no sustituye a la almacenada en la búsqueda por Message. |

Los enlaces de validación son un número constante de filas, posiblemente más de
tres consultas físicas; no constituyen un cuarto recorrido de historia lógica.
La validación de fuente, gate, Message, provider ID y autorización también exige
consultas fuera de esos slots; no se promete tres consultas SQL totales. La
proyección de entrada C1 sigue conteniendo como máximo dos receipts y una
intención; la salida puede tener tres y dos respectivamente.

No se usa LIMIT 1 para ocultar duplicados en una consulta sin unicidad probada.
Tampoco una página, filtro de fecha o caché negativa. La consulta no reduce datos
por permisos de un usuario para deduplicar: el módulo accede al ledger core de
un scope ya autorizado y exige evidencia íntegra; no expone ese ledger por una
API de consulta pública. Un filtro de permisos que esconda filas no prueba
ausencia física.

### 5.3 Clasificación de resultados y comportamiento seguro

| Situación | Clasificación / salida |
| --- | --- |
| Consulta completa, raíz READY y clave sin fila | **AUSENCIA AUTORITATIVA** del punto en este S protegido; sólo aquí `null`. No promete ausencia global en todos los epochs. |
| Fila y enlaces válidos | **REGISTRO EXISTENTE**, materializar completo. |
| Filas válidas, eventKey apuntando a otro effectKey, o fingerprint entrante diferente | **CONFLICTO** semántico; dejar que C1 devuelva CONFLICT/IDEMPOTENCY_CONFLICT. Sin claves consumidas. |
| Timeout, desconexión, permisos SQL, cancelación, error del driver, schema ausente | **ERROR DE CONSULTA**; rollback y error técnico explícito. Nunca `catch => null`. |
| Root/snapshot diferentes, epoch cambiado, lecturas de conexiones distintas | **SNAPSHOT INCONSISTENTE**; no evaluar ni persistir, abortar. Reintento completo sólo si su causa es transitoria identificada. |
| Receipt sin Effect/canónico/audit, tipos/versiones inválidos, más de una fila, original imposible, referencia cruzada | **DATOS CORRUPTOS O INCOMPLETOS**; INVALID_LEDGER/NOT_READY según frontera, suspender/alertar y no auto-reparar como evento nuevo. |

Las categorías técnicas se conservarán en el error del adaptador de persistencia;
no se fuerzan a un `AttentionAdapterResult` exitoso ni a una reason inventada del
dominio. C2-II definirá ese envelope sin modificar las APIs puras aceptadas.

### 5.4 Casos que el lector debe distinguir

| Caso | Hechos y decisión esperada |
| --- | --- |
| Evento y efecto nuevos | Receipt/Effect ausentes de forma autoritativa; intención según lookup. Aplicar o rechazar el hecho por C1. |
| Evento existente | Receipt completo más Effect solicitado; C1 DUPLICATE/SAME_EVENT si coincide. Recuperar original del evento y del efecto por separado. |
| Alias nuevo de efecto existente | Receipt ausente y Effect válido. DUPLICATE/SAME_INTENTION_OR_EVIDENCE; insertar sólo receipt/audit del alias. |
| Alias existente | Receipt propio DUPLICATE histórico; Effect conserva su APPLIED/IGNORED. Nunca devolver el original canónico como si fuese el del alias. |
| eventKey→E1, entrada effectKey E2 | Leer E1 por el enlace del receipt y E2 por su slot, aun si E2 no existe. Es conflicto semántico, no ausencia del evento ni corrupción si las filas son válidas. |
| Fingerprint diferente de la entrada | CONFLICT/IDEMPOTENCY_CONFLICT, sin sobreescribir. Si son las filas almacenadas las que contradicen sus vínculos/audit, INVALID_LEDGER. |
| IGNORED previo | Effect/Receipt permanecen consumidos. Retry/alias es DUPLICATE aunque cambie estado/configuración; nunca reevaluar como nuevo. |
| CONFLICT previo | Puede haber Audit, pero no Effect/Receipt/Intent de ese intento. Sus slots pueden ser ausentes y permitir un retry causal posterior. Audit no es prueba de consumo. |
| HUMAN ya registrado | Lookup por intentId para callback o por Message para una nueva intención; recuperar actor, referencia, formato, contenido y cobertura inmutables. No refrescar procedencia/cobertura. |
| Original recuperable | `transition` usa estado actual; `recovered.eventResult` y `effectResult` son históricos. En alias nuevo sólo existe el original del efecto; el del alias se crea ahora. |
| Cambio de epoch | Resolver origen desde Message/intención durable. Si no es el activo READY, NOT_READY y ninguna nueva clave; no buscar sólo el epoch actual y asumir novedad. |

Un efecto de respuesta registrado sin cambio de revisión sigue siendo EXISTENTE.
La revisión no es contador de filas ledger ni prueba de que éste no cambió.

## 6. Protocolos de concurrencia y aislamiento

### 6.1 Elección razonada de READ COMMITTED

PostgreSQL READ COMMITTED crea snapshots por sentencia; una lectura posterior
puede ver commits que una anterior no vio. Un lock esperado no refresca los
resultados ya leídos. Además, ON CONFLICT DO NOTHING puede no insertar por un
conflicto todavía invisible al snapshot de su sentencia.
([Documentación PostgreSQL: aislamiento](https://www.postgresql.org/docs/current/transaction-iso.html)).

La decisión de diseño es que READ COMMITTED **resulta suficiente bajo este
protocolo**, porque todos los escritores del mismo agregado adquieren el mismo
lock antes de decidir y releen después. La consulta de facts comienza cuando el
predecesor ya confirmó o revirtió, y ningún escritor participante de S puede
intercalarse hasta el commit. Las filas de evidencia se observan juntas; las
unicidades respaldan las claves nuevas que no pueden bloquearse por inexistentes.
Es una deducción de las precondiciones, pendiente de prueba física; no se afirma
que los writers actuales ya la satisfagan.

REPEATABLE READ no arregla una lectura hecha antes del lock: puede conservar un
snapshot anterior, incluso si sólo se insertó ledger y la revisión no cambió.
SERIALIZABLE requeriría reintentos completos ante dependencias y no eliminaría
autenticación, constraints, correlación ni el corte de writers legacy. Añade
coste y cambios de integración sin necesidad demostrada para estos agregados.
No se selecciona automáticamente. Una futura regla que abarque varios agregados
o predicados no protegidos requerirá nuevo análisis.

### 6.2 Escenarios y resultado exigido

| Carrera | Serialización / resultado |
| --- | --- |
| Dos inbound iguales | Identidad Message existente única por conexión/provider ID; ambos resuelven la misma Conversation. Uno crea Message+Effect+Receipt y abre revisión; el segundo relee y es DUPLICATE, sin segundo incremento. |
| Dos hechos mismo effectKey y mismo fingerprint | Primero consume; segundo relee Effect. Si tiene otro eventKey, crea alias, no segundo Effect. |
| Mismo effectKey, distinto fingerprint | El perdedor ve el fingerprint consumido y CONFLICT. UNIQUE no se interpreta como igualdad. |
| Dos aliases nuevos del mismo efecto | Recibos propios únicos, un único efecto/original canónico; no cambia atención. |
| Dos respuestas con mismo Message | Lookup por Message y UNIQUE `(S,messageId)`; una registra, la otra CONFLICT/MESSAGE_IDENTITY_CONFLICT salvo retry de la misma identidad. También se bloquean aunque revisión permanezca igual. |
| Dos callbacks DELIVERED/READ | Mismo efecto se deduplica; efectos distintos se serializan. Sólo el primero válido que cubra revisión actual puede cerrar; el segundo queda consumido IGNORED si su cobertura ya no es vigente. |
| Callback antes de intención | CONFLICT/RESPONSE_INTENT_NOT_FOUND sin reservar claves; fuente durable queda reintentable. Tras registro puede aplicarse con la misma identidad. |
| Acción manual vs inbound | Si inbound gana, cerrar con revisión vieja entra en conflicto; abrir manual renueva según C1. Si cierre gana, inbound posterior vuelve a PENDING con nueva revisión. |
| RESPUESTA/IGNORED/alias sin incremento | Mismo lock obligatorio. Un CAS sólo sobre attentionRevision no descubre estos commits; se prohíbe como mecanismo único. |
| Inserción ocurrida mientras se esperaba lock | No reutilizar consulta/plan anterior. Materialización nueva ve el commit incluso si el predecesor no actualizó Conversation. |
| Nueva Conversation concurrente | Resolver identidad única conexión/address, crear si procede y bloquear la fila ganadora antes de cualquier Message/ledger. Nunca tratar un SELECT vacío como lock de una fila inexistente. |
| Dos Conversations distintas | Pueden avanzar en paralelo bajo locks SHARE del gate; unicidades globales actuales de Message siguen rechazando identidad provider/clientRequestId cruzada. |

La creación concurrente de Conversation puede usar el patrón existente de insert
con conflicto de identidad seguido de lectura nueva y lock, pero debe comprobar
la fila ganadora completa. No aplica este atajo a Effect/Receipt/Intent ni
silencia conflictos de otros constraints. Si la identidad de routing cambió,
se aborta y se resuelve de nuevo, sin retargetear el evento.

### 6.3 Linearización y revalidación

La transición se decide **dentro de la transacción que posee Conversation**,
después de revalidar gate, epoch, fuente, autorización y facts. El lock determina
su orden relativo; el punto de linearización durable de un resultado exitoso
es el commit. No se responde APPLIED antes de confirmar todos los constraints.
Un conflicto de dominio con auditoría sola se decide bajo el mismo lock y se
devuelve tras confirmar esa auditoría, sin consumir claves.

Después de esperar cualquier lock relevante se revalidan los datos que éste
protege. Un precheck humano, una plantilla consultada fuera de transacción o un
hint local no congelan autorización. C2-III debe preservar los contratos actuales
de revocación de Messaging/Record Access y probar la lectura vigente con el
contexto transaccional adecuado; no asumir que un repositorio global comparte
snapshot porque se llamó dentro de una callback transaction.

## 7. Orden de locks e integración de writers

Orden obligatorio para operaciones que participen en atención:

1. MessagingConfiguration del workspace, SHARE; bloquea cambios de gate durante
   el evento, permite eventos de Conversations diferentes. Cambios de gate usan
   UPDATE exclusivo y no se toman después de bloquear Conversation.
2. Conversation por C, UPDATE. Si excepcionalmente hay varias, orden estable por
   `(workspaceId,conversationId)`; v1 procesa un agregado por transacción.
3. Epoch de esa C, validado bajo el lock padre. Bootstrap y lifecycle respetan
   el mismo orden; no requieren un mutex independiente anterior a Conversation.
4. WebhookReceipt causal, UPDATE, si participa; comprobar leaseToken vigente.
5. Messages implicados, UPDATE y orden estable por UUID; revalidar scope, epoch,
   dirección y providerMessageId tras adquirirlos.
6. DispatchAttempt involucrado, UPDATE, orden por Message/attemptNumber.
7. Filas ledger, auditoría y Outbox; inserciones/validaciones en orden estable.

Los claims de transporte pueden seguir siendo transacciones cortas separadas
que bloquean sólo WebhookReceipt o DispatchAttempt y terminan antes del paso 1.
No conservan esos locks al entrar en el protocolo. La transacción de procesamiento
posterior debe revalidar la posesión del lease tras tomar los locks comunes.

La futura integración debe cambiar el orden de adquisición en webhook processing
y dispatch **si van a adquirir Conversation en esa misma transacción**. No añadir
Conversation al final del orden actual Receipt/Attempt→Message: produciría
inversión contra Conversation→Message. Las rutas sólo de transporte que nunca
adquieran Conversation tampoco pueden conservar Attempt→Message cuando otra
ruta toma Message→Attempt: ese par puede producir su propio deadlock. Toda ruta
que tome ambos debe respetar Message→Attempt; un claim aislado que tome sólo
Attempt debe terminar antes de procesar Message. Deben auditarse además los
locks implícitos por FK y las futuras llamadas. Las actualizaciones de
correlación provider ID tienen que conservar identidad única y releerse bajo
Message lock.

Attention no adquiere locks de CRM/F13 ni llama su executor. La resolución/link
CRM continúa post-persistencia por Outbox. El gate de atención no se injerta en
la transacción de F13; cualquier futura composición exige revisar el orden
completo, incluidos advisory locks, configuración y permisos.

No se usa SKIP LOCKED para el lector decisorio: una fila ocupada no es ausencia.
No se usa un advisory lock hash como única protección ni locks de Redis. Los
locks PostgreSQL se mantienen hasta terminar la transacción.
([Documentación PostgreSQL: locks](https://www.postgresql.org/docs/current/explicit-locking.html)).

## 8. Atomicidad, escritura y recuperación

### 8.1 Aplicar únicamente el delta comprobado

Después de evaluar C1, comparar delta y facts con scope/identidad originales:

1. Si CONFLICT: no crear Effect, Receipt, intención ni Outbox de atención; no
   cambiar status/revisión/pendingAt. Puede insertar audit del intento. Si la
   operación causal de Message no puede aceptarse sin intención, abortar esa
   operación completa; no hacer commit de un envío huérfano para responder luego
   conflicto. La auditoría aislada de ese rechazo requiere otra transacción
   explícita, sin fingir atomicidad con lo revertido.
2. Si consumido: insertar Audit con el resultado completo. Si `delta.effect`
   existe, insertar exactamente un Effect y reservar su canonicalReceiptId;
   insertar Receipt si `delta.receipt` existe. Enlazar el primer audit sólo a
   ese receipt. Insertar ResponseIntent únicamente si `delta.intent` existe.
3. El orden físico puede preasignar UUIDs e insertar Effect→Audit→Receipt→Intent
   usando las FKs cíclicas diferidas. Antes del commit todas deben satisfacerse.
   No dejar una fase de commit separada para la pareja canónica.
4. Actualizar agregado/pendingAt sólo si `audit.attentionChanged`; comprobar que
   before coincide exactamente con el estado leído y after incrementa uno.
   RESPONSE_REGISTERED, IGNORED y DUPLICATE siguen dentro de la transacción
   aunque no actualicen revision. No emitir Outbox de atención por ellos.
5. Si cambia atención, insertar una salida durable por tipo con deduplicationKey
   igual a la tupla JSON versionada de namespace atención, S, effectKey y tipo.
   No contiene datos sensibles y no usa concatenaciones ambiguas. La unicidad
   global de Outbox materializa UNIQUE lógico `(S,effectKey,tipo)`.
6. Confirmar constraints diferidos y transacción. Sólo entonces solicitar
   publicación mediante Outbox actual; nunca publicar ni llamar proveedor antes
   del commit de la intención. Realtime sigue reautorizando destinatarios.

Las inserciones ledger no usan `orIgnore()` genérico ni upsert que altere
inmutables. Una fila supuestamente nueva que encuentra UNIQUE exige recuperación
según §8.2. Incluso al reutilizar una Outbox existente hay que leer y comprobar
workspace, aggregate, tipo y payload; un resultado de insert ignorado no es
confirmación de equivalencia.

El tipo interno propuesto `CONVERSATION_ATTENTION_CHANGED` se mapearía al hint
actual CONVERSATION_UPDATED sólo tras ampliar explícitamente la allowlist del
publicador; hoy un tipo desconocido falla. Se conserva el payload mínimo de
Conversation, sin actor, campos personales ni CRM. El Outbox de Message existente
continúa por su propio hecho; dos hints de propósitos distintos no son dos
aplicaciones del mismo efecto de atención.

Para inbound integrado, Message nuevo, epoch, atención, ledger y
INBOUND_MESSAGE_RECEIVED se confirman juntos. WebhookReceipt ya puede existir
como recepción durable previa; su transición a PROCESSED pertenece a la misma
transacción causal. Para send, Message, DispatchAttempt inicial, intención y
ledger se confirman antes de submit. Para callback aceptado, actualización
Message, ProviderStatusEvent, atención y Outbox se confirman juntos.

Un callback no aplicado por causalidad ausente no puede marcar su trabajo de
atención como terminado: conserva Receipt reintentable. No se propone añadir un
segundo job ni fingir que `ProviderStatusEvent.appliedToProjection` significa
atención procesada. Si se necesita separar persistencia de transporte del retry
de atención, hará falta un contrato durable adicional revisado antes de C2-III;
v1 prefiere rollback del procesamiento causal y retry del Receipt existente.

### 8.2 Errores y límites de retry

| Error | Tratamiento futuro obligatorio |
| --- | --- |
| UNIQUE `23505` en clave conocida de idempotencia | Rollback completo. A lo sumo una relectura/evaluación nueva bajo gate+Conversation; clasificar duplicate o conflicto comparando todas las evidencias. Nunca continuar la transacción abortada. |
| UNIQUE de constraint desconocido o contradicción estructural | Error explícito, sin convertir a duplicate ni retry genérico. Diagnosticar fuera del camino de negocio. |
| Deadlock `40P01` / serialization failure `40001` | Rollback y retry de toda la unidad con mismas identidades/cobertura, reautorización y plan nuevo; propuesta máxima tres intentos totales, backoff con jitter. Agotamiento es fallo reintentable, sin éxito inventado. |
| Lock timeout, statement timeout, cancelación | Abortar; devolver indisponibilidad/reintento acotado. No devolver NOT_FOUND ni slots null. No mantener una transacción abierta para dormir/reintentar. |
| FK/check/decoder/resultados imposibles | Rollback; INVALID_LEDGER/configuración/capacidad según causa. No reparar por inserción alternativa. |
| Conexión perdida durante commit | Resultado indeterminado para el caller. Reconciliar por misma eventKey/effectKey en una transacción nueva; nunca cambiar identidad para asegurar un APPLIED. |

Los límites exactos de tiempo/backoff se fijarán operativamente en C2-III. La
política evita bucles de retry indefinidos y mantiene pendiente de revisión la
latencia admisible por ruta humana/webhook. Ante 23505 bajo el mutex común se
debe investigar un writer ajeno, una identidad global cruzada o un error de
integración; no es un resultado esperado que se silencie sistemáticamente.

### 8.3 Recuperación por punto de caída

| Punto de caída | Estado durable / recuperación |
| --- | --- |
| Antes del commit | Ningún delta parcial visible; rollback libera locks. Retry usa las mismas identidades. |
| Entre inserts, antes de cerrar ciclos | FKs diferidas impiden commit incompleto; fallo revierte toda la unidad. |
| Commit confirmado, respuesta perdida | Receipt/Effect/Intent/originales recuperables; retry DUPLICATE con estado actual y originales separados. |
| Commit confirmado, enqueue/publicación falla | Outbox queda PENDING/recuperable por mecanismo actual; no repetir transición ni submit. |
| Publicación ocurrió y no se marcó PUBLISHED | Puede repetirse el hint; consumidores refetch autorizado. No se promete entrega exactamente una vez. |
| Submit ambiguo o caída después de frontera providerRequestStartedAt | Conservar UNKNOWN y reglas de DispatchAttempt actuales. El ledger no autoriza reenviar ni cerrar por ausencia de prueba. |
| Corrupción o evidencia eliminada sin política | SUSPENDED/NOT_READY; reparación explícita. Nunca bootstrap automático ni reset de epoch. |

## 9. Seguridad y procedencia durable

HUMAN proviene exclusivamente de una entrada backend autenticada que pasó por
`InconnectMessagingAuthorizationService`, con WorkspaceMember actual y
Conversation autorizada. En la aceptación del send se congela actor,
authorityReference, contenido normalizado, formato, Message y coveredRevision
leída bajo el mutex. Un string `origin: HUMAN`, un payload tipado o una referencia
de autorización elegida por cliente no prueban nada.

AUTOMATION necesita una operación backend reconocida y autorizada en la futura
integración; no se crea ese permiso ni un principal en C2. LEGACY_UNKNOWN expresa
ausencia de prueba histórica. Ninguna de esas procedencias puede convertirse a
HUMAN por retry, plantilla, usuario asignado al Lead, estado SENT, lectura
personal o callback. Persistir un actor histórico no le da acceso vigente ni al
resultado original: cada petición humana y destinatario se reautoriza.

El proveedor no proporciona procedencia ni revisión. El backend verifica firma/
autenticación con el adaptador existente, conexión/workspace, Message local,
providerMessageId, intención y epoch. Se guarda la referencia durable de esa
verificación/correlación; no secretos ni una firma como capability de permisos.
El hint firmado local de callback sólo sirve al mecanismo actual de correlación;
se revalida Message y cualquier provider ID ya establecido bajo lock.
Si aún falta la intención, no se inventa ni se atribuye HUMAN: cuando el backend
pueda resolver su identidad causal estable desde el Message, el slot autoritativo
ausente permite a C1 devolver RESPONSE_INTENT_NOT_FOUND sin consumir claves. Si
falta también esa correlación estable, se rechaza antes del reductor y se conserva
la fuente reintentable; no se toma un intentId libre del webhook como autoridad.

DELIVERED/READ se admite para atención sólo cuando la máquina outbound lo acepta
como progreso válido de ese Message y existe intención causal. Para v1 se propone
usar el resultado APPLIED de esa máquina como criterio conservador de entrada;
eventos REJECTED, LOWER_PROGRESS_CALLBACK y DUPLICATE de transporte no generan
un cierre nuevo. El mismo Receipt procesado íntegramente se recupera como replay
del ledger, no se pierde por volver a preguntar el estado outbound ya cambiado.
La deduplicación del ledger se consulta antes de descartar un replay por el estado
outbound actual: un alias de un Effect ya consumido conserva su tratamiento
DUPLICATE y su receipt propio, aunque envío ahora clasifique la evidencia como
duplicada. La exigencia de progreso APPLIED se aplica a evidencia nueva sin
Effect consumido; nunca permite saltarse una colisión de eventKey/fingerprint.
Como el cambio Message y ledger son atómicos, un fallo ledger no deja un
DELIVERED avanzado sin su decisión de atención. Un Message ya DELIVERED legacy
no adquiere intención retroactiva. Ampliar elegibilidad de callbacks ignorados
requeriría otro contrato; no se aplica por inferencia histórica.

ACCEPTED conserva su estado original de DispatchAttempt/contrato de evidencia;
no existe como estado normalizado del reductor. No se convierte a DELIVERED/READ
ni se presenta a C1 como confirmación. SENT continúa siendo insuficiente. La
política aprobada se mapea por `approvedAttentionSuccessPolicy()` al nombre
histórico del dominio, sin reabrir su aprobación comercial.

Acciones manuales conservan autorización de work-state actual; no implican SEND
ni nuevos permisos. Su futura API necesitará identidad estable y revisión
observada para el contrato C1; el booleano legacy no puede fabricar ambas.
Nunca se introduce SYSTEM bypass, impersonación, reutilización de autoridad F13,
acceso directo a políticas/Teams o dependencia Enterprise. El ledger tampoco
autoriza editar CRM, transferir owners ni distribuir Leads.

## 10. Bootstrap, epochs, compatibilidad y retención

### 10.1 Activación futura por gates explícitos

1. Preparar esquema aditivo y decoders con gate DISABLED. Migración no activa
   atención ni reconstruye historia. Inventariar todos los writers reales,
   incluidas instancias antiguas, jobs en vuelo y rutas no habituales.
2. Pasar a PREPARING mediante operación autorizada: desplegar protocolo en todos
   los writers y fences físicos. Gate no certifica por sí solo que desapareció
   código viejo; deben comprobarse despliegue y drenaje antes de habilitar.
3. En un corte coordinado, detener/drenar writers legacy del ámbito. Bootstrap
   bajo gate+Conversation copia exactamente pendingAt. Si no es NULL: PENDING,
   revisión `0`; si es NULL: ATTENDED, revisión `0`. ATTENDED inicial significa
   ausencia de trabajo abierto en el baseline, no respuesta humana histórica.
   Guardar baseline/referencia/instantes y puntero de manera atómica.
4. Preparar Conversation/Epoch sin inferir ni reproducir mensajes antiguos.
   PREPARING puede usarse antes del corte para inventario y despliegue, pero no
   se persiste un baseline provisional mientras haya writers legacy habilitados.
   La captura del paso 3 ocurre después del drenaje; al asignar el puntero se
   instala el fence del agregado. No modificar el baseline inmutable para
   corregir un rollout defectuoso: suspenderlo y revisar su recuperación.
5. Habilitar sólo con configuración/protocolo compatibles y sus Conversations
   preparadas. Cambiar gate exclusivo serializa frente a eventos que mantienen
   SHARE. Una Conversation faltante bajo ENABLED devuelve NOT_READY hasta su
   bootstrap autorizado; no crea epoch durante una consulta de negocio.
6. Conversations nuevas se crean y preparan dentro de la transacción de su primer
   hecho, bajo el protocolo nuevo. No se deja un primer Message tracked antes de
   que exista su epoch. Un workspace parcialmente preparado no hereda readiness
   de otro ni interpreta NULL como legado válido para crear trabajo tracked.

Con gate ENABLED, NOT_READY bloquea la mutación causal tracked completa:
humanos reciben rechazo; recepción webhook durable puede continuar antes del
procesamiento, que queda reintentable sin PROCESSED ni submit parcial. La
recuperación usa WebhookReceipt/Outbox existentes y monitoreo operativo; no una
cola paralela. Callback de Message legacy NULL sólo actualiza transporte según
su contrato actual y se clasifica explícitamente como fuera de tracking, sin
crear hechos C1. No se mezcla ese caso con un nuevo Message que omitió epoch.

No hay coexistencia de escritura legacy y nueva sobre un agregado READY. Los
fences deben rechazar, aun con el mismo rol de DB, updates legacy de pendingAt,
INSERT de Message sin epoch y deltas incompletos. No basta un flag de frontend
ni un SET LOCAL suministrado por el caller. Un guard de DB no puede detectar una
ruta antigua que responda éxito sin escribir, como setPending con el mismo
booleano: la integración debe rechazar la API legacy en agregados preparados
**antes** de ese short-circuit y exigir el contrato versionado de intención y
revisión. El corte de versiones del backend sigue siendo obligatorio; fences no
certifican ausencia de procesos antiguos. SUSPENDED no permite que código viejo
reanude escritura de pendingAt; mantiene evidencia y permite diagnóstico seguro.
Un rollback de aplicación después de activar exige detener/proteger escrituras
o mantener una versión compatible; no bajar esquema ni vaciar epochs como
recuperación rutinaria.

La barrera es causal/identitaria, no `providerOccurredAt`. Un nuevo Message que
realmente se inserte después de activar participa aunque el proveedor declare
una fecha antigua. Si ya existe un Message anterior NULL, replay conserva esa
identidad y no genera inbound tracked. Receipts recibidos antes del corte pero
sin Message aún necesitan una regla operativa explícita de drenaje: propuesta
v1 procesarlos por el camino legacy antes de activar; no asignarles epoch por
timestamp ni inferir novedad en el rollout.

Favorite, Unread, read cursor y `workStateTrackingBaselineAt` quedan separados.
MESSAGES_READ en C1 es IGNORED y, si se integra, consume su propia clave sin
cambiar atención. El bootstrap no lee Unread ni crea NxM MemberState.

### 10.2 Conservación y tombstones

Política segura inicial: conservar durante toda la vida del scope las claves
Effect/Receipt, intención, vínculo Message→epoch, baseline y resultados originales
referidos. No hay TTL de deduplicación. Las auditorías adicionales de retries y
conflictos pueden archivarse mediante trabajo separado; nunca se borra el audit
al que apunta `originalAuditId` ni los datos necesarios para correlación activa.

El tombstone de un hecho consumido es su misma fila mínima Effect/Receipt y
original completo referenciado. Archivar auditoría extensa no exige otra tabla
de deduplicación: se mantienen identidad, fingerprint, scope/epoch, canónico y
resultado propio consultables en PostgreSQL. El original mínimo de C1 ya es
auditoría necesaria, no un payload descartable. Si se propone mover ese original
fuera del primario, deja de estar listo este lector hasta diseñar una recuperación
autoritativa y su fallo seguro; no se reemplaza por un null o sólo un hash.

Una futura política que elimine evidencia incluso de esos tombstones debe
**cerrar permanentemente el epoch a toda entrada**, conservar su marcador de
cierre y los vínculos/identidades de origen, y rechazar replays como NOT_READY/
evidencia expirada antes de los slots. No es seguro aceptar una clave desconocida
porque su timestamp parezca reciente: el cliente podría cambiarlo. Sin una
barrera autoritativa de origen no se autoriza esa purga. Reabrir el epoch o
eliminar su marcador después de purgar permitiría reejecutar efectos.

Para recuperar un original que se haya eliminado, la respuesta es error explícito
de evidencia no disponible, jamás APPLIED/ausencia. C1 requiere originales en sus
facts; no puede seguir operando ese scope con tombstones incompletos.

Se prefiere conservar Message como registro de identidad mientras existan FKs
de intención/efecto; redactar cuerpo/adjuntos no equivale a borrar su identidad.
Una eventual eliminación de workspace requiere purga conjunta con tracking
apagado permanentemente y entrada externa revocada. Plazos y cumplimiento legal
se deciden aparte; este diseño no ejecuta ni autoriza borrados.

## 11. Plan de implementación posterior

Todas las subfases requieren nueva autorización; los nombres no son permisos.

| Subfase | Archivos probables | Aceptación y pruebas | Riesgos / gate |
| --- | --- | --- | --- |
| C2-I: modelo y contratos físicos | Nuevos `entities/attention-{epoch,effect,receipt,response-intent,transition-audit}.entity.ts`; columnas en Conversation, Message y MessagingConfiguration; tipos/decoders en `attention-adapter/persistence/`; futura especificación/command aditivo y registro de pruebas | Paridad columnas/tipos/FKs/índices, ciclos diferidos, inmutabilidad, límites de entrada y decoder de result completos. Fixtures de mapeo reconstruct→C1; cero registro runtime/activación. | Si incluye redactar un nuevo Fast Command/generador, autorización específica; nunca ejecutarlo. No modificar comandos existentes. El modelo core no es entidad syncable. |
| C2-II: lector autoritativo source-only | `attention-adapter/persistence/read-attention-projection.ts`, decoder/mappers, pruebas focales y harness de consultas simulado | Tres slots completos; error/ausencia separados; primario/manager/lock exigidos; LEFT JOIN sin ocultar corrupción; originales propios de aliases; tests adversariales de la falla reportada. Regresiones dominio/C1 intactas. | Mocks no prueban MVCC, locks ni planes físicos. No registrar servicio ni abrir conexiones reales. |
| C2-III: escritor y composición source-only | Writer caller-owned, política de retry/recuperación, guards/constraint triggers como fuentes de command autorizado; cambios futuros en Send, WebhookProcessing, WorkState, Dispatch, Outbox y pruebas de composición | Aplicar sólo delta; atomicidad modelada; orden de locks uniforme; fencing legacy; idempotencia de Outbox; causalidad de retry; reautorización. Contrato nuevo de acción manual versionado. | Sin habilitar Twilio productivo, bootstrap ni gate ENABLED; toda integración queda desactivada. Autorización de código no implica ejecutar command/servicios. |
| C2-IV: aceptación física aislada | Plan/harness específico, pruebas PostgreSQL de constraints, concurrencia y fallos; documentación de evidencia | Aislamiento físico aceptado y autorización de aprovisionamiento/ejecución; carreras reales con barreras deterministas, commit/rollback/caídas, revisión Entity↔DDL y registro. | No usar normal local `default`; otro puerto/nombre no basta. PG0/PG1/exact-upgrade siguen bloqueados salvo autorización y gates propios; esta subfase no los desbloquea. Producción requiere decisión posterior independiente. |

Conviene mantener C2-I y C2-II pequeños; no mezclar correcciones de C1 aceptado
sin una divergencia concreta. C2-III puede dividirse en writer puro de protocolo
y composición de rutas para revisar el orden de locks antes de integrar. La
activación operativa no es una quinta tarea implícita: necesitará su propio
plan, autorización, backup/rollback y aceptación de producto.

## 12. Matriz de pruebas futuras

U = unitarias sin I/O; I = integración de componentes con manager/driver simulado,
sin DB; P = integración PostgreSQL física aislada y autorizada. No denominar
una simulación prueba de bloqueo real. Ninguna P fue ejecutada en esta fase.

| ID | Caso / oráculo | U | I | P |
| --- | --- | --- | --- | --- |
| T01 | Historial completo DUPLICATE y lector falso ausente: el contrato rechaza lector/fallo incompleto; nunca APPLIED por error de consulta | Sí | Sí | Sí: fuente durable real |
| T02 | Tres búsquedas lógicas, enlaces constantes con historia grande; mismo resultado/auditoría que reductor completo | Sí | Sí | Sí: planes y cardinalidad |
| T03 | Receipt canónico, alias nuevo, alias repetido; original APPLIED/IGNORED distinto del DUPLICATE propio | Sí | Sí | Sí |
| T04 | eventKey→otro efecto y fingerprints entrantes contradictorios; CONFLICT sin consumir | Sí | Sí | Sí |
| T05 | Receipt sin Effect/audit/canónico, claves duplicadas, JSON/versiones inválidos; INVALID_LEDGER y cero mutaciones | Sí | Sí | Sí: constraints impiden commit; corrupción controlada sólo en fixture aislada |
| T06 | Error, timeout, cancelación, permiso SQL, réplica/manager equivocado; nunca null | Sí | Sí | Sí |
| T07 | Revisiones > MAX_SAFE_INTEGER y > int64; before/after exactos, cero Number; límite de capacidad explícito | Sí | Sí | Sí: round-trip text |
| T08 | Claves en límite UTF-8/multibyte, collation exacta, exceso rechazado sin truncar | Sí | Sí | Sí: índices reales |
| T09 | Cruces workspace, Conversation, conexión y epoch en cada FK y mapping | Sí | Sí | Sí |
| T10 | Dos inbound idénticos: un cambio de atención, un Message, efecto único y receipts correctos | Historia | Orden de calls | Dos sesiones sincronizadas |
| T11 | Mismo effectKey: igualdad, colisión y varios aliases; ningún overwrite de original | Sí | Sí | Sí |
| T12 | Dos intenciones de un Message y registro sin incremento; una aceptada, conflicto de la otra | Sí | Sí | Sí |
| T13 | Commit de ledger sin tocar revision mientras otro espera Conversation; lectura posterior ve intención/receipt | Sí | Sí | Sí: crítico para READ COMMITTED |
| T14 | DELIVERED/READ simultáneos, dos respuestas y nuevo inbound/manual; sólo revisión cubierta vigente puede cerrar | Permutaciones | Composición | Sí |
| T15 | Callback antes de intención y retry con misma identidad; no reserva claves y no termina prematuramente fuente causal | Sí | Sí | Sí |
| T16 | HUMAN FREEFORM/TEMPLATE; AUTOMATION/LEGACY_UNKNOWN; origin falso; actor revocado, proveedor mal correlacionado | Sí | Sí | Sí: sin autoridad implícita |
| T17 | ACCEPTED/SENT/FAILED/UNKNOWN no cierran; callbacks regresivos/rechazados no eluden máquina outbound | Sí | Sí | Sí |
| T18 | Inyección de fallo después de cada insert/update y antes del commit; ninguna pareja/estado/outbox parcial | Sí | Sí | Sí: rollback y constraints diferidos |
| T19 | 23505 conocido/desconocido; retry en transacción nueva y acotado; no queries dentro de tx abortada | Sí | Sí | Sí |
| T20 | Deadlock/40001/lock timeout; lock order, release y retries conservan identidad/cobertura | Sí | Sí | Sí |
| T21 | Commit confirmado/respuesta perdida; commit indeterminado; recuperación con estado actual y ambos originales | Sí | Sí | Sí: corte de conexión supervisado |
| T22 | Outbox enqueue falla; publicación duplicada; clave/payload contradictorios; cero doble transición | Sí | Sí | Sí, sin proveedor real |
| T23 | Bootstrap pendingAt exacto incluido microsegundo; revisión cero, sin inferir HUMAN/Unread/historial | Sí | Sí | Sí |
| T24 | Gate parcial, epoch ausente/SUSPENDED/CLOSED, Message legacy, replay de otro epoch y writer legacy activo | Sí | Sí | Sí: fences rechazan |
| T25 | Archivado de audit de intentos conserva originales; tombstone incompleto falla; epoch purgado no reabre | Sí | Sí | Sí |
| T26 | Registro/discoverability y paridad Entity↔DDL, up/down en instancia vacía; downgrade con datos no se usa como recuperación | Sí | Sí | Sí con autorización de DDL |
| T27 | Locks implícitos de FK, claims vencidos y takeover de lease con procesamiento en curso | Modelo | Orden de calls | Sí: verificar no doble procesamiento |

Para P deben definirse barreras de sesiones, outcomes admitidos y comprobaciones
de filas/commit, sin depender de sleeps como prueba de orden. La prueba de lector
no se agota comprobando que llamó tres veces a un mock. Debe incluir omisiones,
dependientes desaparecidos y resultados reales del driver. Ningún test unitario
puede certificar por sí solo que una implementación SQL incorrecta nunca omitirá
dos filas existentes; se exige revisión de consulta y aceptación P con el caso
reproducido por la revisión independiente.

## 13. Decisiones pendientes de negocio y operación

**No está pendiente DELIVERED/READ para HUMAN**; ya es la regla aprobada. Tampoco
se propone cerrar por SENT/ACCEPTED ni deducir atención desde Unread.

Quedan por confirmar antes de activación:

- UX/API de intención manual y conflicto por revisión; propuesta mantiene
  pendingAt como inicio del período, aun al renovar PENDING→PENDING.
- Plazos de auditoría no referida y requisitos de borrado/redacción; default
  técnico seguro conserva indefinidamente deduplicación y originales.
- Ventana/corte de rollout, drenaje de Receipts anteriores y política de soporte
  a Conversations no preparadas. Se propone rechazo NOT_READY, sin fallback.
- Política operativa para proveedores que nunca emitan confirmación válida:
  permanecen pendientes o se usa acción manual existente, sin cierre inferido.
- Latencia/SLO, presupuesto de retries y tratamiento humano de errores de
  capacidad/epoch expirado. No autorizan ampliar cobertura de una intención.

No se requiere reabrir distribución de Leads, estado puro A ni proyección C1
para resolver estas decisiones de integración.

## 14. Riesgos y limitaciones sin resolver físicamente

1. READ COMMITTED es suficiente sólo si **todos** los writers y fences cumplen
   el protocolo. La integración actual aún no lo cumple; hay que revisar también
   locks implícitos por FKs y lifecycle de leases con sesiones reales.
2. Los guards diferidos, ciclos de FKs, tamaño de índices, planes del lector y
   errores del driver/ORM requieren Entity↔DDL y aceptación física. No existen
   todavía ni se validaron constraints en PostgreSQL en C2.
3. La procedencia autenticada y la reautorización vigente son obligaciones de la
   integración; los tipos C1 y un campo authorityReference no las implementan.
4. Se propone filtrar evidencia nueva por progreso outbound APPLIED. Soporta la
   regla comercial de forma conservadora y evita contradecir envío, pero exige
   integración atómica; reconciliación de datos históricos/transportes ya
   avanzados sin ledger no está implementada ni autorizada.
5. Retención de claves crece O(eventos + aliases); el lector acotado no es GC.
   Retención total y eliminación de workspace necesitan política explícita.
6. Los límites de admisión son una propuesta física verificable; no existe aún
   contrato público de errores de capacidad ni benchmark de los bytes máximos.
7. NOT_READY puede acumular recepción durable; el rollout necesita capacidad,
   monitoreo y recuperación definidos. No se compensa activando legacy.
8. Ni este esquema ni locks garantizan exactamente una entrega del proveedor,
   disponibilidad de red o publicación única. Se conserva UNKNOWN y transporte
   al menos una vez con idempotencia PostgreSQL del efecto local.

Base documental PostgreSQL adicional: las FKs requieren claves candidatas y no
crean automáticamente índices en el lado hijo
([constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)).
La elección de text evita depender del rango finito de bigint o de precisión
numeric para la revisión
([tipos numéricos](https://www.postgresql.org/docs/current/datatype-numeric.html)).
Se consultó documentación oficial pública; no se inspeccionó una instancia ni se
afirmó su versión. Estas referencias sustentan primitivas; la suficiencia del
protocolo es análisis de diseño sujeto a las pruebas anteriores.

Validación de esta entrega: revisión de fuentes y del contrato, estructura del
Markdown y whitespace. Los 141 tests y las 100.000 transiciones de la aceptación
anterior son antecedentes aportados, **no ejecuciones ni garantías físicas de
C2**. No se ejecutaron Jest, lint/typecheck de TypeScript, SQL, migraciones,
servicios ni pruebas físicas; sólo se creó este documento autorizado.
