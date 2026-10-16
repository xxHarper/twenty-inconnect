# INCONNECT Lead Management — Fase 1A-R2

Fecha: 2026-10-16. Rama: `feature/inconnect-lead-management`.
HEAD: `a58e5c82b92c38f618d8f6fb243838311aad3d9c`.

Veredicto: **lista para nueva revisión independiente de código**, con los límites
indicados aquí. No constituye aceptación física, despliegue, activación ni inicio
de Fase 1B. Se leyó el AGENTS.md operativo. Git se utilizó exclusivamente en modo
lectura; no hubo staging, commits, cambios de rama, merges ni push. No se iniciaron
servidores, workers, bases, migraciones, PostgreSQL/SSE físicos o servicios externos.
PG0, PG1 y exact-upgrade no se intervinieron.

## Reproducción antes de la corrección

Se añadió primero una suite persistida con ocho regresiones, ejecutada contra las
rutas originales de esta sesión, antes de introducir las barreras R2:

| Hallazgo | Casos | Resultado previo | Resultado final |
| --- | --- | --- | --- |
| P1-A | CREATED, UPDATED, DELETED, DESTROYED: raíz no administrada, FK a destino administrado, destino con label y campo sensible | 4 FAIL: se consultaba el destino y se encolaba su contenido en el workflow | 4 PASS: no consulta del destino ni enqueue |
| P1-B | CREATED, UPDATED, DELETED, UPSERTED: mismo payload indirecto, sink y publicación reales con transportes simulados | 4 FAIL: además de persistir se publicaba el snapshot por el canal live | 4 PASS: persistencia completa; cero publicación live |

Salida observada de esa primera ejecución: **1 suite FAIL / 8 tests FAIL**.
La suite es `inconnect-record-event-publication.spec.ts`; después se amplió con
los casos adversariales. Los logs originales de esa ejecución en `/tmp` dejaron
de estar disponibles tras la interrupción del entorno; los resultados anteriores
son la evidencia observada durante la sesión, no una nueva ejecución negativa.
Las pruebas persistidas y el resultado final permiten revisar el contrato corregido.

## P1-A: dependencias y enriquecimiento de workflows

La clasificación ya no se limita al objeto raíz. La utilidad independiente de
INCONNECT recorre BEFORE, AFTER y los dos lados de `diff`, y resuelve los Fields
por metadata del workspace. Reconoce relaciones y sus FK normalizadas, también
relaciones anidadas. Un FK no nulo ya establece una dependencia, aunque todavía
no se haya hidratado el registro. Los campos sensibles del destino nunca llegan
al payload si ese objeto está administrado.

Se valida identidad/workspace de Object y Field, pertenencia Field -> Object,
existencia del destino, nombres/IDs duplicados, colisiones con alias FK, forma del
payload y propiedades desconocidas. Metadata ausente, inconsistente, cruzada o
excepciones de Record Access deniegan distribución. Hay límites de profundidad y
cantidad para que una estructura recursiva no pueda convertirse en allow-all.

El listener comprueba las dependencias antes del enriquecimiento; comprueba otra
vez el destino antes de obtener su repositorio SYSTEM; verifica que la metadata
de enriquecimiento corresponde a la raíz original, y vuelve a clasificar el
payload completo antes de cada enqueue. El bypass preexistente sólo permanece
para relaciones clasificadas como no administradas. SYSTEM no concede autoridad
para divulgar relaciones administradas. El payload original no se modifica.

Las relaciones seguras conservan el enriquecimiento en lote y se deduplican los
IDs del IN; no se añadió ningún SELECT CRM de autorización ni una consulta por
registro. UPDATED conserva los lotes BEFORE/AFTER existentes. Una dependencia
protegida o no verificable suprime el dispatch afectado; actualmente la barrera
inicial de workflow puede suprimir el batch completo.

El job de workflow revalida antes de cualquier lectura de workflow y antes de
crear/ejecutar el run. Los nuevos jobs transportan `recordEventObjectMetadataId`
interno. Jobs antiguos con forma de evento de registro y sin esa procedencia
se suprimen; cron y otros payloads sin esa forma mantienen su comportamiento.

## P1-B: cuatro autoridades distintas

| Capa | Comportamiento final |
| --- | --- |
| Persistencia interna | `EntityEventsToDbListener -> CreateEventLogFromInternalEvent -> WorkspaceEventSinkService` conserva el snapshot completo y escribe en los sinks habilitados antes de intentar distribución. No se usa la supresión de publicación para eliminar auditoría. |
| Histórico | SECURITY y los controles existentes de disponibilidad/entitlement no acreditan por sí solos READ CRM independiente. La consulta OBJECT_EVENT se rechaza para workspaces con Record Access configurado, inválido o no disponible, antes y después de la consulta. Esto evita divulgar snapshots borrados y counts imposibles de postfiltrar con seguridad. Los demás históricos y workspaces válidamente no administrados conservan el contrato existente. |
| Publicación live | `EventLogLiveService` clasifica OBJECT_EVENT después de consultar presencia y antes de publicar. Reutiliza una recuperación de metadata/policy por objeto y lote, con decisión separada por fila; una fila segura puede salir junto a otra suprimida del mismo objeto. No publica filas sin identidad verificable ni de otro workspace. |
| Destinatario live | La suscripción exige contexto humano y vuelve a comprobar SECURITY y disponibilidad/entitlement al entregar. Vuelve a clasificar las filas almacenadas en el transporte antes de cederlas al destinatario. Revocaciones posteriores al subscribe o a una primera entrega no constituyen autorización permanente. |

La inspección de SettingsPermissionGuard y de los endpoints de auditoría no
estableció un contrato de autoridad auditora independiente de Record Access.
No se creó tal privilegio. Los controles nuevos sólo restringen las superficies
existentes; la lógica propia de clasificación permanece en INCONNECT. No se
inspeccionó ni reutilizó una implementación Enterprise Row-Level Permissions ni
se modificó `engine/core-modules/enterprise/**`.

La persistencia conserva también las limitaciones previas: DESTROYED no se
encola como auditoría; el conversor reconoce created/updated/deleted/upserted,
no añade soporte nuevo de RESTORED. Sinks deshabilitados o errores de persistencia
siguen sujetos al contrato existente. Las pruebas no afirman persistencia física
en ClickHouse ni durabilidad real de colas.

## Otras rutas identificadas y detenidas

La barrera del publicador genérico recibe ahora las propiedades completas. Con
ello la misma decisión protege las salidas del listener de eventos hacia
webhooks, logic functions y materialización secundaria, además de los eventos
raíz administrados que ya estaban suprimidos en 1A-R.

También se identificó el problema de autoridad permanente en jobs que ya habían
cruzado el enqueue. Se añadieron controles locales al consumidor final de webhook
antes de HTTP y al consumidor de logic functions antes del executor. El consumidor
de workflow tiene los controles descritos arriba. La consulta histórica de
OBJECT_EVENT, que tampoco acreditaba READ independiente, se restringió como se
explica en la tabla. Son cierres de rutas concretas; no se rediseñaron estos módulos.

## Qué sigue funcionando y qué se suprime

- Persistencia interna de snapshots de auditoría según el contrato previo.
- Eventos genéricos de objetos no administrados con payload verificable y sin
  dependencias administradas; relaciones seguras y workflows cron conservados.
- Filas live seguras, incluso mezcladas con filas protegidas del mismo objeto.
- Tablas live distintas de OBJECT_EVENT conservadas, con aislamiento de workspace
  y revalidación de permisos del suscriptor.
- Continúan suprimidos todos los eventos genéricos raíz administrados, aunque el
  actor sea Admin, Supervisor o SYSTEM; no hay excepción nueva de lectura.
- Se suprimen payloads con relaciones/FK administrados en cualquier snapshot o diff,
  metadata no verificable y trabajo de registro antiguo sin procedencia de objeto
  suficiente. Las suscripciones live ahora requieren contexto humano; no se amplió
  acceso de API keys o aplicaciones.
- El histórico OBJECT_EVENT queda temporalmente indisponible en workspaces
  administrados, incluso para objetos individuales no administrados: no hay un
  filtro histórico seguro que preserve counts y snapshots ya borrados.

## Archivos de R2 y alcance

Rutas relativas a `packages/twenty-server/`. El worktree ya traía 1A/1A-R; el
inventario Git posterior incluye ese trabajo. Esta fase toca 20 archivos TypeScript
más este informe, de los cuales 15 TypeScript son nuevas rutas en el diff respecto
del estado inicial de la sesión. No modifica los builders ORM de 1A/1A-R.

| Archivo o grupo | Justificación |
| --- | --- |
| `src/engine/core-modules/inconnect-record-access/utils/collect-record-event-payload-dependencies.util.ts` | Clasificación de dependencias por metadata, sin lecturas CRM ni grants. |
| `src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service.ts` | Clasificación completa y por fila; restricción de histórico. Las decisiones de lectura/escritura existentes no cambian. |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts` | Comprobaciones antes de hidratar y encolar; comprobación de metadata; IN deduplicado. |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts` | Ajuste del contrato de clasificación y procedencia interna de queue. |
| `src/modules/workflow/workflow-trigger/jobs/workflow-trigger.job.ts` y `src/modules/workflow/workflow-trigger/workflow-trigger.module.ts` | Revalidación del consumidor y registro de dependencia. |
| `src/engine/subscriptions/object-record-event/object-record-event-publisher.ts` y su `__tests__/object-record-event-publisher.spec.ts` | Clasificación de propiedades completas y expectativa de regresión. |
| `src/engine/core-modules/event-logs/live/event-log-live.service.ts` y `event-log-live.module.ts` | Filtro por fila en publicación/entrega y registro de dependencia. |
| `src/engine/core-modules/event-logs/event-logs-live.resolver.ts` | Revalidación del destinatario y de filas bufferizadas. |
| `src/engine/core-modules/event-logs/event-logs.resolver.ts` y `event-logs-viewer.module.ts` | Restricción local del histórico y registro de dependencia. |
| `src/engine/core-modules/logic-function/logic-function-trigger/jobs/logic-function-trigger.job.ts` y `logic-function-trigger.module.ts` | Revalidación del consumidor final de eventos de registro. |
| `src/engine/metadata-modules/webhook/jobs/call-webhook.job.ts` y `webhook-job.module.ts` | Revalidación final antes de HTTP. |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-event-publication.spec.ts` | Reproducción de los ocho casos y regresiones de dependencias, metadata, batches y revocación. |
| `src/engine/core-modules/inconnect-record-access/__tests__/record-event-consumer-revocation.spec.ts` | Consumidores, revocación, jobs antiguos y preservación de cron. |
| `src/engine/core-modules/event-logs/event-logs-distribution.spec.ts` | Histórico, destinatarios, entregas sucesivas y buffers previos a revocación. |

## Compatibilidad y límites de aceptación

UUID canónico, normalización/deduplicación de executeMany, selección privada
completa de BEFORE, AFTER del mismo UPDATE, RETURNING público y generatedMaps
permanecen como estaban en 1A-R. Sus regresiones se ejecutaron. No se tocaron
Owner Integrity, políticas de Role, Commercial Teams, entidades, configuración
persistida, auth SYSTEM ni los scopes de lectura/escritura. La API GraphQL no
cambia de schema; los parámetros añadidos al resolver proceden del contexto,
no de argumentos públicos. No se requiere codegen o migración por estos cambios.

Messaging conserva su autorización y su publicación member-scoped. Se ejecutaron
seis suites focales de Messaging además de las regresiones ORM y Record Access.
El cambio no declara que los consumidores genéricos de snapshots administrados
puedan volver a activarse para Messaging ni para otro principal técnico.

Garantías comprobadas **sólo a nivel de código con dobles de infraestructura**:
no consulta de relaciones protegidas en los casos adversariales, no enqueue/no
publicación/no ejecución de los consumidores cubiertos, persistencia interna
previa a live y revalidación observable ante cambios de autoridad.

Pendientes físicos y riesgos expresos:

- No hay prueba física PostgreSQL, ClickHouse, Redis, BullMQ o SSE, ni de DI en una
  aplicación arrancada. Typecheck y tests de clases no sustituyen ese arranque.
- No se añadió un lock atómico que englobe metadata, configuración de Record Access,
  cambios de permisos, enqueue y entrega. Se revalida en límites posteriores, pero
  no se promete orden global frente a cambios concurrentes durante el último I/O.
- No se inspeccionaron, purgaron ni cancelaron colas reales, runs ya iniciados o datos
  derivados materializados antes de estas barreras. Un run iniciado y datos ya
  entregados requieren tratamiento operacional separado; no se pueden retractar
  por una comprobación nueva de queue.
- La clasificación sigue las dependencias representadas por metadata del payload;
  no implementa seguimiento semántico de valores copiados anteriormente a texto o
  JSON independientes. No se afirma cierre universal de cualquier canal de datos.
- BEFORE sigue sin lock físico, y executeMany conserva la dependencia de rollback
  del llamador descrita en 1A-R. Esta fase no acepta concurrencia temporal ni cambia
  la atomicidad del ORM.

No se identificó un P1 adicional concreto sin barrera dentro de las rutas
inspeccionadas. Las restricciones funcionales indicadas deben revisarse antes
de aceptar o desplegar la mitigación; no se inicia Fase 1B.

## Validación y estado Git

Resultado final: **40 suites / 512 tests PASS**, 0 fallos y 0 omitidos.

Jest se ejecutó con `--config packages/twenty-server/jest.config.mjs --runInBand --runTestsByPath <rutas de la tabla> --json --outputFile=/tmp/inconnect-1ar2-final.json`. Las 20 suites anteriores de 1A/1A-R están incluidas.

| Suite (relativa al servidor) | PASS |
| --- | ---: |
| `src/engine/subscriptions/object-record-event/__tests__/object-record-event-publisher.spec.ts` | 46 |
| `src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts` | 46 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-inbound-auto-link.service.spec.ts` | 15 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-event-publication.spec.ts` | 42 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-authorization.service.spec.ts` | 41 |
| `src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts` | 18 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-write-values.spec.ts` | 35 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-auto-create-authority.service.spec.ts` | 8 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-auto-create-eligibility.service.spec.ts` | 15 |
| `src/engine/twenty-orm/repository/__tests__/internal-write-provenance-permissions.spec.ts` | 16 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-authorization.service.spec.ts` | 24 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-outbox.service.spec.ts` | 16 |
| `src/engine/core-modules/logic-function/logic-function-trigger/triggers/database-event/utils/__tests__/transform-event-batch-to-event-payloads.spec.ts` | 14 |
| `src/modules/workflow/workflow-trigger/automated-trigger/crons/jobs/__tests__/workflow-cron-trigger-cron.job.spec.ts` | 11 |
| `src/engine/twenty-orm/repository/__tests__/workspace-select-query-builder.inconnect-record-access.spec.ts` | 6 |
| `src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-policy-source.service.spec.ts` | 16 |
| `src/engine/twenty-orm/utils/__tests__/apply-inconnect-record-access-to-mutation-query-builder.util.spec.ts` | 9 |
| `src/modules/inconnect-messaging/__tests__/inconnect-messaging-context.service.spec.ts` | 7 |
| `src/engine/subscriptions/__tests__/event-stream.service.spec.ts` | 14 |
| `src/engine/metadata-modules/webhook/utils/__tests__/transform-event-batch-to-webhook-events.spec.ts` | 3 |
| `src/engine/twenty-orm/utils/__tests__/format-twenty-orm-event-to-database-batch-event.util.spec.ts` | 3 |
| `src/engine/core-modules/inconnect-record-access/__tests__/record-event-consumer-revocation.spec.ts` | 12 |
| `src/engine/core-modules/event-logs/event-logs-distribution.spec.ts` | 10 |
| `src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts` | 2 |
| `src/engine/core-modules/event-logs/emit/event-log-emitter.resolver.spec.ts` | 6 |
| `src/engine/core-modules/event-logs/emit/event-log-emitter.service.spec.ts` | 7 |
| `src/engine/twenty-orm/repository/__tests__/inconnect-standard-write-permissions.spec.ts` | 7 |
| `src/engine/core-modules/event-logs/producers/application-log/parse-application-log-lines.spec.ts` | 10 |
| `src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts` | 12 |
| `src/engine/api/common/common-query-runners/__tests__/common-update-many-query-runner.internal-write-provenance.spec.ts` | 2 |
| `src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts` | 4 |
| `src/engine/core-modules/event-logs/registry/event-log-registry.spec.ts` | 8 |
| `src/engine/workspace-event-emitter/workspace-event-emitter.spec.ts` | 3 |
| `src/engine/core-modules/event-logs/event-logs.service.spec.ts` | 5 |
| `src/engine/api/common/common-query-runners/__tests__/common-create-many-query-runner.internal-write-provenance.spec.ts` | 1 |
| `src/engine/core-modules/event-logs/ingest/clickhouse-event.sink.spec.ts` | 4 |
| `src/engine/core-modules/event-logs/emit/analytics.utils.spec.ts` | 3 |
| `src/engine/core-modules/event-logs/producers/application-log/strip-ansi-escapes.util.spec.ts` | 8 |
| `src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event.spec.ts` | 1 |
| `src/engine/core-modules/event-logs/emit/build-event-envelope.spec.ts` | 2 |

- Typecheck completo: `node node_modules/@typescript/native-preview/bin/tsgo.js -p packages/twenty-server/tsconfig.json --noEmit`: PASS, exit 0.
- Lint de rama: `NX_DAEMON=false NX_ISOLATE_PLUGINS=false node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies --skip-nx-cache`: PASS. Comprueba main...HEAD, no sustituye la comprobación del worktree/untracked.
- Typed lint explícito de los 32 TypeScript del worktree y untracked: `oxlint --type-aware -c .oxlintrc.json <rutas>`: **0 errores / 0 warnings, exit 0**.
- Formato explícito de esos 32 archivos: `oxfmt --check <rutas>`: **PASS, exit 0**.
- Los errores impresos por casos negativos de cache/policy y cron forman parte de tests PASS. No son servicios arrancados.
- Una ejecución intermedia de Jest/typecheck fue interrumpida y se repitió; no se contó como validación. Un primer intento de Nx usó una ruta binaria inexistente; se corrigió a `.bin/nx`. Un chequeo de formato concurrente con ediciones detectó un archivo sin formatear; la ejecución final de rama pasó después de formatearlo.

Inventario Git completo (incluye el trabajo previo y este informe):

```text
 M packages/twenty-server/src/engine/api/common/common-query-runners/__tests__/common-update-many-query-runner.internal-write-provenance.spec.ts
 M packages/twenty-server/src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener.ts
 M packages/twenty-server/src/engine/core-modules/event-logs/event-logs-live.resolver.ts
 M packages/twenty-server/src/engine/core-modules/event-logs/event-logs-viewer.module.ts
 M packages/twenty-server/src/engine/core-modules/event-logs/event-logs.resolver.ts
 M packages/twenty-server/src/engine/core-modules/event-logs/live/event-log-live.module.ts
 M packages/twenty-server/src/engine/core-modules/event-logs/live/event-log-live.service.ts
 M packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-access-authorization.service.spec.ts
 M packages/twenty-server/src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service.ts
 M packages/twenty-server/src/engine/core-modules/logic-function/logic-function-trigger/jobs/logic-function-trigger.job.ts
 M packages/twenty-server/src/engine/core-modules/logic-function/logic-function-trigger/logic-function-trigger.module.ts
 M packages/twenty-server/src/engine/metadata-modules/webhook/jobs/call-webhook.job.ts
 M packages/twenty-server/src/engine/metadata-modules/webhook/jobs/webhook-job.module.ts
 M packages/twenty-server/src/engine/subscriptions/object-record-event/__tests__/object-record-event-publisher.spec.ts
 M packages/twenty-server/src/engine/subscriptions/object-record-event/object-record-event-publisher.ts
 M packages/twenty-server/src/engine/subscriptions/subscriptions.module.ts
 M packages/twenty-server/src/engine/twenty-orm/repository/workspace-update-query-builder.ts
 M packages/twenty-server/src/engine/twenty-orm/utils/compute-event-select-query-builder.util.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/automated-trigger.module.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/listeners/__tests__/workflow-database-event-trigger.listener.spec.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/jobs/workflow-trigger.job.ts
 M packages/twenty-server/src/modules/workflow/workflow-trigger/workflow-trigger.module.ts
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A.md
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_R2.md
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_REMEDIATION.md
?? packages/twenty-server/src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts
?? packages/twenty-server/src/engine/core-modules/event-logs/event-logs-distribution.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-event-publication.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/record-event-consumer-revocation.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/utils/collect-record-event-payload-dependencies.util.ts
?? packages/twenty-server/src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util.ts
```

Diff de archivos tracked respecto de HEAD:

```text
 ...-query-runner.internal-write-provenance.spec.ts | 132 +++++++++--------
 .../listeners/entity-events-to-db.listener.ts      |  67 +++++----
 .../event-logs/event-logs-live.resolver.ts         |  74 ++++++++--
 .../event-logs/event-logs-viewer.module.ts         |   2 +
 .../core-modules/event-logs/event-logs.resolver.ts |  39 ++++-
 .../event-logs/live/event-log-live.module.ts       |   7 +-
 .../event-logs/live/event-log-live.service.ts      |  57 +++++++-
 ...ect-record-access-authorization.service.spec.ts |  74 ++++++++++
 ...nconnect-record-access-authorization.service.ts | 115 +++++++++++++++
 .../jobs/logic-function-trigger.job.ts             |  24 ++++
 .../logic-function-trigger.module.ts               |   2 +
 .../webhook/jobs/call-webhook.job.ts               |  14 ++
 .../webhook/jobs/webhook-job.module.ts             |   2 +
 .../object-record-event-publisher.spec.ts          | 158 +++++++++++++++++++++
 .../object-record-event-publisher.ts               |  31 ++++
 .../engine/subscriptions/subscriptions.module.ts   |   2 +
 .../repository/workspace-update-query-builder.ts   | 138 ++++++++++++++----
 .../compute-event-select-query-builder.util.ts     |  12 ++
 .../automated-trigger/automated-trigger.module.ts  |   2 +
 ...orkflow-database-event-trigger.listener.spec.ts |  76 ++++++++++
 .../workflow-database-event-trigger.listener.ts    |  96 +++++++++++--
 .../workflow-trigger/jobs/workflow-trigger.job.ts  |  29 ++++
 .../workflow-trigger/workflow-trigger.module.ts    |   2 +
 23 files changed, 1018 insertions(+), 137 deletions(-)
```

Los archivos nuevos también forman parte de la entrega aunque `git diff` no los muestre por defecto. El diff completo de tracked y de cada untracked se preparó por lectura en `/tmp/inconnect-1ar2-full.diff`; status en `/tmp/inconnect-1ar2-git-status.txt`. Estos artefactos y logs son temporales; los tests y este informe son los artefactos persistidos en el repositorio.

Whitespace: `git diff --check` exit 0; 12 untracked comprobados individualmente con `git diff --no-index --check /dev/null <archivo>`, sin diagnósticos. El exit 1 de untracked indica diferencia de archivo nuevo. Índice sin diferencias staged; rama y HEAD sin cambios. Estado final: 23 tracked modificados + 12 untracked, cero staging.
