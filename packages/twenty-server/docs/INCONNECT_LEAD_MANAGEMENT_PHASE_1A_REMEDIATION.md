# INCONNECT Lead Management — Fase 1A-R

Fecha: 2026-10-16. Rama: `feature/inconnect-lead-management`.
HEAD inspeccionado: `a58e5c82b92c38f618d8f6fb243838311aad3d9c`.
Trabajo exclusivamente de código y pruebas sin infraestructura. No hay aceptación
física, despliegue ni inicio de 1B. PG0, PG1 y exact-upgrade permanecen bloqueados.

## Resultado por hallazgo

| Hallazgo | Resultado de código | Límite |
| --- | --- | --- |
| P1, publicación sin INCONNECT por destinatario | Mitigado mediante supresión fail-closed de entregas genéricas para objetos gestionados. | No se implementó autorización positiva de snapshots por destinatario. Realtime y automatizaciones genéricas gestionadas quedan suspendidas. |
| P2, UUID | Corregido: validación de forma canónica y normalización a minúsculas antes de deduplicar, seleccionar y correlacionar. | IDs ausentes del BEFORE autorizado siguen produciendo cero escrituras, sin revelar existencia. |
| P2, BEFORE parcial | Corregido en UPDATE y executeMany: selector privado completo, comparable con AFTER del mismo UPDATE. | BEFORE sigue sin lock; no se acredita exactitud temporal bajo concurrencia. |

La alternativa de supresión está autorizada expresamente en el Trabajo C del
pedido. No se improvisa un modelo de destinatarios, no se usan snapshots como
capacidad de lectura y no se añade impersonación ni bypass SYSTEM.

## Reproducción y regresiones

Antes de corregir, el arnés del builder produjo **4 fallos / 34 pases**:
UUID mayúsculo con `affected: 0`, duplicado por distinto caso aceptado y BEFORE
parcial en ambas rutas. El publicador produjo **10 fallos / 36 pases** en las
nuevas regresiones de supresión, fallo de autoridad, revocación y workspace.

Además se repitieron los cuatro casos del builder sobre los tests finales,
deshabilitando temporalmente sólo normalización y selección completa, con
restauración del código mediante `finally`, sin operaciones Git: **4 fallos /
42 omitidos**. En ambos casos de proyección `id + ownerId`, actualizar sólo Owner
incluía artificialmente `name` en `updatedFields` (también `deletedAt`, omitido en
el fixture parcial). Con las correcciones restauradas, los cuatro casos pasan.

Evidencia local de esta sesión:

- `/tmp/inconnect-1ar-before.log`: primera reproducción del builder.
- `/tmp/inconnect-1ar-p1-before.log`: reproducción P1 antes de la protección.
- `/tmp/inconnect-1ar-defect-replay.log`: repetición controlada de los cuatro defectos con los tests finales.
- `/tmp/inconnect-1ar-final.json` y `/tmp/inconnect-1ar-final.log`: ejecución final completa.

Estos archivos temporales no son evidencia física ni artefactos versionados.

## Contratos de UUID, ORM y snapshots

`executeMany` recibe UUIDs canónicos de 36 caracteres, acepta cualquier caso y
no restringe versión ni variante (se cubren UUID cero y versión 7). Rechaza forma
inválida, espacios, formato compacto y duplicados normalizados con `INVALID_INPUT`
antes del SELECT o UPDATE. El array de entrada del llamador no se modifica.
El nuevo contrato hace explícito el rechazo; no hay dos UPDATE para la misma
identidad con mayúsculas/minúsculas. Se conservan los límites de 200, permisos
estándar, Owner Integrity y alcance INCONNECT en el SQL de mutación.

La opción interna `selectAllColumns`, usada sólo por UPDATE/executeMany,
reemplaza la proyección heredada en el clon privado. Selecciona las columnas de
EntityMetadata por `propertyPath`, incluidas `select:false` y columnas embebidas.
No modifica el SELECT original del builder, RETURNING ni la respuesta pública.
Los demás consumidores del helper conservan su comportamiento por defecto.
La lectura privada conserva el enforcement INCONNECT existente y su condición
de snapshot interno; no añade un endpoint ni una concesión READ.

AFTER continúa hidratándose desde las columnas privadas del mismo
`UPDATE ... RETURNING`, usando driver y ColumnMetadata. No hay SELECT posterior
para AFTER. Se mantienen las proyecciones `id`, `*`, expresiones con alias y
RETURNING vacío, sus `raw`/`generatedMaps` y la eliminación de aliases internos.
La prueba nativa en memoria compara BEFORE/AFTER con relación/FK de nombre físico,
fecha, numeric de precisión alta, JSON, columna oculta y campo embebido.
No conecta ni inicializa DataSource.

UPDATED mantiene BEFORE, AFTER y diff lógico; `name` no cambia al transferir sólo
Owner. UPSERTED mantiene su contrato de AFTER, sin convertirlo en UPDATED.
No se modificó el formateador. Se mantienen la emisión interna y el buffer
transaccional existentes. Los resultados sin filas realmente afectadas no
fabrican eventos.

El consumidor de upsert es
`CommonCreateManyQueryRunnerService.processRecordsToUpdate -> repository.updateMany
-> WorkspaceEntityManager.updateMany -> setManyInputs/executeMany`.
Se cubre mediante `run()` real del runner y builder real con transporte simulado:
consume `generatedMaps`, conserva `columnsToReturn`, limpieza de `createdBy`,
restauración de `deletedAt` y refetch público propio del upsert. No se añadió ese
refetch a los snapshots. Un lote upsert con identidad repetida propaga
`INVALID_INPUT` antes de mutar. El upsert nativo INSERT del EntityManager no cambia.
No se cambia el algoritmo previo de resolución de conflictos del upsert.

## Pipeline y protección P1

La ruta inspeccionada es:

1. El ORM produce WorkspaceEventBatch; el emisor lo bufferiza cuando hay transacción.
2. Tras el ciclo de commit existente, EntityEventsToDbListener recibe CREATED,
   UPDATED, DELETED, RESTORED y DESTROYED.
3. Ese listener llamaba a ObjectRecordEventPublisher y encolaba snapshots para
   webhooks, triggers de funciones, auditoría y materialización de timeline.
4. El publicador descubre streams, resuelve roles/permisos estándar actuales,
   filtra Field Permissions, evalúa queries y enriquece relaciones antes de SSE.
   No acreditaba INCONNECT del destinatario. Un filtro de suscripción no lo sustituye.
5. WorkflowDatabaseEventTriggerListener es otro consumidor independiente,
   también de UPSERTED; enriquecía relaciones mediante su contexto SYSTEM
   preexistente y encolaba el snapshot. Proteger sólo el listener anterior no lo cubría.

La fachada pública INCONNECT añade
`isGenericRecordEventPublicationAllowed(workspaceId, objectMetadataId)`.
Es una clasificación para SUPRESIÓN, no una autorización de lectura. Usa la fuente
vigente de políticas ya existente (env/transition/database), metadata de ese
workspace y las validaciones/cache autoritativas actuales. No reconstruye scopes,
Owners, Teams o Roles en el publicador. No crea AuthContext ni reusa el actor escritor.

| Autoridad vigente | Entrega genérica |
| --- | --- |
| Objeto gestionado, cualquiera de ownRecords/ownAndTeamRecords/allRecords | Suprimida para todos, incluso anterior/nuevo Owner, Coordinador dentro/fuera de Team y administrador. |
| Estado inválido, configuración DB ausente, caché/fuente fallida o metadata desconocida/cruzada | Suprimida; nunca fallback local a permitido. |
| Excepción de la fachada | Suprimida. |
| Objeto confirmado no gestionado | Continúa la ruta estándar existente; SSE conserva permisos por destinatario y Field Permissions. |
| `not-configured` válido de la fuente ENV | Continúa como no gestionado, conforme al contrato actual de esa fuente. No equivale a configuración DB ausente. |
| Revocación o cambio de autoridad | Se consulta de nuevo para cada lote; no se cachea una aprobación en el publicador. |

El publicador aplica la barrera antes de descubrir streams o enriquecer datos;
un stream con workspace distinto también se descarta. No se envía payload,
recordId, diff ni hint de existencia para un objeto gestionado. No hay consultas
por registro/destinatario ni nuevo fanout; las clasificaciones son por lote.
Una autoridad global inválida puede suprimir también objetos normalmente no
gestionados porque su clasificación actual no se puede acreditar.

Para impedir salidas alternativas del mismo snapshot, EntityEventsToDbListener
suprime SSE, enqueue de webhooks, triggers de funciones y nueva materialización
de timeline de objetos gestionados/no clasificables. Conserva la cola de auditoría
interna y su excepción original de DESTROYED. WorkflowDatabaseEventTriggerListener
aplica la misma clasificación antes de clonar, enriquecer o encolar, cubriendo
UPDATED y UPSERTED. Los módulos importan explícitamente la fachada existente.
No se implementa un job ni distribuidor nuevos.

Impacto funcional deliberado: los objetos gestionados pierden la publicación
SSE genérica, los webhooks de este listener, los triggers de funciones, los triggers
de workflows y el timeline derivado de estos nuevos eventos. Su escritura y eventos
internos se conservan; la auditoría interna permanece. Las pruebas de objetos no
gestionados conservan payloads y rutas originales, salvo el rechazo explícito de
workspaces cruzados, justificado por aislamiento y cubierto por tests.

La matriz de destinatarios comprueba SUPRESIÓN, no simula una concesión positiva
por Owner o Team. La indisponibilidad de Team no puede abrir esta barrera: para un
objeto gestionado se deniega independientemente del destinatario.

## Archivos y motivos

Rutas relativas a `packages/twenty-server/`:

| Archivo | Motivo / estado respecto a 1A |
| --- | --- |
| `src/engine/twenty-orm/repository/workspace-update-query-builder.ts` | Normalización y deduplicación; BEFORE completo en ambas rutas. Conserva el trabajo previo 1A. |
| `src/engine/twenty-orm/utils/compute-event-select-query-builder.util.ts` | Opción de proyección privada completa, por defecto desactivada. |
| `src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts` | 12 regresiones nuevas sobre las 34 previas; incluye consumidor upsert. |
| `src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts` | Dos pruebas de proyección/hidratación comparable con TypeORM nativo en memoria. |
| `src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service.ts` | Clasificación pública para supresión; sin nueva autoridad READ. |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-authorization.service.spec.ts` | Diez regresiones de clasificación gestionada/no gestionada y fallos. |
| `src/engine/subscriptions/object-record-event/object-record-event-publisher.ts` | Barrera previa al fanout y rechazo de workspace cruzado. |
| `src/engine/subscriptions/object-record-event/__tests__/object-record-event-publisher.spec.ts` | Diez regresiones P1; conserva 36 pruebas previas. |
| `src/engine/subscriptions/subscriptions.module.ts` | Import explícito del módulo INCONNECT existente. |
| `src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener.ts` | Supresión de salidas genéricas/secundarias; conservación de auditoría. |
| `src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts` | Doce pruebas de rutas, acciones y auditoría. |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts` | Supresión del consumidor independiente antes de su enriquecimiento preexistente. |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts` | Seis regresiones; conserva doce pruebas previas. |
| `src/modules/workflow/workflow-trigger/automated-trigger/automated-trigger.module.ts` | Import explícito del módulo INCONNECT existente. |
| `docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A.md` | Señala este informe como estado vigente de remediación, preservando evidencia histórica. |
| Este informe | Entrega, resultados, impacto, Git y límites de 1A-R. |

Se conservan sin cambios de remediación los tres archivos previos de 1A:
`execute-update-with-event-snapshots.util.ts`, su test y
`common-update-many-query-runner.internal-write-provenance.spec.ts`.
Siguen formando parte del diff/untracked pendiente del usuario y se validaron.

## Validación final sin infraestructura

**20 suites / 281 tests PASS, 0 fallos, 0 omitidos.** Las 10 suites históricas de
119 tests están incluidas y ahora suman 131; las otras 10 suman 150.

Comando: `jest --config packages/twenty-server/jest.config.mjs --runInBand
--runTestsByPath <las 20 rutas de la tabla> --json
--outputFile=/tmp/inconnect-1ar-final.json` usando el Node local existente.
No se ejecutaron tests de integración, conexiones DB, SSE reales ni workers.

| Suite (ruta relativa al servidor) | Tests PASS |
| --- | ---: |
| `src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts` | 46 |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts` | 18 |
| `src/engine/api/common/common-query-runners/__tests__/common-create-many-query-runner.internal-write-provenance.spec.ts` | 1 |
| `src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts` | 12 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-policy-source.service.spec.ts` | 16 |
| `src/engine/api/common/common-query-runners/__tests__/common-update-many-query-runner.internal-write-provenance.spec.ts` | 2 |
| `src/engine/core-modules/logic-function/logic-function-trigger/triggers/database-event/utils/__tests__/transform-event-batch-to-event-payloads.spec.ts` | 14 |
| `src/engine/subscriptions/object-record-event/__tests__/object-record-event-publisher.spec.ts` | 46 |
| `src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts` | 2 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-authorization.service.spec.ts` | 24 |
| `src/engine/subscriptions/__tests__/event-stream.service.spec.ts` | 14 |
| `src/engine/twenty-orm/repository/__tests__/workspace-select-query-builder.inconnect-record-access.spec.ts` | 6 |
| `src/engine/workspace-event-emitter/workspace-event-emitter.spec.ts` | 3 |
| `src/engine/twenty-orm/utils/__tests__/format-twenty-orm-event-to-database-batch-event.util.spec.ts` | 3 |
| `src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts` | 4 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-write-values.spec.ts` | 35 |
| `src/engine/twenty-orm/repository/__tests__/internal-write-provenance-permissions.spec.ts` | 16 |
| `src/engine/twenty-orm/repository/__tests__/inconnect-standard-write-permissions.spec.ts` | 7 |
| `src/engine/twenty-orm/utils/__tests__/apply-inconnect-record-access-to-mutation-query-builder.util.spec.ts` | 9 |
| `src/engine/metadata-modules/webhook/utils/__tests__/transform-event-batch-to-webhook-events.spec.ts` | 3 |

- Typecheck completo del servidor: `tsgo -p tsconfig.json --noEmit`: **PASS**.
- Lint de rama: `NX_DAEMON=false NX_ISOLATE_PLUGINS=false nx run
  twenty-server:lint:diff-with-main --excludeTaskDependencies --skip-nx-cache`:
  **PASS**. Compara `main...HEAD`; no incluye por sí solo el worktree/untracked.
- Typed lint explícito de los **17 archivos TypeScript** actuales:
  `oxlint --type-aware -c .oxlintrc.json <archivos>`: **0 errores / 0 warnings**.
- Formato explícito de esos 17 archivos: **PASS**.
- `git diff --check`: **PASS, exit 0**. Los siete untracked se comprobaron
  individualmente con `git diff --no-index --check /dev/null <archivo>`:
  **sin diagnósticos de whitespace**; exit 1 indica las diferencias de archivos nuevos.

El log de la prueba negativa de configuración incluye intencionalmente el error
`INCONNECT_RECORD_ACCESS_SOURCE_MODE must be one of ...`; la suite pasa y no
inicia servicios. Durante la preparación se corrigieron tipos y dobles de los
fixtures de tests; los resultados de arriba corresponden al estado final.

## Riesgos y validación pendiente

- BEFORE no tiene lock: otro escritor puede cambiar valores entre SELECT y UPDATE.
  Los IDs acotados y el predicado actual de mutación no demuestran un BEFORE físico
  exacto. Requiere diseño/validación de concurrencia antes de prometer auditoría temporal.
- executeMany conserva atomicidad dependiente de la transacción del llamador.
  Fallos intermedios o posteriores al SQL requieren rollback del propietario.
- No se acredita commit/rollback físico, comportamiento real de triggers, tipos,
  generatedMaps sobre PostgreSQL, SSE, carreras de autorización o caída/retry de consumidores.
- La clasificación consulta autoridad vigente pero no añade un lock atómico entre
  cambios de configuración, publicación y enqueue. Suprimir entregas gestionadas
  es la mitigación actual; no se promete atomicidad frente a reconfiguración concurrente.
- No se reautoriza ni purga trabajo ya encolado, materializado o entregado antes de
  esta barrera. Cualquier despliegue requiere una revisión separada de esas colas,
  consumidores y datos derivados, con autorización específica; no se inspeccionaron aquí.
- La reactivación de publicación positiva gestionada necesita un contrato de
  destinatarios actuales, permisos estándar y Field Permissions, tratamiento de
  BEFORE/AFTER, revocación y derivados. No basta comprobar sólo AFTER ni el filtro
  GraphQL. Este trabajo no afirma haber implementado ese contrato.
- La auditoría interna almacenada no es una entrega genérica. No se modifican sus
  APIs ni se certifican en esta fase todas las superficies históricas de datos derivados.

Pruebas físicas futuras requieren autorización específica y target aislado aceptado:
transferencia de Owner con pérdida/ganancia de acceso, transacciones y rollback,
concurrencia de dos conexiones, tipos/RETURNING/triggers reales, SSE y cambio
concurrente de autoridad. No se realizaron ni se habilitan por este informe.

## Git de sólo lectura y veredicto

El preflight encontró **2 archivos tracked modificados y 4 untracked** de 1A;
no era un worktree limpio. Se preservaron. El resultado final incluye esos archivos.
No se ejecutaron branch, switch, checkout, add, commit, push, merge ni rebase.
No hay cambios staged.

Estado final (también enumera archivos untracked individuales):

```text
## feature/inconnect-lead-management
 M packages/twenty-server/src/engine/api/common/common-query-runners/__tests__/common-update-many-query-runner.internal-write-provenance.spec.ts
 M packages/twenty-server/src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener.ts
 M packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-authorization.service.spec.ts
 M packages/twenty-server/src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service.ts
 M packages/twenty-server/src/engine/subscriptions/object-record-event/__tests__/object-record-event-publisher.spec.ts
 M packages/twenty-server/src/engine/subscriptions/object-record-event/object-record-event-publisher.ts
 M packages/twenty-server/src/engine/subscriptions/subscriptions.module.ts
 M packages/twenty-server/src/engine/twenty-orm/repository/workspace-update-query-builder.ts
 M packages/twenty-server/src/engine/twenty-orm/utils/compute-event-select-query-builder.util.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/automated-trigger.module.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A.md
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_REMEDIATION.md
?? packages/twenty-server/src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util.ts
```

Diff tracked respecto a HEAD (los untracked se enumeran arriba):

```text
 ...-query-runner.internal-write-provenance.spec.ts | 132 +++++++++--------
 .../listeners/entity-events-to-db.listener.ts      |  67 +++++----
 ...ect-record-access-authorization.service.spec.ts |  74 ++++++++++
 ...nconnect-record-access-authorization.service.ts |  51 +++++++
 .../object-record-event-publisher.spec.ts          | 157 +++++++++++++++++++++
 .../object-record-event-publisher.ts               |  30 ++++
 .../engine/subscriptions/subscriptions.module.ts   |   2 +
 .../repository/workspace-update-query-builder.ts   | 138 ++++++++++++++----
 .../compute-event-select-query-builder.util.ts     |  12 ++
 .../automated-trigger/automated-trigger.module.ts  |   2 +
 ...orkflow-database-event-trigger.listener.spec.ts |  67 +++++++++
 .../workflow-database-event-trigger.listener.ts    |  18 ++-
 12 files changed, 640 insertions(+), 110 deletions(-)
```

**Lista para revisión independiente de 1A-R en código**, con P1 mitigado por
supresión y con su impacto funcional explícito. No es aceptación de publicación
positiva por destinatario, aceptación física, habilitación de PG0/PG1/exact-upgrade,
autorización de despliegue ni inicio de 1B.
