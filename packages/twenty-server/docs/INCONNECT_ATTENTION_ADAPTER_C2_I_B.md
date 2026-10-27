# INCONNECT — Fase 1B-1B-C2-I-B

> Lectura vigente, 2026-10-27: este documento conserva la entrega de su fase.
> Las etiquetas de revisión pendiente y recomendaciones de siguiente fase son
> históricas; consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para los
> checkpoints posteriores hasta R4 y [guardrails](INCONNECT_ATTENTION_GUARDRAILS.md).
> Sus contratos técnicos y gates físicos permanecen; ninguna fase ni instalación
> se autoriza por esta reconciliación documental.

Fecha: 2026-10-21. **Implementación SOURCE-ONLY; pendiente de revisión
independiente y de aceptación física PostgreSQL.**

## 1. Base, alcance y estado

Preflight read-only: rama `feature/inconnect-lead-management`, HEAD
`bf25dcd36e757a1996d34d05debd7b0dcc4e90ac`, árbol limpio y staging vacío.
C2-I-A está registrada en ese commit. En el primer intento todavía había 14
archivos C2-I-A sin seguimiento; se esperó a que el usuario los registrara.
La aceptación independiente de C2-I-A comunicada por el usuario prevalece sobre
su etiqueta documental histórica de revisión pendiente; no se modifica ese
documento ni se presenta esta implementación como su revisión independiente.

Se leyeron AGENTS.md completo, C2 completo, C2-I-A, persistencia y sus pruebas,
contratos C1/dominio, entidades actuales, datasource, metadata/driver de TypeORM
instalado, registro y runner de upgrades y comandos aditivos de referencia.
El modelo es operacional core, no una entidad syncable. No se usa Enterprise
RLS. AGENTS.md, C2, C2-I-A, los algoritmos C1/reducer y servicios operativos
permanecen sin modificaciones.

Se redactan cinco entidades, siete columnas funcionales sobre entidades existentes
y, tras R1, cuatro marcadores técnicos adicionales sobre entidades existentes; una
clave candidata en ProviderStatusEvent, un Fast Command registrado y sus fuentes
SQL. No se implementa lector, escritor transaccional, bootstrap operativo, API,
activación, distribución de Leads ni integración de Send/Inbound/Dispatch/
callbacks/WorkState. No se conectó PostgreSQL, ejecutó SQL, invocó UP/DOWN del
nuevo comando, lanzó generador Twenty, migración, servidor, worker, Redis,
Twilio, setup o reset. Git se utilizó exclusivamente en lectura.

## 2. Identidades, scopes y columnas

`C = (workspaceId, conversationId, providerConnectionId)`.
`S = (workspaceId, conversationId, providerConnectionId, trackingEpochId)`.
Todos los componentes son UUID físicos. El epoch usa `id` como trackingEpochId.
No se sustituye ninguna identidad lógica C1 por un UUID físico.

Se conservan los bytes v1 de eventKey/effectKey/fingerprint; intentId sigue
siendo text. Effect conserva referencia a su Receipt canónico; cada Receipt
apunta a su propio audit original. No se duplica el resultado en Effect o
Receipt. Audit permite conflictos sin reservar claves de dominio. Las entidades
nuevas implementan los tipos de fila aceptados en C2-I-A.

| Entidad existente | Adición física | Estado tras UP |
| --- | --- | --- |
| MessagingConfiguration | `attentionTrackingMode varchar NOT NULL DEFAULT 'DISABLED'` | DISABLED, también para filas históricas |
| MessagingConfiguration | `attentionWriterProtocolVersion integer NULL` | NULL |
| MessagingConfiguration | `attentionGateUpdatedAt timestamptz(6) NULL` | NULL |
| Conversation | `attentionTrackingEpochId uuid NULL` | NULL |
| Conversation | `attentionStatus varchar NULL` | NULL |
| Conversation | `attentionRevision text COLLATE "C" NULL` | NULL |
| Message | `attentionTrackingEpochId uuid NULL` | NULL, incluidos todos los Messages históricos |
| ProviderStatusEvent | UNIQUE inmediato `(id,messageId,workspaceId)` | Clave conservada |
| Message (R1) | `attentionCreatedTransactionId text COLLATE "C" NULL`, `attentionUpdatedTransactionId text COLLATE "C" NULL` | NULL histórico, sin backfill/default |
| ProviderStatusEvent, OutboxEvent (R1) | `attentionCreatedTransactionId text COLLATE "C" NULL` en cada tabla | NULL histórico, sin backfill/default |

Se conserva `Conversation.pendingAt`, sin backfill ni reinterpretación. No se
toca `workStateTrackingBaselineAt`, Favorite, Unread ni el cursor personal.
MessagingConfiguration sigue teniendo solamente `workspaceId` como PK.
WebhookReceipt conserva sus claves existentes y no añade columnas.

## 3. Paridad Entity ↔ DDL

Prefijo de las cinco tablas: `core.inconnectMessagingAttention`. En esta tabla,
`UUID S` expande las cuatro columnas de S; `UUID C` expande las tres de C.
Salvo las columnas enumeradas como NULL, todas son NOT NULL.

| Entidad / tabla | Columnas y tipos coincidentes | NULL | Defaults físicos |
| --- | --- | --- | --- |
| Epoch | `id uuid`, UUID C; `identityVersion`, `reducerVersion`, `successPolicy`, `lifecycle`, `bootstrapStatus` varchar; `bootstrapRevision`, `bootstrapReference` text; `bootstrapPendingAt`, `createdAt`, `activatedAt`, `closedAt` timestamptz(6) | bootstrapPendingAt, activatedAt, closedAt | id UUID v4; createdAt now() |
| Effect | `id uuid`, UUID S; `effectKey`, `fingerprint`, `responseIntentId` text; `canonicalReceiptId`, `messageId`, `providerStatusEventId` uuid; `eventKind` varchar; `createdAt` timestamptz(6) | messageId, responseIntentId, providerStatusEventId; CHECK condiciona por eventKind | id UUID v4; createdAt now() |
| Receipt | `id uuid`, UUID S; `eventKey` text; `effectId`, `originalAuditId` uuid; `createdAt` timestamptz(6) | Ninguna | id UUID v4; createdAt now() |
| ResponseIntent | `id uuid`, UUID S; `intentId`, `contentFingerprint`, `coveredRevision`, `authorityReference` text; `messageId`, `actorWorkspaceMemberId`, `registeredEffectId` uuid; `provenanceKind`, `format` varchar; `createdAt` timestamptz(6) | actorWorkspaceMemberId; obligatorio exclusivamente para HUMAN | id UUID v4; createdAt now() |
| TransitionAudit | `id uuid`, UUID S; `eventKey`, `effectKey`, `fingerprint`, `authenticationReference`, `correlationReference` text; `result jsonb`; `resultVersion integer`; `authorityKind varchar`; `recordedAt timestamptz(6)` | correlationReference; obligatoria para PROVIDER_EVIDENCE | id UUID v4; recordedAt now() |

R1 añade `attentionCreatedTransactionId text COLLATE "C" NOT NULL` a cada
una de las cinco tablas. Son **71 columnas nuevas en cinco tablas**, además de
las once columnas sobre tablas existentes de la sección anterior (siete
funcionales y cuatro técnicas). Los nueve marcadores se generan por triggers,
sin default físico ni ORM; véase §7.1. Todas las columnas text nuevas usan
collation determinista
`C`, incluyendo claves lógicas y revisiones. PKs, índices, FKs, CHECKs y sus
expresiones se comparan con metadata TypeORM real sin conexión. El comando
posee 32 índices adicionales, 13 de ellos únicos, 15 FKs y 28 CHECKs.

Los nombres nuevos `PK_IM_AT_*`, `IDX_IM_AT_*`, `FK_IM_AT_*`, `CHK_IM_AT_*` y
`TR_IM_AT_*` evitan truncamiento de identificadores a 63 bytes. No se renombra
ninguna restricción preexistente.

**Diferencia deliberada de metadata:** el default DISABLED existe sólo en el
DDL. No se declara como `Column.default`: TypeORM 0.3.31 incluye columnas con
default en `getInsertionReturningColumns()` aun con `insert:false`. Añadir ese
default ORM produciría referencias prematuras a una columna ausente. Los once
campos sobre tablas existentes tienen `select:false, insert:false, update:false`,
sin default ORM ni
inicializadores. No se presenta esa diferencia como paridad de defaults ORM.
El schema físico tiene el default requerido y las pruebas verifican ambos lados.

No se añaden relaciones eager ni inversas. `@ForeignKey` nativo de la versión
instalada representa las FKs escalares compuestas sin inducir joins o providers.
Las relaciones anteriores de Messaging permanecen intactas.

## 4. Unicidades, FKs e índices hijos

Las cinco PKs físicas son UUID y permiten preasignación. Son inmediatas todas
las claves candidatas y unicidades siguientes:

| Tabla | Claves únicas adicionales |
| --- | --- |
| Epoch | `(id,C)`; parcial por C cuando lifecycle no es CLOSED |
| Effect | `(S,effectKey)`; `(id,S)`; `(id,S,responseIntentId)` |
| Receipt | `(S,eventKey)`; `(id,S)`; `(id,effectId,S)` |
| ResponseIntent | `(S,intentId)`; `(S,messageId)` |
| Audit | `(id,S,eventKey)`; sin unicidad de eventKey/effectKey/revisión |
| Message | `(id,workspaceId,conversationId,providerConnectionId,attentionTrackingEpochId)` |
| ProviderStatusEvent | `(id,messageId,workspaceId)` |

Epoch referencia Conversation mediante la clave existente
`(id,providerConnectionId,workspaceId)`. Conversation apunta al Epoch del mismo C.
Message referencia Epoch con C completo. Effect/Receipt/Intent/Audit referencian
Epoch con S completo. Effect e Intent referencian el Message exacto mediante
`(messageId,S)`; en Message el último componente se llama
`attentionTrackingEpochId`. Effect referencia StatusEvent mediante
`(providerStatusEventId,messageId,workspaceId)`.

Receipt→Effect usa `(effectId,S)`; Receipt→Audit usa
`(originalAuditId,S,eventKey)`. El canónico de Effect usa
`(canonicalReceiptId,id,S)`→Receipt `(id,effectId,S)`. Effect→Intent usa
`(S,responseIntentId)`→`(S,intentId)`; el registro inverso usa
`(registeredEffectId,S,intentId)`→Effect `(id,S,responseIntentId)`.

Cada lado hijo tiene un índice que cubre por prefijo la FK completa. Se añaden
índices diagnósticos C2; no hay índice sobre fingerprints ni JSONB completo.
Las referencias usan NO ACTION, sin cascadas nuevas de Workspace. Pertenencia
a workspace/conexión queda encadenada por las claves compuestas.

## 5. Ciclos y diferibilidad

Sólo cuatro FKs son `DEFERRABLE INITIALLY DEFERRED`:

1. Conversation→Epoch actual.
2. Effect→Receipt canónico.
3. Effect→ResponseIntent.
4. ResponseIntent→Effect de registro.

Las restantes FKs son inmediatas. Las claves únicas no son diferibles y no se
usa ON CONFLICT como sustituto del protocolo. Después de preparar el agregado,
se pueden preasignar los UUID y declarar Effect→Audit→Receipt→Intent, con los
Messages causales ya insertados. El audit se inserta **antes** de actualizar el
estado de Conversation: su guard inmediato exige before igual al estado vivo
bajo lock. Antes de commit deben estar cerrados todos los enlaces y deltas.
Forzar constraints IMMEDIATE antes de completar ese conjunto debe fallar.

Se declaran además ocho constraint triggers AFTER ROW, diferidos al commit:
Epoch completo, enlaces Effect/Receipt/Intent, Effect causal completo, Audit
completo, Message nuevo completo y Outbox nuevo completo. No certifican
autenticación ni decisiones del futuro lector/escritor.
Estas primitivas se contrastaron con la documentación oficial de
[CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html).

## 6. CHECKs, NULL e integridad del resultado

Los CHECKs locales cubren versiones/política v1, baseline cero, lifecycle,
status, revisión decimal, provenance/actor, formato, límites UTF-8 y timestamps
finitos dentro de la frontera temporal C2-I-A. El tuple de Conversation es
totalmente NULL o totalmente presente; con tracking, PENDING equivale a
pendingAt no nulo. En Effect, Message/Intent/StatusEvent son obligatorios
exactamente para sus eventKinds, cerrando los escapes de las FKs con NULL.
canonicalReceiptId, originalAuditId y registeredEffectId no admiten NULL.
Message legacy con epoch NULL es una excepción intencional: C es no nulo y la
FK no exige un epoch inexistente; no se usa MATCH FULL que invalide ese legado.
El tratamiento de NULL corresponde al de las
[FKs PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html);
no se presupone que una FK parcial compruebe la tupla completa.

`im_at_result_valid` verifica la estructura exacta de result y auditoría,
versiones, enums, scope/identidades, nulabilidad, tuplas/fingerprints v1, estados,
revisiones, attentionChanged y compatibilidad local de kind/reason. Sus helpers
no consultan tablas. El presupuesto JSON se calcula con una serialización
compacta de JSONB; el orden de propiedades no cambia el tamaño o la comparación.
Su equivalencia de escapes/bytes con JSON.stringify requiere pruebas físicas,
incluidos Unicode y controles. No se ofrece este CHECK como segundo motor de
transición: sólo acepta o rechaza un resultado suministrado; no decide ni aplica
estado. El reducer aceptado sigue siendo la única evaluación de dominio futura.

Todos los predicados de admisión se exigen `IS TRUE`; un dato incompleto no se
acepta porque el resultado SQL sea NULL. No hay CHECKs que consulten otras
tablas. Las validaciones entre filas están en constraint triggers.

Los guards cruzados pretenden comprobar:

- Canónico del mismo Effect/S y original APPLIED/IGNORED, con keys/fingerprint
  concordantes. Original propio de alias DUPLICATE/SAME_INTENTION_OR_EVIDENCE.
- Causalidad congelada idéntica y revisión del alias no anterior al after
  canónico. La remediación R1 se conserva: misma revisión implica mismo status
  contra baseline, before y after canónicos; una revisión posterior legítima
  puede tener otro estado.
- Registro RESPONSE_INTENDED/APPLIED/RESPONSE_REGISTERED, mismo Message outbound,
  intención, contenido, formato, actor, procedencia y cobertura. La evidencia
  comprueba también la pareja de registro de su intención.
- StatusEvent del Message/workspace exactos, estado normalizado y provider ID
  concordantes, y conexión del WebhookReceipt cuando existe. Se toman locks
  SHARE sobre Message, StatusEvent y Receipt al validar esos enlaces.
- Cambios posteriores de las identidades causales de Message/StatusEvent/
  WebhookReceipt no invalidan evidencia retenida. Leases y estado de transporte
  ajenos a esas identidades conservan sus actualizaciones normales.
- Deltas nuevos de atención con audit de esa transacción, before/after exactos,
  incremento decimal uno y estado final coincidente. Un CONFLICT no consume
  Effect/Receipt/Intent. Un Message tracked nuevo requiere su Effect original.

La relación lógica `evidenceId`↔identidad backend StatusEvent **no se inventa**:
C2 y C2-I-A la dejaron sin resolver. UUID StatusEvent, providerEventKey y
evidenceId siguen separados. La integración deberá fijarla expresamente.

## 7. Inmutabilidad, lifecycle y protocolo transaccional

Effect, Receipt, Intent y Audit rechazan UPDATE/DELETE. Las cinco tablas rechazan
TRUNCATE. Epoch conserva C, identidad, versiones, política y baseline; sólo
evolucionan lifecycle/instantes, sin reabrir CLOSED ni reemplazar instantes ya
fijados. No hay rotación implementada. La configuración con epochs no puede
borrarse ni volver a DISABLED para eludir la barrera; el puntero preparado de
Conversation no se elimina ni reasigna. Esto puede bloquear el borrado actual
de workspace: una purga conjunta sigue pendiente, sin procedimiento nuevo aquí.

Message mantiene su epoch desde INSERT, incluso NULL→UUID queda prohibido por
UPDATE. NULL no permite generar una nueva intención/inbound tracked. Insertar
Message legacy sin epoch se rechaza bajo ENABLED o si Conversation ya está
preparada, incluso con gate PREPARING/SUSPENDED. Actualizar transporte de un
Message histórico NULL sigue permitido.

Todos los INSERT ledger toman gate SHARE y Conversation UPDATE, aun para
IGNORED, aliases y registro de intención sin incremento. Se comprueba gate
ENABLED, protocolo 1, puntero exacto y Epoch READY. Bootstrap explícito sólo
admite PREPARING/ENABLED, copia pendingAt directamente y conserva revisión cero;
no se ejecuta desde UP. Lifecycle puede suspender/cerrar bajo el lock común.

### 7.1 Remediación focal C2-I-B-R1: P2 de identidad transaccional

La revisión independiente disponible en `/tmp/c2-i-b-independent/` concluyó
REQUIRES REMEDIATION: ningún P0/P1 y un P2. La implementación original comparaba
`xmin` con `pg_current_xact_id() % 4294967296`. Esto descartaba la generación
del XID. Un Audit histórico con xmin=12345 podía confundirse con una escritura
de la transacción superior 4294979641 y provocar un falso 23514 al insertar su
primer Audit. Freezing no hace suficiente ese predicado; no se puede asumir que
cambie el xmin visible ni imponer ahora una retención corta al ledger aprobado.
El defecto era de semántica, no simplemente una prueba física pendiente.

**Mecanismo seleccionado:** persistir el decimal completo de
`pg_current_xact_id()` en `attentionCreatedTransactionId`, asignado
incondicionalmente dentro de BEFORE INSERT, ignorando cualquier valor del
caller. `im_at_own_write(transaction_id text)` compara
`COALESCE(transaction_id::xid8 = pg_current_xact_id(), false)`. No hay reducción,
reconstrucción desde xmin, conversión a Number/int64 ni consulta a estados de
commit históricos. NULL no prueba pertenencia y devuelve false, incluso bajo
NOT. PostgreSQL documenta que xid8 incluye la generación y no se recicla durante
la vida de una instalación; es la base de esta deducción de identidad completa.
[Identificadores PostgreSQL 18](https://www.postgresql.org/docs/18/transaction-id.html).

Se usa **text COLLATE C con cast de comparación a xid8**, porque TypeORM 0.3.31
instalado no incluye xid8 entre sus tipos PostgreSQL soportados. La representación
decimal de PostgreSQL conserva los 64 bits, incluido el rango unsigned por encima
de bigint firmado; no se asigna el tipo físico equivocado a Entity. No hay default:
un default solo podría ser sustituido por el caller. Tampoco sirve una columna
generada con una función volátil. Las flags ORM no son la autoridad: la asignación
y la inmutabilidad SQL son obligatorias. No se utiliza PID, timestamp, UUID
auxiliar, GUC, tabla temporal confiada al cliente ni la retención como sustitutos.
`pg_current_xact_id_if_assigned()` podría evitar asignación en una lectura pura;
estos guards participan en escrituras y usan la variante que asigna el XID.

| Filas | Marcador técnico | Nulabilidad y generación | Protección posterior |
| --- | --- | --- | --- |
| Epoch, Effect, Receipt, ResponseIntent, TransitionAudit | attentionCreatedTransactionId text COLLATE C | NOT NULL, BEFORE INSERT PostgreSQL, sin default | Ledger immutable; Epoch sólo permite lifecycle/activatedAt/closedAt |
| Message, ProviderStatusEvent, OutboxEvent | attentionCreatedTransactionId text COLLATE C | NULL sólo para historia previa al UP; nuevos INSERT siempre reciben xid8 completo | UPDATE rechaza cambios, incluidos NULL→valor; no se reconstruye la creación histórica |
| Message | attentionUpdatedTransactionId text COLLATE C | NULL histórico y en INSERT; cada BEFORE UPDATE lo reemplaza con xid8 superior actual | El valor del caller se sobrescribe; no modifica el marcador de creación |

Hay **nueve columnas técnicas** en total. No se crea tabla, índice, clave de
negocio ni FK adicional. Las 15 FKs, ciclos y candidatas permanecen iguales.
UP añade las cuatro columnas nullable sin backfill a tablas existentes y las
cinco NOT NULL en tablas nuevas; DOWN retira las cuatro primeras explícitamente
y las otras junto con sus tablas. Los triggers de StatusEvent y Outbox incluyen
ahora INSERT; el número de triggers sigue siendo 30. Entity y DDL coinciden en
nombres, text, collation, nullability y ausencia de default. Los marcadores son
`select:false, insert:false, update:false`, sin inicializador; los de tablas
existentes llevan WasIntroducedInUpgrade. La generación es por trigger, no por
`Column.default` ni `isGenerated` de TypeORM. No entran en los contratos de
dominio ni C2-I-A; una futura proyección raw debe enumerar los campos de esos
decoders estrictos y excluirlos.

**Consumidores corregidos exhaustivamente** en `attention-ledger-row-guards.ts`
y `attention-ledger-aggregate.ts`:

| Guard | Testigo completo exigido, además de los enlaces/scopes originales |
| --- | --- |
| im_at_insert_guard | Audit creado por la transacción superior actual, para rechazar un segundo Audit de la misma C; history no bloquea el primero |
| im_at_conversation_guard | Epoch recién creado para bootstrap; Audit nuevo del S y before/after exactos para delta |
| im_at_audit_complete | Conflict sin Effect/Receipt/Intent nuevos; APPLIED/IGNORED con Effect y Receipt nuevos y UUID canónico/original exactos; alias con Receipt propio nuevo; replay conserva original anterior |
| im_at_message_complete | Effect original nuevo del Message/S y eventKind correspondiente |
| im_at_effect_complete | INBOUND_RECEIVED/RESPONSE_INTENDED exigen creación del Message actual; PROVIDER_EVIDENCE exige UPDATE de Message actual más INSERT de StatusEvent actual y estado normalizado concordante |
| im_at_audit_complete / im_at_outbox_complete | Outbox creada en la transacción actual y Audit nuevo de cambio, con clave causal, tipo, aggregate, workspace y payload exactos |

Una actualización MVCC de Message ya no equivale a crear un inbound o respuesta
nuevos. El callback conserva el requisito distinto de actualizar el Message
existente en la unidad causal; una actualización técnica por sí sola no certifica
admisión outbound o autenticidad. Actualizar StatusEvent, lifecycle de Epoch o
leases de Outbox nunca rejuvenece su creación. Los predicados usan marcadores
además de los UUIDs físicos, las claves causales y C/S, no como autoridad paralela.
Las funciones de validación histórica no añaden un filtro de transacción actual:
originales retenidos, aliases y repeticiones siguen siendo recuperables.

**Unidad superior y savepoints:** PostgreSQL especifica que ambas funciones
pg_current_xact_id devuelven el ID superior incluso dentro de subtransacciones.
Por tanto, una escritura que sobrevive RELEASE SAVEPOINT sigue contando dentro
de la misma unidad; no habilita un segundo Audit. ROLLBACK TO debe deshacer filas,
marcadores y eventos diferidos de ese subárbol, sin tocar los anteriores. No se
compara el subxid del tuple ni se pretende rechazar automáticamente cualquier
savepoint. El protocolo del futuro caller sigue sin ofrecer transacciones
anidadas/batches y conserva una Conversation/evento por unidad v1. Esta definición
corrige la limitación accidental de xmin sin cambiar C1, C2 o C2-I-A.
[API de identidad transaccional](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT),
[subtransacciones](https://www.postgresql.org/docs/18/subxacts.html).

La corrección es SOURCE-ONLY. La igualdad completa y las invariantes tienen
contraejemplos/regresiones aritméticas y verificación de fuentes; **no equivalen
a ejecutar MVCC, VACUUM FREEZE, triggers o savepoints**. Siguen pendientes las
pruebas físicas de asignación server-owned, inputs falsificados, UPDATE/rollback,
visibilidad de triggers, locks y callbacks. Los marcadores pertenecen a la vida
de una instalación: una restauración lógica/importación que copie marcadores
hacia otro contador de XID, pg_resetwal o una intervención privilegiada exige
procedimiento revisado; no se afirma identidad global entre clusters. Los guards
no resisten deshabilitar triggers/constraints. El coste de consultas sobre Audit
retenido y planes reales sigue pendiente; no se añade un índice sin medición.


### 7.2 Validación SOURCE-ONLY de R1 — 2026-10-21

Preflight de R1: misma rama/HEAD que §1; el trabajo original ya existía como
7 archivos modificados y 19 untracked, sin staging. Se conservaron copias en
`/tmp/c2-i-b-r1/before/`. R1 modifica exclusivamente 16 TypeScript relacionados
con este P2 y este documento: cuatro fuentes SQL (row-guards, aggregate,
structure, triggers), ocho entidades (las cinco nuevas más Message/StatusEvent/
Outbox), los tests de guards/schema, metadata.fixtures y el nuevo test de
transaction-identity. No se modifica el cuerpo del comando, registro, C2/C2-I-A,
AGENTS.md, C1/dominio, servicios o integración productiva. El inventario previo
se conserva; el único tracked adicional es Outbox y el único untracked adicional
es la suite nueva. Estado final: 8 M + 20 ??, staging vacío; status completo y
diff exclusivo de R1 en `/tmp/c2-i-b-r1/`.

| Caso | Resultado observado en pruebas de fuente/aritmética |
| --- | --- |
| A | 12345 y 4294979641 comparten low32, pero no identidad completa; histórico no es propio |
| B | Audit histórico no impide el primer Audit de la transacción superior actual |
| C | Audit actual retenido impide un segundo en esa misma unidad |
| D | 400 pares contrastados contra oráculo separado generación/contador, incluidos valores >2^53, >int64 y máximo xid8 |
| E | Causas históricas/faltantes y originalAuditId equivocado no satisfacen el testigo actual; se conservan enlaces exactos |
| F | Outbox histórica/faltante y Audit histórico/faltante o clave errónea no cumplen la obligación |
| G | UPDATE de Message sólo prueba participación de UPDATE; no rejuvenece creación. StatusEvent/Outbox/Epoch conservan creación |
| H | Replay y alias retienen originales históricos; alias exige Receipt actual, no Effect histórico actual |
| I | Nueve marcadores: metadata real y DDL concordantes; generación por triggers, immutability y UP/DOWN fuente simétricos |
| J | Regresiones C2-I-A/C1/domain, FKs/ciclos/scopes, Pending/gates/legacy y registro conservados |

La suite nueva combina el contrato escalar extraído de la fuente con un oráculo
aritmético independiente e invariantes de testigos; comprueba además el cableado
SQL por referencias/ramas exactas. No implementa un intérprete PL/pgSQL ni una
base en memoria que se presente como PostgreSQL. Los modelos B/C/E/F/G/H y
savepoints son razonamientos de invariantes, no ejecución de constraints/MVCC.

| Validación R1 realmente ejecutada | Resultado final |
| --- | --- |
| Jest focal inicial guards/schema/transaction-identity | 3 suites / 65 PASS antes de dos casos adicionales |
| Jest final completo | **13 suites / 365 PASS**, 0 fallos/omitidos; +33 respecto de 332 |
| Guards/schema/transaction-identity finales | 3 suites / 67 PASS (15 + 25 + 27) |
| Registro/persistencia/Pending legacy | 3 suites / 31 PASS |
| C2-I-A | 3 suites / 126 PASS |
| C1 | 2 suites / 63 PASS |
| attention-domain | 2 suites / 78 PASS |
| Typecheck completo twenty-server | tsgo --noEmit --incremental false: exit 0 |
| Typed lint explícito | 16 TypeScript, 0 errores/warnings |
| Diff lint | Nx lint:diff-with-main PASS, 494 archivos; main...HEAD excluye cambios actuales, cubiertos por lint explícito |
| Formato explícito | 16 TypeScript PASS; config temporal sin exclusión de upgrades; Markdown revisado estructuralmente |
| Whitespace / Git | git diff --check y no-index para untracked; status/diff/cached sólo lectura |
| Arnés de estructura separado | 71 + 11 columnas, 15 FKs / 4 diferidas, 32 índices / 13 únicos, 28 checks, 30 triggers / 8 diferidos; 123 UP + 90 DOWN fuente |

Comandos principales, con Node Linux v24.16.0 en PATH, desde twenty-server:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-i-b-r1/jest-cache src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-schema.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-guards.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-transaction-identity.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/inconnect-messaging-instance-command-registration.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-persistence.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-work-state.service.spec.ts --json --outputFile /tmp/c2-i-b-r1/jest-final.json
../../node_modules/.bin/tsgo --noEmit --incremental false
mapfile -t attention_files < /tmp/c2-i-b-r1/changed-ts.txt
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json "${attention_files[@]}"
```

Desde raíz, se ejecutaron Nx `lint:diff-with-main --excludeTaskDependencies`
con NX_DAEMON=false, NX_ISOLATE_PLUGINS=false y caches en /tmp/c2-i-b-r1;
oxfmt con `--config /tmp/c2-i-b-r1/oxfmt.json --ignore-path
/tmp/c2-i-b-r1/empty-ignore` y lista explícita; el arnés
`node /tmp/c2-i-b-r1/source-audit.cjs`; búsquedas rg, comparaciones de snapshots,
Git status/diff/show/branch/rev-parse read-only y whitespace. Se consultó la
documentación oficial PostgreSQL de §7.1. No se ejecutó el parser pglast de la
entrega anterior en R1 ni se instaló dependencia. El primer typecheck detectó
literales BigInt incompatibles con el target del repositorio en el test nuevo:
se reemplazaron por BigInt(string) y el typecheck final pasó. Los avisos de
NO_COLOR/FORCE_COLOR y versión npm no provocaron actualización.

Evidencia final: `jest-final.json`, `typecheck-final.log`,
`typed-lint-final.log`, `diff-lint.log`, `format-final.log`,
`source-audit.json`, `remediation.diff`, `status-final.txt` y `REPORT.md` en
`/tmp/c2-i-b-r1/`. El arnés estructural fue adaptado del anterior por el mismo
implementador: **no constituye otra revisión independiente**.

Se recomienda una nueva revisión independiente del P2 y de todos sus
consumidores, incluida la separación creación/UPDATE, nullability histórica,
server ownership y unidad superior. No se declara C2-I-B aceptada. No se ejecutó
UP/DOWN del comando 1792540800000 ni SQL real, conexión PostgreSQL, migración,
generator, infraestructura, tracking o Git write. No se inicia C2-II/C2-III.

Se exige un audit/evento por C en la transacción. La integración sigue obligada
a una Conversation por unidad v1, READ COMMITTED explícito, primario,
relectura después de esperar el lock y mismo manager/QueryRunner. Un guard de
UPDATE se ejecuta después del lock implícito de fila: no sustituye el orden
gate→Conversation que el caller debe adquirir previamente. Las rutas legacy
actuales aún no cumplen el protocolo completo; no se cambia ninguna aquí.

## 8. Outbox y estado inicial seguro

El guard diferido de un audit con cambio requiere una Outbox nueva del mismo
workspace/Conversation con tipo `CONVERSATION_ATTENTION_CHANGED`, aggregateType
CONVERSATION y payload exacto `{ conversationId }`. Se concreta la tupla de
salida propuesta en C2 §8.1 como:

```text
["attention-outbox-v1", workspaceId, conversationId, providerConnectionId,
 trackingEpochId, effectKey, "CONVERSATION_ATTENTION_CHANGED"]
```

`im_at_outbox_key` la serializa compacta. Esta identidad de salida no sustituye
las formas lógicas C1. La UNIQUE global de Outbox evita otra salida para el
mismo S/effectKey/tipo. Se rechazan salidas nuevas sin audit de cambio y la
mutación/borrado de su identidad; TRUNCATE se rechaza si conserva esas salidas.
No se bloquean actualizaciones de publicación/leases. Retención posterior de
esas salidas necesita trabajo separado.

**No se modifica la allowlist del publicador:** hoy no sabe publicar ese tipo.
C2-III deberá conectarlo al hint CONVERSATION_UPDATED con autorización vigente
antes de habilitar. UP no inserta Outbox ni facts y no activa esa ruta. No hay
salidas de atención por RESPONSE_REGISTERED, IGNORED o DUPLICATE.

Después de UP todos los workspaces existentes permanecen DISABLED, sin epochs
ni tracking; Pending manual actual sigue funcionando. No hay bootstrap,
recálculo, captura de HUMAN desde historia ni creación de filas por lectura.
Una vez preparado un agregado, el fence aplica desde ese instante. La API
booleana legacy aún puede responder no-op sin SQL: sólo la integración futura
puede rechazarla antes de ese short-circuit. Los triggers no prueban que se
drenaron versiones antiguas del backend.

## 9. Descubrimiento y compatibilidad antes de instalar DDL

El glob existente de Core descubre `modules/inconnect-messaging/**/*.entity`
automáticamente, tanto con billing como sin él. Añadir clases no es totalmente
inerte: sus metadatos se construyen al iniciar TypeORM. `synchronize:false` y
`migrationsRun:false` impiden aplicar su DDL automáticamente. No hay nuevos
providers en InconnectMessagingModule ni consumidores de repositorios nuevos.

Las cinco clases y los once campos sobre tablas existentes se marcan con `WasIntroducedInUpgrade` y el
nombre real del paso registrado. Se prueba disponibilidad antes/después del
cursor. Además, las flags dormantes de columna y la omisión del default ORM
mantienen SELECT/INSERT y returning implícito ordinarios sin nombres nuevos aun
en un DataSource sin el adaptador de upgrade. No hay relaciones eager nuevas.
Un consumidor futuro que seleccione campos explícitos deberá respetar el gate
de instalación; no se promete proteger SQL arbitrario que nombre esas columnas.

También se inspeccionaron los consumidores genéricos de `entityMetadatas`.
El exportador existente enumera toda metadata con `workspaceId` y usa SQL raw.
Por ello se marca también esa propiedad en las cinco clases con la misma
introducción: antes del paso queda fuera de la forma visible de metadata y de
su enumeración de exportación. Una prueba usa el resolver de forma y el filtro
de exportación reales sin ejecutar el servicio. No se modifica el exportador.
Esto presupone un cursor de upgrade disponible: si falla la lectura inicial
del cursor, el adaptador existente conserva su fallback de metadata completa;
no se promete exportación pre-DDL segura bajo ese fallo. El comando de
exportación no es un consumidor automático del arranque ni fue ejecutado.

Las pruebas construyen metadata real completa del grafo existente y metadata
acotada para comparar FKs/índices y generar texto de consultas legacy. No llaman
DataSource.initialize ni hacen consultas. Eso demuestra propiedades de fuente;
**no se realizó boot real**, lectura del catálogo ni inspección del entorno.

Las revisiones físicas son text y las propiedades TypeORM/decoders son string.
La aritmética SQL usa operaciones sobre dígitos/longitud, sin bigint/numeric de
revisión. `im_at_own_write` sólo convierte el marcador completo de text a xid8;
no opera sobre attentionRevision.
Los nuevos timestamps son timestamptz(6) con propiedades string y transformer
que rechaza Date u otra representación incompatible. El parser pg habitual ya
produce Date antes de la hidratación: se falla explícitamente, sin aparentar
recuperar microsegundos. C2-II debe usar datos raw con casts a text y formato/
zona compatibles, sin pasar por ese parser. `pendingAt` conserva su mapeo Date
legacy; el futuro lector exacto tampoco puede usar su hidratación ordinaria.

## 10. Fast Command, registro, UP y DOWN

Archivo: `2-32-instance-command-fast-1792540800000-create-inconnect-messaging-attention-ledger.ts`.
Clase: `CreateInconnectMessagingAttentionLedgerFastInstanceCommand`.
Registro: `@RegisteredInstanceCommand('2.32.0', 1792540800000)` y entrada explícita
en `instance-commands.constant.ts`. No hay colisión con las entradas existentes;
se ejecutaría después de los comandos Messaging 1790793305698/5700 en el grupo
Fast. El runner ordena todos los Fast antes de Slow y Workspace; no intercala
Slow por timestamp. La prueba de Discovery/Sequence incluye el nuevo comando.

Se editó el registro como fuente por la autorización específica del usuario,
sin invocar el generador que normalmente lo actualiza. No se modificó ningún
UP/DOWN previamente registrado. Los ocho helpers de SQL son una instantánea
propiedad de este comando; tras commit no deben reescribirse como migración
histórica. No dependen de metadatos Entity mutables para producir su DDL.

UP contiene 123 sentencias fuente después de R1: columnas/tablas, índices inmediatos, FKs,
funciones, checks de admisión y triggers. No hay DML de bootstrap o activación.
El runner existente envuelve Fast UP en transacción según inspección de fuente;
no se invocó ni se probó físicamente ese camino.

DOWN contiene 90 sentencias fuente después de R1: quita primero triggers/guards, rompe FKs en
orden inverso, elimina exclusivamente las cinco tablas nuevas, los cuatro
índices añadidos a tablas existentes, checks/columnas nuevos y funciones propias.
No usa DROP CASCADE ni limpia CRM, FileStorage, Twilio, Redis o datos externos.
Conserva pendingAt, Messages, Conversations y tablas preexistentes. **Pierde
irreversiblemente ledger, originales, baseline, procedencia/cobertura, epochs y
vínculo de origen Message.** No reconstruye historia ni constituye rollback
operativo después de activar. Outbox existentes permanecen en su tabla; cualquier
downgrade tras escribir salidas nuevas exige coordinación de versión/publicador
y backup. Ni UP ni DOWN están autorizados para ejecución por esta entrega.

## 11. Pruebas y herramientas efectivamente usadas (entrega original; R1 abajo)

Node Linux v24.16.0. Desde `packages/twenty-server`, con ese Node en PATH:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-i-b/jest-cache src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-schema.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-guards.instance-command.spec.ts src/database/commands/upgrade-version-command/2-32/__tests__/inconnect-messaging-instance-command-registration.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-persistence.spec.ts src/modules/inconnect-messaging/__tests__/inconnect-messaging-work-state.service.spec.ts --json --outputFile /tmp/c2-i-b/jest-final.json
../../node_modules/.bin/tsgo --noEmit --incremental false
mapfile -t attention_files < /tmp/c2-i-b/changed-ts.txt
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json "${attention_files[@]}"
```

Desde raíz:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-i-b/nx-data NX_CACHE_DIRECTORY=/tmp/c2-i-b/nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
```

Se aplicó oxfmt sólo a los archivos autorizados. El formato global excluye
`upgrade-version-command/**` y Markdown: se usó también una copia temporal de
la misma configuración sin la exclusión de upgrades, con lista explícita de los
archivos afectados y un ignore-file vacío. No se reformatearon comandos
históricos. El Markdown se revisó estructuralmente y por whitespace. Cada
archivo untracked se comprueba además con `git diff --no-index --check /dev/null`.

| Validación fuente | Resultado |
| --- | --- |
| Conjunto Jest | **12 suites / 332 pruebas PASS**, cero fallos/omisiones |
| C2-I-A conservado | 3 suites / 126 pruebas PASS |
| C1 conservado | 2 suites / 63 pruebas PASS |
| Reducer conservado | 2 suites / 78 pruebas PASS |
| Schema/guards nuevos + registro + persistencia y Pending legacy | 5 suites / 65 pruebas PASS |
| Typecheck completo sin emisión/incremental | PASS |
| Typed lint explícito de los 25 TypeScript afectados | PASS: cero errores/warnings |
| lint:diff-with-main sin dependencias | PASS; main...HEAD no incluye el trabajo actual sin commit |
| Formato y whitespace | PASS; comprobación específica adicional de upgrades |

El test de persistencia anterior mantiene sus mocks Jest para los comandos
históricos; para este comando sólo concatena las definiciones constantes.
Ninguna prueba invoca UP/DOWN nuevos o sentencias SQL reales. Las pruebas
estáticas comprueban declaraciones; no ejecutan ni simulan el motor PostgreSQL.

Se extrajeron literales TypeScript mediante AST y se analizaron SQL y cuerpos
PL/pgSQL con **pglast 8.7, gramática PostgreSQL 18.6**, cargado exclusivamente
en `/tmp/c2-i-b/sql-parser`. Es un parser local, sin servidor, driver o conexión.
Se comprueba sintaxis de las 209 sentencias UP/DOWN y de 19 funciones PL/pgSQL;
no resolución de objetos/columnas, semántica, instalación ni commit. El primer
análisis detectó un CASE que necesitaba paréntesis dentro de IF; se corrigió.
Las primeras pruebas detectaron también expectativas de whitespace y un uso
de findLastIndex fuera del lib TypeScript configurado; quedaron corregidos.
No se añadió dependencia al repositorio. pip no estaba disponible; se descargó
y extrajo el wheel del parser en /tmp. El primer intento con `python` no halló
ese alias y se utilizó `python3`.

Logs y JSON están en `/tmp/c2-i-b/`. Los avisos ambientales NO_COLOR/FORCE_COLOR
y de actualización npm de Nx no provocaron instalación ni actualización.

## 12. Límites físicos, riesgos y criterios posteriores

No hay aceptación física de C2-I-B. Queda pendiente, en aislamiento real aprobado
y con autorización específica de aprovisionamiento/ejecución:

1. UP/DOWN reales sobre una instalación histórica: existencia de tipos/funciones
   previas, encoding UTF-8, collation C, claves candidatas, constraints y paridad
   del catálogo; verificación de todos los objetos retirados por DOWN.
2. Rechazo real de cruces de workspace/Conversation/conexión/epoch, NULL parciales,
   canónicos/aliases/intenciones incompletos y alteraciones/borrados adversariales.
3. Commit/rollback, SET CONSTRAINTS, locks implícitos de FK, visibilidad posterior
   al lock y carreras de guards contra mutaciones de dependientes. La revisión
   del orden de locks de los writers actuales sigue siendo obligatoria.
4. Marcadores completos de creación/actualización de R1: generación/inmutabilidad,
   VACUUM FREEZE, visibilidad, commit/rollback y SET CONSTRAINTS; savepoints
   retenidos/revertidos y un Audit por unidad superior, sin afirmar simulación MVCC.
5. Casos SQL de todos los resultados del reducer, incluidos R1, aliases históricos,
   conflictos sin consumo y originales separados; verificar compactación JSONB,
   escapes y límites bytes contra C2-I-A, con property tests diferenciales.
6. Round-trip de revisión superior a int64, máximos multibyte en índices,
   timestamps .123456 y baseline Pending copiado sin Date. Revisar coste de
   checks/guards e índices en la versión/configuración real, sin suponer 18.6.
7. Boot antes/después del esquema con la cadena completa de upgrade, parser pg,
   cursor de metadata y ausencia de consultas a tablas/columnas aún inexistentes.

No hay prueba de autenticación real, permisos actuales, despliegue/drenaje,
completitud de consultas, recuperación de caídas, normalización/autenticidad de
callbacks, atomicidad con proveedor ni publicación. Una referencia de autoridad
y `appliedToProjection=true` no certifican esos hechos. Los guardrails del ledger
no resisten a un administrador que deshabilite triggers/constraints. Tampoco
implementan retención/purga, monitoreo operativo o activación segura.

## 13. Obligaciones C2-II / C2-III y revisión independiente

C2-II debe proporcionar lector autoritativo: primario, transacción/aislamiento,
lock común y relectura, tres slots completos con dependientes/cardinalidad,
errores distintos de ausencia, decoders C2-I-A y timestamps raw text sin Date.
El esquema no es prueba de completitud del lector. No hay contradicción del
diseño identificada que obligue a cambiar los algoritmos aceptados, pero toda
ejecución permanece bloqueada por las comprobaciones físicas anteriores.

C2-III debe implementar writer caller-owned, autoridad vigente, identidades
backend de evidencia/StatusEvent, admisión outbound verdadera, tratamiento de
errores/retries y composición atómica con los pipelines existentes. Debe respetar
audit antes del UPDATE, UUIDs preasignados, ciclos diferidos, una unidad v1 sin
savepoints, nueva salida Outbox y su allowlist/fanout autorizado. También debe
rechazar la API booleana legacy antes del no-op, coordinar el gate/versión,
bootstrap/drenaje y rollout. Nada de ello se inicia en C2-I-B.

Se solicita **revisión independiente de C2-I-B SOURCE-ONLY**, especialmente de
NULL/SQL de tres valores, referencias circulares, original propio/canónico,
validador SQL frente al reducer, marcadores completos R1, lifecycle y compatibilidad pre-DDL.
La aceptación independiente de fuente no autorizará una ejecución física.
PG0, PG1, Stage C5 y exact-upgrade siguen bloqueados. Sin commit por Codex.

## 14. Inventario exacto y Git (entrega original; R1 en §7.2)

Creado en documentación:

- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_B.md`

Creados en `packages/twenty-server/src/modules/inconnect-messaging/entities/`:

- `attention-epoch.entity.ts`
- `attention-effect.entity.ts`
- `attention-receipt.entity.ts`
- `attention-response-intent.entity.ts`
- `attention-transition-audit.entity.ts`
- `attention-exact-timestamp.ts`

Creados en `packages/twenty-server/src/database/commands/upgrade-version-command/2-32/`:

- `2-32-instance-command-fast-1792540800000-create-inconnect-messaging-attention-ledger.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-structure.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-values.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-result.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-admission.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-row-guards.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-links.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-aggregate.ts`
- `inconnect-attention-ledger-1792540800000/attention-ledger-triggers.ts`
- `__tests__/attention-ledger-metadata.fixtures.ts`
- `__tests__/attention-ledger-schema.instance-command.spec.ts`
- `__tests__/attention-ledger-guards.instance-command.spec.ts`

Modificados:

- `packages/twenty-server/src/modules/inconnect-messaging/entities/conversation.entity.ts`
- `packages/twenty-server/src/modules/inconnect-messaging/entities/message.entity.ts`
- `packages/twenty-server/src/modules/inconnect-messaging/entities/messaging-configuration.entity.ts`
- `packages/twenty-server/src/modules/inconnect-messaging/entities/provider-status-event.entity.ts`
- `packages/twenty-server/src/modules/inconnect-messaging/__tests__/inconnect-messaging-persistence.spec.ts`
- `packages/twenty-server/src/database/commands/upgrade-version-command/instance-commands.constant.ts`
- `packages/twenty-server/src/database/commands/upgrade-version-command/2-32/__tests__/inconnect-messaging-instance-command-registration.spec.ts`

Total: **19 archivos creados y 7 modificados**, sin staging. Misma rama/HEAD.
El diff tracked no muestra los 19 untracked: se entrega también patch completo
con `git diff` y `git diff --no-index /dev/null` para cada archivo nuevo, más
status e inventario en `/tmp/c2-i-b/`. Ningún archivo fue añadido al índice.
