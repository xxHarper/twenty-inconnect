# INCONNECT Lead Management — Fase 1A-R3

Fecha: 2026-10-16. Rama: `feature/inconnect-lead-management`.
HEAD inspeccionado: `a58e5c82b92c38f618d8f6fb243838311aad3d9c`.

Veredicto: **P1 de pérdida de identidad de aplicación cerrado a nivel source-only**.
La aceptación se limita a las comprobaciones descritas; no afirma aceptación
física, despliegue o activación. Fase 1B no iniciada.

## Causa raíz y contrato vigente

El guard inicial `SettingsPermissionGuard(SECURITY)` suministraba a
`PermissionsService.userHasWorkspaceSettingPermission` el workspace, usuario,
API key y aplicación autenticados. El resolver live de R2 conservaba solamente
`workspaceId` y `userWorkspaceId`: `hasCurrentAccess()` volvía a pedir SECURITY
sin `applicationId`. Por ello comprobaba únicamente el permiso humano incluso
cuando la suscripción había sido autorizada para usuario + aplicación.

La estrategia JWT representa al humano mediante `userWorkspaceId` y, para un
token `APPLICATION_ACCESS` ligado a usuario, añade `application` al mismo contexto.
También conserva `tokenType`. En las revalidaciones no se vuelve a ejecutar esa
estrategia inicial; debe preservarse la identidad original, no su autorización.

El contrato existente de PermissionsService ya resuelve la aplicación por
`id + workspaceId` en cada consulta. Si fue eliminada, lanza una excepción; si
su Role limita al usuario, exige la intersección de los Roles actuales. La
revocación de SECURITY en cualquiera de los dos Roles deniega. R3 no cambia ese
servicio ni el guard. Se conserva su contrato explícito para una aplicación
existente que declara `defaultRoleId = null`; no se confunde ese caso con una
aplicación ausente, eliminada o con un Role que deniega.

## Corrección localizada

- El resolver obtiene `RawAuthContext` con `@Context('req')`, desde el mismo
  request autenticado que usa el guard. No añade argumentos GraphQL públicos.
- Captura antes del primer await `workspaceId`, `userWorkspaceId` y
  `applicationId` como valores independientes de los objetos del request/cache.
- Deniega antes de presencia o subscribe si falta la aplicación de un token
  `APPLICATION_ACCESS`, falta/viene vacío su ID, pertenece a otro workspace,
  falta/discrepa el usuario o aparece una API key en este endpoint humano.
- Apertura, heartbeat y entregas usan el mismo PermissionsService con el
  principal completo. No hay catch que reintente con autoridad sólo humana.
- Mantiene disponibilidad/entitlement y el filtrado de filas de R2. Después del
  filtrado asíncrono vuelve a comprobar el principal antes de `yield`.
- Un heartbeat denegado no renueva presencia y llama a `return()` del iterador
  fuente. Esto es local al resolver: el wrapper compartido no cierra por sí solo
  un iterador por recibir `false` del callback. No se modifica ese wrapper.
- Una entrega denegada termina el generador y ejecuta la limpieza existente.

## Reproducción y regresiones

Primero se creó y ejecutó la suite del resolver contra el código anterior de la
sesión: **24 tests: 20 FAIL / 4 PASS**. Se conservan esos casos. Tras la corrección
pasaron los 24; posteriormente se añadió un caso contra IDs de aplicación
introducidos fuera del contexto autenticado. Resultado focal final: **25 PASS**.

| Caso | Antes | Después |
| --- | --- | --- |
| Usuario + aplicación inicialmente autorizados | Entregaba, pero la aserción del principal completo fallaba: faltaba applicationId | Entrega con identidad completa y sólo filas permitidas |
| SECURITY revocado sólo a aplicación tras tres entregas | Continuaba entregando | Termina sin filtrar/entregar otra fila |
| Aplicación eliminada tras tres entregas | Continuaba entregando | Termina; la excepción de aplicación ausente deniega |
| SECURITY del usuario revocado | Ya bloqueaba la siguiente entrega | Se conserva para usuario + aplicación y humano solo |
| Heartbeat tras revocación/eliminación | Aplicación revocada/eliminada renovaba presencia; faltaba liberar iterador en los tres casos | No renueva y libera el iterador |
| Token de aplicación sin aplicación/ID | No rechazaba la apertura incompleta | Deniega antes de presencia/subscribe |
| IDs del request/cache mutados después de subscribe | No conservaba identidad completa | Sigue consultando los IDs originales |
| Revocación durante el filtro asíncrono | Cedía las filas con autoridad anterior al await | Deniega antes de yield |
| Humano autorizado, tabla distinta, filas administradas y de otro workspace | Controles previos presentes | Controles preservados |
| applicationId externo en body/variables/request | Caso añadido después de la reproducción inicial | Se ignora; se consulta sólo la aplicación autenticada |

El harness usa las clases reales PermissionsService y EventLogLiveService con
repositorios, cache, transporte y clasificación INCONNECT simulados en memoria.
Usa permisos granulares SECURITY; las revocaciones no sustituyen el servicio de
permisos por un booleano fijo. La clasificación INCONNECT real se verifica además
en sus suites de regresión existentes.

| Ejecución | Resultado |
| --- | --- |
| Resolver live + distribución, primer green | 2 suites / 34 tests PASS |
| Auditoría completa, Record Access, permisos, guard, JWT, event stream, publisher, workflow listener y listener de auditoría | 48 suites / 588 tests PASS; incluye los 24 tests focales originales |
| ApplicationTokenService, resolución de Roles, permisos de objeto, procedencia y snapshots/UUID del ORM | 7 suites / 81 tests PASS |
| Resolver focal final, incluido el caso adicional de IDs externos | 1 suite / 25 tests PASS |

Son **55 suites distintas / 670 casos vigentes comprobados**, sin sumar dos veces
las ejecuciones focales que se solapan con la regresión. No hubo fallos u omitidos
en las ejecuciones finales. Los logs de errores de recomputación en algunas suites
de Record Access corresponden a escenarios de fallo simulados que pasan.

Comandos de validación (Node local v24.16.0 añadido al PATH):

```bash
node_modules/.bin/jest --config packages/twenty-server/jest.config.mjs --runInBand --runTestsByPath packages/twenty-server/src/engine/core-modules/event-logs/event-logs-live.resolver.spec.ts
node_modules/.bin/tsgo -p packages/twenty-server/tsconfig.json --noEmit --incremental false
node_modules/.bin/nx run twenty-server:lint:diff-with-main --skip-nx-cache
git diff --check
```

Typecheck completo del servidor: PASS. Typed lint directo de los tres archivos
TypeScript tocados: **0 errores / 0 warnings**. `lint:diff-with-main`: PASS; el target
lee `main...HEAD`, por lo que el lint directo cubre también cambios locales y
untracked. Nx informó su aviso de tarea flaky para el build de reglas de lint,
pero ambos targets finalizaron con éxito. Formato focal y whitespace: PASS.

Logs locales de esta sesión en `/tmp/inconnect-r3-*.log`: `red`, `green`,
`regressions`, `additional-regressions`, `final-focused`, `typecheck-final`,
`lint-final`, `diff-lint` y `format`. Son evidencia temporal, no artefactos Git.

## Archivos y alcance de R3

Rutas relativas a `packages/twenty-server/`:

| Archivo | Cambio en esta sesión |
| --- | --- |
| `src/engine/core-modules/event-logs/event-logs-live.resolver.ts` | Único archivo de producción modificado: captura del principal y revalidación completa |
| `src/engine/core-modules/event-logs/event-logs-live.resolver.spec.ts` | Suite nueva de 25 regresiones |
| `src/engine/core-modules/event-logs/event-logs-distribution.spec.ts` | Una línea en el harness previo para pasar el contexto humano autenticado |
| `docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_R3.md` | Este informe |

Se compararon hashes contra el inventario inicial: sólo el resolver y el harness
de distribución cambiaron entre los archivos que ya estaban modificados o
untracked. Los demás cambios de 1A/1A-R/R2 se preservaron. No se modificaron los
builders ORM, clasificación, policies, Roles, Commercial Teams ni configuraciones.
No se inspeccionó ni reutilizó Enterprise RLS. No se amplió la arquitectura de
eventos ni se levantaron supresiones de objetos administrados o de histórico.

## Límites de la aceptación

Todo lo ejecutado fue source-only, sin iniciar servidores, workers, PostgreSQL,
Redis, ClickHouse, migraciones o servicios externos. No hubo pruebas físicas ni
inspección de sesiones. PG0, PG1 y exact-upgrade continúan bloqueados.

Se demuestra la denegación cuando el contrato vigente de permisos observa la
revocación/eliminación; no se introduce atomicidad global entre cambio de
permisos, cache y transporte, ni se retractan datos ya entregados. No se validó
físicamente el ciclo SSE/Redis/DI ni la propagación real de invalidaciones de cache.
Estos límites no se presentan como aceptación operacional.

## Estado Git final

Git se usó exclusivamente en lectura. No hubo staging, commits, push, cambio de
rama u otra mutación de Git. El diff global incluye cambios preexistentes: no es
el diff exclusivo de R3. `git diff --stat` no cuenta archivos untracked.

Inventario completo y diff global registrados a continuación.

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
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_R3.md
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1A_REMEDIATION.md
?? packages/twenty-server/src/engine/api/graphql/workspace-query-runner/listeners/__tests__/entity-events-to-db.listener.spec.ts
?? packages/twenty-server/src/engine/core-modules/event-logs/event-logs-distribution.spec.ts
?? packages/twenty-server/src/engine/core-modules/event-logs/event-logs-live.resolver.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/inconnect-record-event-publication.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/__tests__/record-event-consumer-revocation.spec.ts
?? packages/twenty-server/src/engine/core-modules/inconnect-record-access/utils/collect-record-event-payload-dependencies.util.ts
?? packages/twenty-server/src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/compute-event-select-query-builder.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts
?? packages/twenty-server/src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util.ts
```

```text
 ...-query-runner.internal-write-provenance.spec.ts | 132 +++++++++--------
 .../listeners/entity-events-to-db.listener.ts      |  67 +++++----
 .../event-logs/event-logs-live.resolver.ts         | 128 +++++++++++++++--
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
 23 files changed, 1067 insertions(+), 142 deletions(-)
```

`git diff --cached --stat`: vacío; 0 archivos staged.
