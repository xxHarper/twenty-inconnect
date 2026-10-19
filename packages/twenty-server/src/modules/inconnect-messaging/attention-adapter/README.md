# Fase 1B-1B-C1 — Contratos y proyección (SOURCE-ONLY)

Fecha: 2026-10-19. No hay adaptador conectado, entidad, tabla, migración,
servicio, registro NestJS, endpoint, conexión ni consumidor. El directorio
`attention-domain/` aceptado permanece intacto. No se inicia la siguiente fase.

## Decisión comercial vigente

**DELIVERED o READ, con evidencia válida, autenticada y correlacionada de una
respuesta HUMAN, cierra solamente la revisión cubierta que siga vigente.**
La regla de negocio está aprobada. HUMAN + TEMPLATE también puede cerrar;
AUTOMATION y LEGACY_UNKNOWN nunca cierran. QUEUED, SENDING, ACCEPTED, SENT,
FAILED y UNKNOWN no cierran. READ del proveedor no es Unread personal.

`approvedAttentionSuccessPolicy()` mapea esta decisión al literal histórico
`PROPOSED_DELIVERED_OR_READ` que el reductor todavía exige. El nombre describe
una API heredada, no una decisión comercial provisional. No se cambia el dominio.
No se ofrece UNDECIDED como configuración nueva del adaptador.

ACCEPTED no existe entre los estados del dominio aceptado. El contrato futuro de
evidencia conserva `providerStatus`, separado de la evidencia normalizada. Esta
subfase rechaza ACCEPTED como evidencia normalizada; no implementa una nueva
máquina outbound ni decide cómo un proveedor normalizará ese estado. Su futura
normalización nunca podrá convertirlo en DELIVERED/READ ni perder el estado
original. Se mantiene la máquina outbound vigente como autoridad de aceptación
de callbacks, incluida su política de estados contradictorios.

## Inspección y contrato de diseño confirmado

Se inspeccionaron AGENTS.md, tipos, constructor, identidad/fingerprint, reductor,
fixtures y las dos suites del dominio; no se dedujo el comportamiento sólo del
README. La rama inicial era `feature/inconnect-lead-management`, HEAD
`6b1044bbe2`, sin cambios locales.

El usuario confirmó el 2026-10-19 que el diseño 1B-1B-B se realizó en otra
conversación y no se guardó en el repositorio. El contrato aportado directamente
por el usuario es la referencia de diseño para C1; no hace falta localizar otro
documento:

- Reutilizar el reductor sin modificarlo.
- Preparar AttentionEffect y AttentionReceipt como entidades durables futuras.
- Conservar scopes, fingerprints, aliases, claves idempotentes y resultados
  originales.
- Demostrar equivalencia entre historial completo y proyección acotada.
- No consumir claves cuando exista un conflicto no aplicado.
- No crear tablas, migraciones ni integración con Messaging productivo.
- Usar DELIVERED/READ como criterio comercial aprobado para respuestas humanas
  autenticadas.
- Mantener Git exclusivamente en lectura y no avanzar a C2.

La implementación C1 y sus validaciones se conservan. Las decisiones pendientes
son las ya descritas aquí: autoridad y completitud del lector durable, invariantes
físicas, serialización/atomicidad, normalización de ACCEPTED, representación SQL
de revisiones, retención y ciclo de vida de epochs. Ninguna se presume resuelta
por estas pruebas source-only ni habilita integración productiva.

## Archivos y contratos

| Archivo | Responsabilidad |
| --- | --- |
| `attention-adapter.types.ts` | Scopes, epoch, identidades, revisión/snapshot con marca de validación, errores/resultados, facts y delta normalizados, intención/procedencia y fronteras de confianza |
| `attention-contract-validation.ts` | Validación estructural de entradas backend tipadas, revisión decimal exacta, tuplas de identidad y mapeo de política aprobada |
| `attention-event-copy.ts` | Copia inmutable del evento antes de retener su identidad |
| `attention-original-result.ts` | Comparación del resultado original independiente del orden de propiedades |
| `attention-projection.ts` | Plan de lecturas por clave y reconstrucción de la entrada acotada del reductor |
| `evaluate-attention-projection.ts` | Invocación del mismo reductor, delta lógico y recuperación de resultados originales |
| `index.ts` | Exportaciones puras; sin registro productivo |
| `__tests__/attention-projection.fixtures.ts` | Store normalizado y oráculos de prueba, sólo en memoria |
| `__tests__/attention-contracts.spec.ts` | Identidades, revisiones, invariantes y corrupción local |
| `__tests__/attention-equivalence.spec.ts` | Equivalencia con historia completa y propiedades adversariales |

Todos los identificadores son explícitos y no vacíos, sin espacios iniciales o
finales. No se normalizan, recortan ni concatenan mediante separadores ambiguos.
Las claves externas de efecto/receipt son tuplas JSON versionadas que incluyen
workspace, Conversation, Provider Connection **y epoch obligatorio**. La clave
del dominio y su fingerprint conservan exactamente la codificación v1 aceptada;
no se hashean ni se interpretan como autorización. Una conexión o epoch diferente
no puede aportar facts al snapshot actual. El epoch deberá derivar del backend;
un cliente no podrá elegirlo ni iniciar otro para eludir una clave consumida.

`ExactAttentionRevision` exige una cadena decimal no negativa canónica. No pasa
por Number. `AttentionSnapshot` valida y copia scope, estado y revisión; no
certifica la autenticidad de su origen ni la completitud del ledger. La entrada
es backend tipada; no es un decoder de JSON arbitrario. `UntrustedAttentionInput`
retiene `payload: unknown` y no es intercambiable con `AuthenticatedAttentionFact`.
Las referencias declaradas de autenticación/autorización/correlación en estos
contratos no autentican, autorizan ni consultan nada. El futuro adaptador deberá
obtenerlas y revalidarlas desde autoridad real, dentro de su transacción.

La procedencia y cobertura forman parte de la intención inmutable. No se deduce
HUMAN del formato, del cliente, de SENT, de un permiso de lectura ni de un
callback. La correlación futura debe comprobar el tuple completo de scope,
Message local, intención y provider Message, además de autenticidad del proveedor.
El reductor puro no autentica ni comprueba esa relación por sí mismo.

Los errores de contrato separan scope, identidad, autoridad, colisión, revisión,
readiness, configuración y ledger inválido. AUTHORITY_REQUIRED y NOT_READY son
contratos para fases posteriores; ninguna función actual finge realizar esas
comprobaciones. Los conflictos propios del dominio conservan exactamente
`kind: CONFLICT` y su reason, incluida IDEMPOTENCY_CONFLICT. No se consumen como
receipts ni se convierten en éxitos recuperables.

## Inventario exhaustivo de consultas del reductor v1

Además de status/revision/scope del snapshot, sólo existen estas consultas:

| Consulta real | Condición y orden | Hecho acotado requerido |
| --- | --- | --- |
| `responseIntents.find(intentId)` | PROVIDER_EVIDENCE, antes de dedup/scope/revisión; también aporta auditoría de duplicados y conflictos | Una intención por intentId |
| Intención del evento | RESPONSE_INTENDED, para cobertura y auditoría | El propio evento; nunca sustituirlo por la intención almacenada |
| Comparación exacta de scope | Antes de consumir claves | Snapshot y envelope backend coherentes |
| Validación de revisión actual | Antes de deduplicar | Cadena decimal del snapshot |
| `receipts.find(eventKey)` | Antes de validar revisión referenciada | Receipt exacto, incluso si pertenece a otro efecto |
| `receipts.find(effectKey)` | Junto al anterior | Effect canónico con fingerprint y canonicalEventKey |
| `receipts.some(eventKey)` en finish | Para APPLIED, IGNORED y DUPLICATE | El mismo receipt por eventKey; no una consulta de aliases completa |
| Validación de cobertura y comparación con revisión actual | Después de dedup | Evento manual/intención entrante o intención por intentId |
| `responseIntents.some(messageId)` | RESPONSE_INTENDED, después de cobertura | Una intención por Message |
| Comparación de Message, procedencia, estado de evidencia y política | PROVIDER_EVIDENCE | Evento e intención por intentId |

El reductor no busca todos los aliases, todos los fingerprints, callbacks previos,
intenciones por revisión, resultados originales ni auditorías históricas. No usa
un máximo de estado del proveedor, ni orden de timestamps, ni una caché.
MESSAGES_READ tiene efecto por **eventKey**: otra clave es un hecho IGNORED nuevo,
no un alias del anterior. Para el resto, la clave de efecto sigue exactamente
las tuplas INBOUND/Message, MANUAL/actor/intención, RESPONSE/intención y
EVIDENCE/providerMessage/evidenceId del dominio.

## Representación normalizada y suficiencia

`LogicalAttentionEffect` representa un único efecto consumido APPLIED o IGNORED:
scope, effectKey, fingerprint, canonicalEventKey y resultado original mínimo.
`LogicalAttentionReceipt` representa cada clave de evento consumida, incluidos
aliases DUPLICATE: scope, eventKey, effectKey, fingerprint y su primer resultado.
`LogicalAttentionIntent` guarda la intención inmutable completa.

`planAttentionProjection()` pide exactamente tres slots como máximo:

1. Receipt por `(scope, eventKey)`.
2. Effect por `(scope, effectKey)`.
3. Intención por `(scope, intentId)` para evidencia **o** por `(scope, messageId)`
   para registrar respuesta; ninguno para los demás eventos.

Cada slot es un punto con fila o ausencia autoritativa `null`, no una página o
array truncado. La reconstrucción valida scopes, claves e invariantes locales;
rechaza resultados históricos incoherentes y un receipt del efecto consultado
sin su Effect correspondiente. No puede demostrar que un lector omitió una
fila: la completitud, unicidad y visibilidad transaccional son precondiciones
obligatorias del futuro lector durable. Una caché no satisface ese contrato.

Se sintetiza un receipt canónico desde el Effect y se agrega el receipt del
evento si es diferente: **a lo sumo 2 receipts y 1 intención al entrar** al
reductor. La salida puede contener **3 receipts y 2 intenciones** al añadir el
hecho nuevo. Estos arrays representan sólo la proyección de una transición.
Nunca se persisten como snapshot completo ni se usan como historial siguiente.
Se retiene el delta y se reconstruye otra proyección para cada evento.

La equivalencia tiene como precondición una historia válida del reductor y un
ledger normalizado con unicidades/referencias satisfechas. Los aliases de un
efecto comparten fingerprint, por lo que su receipt canónico basta para reproducir
la búsqueda de primer efecto; el orden relativo de los dos receipts proyectados
no cambia ninguna consulta. La intención por Message reproduce el `some`, y la
intención por intentId reproduce el `find` y todos sus datos de auditoría.
No se promete equivalencia con arrays arbitrariamente corruptos, duplicados o
incompletos que nunca podrían producir las reglas aceptadas.

La igualdad comparada es de estado efectivo, revisión, resultado/reason,
identidad, auditoría completa y **hechos completos tras fusionar el delta**. Los
arrays de la proyección sola no son iguales al historial completo y no se declara
que lo sean. Entradas malformadas o scopes mezclados se rechazan en la frontera;
no se envían al reductor para intentar obtener una transición equivalente.

No se encontró una consulta que requiera recorrer historia no acotada en v1.
Si cambia el reductor o la versión de identidades, se debe repetir este análisis
y su prueba antes de reutilizar la proyección.

## Resultados originales, conflictos y reintentos

El resultado original mínimo es kind/reason y **toda** la auditoría del reductor,
incluidos before/after con estado y revisión exacta. No incluye arrays históricos
ilimitados ni inventa un formato futuro de respuesta pública. Para recuperar
una respuesta API que incorpore otros campos habrá que versionar explícitamente
ese contrato antes de integrarla.

Un efecto conserva su primer APPLIED/IGNORED; cada alias conserva su primer
DUPLICATE. En una repetición exacta se recuperan ambos. En un alias nuevo se
recupera el resultado del efecto, y el resultado propio del alias se crea ahora.
El reductor sigue devolviendo **estado actual**, con auditoría del intento actual;
el original histórico se entrega separado y nunca reemplaza el snapshot.

CONFLICT no agrega Effect, Receipt ni intención. Su auditoría se devuelve para
un eventual registro de intento separado que no reserve la clave lógica. Un
callback sin intención puede reintentarse tras su llegada; un evento futuro
puede reintentarse después de alcanzar su revisión. No se reproduce una decisión
IGNORED al cambiar configuración o cobertura, porque su clave ya fue consumida.

## Pruebas y oráculos

Cada paso ejecuta dos recorridos: el reductor original con ledger completo y
el mismo reductor con la proyección reconstruida desde el store normalizado.
Se compara toda la auditoría, resultado/reason y estado efectivo. El delta se
fusiona con la historia completa y se exige igualdad exacta de receipts e
intenciones, con su orden. El store sólo agrega las filas nuevas; no reemplaza
filas consumidas. Se conserva el resultado original y se comprueba después de
nuevos cambios de atención.

Los oráculos adicionales no dependen de la función productiva de proyección:
clave de efecto esperada por un switch independiente; incremento decimal exacto
sólo cuando cambia atención; conflictos sin filas nuevas; duplicados sin efectos
ni intenciones nuevas; resultado explícito de cierre HUMAN por DELIVERED/READ;
protección de trabajo posterior; comparación literal de snapshots grandes y de
resultados originales; límites de filas constantes.

Casos cubiertos: primer hecho, exact replay, alias y alias repetido, clave de
evento reutilizada para otro efecto, cambio de fingerprint, conflicto de Message,
callback antes de intención y retry posterior, IGNORED consumido, respuesta
antigua, HUMAN + TEMPLATE, AUTOMATION/LEGACY_UNKNOWN, estados no definitivos,
lectura personal, revisiones mayores que MAX_SAFE_INTEGER y que int64, scopes y
epochs distintos, corrupción local, orden de propiedades y entradas congeladas.
Se exploran los 120 órdenes de cinco eventos (inbound B y cuatro callbacks),
cada uno con aliases, y 1.000 historias adversariales de tres pasos (3.000 pasos
más 1.000 repeticiones). Una historia adicional mantiene 400 receipts y 200
intenciones mientras las lecturas permanecen por punto.

## Complejidad

Sea N el número histórico de facts, A el número de aliases y L el tamaño de las
claves, revisiones y campos escalares. Se requieren como máximo 3 búsquedas
indexadas y 3 filas devueltas: O(log(N + A)) por búsqueda en un índice B-tree,
sin contar L. La proyección y el reductor sobre ella usan O(L) tiempo y memoria,
independientes de N y A. BigInt y serialización dependen de L. No se promete un
límite constante de bytes para strings sin tamaño máximo. El crecimiento durable
sigue siendo O(N + A): la proyección no es GC, borrado ni compactación de claves.
El store de pruebas no es un motor de persistencia ni autoridad productiva.

## Mapeo conceptual y requisitos de persistencia posterior

Sea S = `(workspaceId, conversationId, providerConnectionId, trackingEpochId)`.
No se crea todavía ninguna de estas estructuras físicas.

| Destino futuro | Mapeo y restricciones exigidas |
| --- | --- |
| AttentionEffect | UNIQUE `(S, effectKey)`. Fingerprint y canonicalEventKey inmutables. Original APPLIED/IGNORED. Contrato de identidad v1 fijado por epoch |
| AttentionReceipt | UNIQUE `(S, eventKey)`. Referencia compuesta al Effect del mismo S; fingerprint coherente. Original propio inmutable. Receipt canónico referido por el Effect, con validación diferida/inserción atómica de la pareja |
| Intención durable (Message o registro dependiente, decisión física pendiente) | UNIQUE `(S, intentId)` y `(S, messageId)`; referencia al Message exacto y a su epoch. Inmutables cobertura, contenido, formato, procedencia y actor; nunca reasignar la intención al reintentar |
| Conversation | Estado/revisión actuales y epoch activo derivados del backend. FK/workspace/Provider Connection coherentes; bloqueo común para **todos** los escritores de atención |
| Message | Identidad local, conexión y provider Message correlacionados; dirección y origen backend verificables. La identidad provider se resuelve por conexión, no globalmente ni desde un callback sin verificar |
| Tracking epoch | Referencia al agregado, versión de identidad/reductor y política aprobada inmutables. Barrera histórica y coexistencia/bootstrap deberán diseñarse después. No inferir HUMAN del legado ni convertir callbacks antiguos en cobertura nueva |
| Outbox | Evento durable sólo para efectos reales según `audit.attentionChanged`, con UNIQUE por `(S, effectKey, tipo de salida)`; aliases y cambios sólo de ledger no repiten hints |
| Auditoría de intentos | Scope/epoch, identidad, resultado y audit mínimos; conflictos sin reserva de eventKey/effectKey. No usar su unicidad de intento como deduplicación de dominio |

Las referencias completas impiden mezclar workspace, Conversation, conexión o
epoch. También se deberá impedir reutilizar el mismo Message/inbound como un
nuevo hecho de trabajo moviéndolo a otro epoch: Message queda vinculado a su
epoch de origen y los callbacks resuelven ese epoch. La unicidad por S sola no
sustituye esa relación ni autoriza a reiniciar epochs arbitrariamente.

Se exige serialización común por workspace + Conversation, leyendo estado y los
puntos del ledger en la misma transacción/snapshot coherente. El bloqueo incluye
registro de intenciones y aliases, aunque no incrementen revisión: un CAS basado
sólo en revisión de atención no serializa esas escrituras. Unicidad y FK son la
última barrera, nunca un reemplazo del bloqueo/relectura y autorización vigente.

Debe persistirse en **una transacción**: Message/hecho causal cuando corresponda,
intención, estado/revisión, Effect, Receipt, auditoría y Outbox. Conflictos,
rollback y fallos de unicidad no deben dejar reservas parciales. Los retries
reanudarán en una transacción nueva con lectura actual; no continuarán una
transacción abortada ni ampliarán cobertura. Las llamadas al proveedor y la
publicación de Outbox sucederán fuera de esa transacción, después del commit.
Los destinatarios seguirán requiriendo reautorización.

La representación SQL de revisión deberá conservar todos los decimales sin
pasar por Number. El dominio no limita a int64: elegir numeric entero o imponer
un límite explícito con manejo de overflow requerirá contrato posterior. No se
puede truncar silenciosamente una revisión grande para encajar en bigint.
Retención, tamaños máximos de claves/fingerprint/audit, índices y política de
reconciliación se deberán fijar antes de implementar persistencia. Eliminar
receipts/effects permite repetir efectos y no se autoriza como optimización.

## Validación y límites

Los comandos de validación usan Node local v24.16.0 añadido al PATH, sin levantar
servicios ni conexiones. Se ejecutan Jest focal (adaptador y regresiones del
dominio), typecheck completo `tsgo --noEmit --incremental false`, typed lint
focal, el target `lint:diff-with-main`, oxfmt y `git diff --check`.
El lint de diff contra main sólo examina cambios ya incluidos en HEAD; los
archivos nuevos se verifican además explícitamente con typed lint y formato.

Resultados finales de esta entrega:

| Validación | Resultado |
| --- | --- |
| Jest del adaptador | PASS: 2 suites / 63 pruebas |
| Regresiones attention-domain | PASS: 2 suites / 78 pruebas |
| Typecheck completo del servidor | PASS |
| Typed lint focal de los 10 archivos TypeScript nuevos | PASS: 0 errores / 0 warnings |
| Target lint:diff-with-main | PASS |
| oxfmt | PASS |
| git diff --check y comprobación no-index de los 11 archivos nuevos | PASS |
| Git | Misma rama/HEAD; 11 archivos nuevos sin seguimiento, ningún archivo existente modificado, sin staging ni commits |

Los logs de validación quedan en `/tmp/inconnect-c1-jest-final.log`,
`/tmp/inconnect-c1-typecheck-final.log`, `/tmp/inconnect-c1-lint-final.log` y
`/tmp/inconnect-c1-diff-lint.log`. `git diff --stat` y el diff staged están
vacíos porque los archivos siguen sin seguimiento; se revisaron además mediante
`git diff --no-index` contra `/dev/null`, sin incorporarlos al índice.

Estas pruebas no prueban atomicidad PostgreSQL, FK/índices, bloqueos reales,
autenticación, autorización, confiabilidad del proveedor, entrega de Outbox ni
recuperación tras crash. No hay integración inbound/outbound, callbacks,
acciones manuales nuevas, bootstrap ni clasificador NORMAL/MESSAGE_PENDING.
No se modifican Conversation, Message, SendService, WebhookProcessingService,
DispatchService, WorkStateService, GraphQL, frontend, distribución o permisos.
Git se usa exclusivamente en lectura: sin staging, commit ni cambios de rama.
PG0, PG1 y exact-upgrade permanecen bloqueados.

Siguiente subfase recomendada, únicamente tras nueva autorización: revisión del
contrato del lector transaccional, la completitud/ausencia de cada punto y las
invariantes físicas bajo el contrato 1B-1B-B confirmado arriba. Luego diseñar
pruebas de rollback, carreras, unicidades y Outbox para la fase que se autorice.
C1 queda cerrada en alcance source-only; no se inicia C2, persistencia ni
integración productiva.
