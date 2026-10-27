# INCONNECT — Fase 1B-1B-C2-II

> Lectura vigente, 2026-10-27: este documento conserva la entrega de su fase.
> Las etiquetas de revisión pendiente y recomendaciones de siguiente fase son
> históricas; consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para los
> checkpoints posteriores hasta R4 y [guardrails](INCONNECT_ATTENTION_GUARDRAILS.md).
> Sus contratos técnicos y gates físicos permanecen; ninguna fase ni instalación
> se autoriza por esta reconciliación documental.

Fecha: 2026-10-21. **Implementación SOURCE-ONLY; pendiente de revisión independiente.**
No constituye aceptación física PostgreSQL ni inicia C2-III.

## 1. Base y alcance

Preflight read-only: rama `feature/inconnect-lead-management`, HEAD
`f143422f59f87f984e50f38d7557852549c865c3`, árbol limpio y staging vacío.
C2-I-A está registrada en `bf25dcd36e`; C2-I-B, incluida la remediación xid8
completa y su evidencia de 13 suites / 365 pruebas, está en HEAD. La aceptación
independiente comunicada por el usuario prevalece sobre las etiquetas históricas
pendientes de revisión de esos documentos. No se modifican esas fuentes.

Autoridades: [C2](INCONNECT_ATTENTION_ADAPTER_C2_DESIGN.md), especialmente
§5–§7; contratos C1; [C2-I-A](INCONNECT_ATTENTION_ADAPTER_C2_I_A.md) y
[C2-I-B](INCONNECT_ATTENTION_ADAPTER_C2_I_B.md). Se contrastaron entidades,
SQL del Fast Command 1792540800000, contratos/decoders/mappers y patrones
transaccionales existentes de Messaging con el QueryRunner PostgreSQL instalado.
No se rediseña el ledger ni se modifica un contrato aceptado.

Se añade exclusivamente un lector interno localizado en
`src/modules/inconnect-messaging/attention-adapter/persistence/reader/`, pruebas
sin conexión y este documento. No hay decoradores Nest, provider registrado,
llamador operativo, endpoint, nueva entidad, esquema, comando o integración.

## 2. Inventario

Todos los TypeScript siguientes son nuevos y relativos al directorio `reader/`:

| Archivo | Responsabilidad |
| --- | --- |
| `attention-reader.types.ts` | Entrada, salida y errores técnicos discriminados |
| `attention-reader-sql.ts` | SELECTs parametrizados y proyecciones raw explícitas |
| `attention-reader-session.ts` | Validación de runner/sesión, cardinalidad y envelope del driver |
| `attention-reader-links.ts` | Pareja canónica, dependientes causales y registro completo de intención |
| `read-attention-projection.ts` | Único protocolo completo de entrada, locks, gates, epoch y tres slots |
| `index.ts` | Exporta exclusivamente el lector y sus contratos; ningún barrel anterior lo importa |
| `__tests__/attention-reader.fixtures.ts` | QueryRunner simulado con script exacto de SQL/parámetros/orden |
| `__tests__/attention-reader.spec.ts` | Paridad con evaluación C1 real y originales separados |
| `__tests__/attention-reader-failures.spec.ts` | Fallos de sesión, consultas, scope, readiness y completitud |
| `__tests__/attention-reader-sql.spec.ts` | Forma SQL, locks/post-lock, parámetros, precisión y ausencia de escrituras |

Total: **10 TypeScript nuevos y este Markdown**, sin modificaciones a fuentes
anteriores, AGENTS.md o documentos aceptados.

## 3. Contratos de entrada y salida

`readAttentionProjection({ queryRunner, input })` recibe el QueryRunner PostgreSQL
ya conectado y transaccional del caller, más un `ScopedAttentionEvent` backend.
No acepta un plan previo, facts, negativos de caché, epoch implícito, conexión
alternativa ni una opción para omitir locks. Copia el evento antes del primer
`await`; planifica contra el snapshot posterior al lock.

El futuro caller debe autenticar, resolver el workspace/conexión/Conversation y
origen del epoch desde autoridad backend y autorizar la operación. **Conocer los
UUIDs o poder construir este tipo no concede autorización.** El lector no es una
API humana o un servicio alternativo de permisos. Actor/authorityReference
históricos no acreditan acceso actual. Para inbound/callback el routing debe
partir de Message/recepción durable; para humanos, de la autoridad Messaging
vigente. La reautorización transaccional efectiva sigue siendo C2-III.

Salida discriminada:

- `ok: true`: `plan`, `facts` C1, Epoch decodificado, Message causal si aplica y
  obligaciones explícitamente no certificadas por la lectura.
- `ok: false`: sólo `error`, con código y ruta; SQLSTATE seguro cuando el driver
  lo proporciona. No contiene facts, payload SQL, parámetros ni texto del driver.

El éxito significa que se completó este protocolo de lectura; no significa
APPLIED, autenticación, autorización, commit, admisión outbound o escritura.
Se llama a `reconstructAttentionProjection` para validar los facts, sin evaluar
una nueva transición. Las pruebas llaman separadamente a C1 real.

Los decoders aprobados de resultados históricos internamente contrastan su
posibilidad con el reducer puro. Se reutiliza esa validación local de C2-I-A:
no se recalcula el original contra Conversation actual ni se invoca el reducer
para decidir/aplicar un evento desde el lector.

## 4. Sesión y ownership transaccional

El reader exige, antes y después de cada consulta, runner activo/no liberado,
manager original, referencias manager↔runner↔DataSource coherentes, PostgreSQL,
DataSource inicializado, `mode = master`, `transactionDepth = 1` y el mismo
`databaseConnection` ya adquirido. No llama connect/start/commit/rollback/release,
crea manager ni cambia opciones o variables de sesión. Evita la adquisición
perezosa de conexión que haría `query()` en un runner aún desconectado.

La API general QueryRunner no declara aislamiento ni todos esos campos; se
verifica la forma real disponible en PostgreSQL TypeORM 0.3.31 y se falla cerrado
si faltan o cambian. No se convierte una declaración del caller en evidencia.

Una SELECT de sesión inicial y otra final verifican realmente, cuando se ejecute
en una integración futura:

- `transaction_isolation = read committed`, `transaction_read_only = off` y
  `pg_is_in_recovery() = false`.
- `row_security = off`. Esto evita que una política que ocultaría filas convierta
  la consulta en falsa ausencia: PostgreSQL debe rechazar una consulta afectada
  por RLS para un rol al que se aplique. El lector no cambia RLS ni roles, ni
  introduce políticas o permisos. El caller debe preparar esa sesión y contar
  con la autoridad backend aprobada para las tablas core.
- `statement_timeout` y `lock_timeout` positivos según sus valores en
  milisegundos de `pg_settings`; no cambia los presupuestos del caller.
- PID y `pg_current_xact_id()::text` idénticos al finalizar. El xid8 se conserva
  como decimal exacto hasta el máximo unsigned, sin Number/int64/modulo/xmin.

`pg_current_xact_id()` asigna un ID a la transacción si aún no lo tenía; no es
DML de negocio. No se leen ni alteran los marcadores técnicos persistidos de
C2-I-B. El testigo tiene alcance de esa conexión/transacción/instalación, sin
pretender identidad global entre clusters o restauraciones.

Precondiciones del futuro caller: uso exclusivo del runner, sin batch,
savepoints ni commit/rollback concurrentes; primario de confianza, protocolo y
esquema instalados, sin filtros que oculten filas. Debe usar los facts sólo
dentro de esa misma unidad y conservar los locks hasta terminarla. Ante cualquier
error debe abortar la unidad; el lector no hace rollback ni retry por su cuenta.
Los mocks prueban verificaciones y orden emitido, no propiedades físicas.

## 5. Locks y lecturas frescas

Secuencia única:

1. Verificar la sesión transaccional.
2. Configuration del workspace `FOR SHARE`; comprobar instalación, gate y versión.
3. Conversation por C completo `FOR UPDATE`; exigir exactamente una fila.
4. Nueva sentencia de estado/epoch después de resolver el lock. La salida del
   SELECT de lock sólo contiene identidad, nunca se usa como snapshot C1.
5. Validar Epoch, mapear snapshot y crear el plan C1.
6. Leer Message de origen si corresponde, después del lock común.
7. Materializar los tres slots juntos en una SELECT con raíz Conversation y
   Epoch por LEFT JOIN; comprobar que estado/epoch coinciden con el paso 4.
8. Completar enlaces por puntos y validar/mapping; verificar continuidad de sesión.

Se usa la descomposición permitida por C2 §5.1. Todas las lecturas decisorias
son posteriores al mutex común, mismo runner/primario y READ COMMITTED. Su
suficiencia depende de que todos los writers y lifecycle respeten ese mutex,
incluidos aliases, IGNORED y registros sin incremento de revisión. READ COMMITTED
no proporciona por sí solo un snapshot común a sentencias distintas.

El lector adquiere únicamente los dos locks comunes. No adquiere locks causales
WebhookReceipt/Message/DispatchAttempt: la futura composición debe respetar
Configuration→Conversation→Epoch→WebhookReceipt→Messages ordenados→DispatchAttempt→
ledger/audit/Outbox y revalidar fuentes/leases donde corresponda. No se permite
entrar conservando locks causales en orden inverso. Si el caller necesita
insertar el Message causal antes de este lector, debe haber adquirido previamente
los locks comunes en el orden aprobado; el lector vuelve a adquirirlos sobre las
mismas filas. Un Message nuevo puede ser visible como inserción propia de esa
unidad; el lector nunca lo crea ni prepara.

No se usa SKIP LOCKED, CAS por revisión, Redis, réplica ni prelectura decisoria.
La continuidad/orden real de otros writers y sus locks implícitos siguen pendientes
de integración y pruebas PostgreSQL.

## 6. SQL, scopes y completitud

`C = workspaceId + conversationId + providerConnectionId`.
`S = C + trackingEpochId`. UUIDs, claves, identidades y referencias son parámetros
`$n`; los identificadores SQL provienen exclusivamente de constantes privadas.

| Consulta | Predicado / datos |
| --- | --- |
| Sesión | Settings y testigo de conexión/transacción; sin datos de workspace |
| Configuration SHARE | `$1 = workspaceId`; singleton sin identificador artificial |
| Conversation lock / raíz | `$1..$3 = C`; Epoch por puntero actual y C completo |
| Slots | `$1..$4 = S`; Receipt `$5=eventKey`; Effect `$6=effectKey`; Intent `$7=intentId` para PROVIDER_EVIDENCE o `$7=messageId` para RESPONSE_INTENDED; NONE no consulta Intent |
| Bundle de Effect | `$1..$4=S`, `$5=UUID físico Effect`; canónico, audit, Message, Intent, StatusEvent, WebhookReceipt y pareja completa de registro |
| Audit original propio | `$1..$4=S`, `$5=originalAuditId`; separado del canónico |
| Message causal | `$1..$3=C`, `$4=messageId`; se conserva su epoch de origen para rechazar NULL/otro epoch, nunca adoptarlo |

Receipt y Effect se buscan **independientemente en la misma sentencia**; no se
omite Effect si Receipt no existe. LEFT JOINs preservan la fila base aunque
falte un dependiente. Se exigen raíz, campos y presencia explícita de cada slot;
no se acepta un objeto vacío como ausencia. Sólo un slot explícitamente ausente
en una consulta completa pasa a `null` C1.

Todas las consultas usan el resultado estructurado de TypeORM: `records`,
`raw` (mismo array que entrega el driver instalado) y `affected` deben concordar.
Falta de rowCount, envelope parcial, raíz vacía o cardinalidad múltiple falla.
No hay LIMIT, filtros temporales, paginación, soft-delete, agregación de historia
ni búsqueda global por eventKey/effectKey. Configuration ausente y Message/
Conversation ausentes no se confunden con ausencia de una clave del ledger.

Cada join ledger incluye S. Message exige C y epoch. StatusEvent carece de
Conversation/epoch propios: se acota por workspace y Message ya acotado a S.
WebhookReceipt se acota por workspace/conexión y su relación al StatusEvent de
ese Message. No se toma un UUID aislado como prueba de pertenencia.

Se contrastan también contradicciones entre puntos conocidos: un canónico que
prueba existencia del Receipt solicitado, un registro que prueba el Effect
solicitado o una intención conocida que coincide con el lookup no pueden convivir
con slots ausentes. Los estados históricos suministrados y el snapshot deben
coincidir cuando tienen la misma revisión y no pueden superar la revisión viva.
Son validaciones acotadas, sin certificar la cadena histórica completa.

Máximo de éxito: **11 SELECTs**, incluidos ambos controles de sesión, hasta
3 bundles de Effect, 1 audit propio y 1 Message causal. Cada bundle tiene enlaces
fijos de un único punto y una pareja de registro; no recursión ni descarga de
aliases/historia. El caso sin ledger ni intención usa 7 SELECTs con Message,
6 sin Message. El coste/plan físico permanece sin medir.

## 7. Gate y Epoch

La consulta Configuration usa extracción `to_jsonb(configuration)` sólo en el
servidor para detectar las tres columnas sin nombrar columnas ausentes. Devuelve
únicamente campos permitidos, nunca la configuración completa. Antes del DDL,
`installed=false` produce `SCHEMA_NOT_INSTALLED`. Tener esas columnas no prueba
instalación completa de constraints/tablas; una instalación parcial posterior
falla como error de consulta y requiere reparación operativa autorizada.

| Gate | Política |
| --- | --- |
| Ausente / columnas no instaladas | GATE_MISSING / SCHEMA_NOT_INSTALLED, sin proyección |
| DISABLED | TRACKING_DISABLED; sin consultas a tablas de atención ni Conversation |
| PREPARING | TRACKING_PREPARING; mismo corte temprano |
| SUSPENDED | TRACKING_SUSPENDED; mismo corte temprano, sin fallback legacy |
| ENABLED | Exige protocolo 1 e instante de gate válido; continúa bajo SHARE |
| Desconocido / contradictorio | INVALID_CONFIGURATION / INCOMPATIBLE_VERSION |

Con ENABLED, tuple de Conversation totalmente NULL significa EPOCH_UNPREPARED;
puntero sin fila, EPOCH_MISSING; tuple parcial, error del decoder. Epoch
PREPARING/SUSPENDED/CLOSED tiene código propio y no produce facts. Sólo READY,
versiones/política aprobadas, mismo C y epoch solicitado/origen permiten continuar.
La lectura no crea epochs, captura cobertura, prepara, hace bootstrap, cambia
pendingAt ni migra Messages históricos NULL.

## 8. Decoders, relaciones y originales

Se reutilizan los decoders estrictos de C2-I-A y los cuatro mappers aceptados.
No se hidratan entidades. Los bundles verifican Effect/canónico/audit/Message,
Intent y evidencia relacionada. Para cada Intent recuperado se proporciona además
su Effect RESPONSE_INTENDED, canónico, audit APPLIED/RESPONSE_REGISTERED y
Message; se verifica el enlace de registro pendiente en un bundle de evidencia
simple de C2-I-A. Se exige también `appliedToProjection=true` en evidencia
retenida, según C2-I-B; no acredita por sí solo admisión actual o autenticidad.

Un Receipt usa su propio `originalAuditId`: alias DUPLICATE con before/after
histórico propio. Effect usa su Receipt canónico y conserva APPLIED o IGNORED.
No se sustituye el primero por el segundo ni se consulta historia de conflictos
como prueba de consumo. Los CONFLICT sin claves reservadas permiten un retry
causal posterior con la misma identidad, como comprueban los tests C1.

ResponseIntent conserva intentId, Message, contenido, coveredRevision, provenance,
actor, authorityReference, format y registeredEffectId. TEMPLATE no implica HUMAN.
El vínculo evidenceId↔StatusEvent y la admisión/autenticación nueva no se inventan;
se informan pendientes de integración junto con autoridad actual.

## 9. Precisión y errores

Las proyecciones JSONB enumeran exclusivamente campos C2-I-A, excluyendo los
marcadores técnicos de C2-I-B. Cada instante válido usa
`to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
Antes se comprueban finitud y rango 0001–9999; los valores fuera de frontera
conservan texto inválido para rechazo, sin normalizar BC a un año positivo.
Gate también produce representación explícita UTC. Ningún timestamp atraviesa
JavaScript Date. Microsegundos y revisión text exacta sobreviven a JSONB.
No se ordenan hechos por timestamps. Revisiones no pasan por Number ni int64.

Se conservan códigos C2-I-A: fila malformada, versión, revisión, scope, causalidad,
original imposible, capacidad y datos incompletos. Se añaden QUERY_FAILED,
INCORRECT_TRANSACTION, INCOMPLETE_PROJECTION, SNAPSHOT_CHANGED, readiness por
gate/epoch e INVALID_PROJECTION para reconstrucción C1 inválida. SQLSTATE 42501,
57014, 55P03, 08006 y 42P01 se prueban como errores, nunca como null. Un error
inesperado de programación se propaga; tampoco devuelve proyección o ausencia.

## 10. Validación ejecutada

Con Node Linux v24.16.0 en PATH, se ejecutaron las comprobaciones siguientes.
No se inició servicio ni conexión como parte de ellas.

| Validación final | Resultado |
| --- | --- |
| Lector, incluido en el conjunto final | 3 suites / **101 pruebas PASS** |
| Regresiones C2-I-A | 3 suites / 126 PASS |
| Regresiones C1 | 2 suites / 63 PASS |
| Regresiones attention-domain | 2 suites / 78 PASS |
| Jest conjunto final | **10 suites / 368 pruebas PASS**, cero fallos/omitidas |
| Typecheck completo twenty-server | tsgo --noEmit --incremental false: exit 0 |
| Typed lint explícito | 10 TypeScript; 0 errores / 0 warnings |
| Diff lint Nx | PASS; 513 archivos lint / 471 formato según exclusiones |
| Formato explícito | 10 TypeScript PASS |
| Whitespace | git diff --check y no-index de los 11 archivos nuevos PASS |
| Integración | Ninguna referencia al nuevo lector fuera de su directorio |

Desde `packages/twenty-server`, con
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-ii-jest-cache src/modules/inconnect-messaging/attention-adapter/persistence/reader
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-ii-jest-cache src/modules/inconnect-messaging/attention-adapter src/modules/inconnect-messaging/attention-domain --json --outputFile /tmp/c2-ii-jest-results.json
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/persistence/reader
```

Desde raíz, con el mismo Node:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-ii-nx-data NX_CACHE_DIRECTORY=/tmp/c2-ii-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
node_modules/.bin/oxfmt --check packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/persistence/reader
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
```

Se aplicó oxfmt sólo al nuevo directorio. Markdown está excluido por la
configuración: se revisó su estructura y whitespace explícitamente. Diff lint
usa `main...HEAD`, de modo que no cubre estos archivos untracked; éstos tienen
lint/formato explícitos. Se inspeccionó su fuente y se comprobó cada archivo
con `git diff --no-index --check /dev/null <archivo>`, sin añadirlo al índice.
No se ejecutaron comandos UP/DOWN ni suites con reset.

La validación intermedia detectó tres fixtures que omitían el Receipt de un
canónico cuya eventKey solicitaban. Las nuevas comprobaciones de completitud
las rechazaron correctamente; se corrigieron a eventKeys de alias distintas y
se añadieron regresiones explícitas de ausencias contradictorias. El conjunto
final completo, typecheck y typed lint se ejecutaron después de las últimas
modificaciones TypeScript. El primer intento de formato usó una ruta relativa
incorrecta y se repitió con la ruta correcta; no modificó archivos ajenos.

Evidencia: `/tmp/c2-ii-jest.log`, `/tmp/c2-ii-jest-results.json`,
`/tmp/c2-ii-typecheck.log`, `/tmp/c2-ii-lint.log` y
`/tmp/c2-ii-diff-lint.log`. Los avisos ambientales NO_COLOR/FORCE_COLOR y de
versión npm no provocaron instalación o actualización.

Las pruebas verifican SQL emitido, valores y orden exactos; conservan errores
del mock fuera del catch del lector para impedir que un test de error absorba
un fallo de su propia expectativa. Usan resultados reales del reducer para
fixtures y C1 real para paridad; no implementan un PostgreSQL en memoria.
La espera del lock se modela mediante una promesa controlada, sin sleeps ni
conexión, y sólo prueba ausencia de lecturas antes de su resolución.

## 11. Obligaciones futuras y límites físicos

No se ejecutó ninguna sentencia contra PostgreSQL ni UP/DOWN del Fast Command.
No se puede afirmar desde mocks que una consulta encuentra todas las filas reales,
que un lock bloquea otra sesión, ni que los constraints instalados satisfacen el
protocolo. Revisión independiente debe inspeccionar SQL y casos de omisión de
ambos slots, además de los enlaces de registro y originales propios.

Permanecen pendientes, con aislamiento y autorización física específicos:
planes/índices y coste real de LEFT JOINs; cardinalidad/rowCount/parser del driver;
UTC/microsegundos/rangos y Unicode reales; primario/roles/RLS; espera de locks y
visibilidad posterior incluso sin cambio de revisión; gate concurrente; session
identity; commit/rollback, timeouts, desconexión y carreras con guards/otros writers.
No se toma la evidencia aritmética xid8 anterior como prueba de MVCC del lector.

C2-III requerirá autorización separada: caller autorizado, orden causal completo,
reautorización bajo locks, identidad backend de evidencia y admisión outbound,
writer/delta, auditoría, atomicidad con Message y Outbox, política de retries y
fences legacy. El lector no implementa esas operaciones. Bootstrap, rollout,
retención/purga y activación siguen siendo trabajos independientes.

## 12. Frontera de entrega y Git

Sin integración en inbound, webhooks, Send, Dispatch, callbacks, WorkState,
GraphQL, frontend, Record Access, Commercial Teams, clasificación de Leads o
distribución operacional. No cambia Pending manual ni permite cierre automático.
No hay Outbox emitida ni nuevo provider registrado.

Estado final: misma rama y HEAD del preflight; **11 archivos nuevos untracked**
(los diez TypeScript del inventario y este documento), cero modificaciones a
archivos tracked y staging vacío. `git diff --stat` y `git diff --cached --stat`
están vacíos porque los archivos nuevos no están en el índice; el inventario y
las comprobaciones no-index incluyen el contenido nuevo.

Git permanece read-only, sin add/commit/push/fetch/pull ni cambios de refs/index.
No se conectó PostgreSQL ni inició infraestructura, Twilio, Redis, servidores,
workers, setup/reset, generadores o migraciones. AGENTS.md y todas las fuentes
aprobadas permanecen intactos. PG0, PG1, Stage C5 y exact-upgrade siguen bloqueados.
**La entrega termina en C2-II SOURCE-ONLY; se recomienda revisión independiente.**
