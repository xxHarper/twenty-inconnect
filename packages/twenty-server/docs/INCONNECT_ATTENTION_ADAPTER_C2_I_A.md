# INCONNECT — Fase 1B-1B-C2-I-A

Fecha: 2026-10-21. **Implementación SOURCE-ONLY con remediación R1;
pendiente de nueva revisión independiente.**

La primera revisión concluyó **REQUIRES REMEDIATION** por un único P2 de
consistencia histórica entre alias y efecto canónico. La remediación y sus
validaciones nuevas se registran al final; no constituyen aceptación de C2-I-A.

Preflight de lectura: rama `feature/inconnect-lead-management`, HEAD
`a332083e303269b72661f44a5bb1d7abd42bacc0`, árbol limpio y staging vacío.
El commit de actualización de AGENTS.md estaba presente. No se ejecutó ninguna
operación Git de escritura.

## Alcance y arquitectura

Se implementa la frontera pura entre las filas propuestas en
[C2](INCONNECT_ATTENTION_ADAPTER_C2_DESIGN.md), §3–§4, y los contratos reales de
C1. Se leyeron AGENTS.md completo, diseño C2, dominio/adaptador y los modelos
actuales de Conversation, Message, WebhookReceipt, ProviderStatusEvent y Outbox;
también se contrastó la persistencia de callbacks del servicio existente.

El recorrido es: valor `unknown` → decoder estructural → invariantes locales →
relaciones con dependientes explícitos → punto lógico C1. Las funciones no leen
ni escriben almacenamiento. Los decoders devuelven un resultado discriminado;
los mappers vuelven a decodificar sus filas, por lo que un cast del caller no
certifica su validez.

No se modificaron el dominio, los algoritmos de C1, su barrel, entidades,
servicios productivos, módulos Nest, GraphQL, AGENTS.md ni el diseño C2 aprobado.
No se creó esquema PostgreSQL, SQL, entidad TypeORM, comando, migración, lector,
escritor, transacción, worker, bootstrap ni activación. C2-I-B/C2-II/C2-III no
están implementadas. PG0, PG1, Stage C5 y exact-upgrade siguen bloqueados.

## Archivos nuevos

Todos los TypeScript están en
`src/modules/inconnect-messaging/attention-adapter/persistence/`:

| Archivo | Responsabilidad |
| --- | --- |
| `attention-persistence.types.ts` | Cinco modelos de fila, resultado histórico, proyecciones explícitas de columnas relacionadas y errores |
| `attention-row-codec.ts` | Primitivas estrictas de objetos, UUID, texto UTF-8, revisión, versión, enums, nullability y timestamp |
| `attention-fingerprint-decoder.ts` | Recuperación del evento desde la tupla semántica v1 existente; comprobación de bytes exactos |
| `attention-result-decoder.ts` | Estructura completa y comprobación del resultado contra el reductor aceptado |
| `attention-row-decoders.ts` | Decoders públicos de filas y proyecciones relacionadas, con invariantes locales |
| `attention-timestamp.ts` | Comparación exacta de instantes con microsegundos, conservando el texto original |
| `attention-relational-validation.ts` | Validación de parejas canónicas, originales propios, registro de intención y hechos causales proporcionados |
| `attention-persistence-mappers.ts` | Materialización de snapshot, Effect, Receipt e Intent de C1 |
| `index.ts` | Exportaciones puras; no se conecta al barrel productivo |
| `__tests__/attention-persistence.fixtures.ts` | Filas de prueba a partir del reductor real; no simula PostgreSQL |
| `__tests__/attention-row-decoders.spec.ts` | Estructuras, campos, nullability, versiones, capacidad, precisión y corrupción |
| `__tests__/attention-relations-and-mappers.spec.ts` | Relaciones y compatibilidad con funciones reales C1 |
| `__tests__/attention-audit-adversarial.spec.ts` | Resultados reales aplicados/ignorados/duplicados/conflictivos y fronteras adversariales |

Se añade además este documento. Total: 13 archivos TypeScript y 1 Markdown.

## Contratos físicos y representación

Los modelos son `Readonly` sin decoradores ni registro ORM. UUID físico `id`,
`effectId`, `canonicalReceiptId`, `originalAuditId` y `registeredEffectId` mantienen
su función de referencias físicas. `effectKey`, `eventKey`, `intentId`,
fingerprints y las identidades versionadas que genera C1 conservan su identidad
lógica. Un UUID de Effect no se usa como `AttentionEffectIdentity.effectId`.

| Fila | Datos conservados |
| --- | --- |
| AttentionEpoch | C, id/epoch, versiones de identidad/reductor, política aprobada, lifecycle, baseline y referencias/instantes históricos |
| AttentionEffect | S, UUID, effectKey/fingerprint exactos, Receipt canónico, eventKind y referencias Message/Intent/StatusEvent |
| AttentionReceipt | S, UUID, eventKey, Effect y audit original propio |
| AttentionResponseIntent | S, UUID físico, intentId lógico, Message, contenido, cobertura decimal, procedencia/actor/autoridad histórica, formato y Effect de registro |
| AttentionTransitionAudit | S, UUID de intento, identidades/fingerprint, resultado completo, resultVersion 1 y referencias de fuente/autenticación/correlación |

S incluye workspace, Conversation, Provider Connection y epoch, todos UUID.
Se admite la salida UUID canónica PostgreSQL en minúsculas, sin imponer versión
o variante UUID. No se transforma ni normaliza silenciosamente un identificador.

Las proyecciones `AttentionConversationColumns`, `AttentionMessageColumns`,
`AttentionProviderStatusColumns` y `AttentionWebhookColumns` contienen sólo las
columnas necesarias para estas comprobaciones. Representan contratos de lectura
futuros, incluidos los campos de epoch/atención todavía inexistentes. No afirman
que las entidades actuales ya tengan esas columnas. No añaden una identidad a
MessagingConfiguration ni implementan su gate.

## Decoders y errores

Las nueve funciones públicas `decodeAttention*` reciben `unknown`. Exigen todos
los campos declarados, rechazan campos extra, instancias ajenas, arrays,
accessors y claves simbólicas. Reconstruyen objetos de datos congelados; nunca
interpretan una fila corrupta como falta de registro. JSONB `result` debe llegar
como objeto decodificado, no como texto JSON o con arrays de historia completos.

Errores con `code` y `path`, sin incluir payload sensible:

| Código | Significado |
| --- | --- |
| MISSING_FIELD | Propiedad obligatoria omitida, incluso si normalmente admite null |
| INVALID_NULL | Null en un campo declarado no nullable |
| WRONG_TYPE | Tipo incorrecto, incluidas revisiones numéricas, Date y getters |
| INVALID_UUID / INVALID_VALUE | UUID o valor/discriminante/tupla fuera del contrato |
| INCOMPATIBLE_VERSION | Identidad, reductor, política o versión de resultado incompatible |
| INVALID_REVISION | Decimal no canónico o baseline v1 distinto de cero |
| SCOPE_MISMATCH | Scopes proporcionados contradictorios |
| INVALID_CAUSAL_REFERENCE | Referencia, nullability condicional o identidad causal contradictoria |
| INCOMPLETE_DATA | Dependiente obligatorio no proporcionado o agregado parcialmente preparado |
| IMPOSSIBLE_RESULT | Resultado incompatible con el reductor, original canónico o baseline |
| CAPACITY_EXCEEDED | Presupuesto de almacenamiento excedido; no trunca ni consume claves |

Un error SQL/timeout no se convierte en ninguno de estos puntos presentes o
ausentes: no hay consultas en esta fase. La ausencia autoritativa y el envelope
técnico del lector siguen pendientes. Ninguna función produce slots `null` para
C1 al fallar una decodificación.

Los límites v1 de C2 se aplican por bytes UTF-8: claves 1.024, intentId 128,
fingerprints/contenido/referencias 16.384 por campo y resultado 65.536. El
presupuesto del resultado se mide mediante `JSON.stringify` del objeto completo
decodificado, no por tamaño interno JSONB. Los límites se componen: escapar una
cadena dentro de un fingerprint o formar un effectKey puede exceder el
presupuesto aunque sus componentes individuales quepan. Se rechazan NUL y
surrogates no emparejados. No se recortan, hashean ni sustituyen identidades.

Revisiones son cadenas decimales canónicas sin límite int64. Incrementos y
comparaciones usan BigInt; nunca pasan por Number. Las marcas TypeScript de C1
sólo se obtienen después de la validación real del snapshot.

## Precisión temporal y lifecycle

La frontera requiere texto de `timestamptz` conservando los microsegundos, con
fecha gregoriana finita 0001–9999, hora 00–23, segundos 00–59, fracción opcional
de hasta seis decimales y offset explícito `Z`, `±HH`, `±HHMM` o `±HH:MM`.
Se acepta separador fecha/hora espacio o `T`. Se conserva el texto original;
no se convierte a Date. Date, infinity, BC, años expandidos y otras formas
DateStyle producen error explícito. El futuro lector deberá solicitar/configurar
una representación compatible sin atravesar previamente un parser Date.

La comparación de baseline y de coherencia de lifecycle calcula una clave de
microsegundos BigInt; dos textos con offset distinto para el mismo instante
comparan iguales. Number sólo interviene en componentes de calendario acotados,
nunca en revisiones, fracciones temporales o el total de microsegundos.
Ninguna fecha ordena hechos ni decide causalidad del ledger.

Baseline v1: revisión cero y Pending inicial equivalente a timestamp no nulo.
PREPARING no tiene activación; READY exige activación; CLOSED exige cierre.
SUSPENDED conserva activación si existió y puede representar suspensión durante
preparación. CLOSED también permite un epoch cerrado antes de activarse. Un
instante de activación/cierre presente debe respetar creación/activación.
Estas comprobaciones no implementan transiciones de lifecycle ni readiness.

## Invariantes relacionales y límites de prueba

Los validadores devuelven `checked` y `unresolved`. Exigen los dependientes que
usa cada relación; no certifican una relación por la mera presencia de su UUID.

| Nivel | Comprobación implementada / obligación pendiente |
| --- | --- |
| Fila | Campos, tipos, versiones, revisión, baseline, nullability por eventKind/provenance, identidad v1 y estructura/semántica del resultado |
| Relacional | S de Epoch/Effect/Receipt/Intent/Audit; Receipt canónico propio; audit propio; canónico APPLIED/IGNORED; alias DUPLICATE/SAME_INTENTION_OR_EVIDENCE; identidad causal congelada y revisiones compatibles |
| Registro de intención | Effect RESPONSE_INTENDED/APPLIED/RESPONSE_REGISTERED, referencia inversa, mismo Message outbound/S, formato, contenido, actor/procedencia y cobertura del original |
| Evidencia proporcionada | Effect→StatusEvent exacto, mismo Message/workspace, Message→Conversation/conexión/epoch, providerMessageId y estado normalizado; conexión de WebhookReceipt cuando está referenciado |
| Física futura | Unicidades, FKs/checks/triggers, inmutabilidad entre escrituras, gate, locks, lectura completa/primario/snapshot, atomicidad, fences legacy y retención |

`validateAttentionIntentRelations` verifica el registro cuando se proporciona su
pareja completa. El bundle de un Effect de evidencia no incluye esa pareja de
registro: informa `INTENT_REGISTRATION_LINK` como pendiente. Se debe comprobar
con las filas de registro de esa misma intención; esta fase no las consulta.

C2 no fija si `evidenceId` lógico deriva del UUID StatusEvent, `providerEventKey`
u otra identidad backend. Se preservan separados, y se informa
`EVIDENCE_ID_BINDING` pendiente: no se declara esa correspondencia garantizada.
También permanecen pendientes autenticación, correlación backend efectiva y
admisión por la máquina outbound. `appliedToProjection` se conserva como dato
de transporte; no certifica por sí solo el procesamiento de atención ni sustituye
la comprobación futura de admisión de evidencia nueva.

La comprobación del resultado reconstruye el evento desde su fingerprint v1 y
contrasta kind/reason/auditoría completos con `transitionConversationAttention`.
Para DUPLICATE/colisión usa un testigo mínimo de receipt; para evidencia usa la
procedencia/cobertura históricas del audit. Estos testigos son comprobación local
de posibilidad del resultado, no prueba de que existieron esos hechos en SQL.
La validación relacional contrasta los datos que efectivamente se proporcionan.
No reconstruye ni certifica la cadena histórica completa o ausencia de filas
omitidas. Los CONFLICT válidos admiten auditoría sola y se rechazan como
originales de un Receipt/Effect consumido.

## Mappers y compatibilidad C1

`mapAttentionSnapshot`, `mapAttentionEffect`, `mapAttentionReceipt` y
`mapAttentionIntent` devuelven respectivamente AttentionSnapshot,
LogicalAttentionEffect, LogicalAttentionReceipt y LogicalAttentionIntent dentro
del resultado de persistencia. Se usan directamente con los planes, facts,
reconstrucción y evaluación reales de C1. La reconstrucción C1 produce la entrada
del reductor aceptado; no hay segundo algoritmo de transición.

Se materializa sólo el punto y sus enlaces constantes: no se recorre el ledger
ni todos sus aliases, ni se arma un lector de los tres slots. El futuro lector
proporcionará los puntos o sus ausencias autoritativas; C1 sigue limitando la
proyección de entrada a dos receipts y una intención. Una colisión semántica de
entrada se deja a C1; una contradicción entre filas almacenadas falla antes.

El Receipt de alias conserva su DUPLICATE original individual y su before/after;
el Effect conserva su APPLIED o IGNORED canónico. Ambos permanecen separados de
la transición contra el estado actual. Repetición de una intención no cambia
cobertura, procedencia ni contenido. No se reinterpretan DUPLICATE, IGNORED,
CONFLICT, APPLIED ni INVALID_LEDGER; los errores físicos no se disfrazan de un
resultado de dominio.

HUMAN histórico no autentica una petición nueva ni concede autorización. La
regla comercial sigue siendo exclusivamente DELIVERED/READ válidos,
autenticados y correlacionados de respuesta HUMAN para su cobertura vigente,
incluido HUMAN + TEMPLATE. AUTOMATION/LEGACY_UNKNOWN y estados insuficientes no
cierran. La integración futura debe pasar por la autoridad Messaging vigente.

## Validación original (anterior a R1)

Node Linux local v24.16.0 mediante
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`. Desde
`packages/twenty-server`, se ejecutaron:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/persistence
```

Desde la raíz:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
node_modules/.bin/oxfmt --check packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/persistence packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_A.md
git diff --check
```

Se aplicó oxfmt previamente sólo al directorio TypeScript autorizado. El
Markdown está excluido por `**/*.md` en `.oxfmtrc.jsonc`: los intentos de
formatearlo aisladamente devolvieron “no target file”. La comprobación conjunta
aprobó los 13 TypeScript; el Markdown se revisó estructuralmente y por whitespace.
Se comprobó también cada archivo nuevo con `git diff --no-index --check
/dev/null <archivo>` y se inspeccionaron status/diff/staging en lectura.

| Validación final | Resultado |
| --- | --- |
| Jest conjunto | PASS: 7 suites / 257 pruebas |
| Nuevas pruebas de persistencia | 3 suites / 116 pruebas |
| Regresiones C1 existentes | 2 suites / 63 pruebas |
| Regresiones del dominio existentes | 2 suites / 78 pruebas |
| Typecheck completo twenty-server, sin emisión/incremental | PASS |
| Typed lint de los 13 TypeScript nuevos | PASS: cero errores/warnings |
| Target lint:diff-with-main, dependencias excluidas | PASS; su rango main...HEAD no incluye archivos nuevos sin seguimiento |
| oxfmt TypeScript / whitespace de los 14 archivos | PASS; Markdown excluido por configuración |

Las primeras iteraciones detectaron errores propios en fixtures, comparación de
arrays proyectados y tipado de tests; quedaron corregidos antes de la ejecución
final. No se reporta un fallo preexistente como excusa para omitir validaciones.
El target de lint emitió avisos ambientales NO_COLOR/FORCE_COLOR y un aviso de
actualización npm; terminó correctamente y no se instaló ninguna actualización.

Logs finales en `/tmp/inconnect-c2-i-a-{jest,typecheck,lint}-final.log` y
`/tmp/inconnect-c2-i-a-diff-lint.log`. Los tests comprueban funciones puras; no
simulan SQL para atribuirse atomicidad, bloqueos, FK o aceptación física.

## Estado de entrega original y trabajo pendiente

Misma rama/HEAD; 14 archivos nuevos sin seguimiento, ningún archivo existente
modificado y staging vacío. `git diff --stat` está vacío porque todo el cambio es
nuevo y no se añadió al índice. Se revisó también el contenido sin seguimiento.
No se realizó commit, conexión PostgreSQL, inicialización, migración, llamada de
proveedor ni arranque de infraestructura.

Antes de C2-I-B: revisión independiente de estos modelos/decoders/mappers y nueva
autorización. Esa subfase deberá concretar paridad entidades/DDL, claves
compuestas/ciclos, checks/guards, lifecycle, configuración y precisión del driver;
escribir/generar comandos y ejecutarlos conservan autorizaciones separadas.
Debe fijarse expresamente el vínculo backend evidenceId/StatusEvent y la admisión
causal, conservando las identidades lógicas existentes.

C2-II debe demostrar lectura acotada completa, dependientes y cardinalidad,
errores separados de ausencia, primario/transacción/locks/post-lock/snapshot,
gate/epoch de origen y consulta del registro de intención. Estas funciones no
prueban esas condiciones. C2-III debe preservar autoridad vigente y composición
atómica con Message/ledger/audit/Outbox y fences legacy. Tamaño real de índices,
collation, aislamiento, carreras, commit/rollback y recuperación necesitan
aceptación PostgreSQL aislada expresamente autorizada. Retención, purga y
activación siguen siendo decisiones separadas. C2-I-A finaliza aquí.

## Remediación focal C2-I-A-R1 — 2026-10-21

Preflight en lectura: misma rama `feature/inconnect-lead-management` y HEAD
`a332083e303269b72661f44a5bb1d7abd42bacc0`. Los 13 TypeScript y este documento
ya estaban sin seguimiento; staging y diff de archivos tracked vacíos.
Se conservaron copias previas en `/tmp/c2-i-a-r1-before/` para revisar el cambio
real de esta remediación sin depender del diff vacío de Git.

**Causa:** `resolveAttentionReceiptRows` comprobaba que la revisión de un alias
no fuera anterior al `after` canónico, pero no comparaba sus estados cuando las
revisiones coincidían. El decoder comprobaba cada resultado contra un testigo
local del reductor; dos resultados localmente posibles podían contradecirse al
considerarlos juntos. El mapper reutilizaba esa validación incompleta y exponía
el original contradictorio como un Receipt lógico válido.

**Corrección mínima:** después de decodificar y validar scope/epoch, referencias
y orden de revisiones, se contrasta el estado del alias con tres puntos ya
suministrados: baseline del Epoch, `before` y `after` canónicos. Sólo se exige
igualdad de status si la revisión exacta coincide. Una contradicción devuelve
`IMPOSSIBLE_RESULT` en `$.receipt.originalAudit.status`; se conserva el rechazo
previo de revisiones anteriores. El decoder existente garantiza que DUPLICATE
no cambia status/revisión entre before y after, por lo que comparar su before
cubre ambos. Las revisiones decimales canónicas se comparan exactamente como
strings para igualdad y con BigInt para orden; no se usa Number ni orden
lexicográfico.

Son tres puntos constantes, sin consulta, recorrido de historia, almacenamiento
ni interpretación alternativa del dominio. No se cambia ningún contrato de las
cinco tablas, mapper, algoritmo C1, dominio o archivo fuera del alcance.

Archivos modificados respecto del preflight:

- `attention-adapter/persistence/attention-relational-validation.ts`: comprobación relacional, 20 líneas añadidas.
- `attention-adapter/persistence/__tests__/attention-relations-and-mappers.spec.ts`: diez pruebas nuevas, con fixtures locales de alias y oráculo.
- Este documento: estado de revisión, separación de evidencia histórica y resultados R1.

| Caso | Resultado nuevo |
| --- | --- |
| A: inbound `ATTENDED/0 → PENDING/1`, alias `ATTENDED/1` | Rechazado por validador y mapper con `IMPOSSIBLE_RESULT` |
| B: baseline/canónico IGNORED `ATTENDED/0`, alias `PENDING/0` | Rechazado por validador y mapper con `IMPOSSIBLE_RESULT` |
| C: canónico `PENDING/1`, alias `PENDING/1` | Aceptado |
| D: inbound canónico `PENDING/1`, cierre manual real `ATTENDED/2`, alias `ATTENDED/2` | Aceptado y evaluado con C1 real |
| E: canónico IGNORED `ATTENDED/0`, alias compatible `ATTENDED/0` | Aceptado |
| F: canónico IGNORED `ATTENDED/1`, alias contradictorio `PENDING/1` | Rechazado con `IMPOSSIBLE_RESULT` |
| G: mapping de alias contradictorio | Resultado de error sin `value`; no produce Receipt fact para C1 ni ausencia/null |
| H: alias válido tras cierre legítimo, canónico APPLIED o IGNORED | C1 recupera el DUPLICATE propio y el APPLIED/IGNORED canónico completos por separado; delta vacío |

También se rechaza contradicción en un before canónico no basal. Un oráculo de
prueba independiente agrupa los estados suministrados en `Map<bigint,
Set<AttentionStatus>>` y exige un solo estado por revisión, además del orden
causal. Sus 72 combinaciones incluyen 0, 1, 9, 10 y dos revisiones consecutivas
superiores a int64: `9223372036854775808` y `9223372036854775809`. No usa el
predicado productivo para calcular su expectativa. Las revisiones posteriores
sin contradicción conocida pueden tener otro estado; no se certifican hechos
intermedios ausentes ni una historia completa.

Antes de corregir el validador, la suite ampliada reprodujo cinco fallos
(A, B, F, oráculo y G), con 40 pruebas aprobadas. Después del cambio, pasan sus
45 pruebas. El typecheck detectó inicialmente el tipo demasiado amplio del
helper manual nuevo; se precisó a la variante MANUAL_ACTION y se repitieron
typecheck, typed lint y las siete suites completas con éxito.

| Validación R1 | Resultado |
| --- | --- |
| Suite focal relacional y mappers | 1 suite / 45 PASS |
| C2-I-A completo | 3 suites / 126 PASS |
| Regresiones C1 | 2 suites / 63 PASS |
| Regresiones reducer | 2 suites / 78 PASS |
| Total Jest nuevo | **7 suites / 267 PASS**, cero fallos/omisiones |
| Typecheck completo twenty-server sin emisión/incremental | PASS |
| Typed lint explícito de los 13 TypeScript de persistencia | PASS, cero errores/warnings |
| lint:diff-with-main sin dependencias | PASS; main...HEAD, excluye untracked |
| Formato TypeScript y whitespace | PASS; Markdown revisado directamente y por whitespace, excluido por oxfmt |

Comandos R1, desde `packages/twenty-server`, con Node Linux v24.16.0 en PATH:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-i-a-r1-jest-cache --runTestsByPath src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-relations-and-mappers.spec.ts
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-i-a-r1-jest-cache src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain --json --outputFile /tmp/c2-i-a-r1-jest-results.json
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/persistence
```

Desde raíz:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-i-a-r1-nx-data NX_CACHE_DIRECTORY=/tmp/c2-i-a-r1-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
node_modules/.bin/oxfmt --check packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/persistence packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_A.md
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
```

Se aplicó oxfmt exclusivamente a los dos TypeScript modificados y se comprobó
cada uno de los 14 untracked con `git diff --no-index --check /dev/null <archivo>`.
Logs: `/tmp/c2-i-a-r1-{red,jest,typecheck,typed-lint,diff-lint}.log`; conteos por
suite en `/tmp/c2-i-a-r1-jest-results.json`.

La evidencia temporal del revisor seguía disponible. Se ejecutó una copia del
arnés en `/tmp/c2-i-a-r1-review/review-remediated.cjs`, adaptando sólo el caso A
para exigir rechazo antes de intentar materializar/evaluar el fact inválido y
redirigiendo su evidencia a ese directorio. Resultado: **76/76 comprobaciones
PASS**, incluidas sus 100 historias / 4.000 transiciones locales del reductor.
El original de revisión y sus resultados anteriores se preservaron. Esta
reejecución por el implementador no es una nueva revisión independiente.

Estado final R1: misma rama/HEAD, los mismos 14 archivos untracked, sin cambios
tracked ni staging, sin commit. No se ejecutaron tests de infraestructura,
PostgreSQL/SQL, Redis, Twilio, migraciones, Fast Commands, workers, servidores
ni setup. No se inspeccionó Enterprise RLS ni se alteró autorización o datos.

Se recomienda nueva revisión independiente del P2, casos A–H y oráculo, con
especial atención a replays posteriores válidos y originales separados.
**C2-I-A no se declara aceptada y no se inicia C2-I-B.** Siguen pendientes las
garantías físicas, lector/escritor autoritativos, integración, retención y
activación descritas arriba; PG0, PG1, Stage C5 y exact-upgrade continúan bloqueados.
