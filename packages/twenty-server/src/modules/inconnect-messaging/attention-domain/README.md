# Fase 1B-1B-A — Atención de conversaciones (SOURCE-ONLY)

> Reconciliación documental 2026-10-27: los rótulos de propuesta/revisión y
> siguiente fase de esta entrega son históricos. DELIVERED/READ para respuesta
> HUMAN con cobertura vigente ya está aprobado; el literal
> PROPOSED_DELIVERED_OR_READ se conserva por compatibilidad. C2 y sus capas hasta
> R4 existen SOURCE-ONLY; no hay autorización de activación ni clasificador Lead.
> Consultar [estado canónico](../../../../docs/INCONNECT_PROJECT_STATUS.md) y
> [guardrails](../../../../docs/INCONNECT_ATTENTION_GUARDRAILS.md) antes de modificar.

Dominio puro y provider-neutral. No está registrado en `InconnectMessagingModule`
ni importado por código productivo. No cambia el Pending actual ni activa reglas
automáticas. No implementa clasificación NORMAL/MESSAGE_PENDING.

## Archivos nuevos

| Archivo | Responsabilidad |
| --- | --- |
| `conversation-attention.types.ts` | Estado, revisión, procedencia, intención, hechos, evidencia, resultado y auditoría |
| `create-conversation-attention-state.ts` | Constructor puro para un agregado nuevo |
| `attention-event-identity.ts` | Identidades de efecto y fingerprints semánticos canónicos |
| `transition-conversation-attention.ts` | Reductor inmutable con control de revisión e idempotencia |
| `index.ts` | Exportaciones del contrato puro |
| `__tests__/conversation-attention.fixtures.ts` | Hechos y estados de prueba independientes de infraestructura |
| `__tests__/conversation-attention.spec.ts` | Semántica normal, entradas adversariales y auditoría |
| `__tests__/conversation-attention-concurrency.spec.ts` | Intercalaciones, reordenamiento y propiedades de historias |
| `README.md` | Tabla de transiciones, compatibilidad, requisitos y decisiones pendientes |

## Base real consultada

- `../entities/conversation.entity.ts`: `pendingAt` compartido, sin revisión de atención.
- `../entities/message.entity.ts`: `sendMode` FREEFORM/TEMPLATE y estado de envío;
  no existe procedencia durable HUMAN/AUTOMATION ni revisión cubierta.
- `../services/inconnect-messaging-work-state.service.ts`: `setPending` bloquea
  Conversation, cambia `pendingAt` y escribe Outbox sólo al cambiar el booleano.
  Repetir Pendiente actualmente es un no-op. Leer afecta el cursor personal.
- `../services/inconnect-messaging-send.service.ts`: autorización humana actual,
  intención `clientRequestId` acotada a actor/conversación y fingerprint durable.
- `../services/inconnect-messaging-dispatch.service.ts`: ACCEPTED se proyecta a
  SENT; esto no confirma entrega.
- `../services/inconnect-messaging-webhook-processing.service.ts`: inbound único
  por Provider Connection + provider Message; callbacks correlacionados,
  evidencia persistida y aplicación de la máquina de envío existente.
- `../state-machine/outbound-message-state-machine.ts`: conserva su autoridad
  sobre el ciclo de envío (incluidos FAILED terminal y UNKNOWN conservador).

## Contratos y uso

`index.ts` expone tipos, `createConversationAttentionState` y
`transitionConversationAttention({ state, event, successPolicy })`.

El estado nuevo empieza ATTENDED en revisión `"0"`; esto significa ausencia de
intención de atención abierta, no prueba de una respuesta humana histórica.
El constructor no importa conversaciones históricas. Revisión es una cadena
decimal canónica no negativa; incremento/comparación usan BigInt sin Number,
sin truncamiento, sin límite artificial de precisión ni límite de almacenamiento
PostgreSQL elegido en esta fase. No se usan fechas para ordenar intenciones.

Cada cambio de atención incrementa la revisión exactamente una vez, incluso
PENDING → PENDING por un inbound único o una nueva intención manual. Un cierre
también incrementa la revisión, invalidando otros cierres concurrentes. Registrar
una respuesta conserva la revisión y congela su cobertura. Los hechos ignorados,
duplicados y registros de respuesta no incrementan la revisión.

`AttentionResponseIntent` une intentId, Message, fingerprint de contenido,
revisión cubierta, procedencia y formato. HUMAN identifica al Workspace Member
autenticado y la referencia de autoridad backend; AUTOMATION y LEGACY_UNKNOWN
carecen de autoridad humana. El formato TEMPLATE nunca decide procedencia.
Callbacks sólo referencian una intención registrada: no pueden elegir ni
actualizar su procedencia, cobertura, actor o formato.

`AttentionEvent` lleva scope workspace/Conversation/Provider Connection y una
clave estable de idempotencia; no es un DTO público. `AttentionProviderEvidence`
es evidencia normalizada y correlacionada por el backend, identificada por evento
y Message del proveedor. El adaptador será responsable de la correspondencia
exacta entre esos identificadores y el Message local.

Cada resultado contiene APPLIED/IGNORED/DUPLICATE/CONFLICT, motivo, siguiente
estado y auditoría mínima: scope, identidad del hecho/efecto/intención/Message,
actor/procedencia cuando corresponden, cobertura, evidencia, política usada y
status/revisión antes y después. No contiene texto, teléfono, credenciales ni
payloads crudos del proveedor. El adaptador deberá persistir `kind`, `reason` y
`audit` juntos; podrá agregar un timestamp servidor sin hacerlo autoridad de orden.

## Tabla de transiciones

En la tabla, `r` es la revisión actual; `c` la cubierta por la respuesta y `o` la
observada en una acción manual. Se asumen claves nuevas y scope correcto.

| Hecho | Condición | Resultado | Atención/revisión |
| --- | --- | --- | --- |
| Inbound único | Cualquier estado | APPLIED / INBOUND_OPENED | PENDING, r+1 |
| Leer mensajes | Cualquier estado | IGNORED / READ_DOES_NOT_ATTEND | Sin cambio |
| Pendiente manual | o ≤ r | APPLIED / MANUAL_PENDING_RENEWED | PENDING, r+1 |
| Atendido manual | o = r y PENDING | APPLIED / MANUAL_ATTENDED | ATTENDED, r+1 |
| Atendido manual | o = r y ATTENDED | IGNORED / ALREADY_ATTENDED | Sin cambio |
| Atendido manual | o < r | CONFLICT / STALE_MANUAL_ATTENDED | Sin cambio |
| Registrar respuesta | c = r y Message/intención nuevos | APPLIED / RESPONSE_REGISTERED | Sin cambio; registra intención |
| Registrar respuesta | c < r | CONFLICT / STALE_RESPONSE_INTENT | Sin cambio |
| Evidencia | Intención ausente o Message incorrecto | CONFLICT | Sin cambio; permite resolver causalidad y reintentar |
| Evidencia | AUTOMATION o LEGACY_UNKNOWN | IGNORED / NON_HUMAN_RESPONSE | Sin cambio |
| Evidencia HUMAN | QUEUED/SENDING/SENT/FAILED/UNKNOWN | IGNORED / INSUFFICIENT_PROVIDER_EVIDENCE | Sin cambio |
| Evidencia HUMAN | DELIVERED/READ, política UNDECIDED | IGNORED / SUCCESS_POLICY_UNDECIDED | Sin cambio |
| Evidencia HUMAN | DELIVERED/READ, propuesta explícita, c = r y PENDING | APPLIED / HUMAN_RESPONSE_CONFIRMED | ATTENDED, r+1 |
| Evidencia HUMAN | DELIVERED/READ, propuesta explícita, c < r | IGNORED / REVISION_NOT_CURRENT | Sin cambio |
| Evidencia HUMAN | DELIVERED/READ, propuesta explícita, c = r y ATTENDED | IGNORED / ALREADY_ATTENDED | Sin cambio |
| Referencia de revisión | Inválida o superior a r | CONFLICT | Sin cambio |
| Clave de hecho o efecto repetida | Mismo contenido semántico | DUPLICATE | Sin cambio de atención |
| Clave de hecho o efecto repetida | Contenido diferente | CONFLICT / IDEMPOTENCY_CONFLICT | Sin cambio |

La deduplicación precede la validación de cobertura actual: un reintento válido
de una intención anterior sigue siendo duplicado después de otro inbound.
Pendiente manual admite una vista anterior porque reabrir no pierde atención;
Atendido manual requiere coincidencia exacta. Para intentar cerrar tras conflicto
se necesita nueva observación y nueva intención, sin reescribir la anterior.

## Concurrencia e idempotencia

- Inbound A → revisión 1; respuesta humana captura 1; inbound B → revisión 2;
  DELIVERED de A no cierra B. Una nueva intención Pendiente tiene igual protección.
- Si DELIVERED de A gana primero, cierra en revisión 2; B reabre en revisión 3.
  Ambos órdenes conservan B pendiente. No se promete igualdad de revisiones entre
  historias con distinto orden transaccional o diferente número de cambios.
- Dos cierres manuales de la misma revisión: sólo uno puede aplicarse. Dos
  respuestas humanas que cubren la misma revisión: sólo una puede cerrarla.
- READ del proveedor puede llegar antes de DELIVERED sin producir dos cierres.
  SENT/UNKNOWN tardíos no degradan atención. Un fallo no cierra ni reabre.
- Un callback anterior al registro de su intención produce conflicto sin consumir
  la clave. Se podrá reintentar tras recuperar el hecho causal; nunca se infiere
  una procedencia humana desde el callback.

Las identidades de efecto usan tuplas JSON canónicas, sin concatenaciones
ambiguas: inbound por Message local; manual por actor + intención; respuesta por
intención; evidencia por provider Message + evidenceId dentro del scope. El
fingerprint usa campos ordenados explícitos. `contentFingerprint` es un dato
backend de la intención; el dominio no accede al contenido ni calcula hashes.
Un mismo Message no admite dos intenciones de respuesta.

El ledger `receipts` consume hechos aplicados e ignorados. Nuevas claves de
transporte para el mismo efecto se registran como alias DUPLICATE; también quedan
protegidas contra reutilización contradictoria. Duplicados de una clave ya
registrada devuelven el mismo estado. Conflictos no consumen claves ni modifican
el estado. Un duplicado devuelve el estado actual; la respuesta original de un
comando, si se necesita para una API futura, deberá conservarla el adaptador.

Estos arrays inmutables modelan un ledger completo, sin GC ni podas. No son un
diseño de almacenamiento escalable ni autorización para crear tablas. El futuro
adaptador debe preservar unicidad e historia suficiente incluso al compactar;
eliminar claves o coberturas permite repetir efectos. Un snapshot debe provenir
del constructor/reductor o ser validado íntegramente al reconstruirlo. La frontera
TypeScript no decodifica JSON arbitrario ni autentica identidades.

## Requisitos del futuro adaptador transaccional

1. Serializar todos los escritores de atención por workspace + Conversation y
   releer estado bajo el bloqueo, o usar CAS exacto con reintento sobre estado
   actualizado. También serializar escrituras de ledger/intenciones que no
   incrementan la revisión; un CAS sólo de revisión no basta para esas escrituras.
2. Garantizar unicidad física de inbound, intenciones, Message de respuesta,
   claves de hechos/efectos/alias y efectos de Outbox, con aislamiento de workspace,
   Conversation y Provider Connection. Cola/reintentos no son autoridad.
3. Registrar la revisión cubierta al aceptar la intención humana dentro de esa
   serialización. Congelarla con procedencia, actor, contenido y Message;
   nunca capturar la revisión al llegar la confirmación. No ampliar cobertura en
   reintentos ni al cambiar contenido. Un nuevo envío requiere nueva intención.
4. Derivar procedencia del contexto/backend autenticado (humano, job autorizado,
   o legado sin prueba), nunca de campos del cliente, del formato TEMPLATE, de
   permisos de lectura, del estado SENT ni de heurísticas de mensajes históricos.
   Reautorizar las acciones humanas y resolver workspace/Conversation en backend.
5. Verificar autenticidad del proveedor, conexión, evento y correlación exacta
   con Message/intención. Respetar la máquina de envío productiva: no usar este
   reductor para reabrir FAILED terminal, reinterpretar estados o confiar en
   callbacks contradictorios descartados por su autoridad. Determinar qué evidencia
   aceptada alimentará atención requiere el contrato de integración posterior.
6. Persistir atómicamente Message o su actualización, intención/cobertura,
   estado/revisión, deduplicación/auditoría y Outbox correspondiente. Un fallo debe
   revertir todo. APPLIED de registro no significa cambio de atención; generar
   efectos de atención sólo cuando `audit.attentionChanged` lo indique.
   Persistir también receipts de IGNORED/DUPLICATE nuevos, sin duplicar Outbox.
7. Hacer llamadas al proveedor y publicar después del commit mediante el ciclo
   durable existente. No introducir I/O en el reductor ni una segunda autoridad.
   Conservar causalidad entre intención, envío y confirmación, y definir la
   recuperación de hechos que lleguen antes de sus dependencias.

## Compatibilidad y decisiones abiertas

Hoy `pendingAt !== null` sigue significando exclusivamente Pending manual.
Este dominio es una propuesta explícita de evolución: inbound automático,
renovación Pendiente aun estando pendiente y cierre con revisión son conductas
nuevas que requieren aprobación e integración posteriores. No se puede conectar
el booleano `setPending` actual sin ampliar su contrato de intención y revisión.
Leer/Unread/Favorite mantienen su independencia y la clasificación de Leads
permanece fuera de esta fase.

La futura compatibilidad puede conservar el indicador visual PENDING ↔ pendingAt
no nulo, pero el timestamp solo no aporta revisión, cobertura ni idempotencia.
Debe acordarse bootstrap histórico, coexistencia/corte de escritores antiguos,
versionado y rollback antes de tocar persistencia; nunca inferir HUMAN de datos
legados. No se define backfill ni se reproduce historial para activar la regla.

Decisiones pendientes de negocio y autorización:

- Aprobar o cambiar DELIVERED/READ como evidencia suficiente. La función exige
  `UNDECIDED` o `PROPOSED_DELIVERED_OR_READ` explícito; la segunda sólo permite
  explorar la propuesta en este dominio. SENT sigue siendo aceptación de envío.
- Resolver evidencia contradictoria, callbacks descartados y proveedores sin
  confirmación definitiva; hasta entonces no hay cierre por ausencia de prueba.
- Acordar despliegue, bootstrap, permisos/UX del cierre por revisión, retención del
  ledger y auditoría, y política de recuperación/reconciliación histórica. Cambiar
  de política no vuelve a aplicar hechos consumidos: requeriría un procedimiento
  nuevo, explícitamente diseñado y autorizado.
- Autorizar por separado cualquier diseño de integración y después entidades,
  migraciones, ejecución física y activación. Esta entrega no concede esos permisos.

Siguiente subfase recomendada: **1B-1B-B, diseño source-only del adaptador y de
procedencia durable/cobertura**, tras revisión de esta propuesta. Preparar
contratos de transacción, claves, evidencia válida, bootstrap y coexistencia;
sin iniciar implementación física ni clasificación SQL hasta nueva autorización.

## Validación

Los dos suites focales cubren casos normales/adversariales, HUMAN + TEMPLATE,
AUTOMATION + TEMPLATE, legado, ausencia de confirmación, precisión superior a
Number.MAX_SAFE_INTEGER, snapshots congelados, reintentos y colisiones.
La suite de concurrencia explora 24 órdenes de callbacks, 120 intercalaciones
con inbound B y 2,800 pasos de historias adversariales de longitud hasta cuatro.
Son simulaciones deterministas, no aceptación de bloqueos ni transacciones reales.

Jest focal: 2 suites / 78 pruebas aprobadas. Validación exclusivamente de código;
no se ejecutaron servicios, workers, migraciones ni operaciones PostgreSQL.
