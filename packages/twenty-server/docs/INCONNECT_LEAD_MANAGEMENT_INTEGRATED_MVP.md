# INCONNECT Lead Management — MVP integrado de selección explícita

Fecha de entrega inicial: 2026-10-26. Actualización de remediación: 2026-10-27.
Entrega **SOURCE-ONLY**, sin despliegue ni activación.

## Remediación focal N1/N2 — 2026-10-27

La auditoría independiente del 27 de octubre cerró F1, F2 y F4, y mantuvo F3/F5
pendientes únicamente por N1/P2 y N2/P2. Esta entrega corrige esos dos defectos y
acredita sus comprobaciones SOURCE-ONLY. No rediseña el distribuidor ni declara
aceptación independiente del MVP, despliegue o activación.

Preflight READ-ONLY: rama `feature/inconnect-lead-management`, HEAD
`0c5936907b61ff1989ffac566e9fb6e036bb6d26`, **6 tracked modificados,
35 untracked, 0 staged**. Se conservaron los cambios anteriores. Las nuevas
pruebas se añadieron a archivos existentes; el inventario de archivos permanece
igual. No se modificaron AGENTS.md, DDL propuesto, metadata GraphQL, descarte de
conexión, contratos compartidos, Common Update, Record Access, Commercial Teams,
Owner Integrity, motor 1B-1A, Messaging/Attention ni Folio ISO.

### N1: separar lectura de recuperación e incertidumbre de escritura

Causa: `recover` asignaba el ID intentado a `knownOperationId` antes de recibir
una operación válida; `unresolved` interpretaba cualquier ID conocido como una
escritura incierta. Un UUID inválido, NOT_FOUND o error de transporte de una
consulta sin mutaciones anteriores dejaba congelada la selección.

El hook distingue ahora:

| Estado                     | Significado y efecto                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recoverId` del componente | Texto que el operador intenta consultar; no congela la selección por sí mismo.                                                                                             |
| `knownOperationId`         | ID canónico acreditado por una respuesta válida de operación o preview. No constituye incertidumbre transaccional por sí solo.                                             |
| `intention`                | Payload exacto del preview pendiente de confirmación/reconciliación. Se conserva ante respuesta incierta.                                                                  |
| `pendingOperationId`       | Operación cuyo execute/cancel no tiene todavía resultado acreditado; sólo una respuesta de la misma operación puede reconciliarla.                                         |
| `operation`                | Estado/progreso acreditado. PREVIEW/RUNNING bloquean una selección alternativa; los terminales permiten una nueva selección explícita cuando no queda escritura pendiente. |

Una lectura fallida no crea `intention` ni `pendingOperationId`, no cambia el ID
acreditado y no borra selección o progreso confirmados. Si no existe escritura
pendiente ni operación activa, consultar Leads, modificar la selección y comenzar
otra intención vuelven a estar disponibles. Las funciones del hook también
protegen reset/selección ante escrituras pendientes; no dependen únicamente del
estado disabled del componente.

La recuperación válida verifica origen e ID consultado, respetando la
normalización UUID del backend, y exige la intención u operación original cuando
hay una escritura pendiente. Una respuesta de otra operación no sustituye esa
identidad. No se reintentan transferencias por fallar una lectura: la continuación
requiere confirmación humana y usa el `expectedVersion` recuperado. El rechazo
definitivo de preview de F3 conserva su comportamiento corregible.

`LeadPoolWorkspace.tsx` mantiene separado el texto de consulta y consume
`unresolved`; no requirió modificación. El cambio de producto está limitado a
`hooks/useLeadPool.ts`. El mutex de peticiones y los controles de destinatarios
aceptados anteriormente se conservan.

Se añadieron **8 pruebas permanentes N1** a `LeadPoolWorkspace.test.tsx`, con hook
y componentes React reales y transporte controlado: UUID malformado, NOT_FOUND,
lectura temporal fallida, recuperación correcta, UUID en mayúsculas/canónico,
progreso confirmado conservado, preview incierto seguido de lecturas fallidas o
ajenas y reconciliación correcta, y ejecución incierta que continúa con la versión
recuperada sin volver a confirmar la versión ya consumida. Las suites completas
de UI incluyen además las regresiones de rechazo definitivo y respuesta perdida
de F3, los tres modos y la selección existente.

### N2: contrato cerrado de constraints

Causa: readiness sólo exigía encontrar PK/UNIQUE/CHECK/FK esperados. No examinaba
si otras filas del catálogo agregaban restricciones que rechazaban operaciones
legítimas, como hash de longitud 63 o unicidad global por actor.

Se revisaron el DDL propuesto y la proyección real de `ready()` en
`lead-pool-store.service.ts`: la consulta ya recoge todas las filas de
`pg_constraint` de la tabla con tipo, columnas, validación/diferibilidad,
definición y validez del índice de identidad. No fue necesario cambiar SQL,
Store transaccional ni el DDL para ocultar los contraejemplos.

`lead-pool-storage-layout.ts` exige ahora ambas condiciones: todos los constraints
esperados deben existir y **cada constraint recibido debe pertenecer al conjunto
reconocido**. Se conservan PK(id), UNIQUE(workspaceId, actorUserId, intentionId),
los CHECKs de hash de longitud 64/estado objeto y las dos FKs RESTRICT de la
propuesta. Se comparan tipo y columnas, y las definiciones normalizadas de
CHECK/FK, sin usar nombres arbitrarios de constraints. La normalización preserva
el contenido de literales SQL: `'o bject'` no puede convertirse en `'object'`.

Se admiten duplicados de una restricción exactamente reconocida: no reducen las
operaciones válidas. Un constraint desconocido, incompatible, no validado o
diferible no se descarta de la comprobación; produce NOT_READY. Esto es una
política conservadora para una tabla nueva de contrato cerrado, no un evaluador
general de equivalencia SQL. Los índices auxiliares ordinarios fuera de
`pg_constraint` no se rechazan sólo por existir. Las comprobaciones previas de
updatedAt, tipos, nullability, defaults, PK/UNIQUE e índices de identidad continúan.

Se añadieron **10 pruebas permanentes N2** a `lead-pool-storage-layout.spec.ts`:
CHECK incompatible, UNIQUE extra sobre actor, CHECK false, FK adicional,
exclusión no prevista, literal SQL distinto, duplicados reconocidos/nombres
arbitrarios, índice auxiliar inocuo y constraints adicionales diferibles/no
validados. Los casos rechazados comprueban que el Store no adquiere un runner ni
invoca la transferencia. Las regresiones existentes cubren layout completo,
instalación parcial, updatedAt/tipos, fallos SQL y drift posterior con rollback.

### Cuatro contraejemplos originales: antes y después

La evidencia independiente disponible en `.cache/lead-final-audit-20261027/` se
usó sin modificar sus fuentes, configuraciones ni expectativas. Se reprodujeron
los cuatro fallos antes de la corrección; las salidas nuevas se guardaron en otra
carpeta ignorada, sin sobrescribir la evidencia original.

| Contraejemplo                             | Antes                     | Después                              |
| ----------------------------------------- | ------------------------- | ------------------------------------ |
| N1: `invalid-uuid` sin mutaciones previas | FAIL, `before-n1`, exit 1 | PASS, `after-audit-ui-final`, exit 0 |
| N1: UUID válido con NOT_FOUND             | FAIL, `before-n1`, exit 1 | PASS, `after-audit-ui-final`, exit 0 |
| N2: CHECK adicional de longitud 63        | FAIL, `before-n2`, exit 1 | PASS, `after-audit-server`, exit 0   |
| N2: UNIQUE adicional sobre actor          | FAIL, `before-n2`, exit 1 | PASS, `after-audit-server`, exit 0   |

### Evidencia focal final y estabilidad

Evidencia en **`.cache/lead-n1-n2-remediation-20261027/`**. Cada prefijo conserva
comando/metadatos, stdout, stderr, `.exit`, boot ID, uptime, memoria/swap antes y
después, y JSON Jest cuando corresponde. `resume-status.md` es el resumen
incremental y `final-results.json` consolida conteos, identidades y hashes.

| Conjunto final                                  | Prefijo                | Suites |    PASS |  FAIL |  Exit |
| ----------------------------------------------- | ---------------------- | -----: | ------: | ----: | ----: |
| UI y recuperación afectadas                     | `regression-ui-final`  |      2 |      31 |     0 |     0 |
| Store/readiness afectadas                       | `regression-store`     |      3 |      41 |     0 |     0 |
| UI independiente sin cambiar expectativas       | `after-audit-ui-final` |      1 |       7 |     0 |     0 |
| Servidor independiente sin cambiar expectativas | `after-audit-server`   |      1 |      22 |     0 |     0 |
| **Total único de este alcance**                 |                        |  **7** | **101** | **0** | **0** |

Las 18 pruebas permanentes nuevas están incluidas en las 72 pruebas del
repositorio; no se suman de nuevo. Las ejecuciones focales y las repeticiones
necesarias durante el ajuste de correlación UUID tampoco se acumulan. Las suites
finales de la tabla no omitieron pruebas. Los fallos iniciales de los cuatro
contraejemplos se conservan como evidencia antes de la reparación, no se cuentan
como fallos de la ejecución final.

Typechecks completos de frontend (`type-frontend-final`) y servidor
(`type-server`): PASS, exit 0. Typed lint limitado a los dos archivos afectados de
cada paquete (`lint-frontend-final`, `lint-server`): PASS, exit 0 y sin warnings.
Formato de los cuatro archivos (`format-source-check-final`): PASS, exit 0. El
formato documental y whitespace/inventario de cierre se acreditan en
`document-format-check` y `final-whitespace`, incluidos en el informe final.
No se repitieron las 428 pruebas generales ni codegen/diff lint: sus superficies
no cambiaron y este cierre es exclusivamente N1/N2.

Boot ID inicial/final de esta ejecución:
`9814242c-895b-4400-bb5c-15245b20c8ca`. No hubo reinicios. Una sola validación a
la vez, Jest `--runInBand`, límites de threads/heap y resultados persistentes.
No se inició infraestructura ni se efectuaron escrituras Git.

### Límites retenidos y siguiente control

Los resultados son SOURCE-ONLY. React, TypeORM y pg-pool recorren código real
con fronteras de I/O simuladas; no acreditan PostgreSQL físico, DDL instalado,
queries de catálogo ejecutadas sobre un clúster real, locks/MVCC, HTTP/DI completa
ni E2E de navegador. Las pruebas físicas siguen requiriendo autorización e
islamiento específicos. NORMAL/MESSAGE_PENDING continúa NOT_READY y Repartir
TODOS deshabilitado. La siguiente auditoría debe ser estrictamente focal N1/N2,
sin reabrir F1/F2/F4 ni iniciar otra fase.

Archivos cambiados en esta remediación: `hooks/useLeadPool.ts`,
`manual-pool/lead-pool-storage-layout.ts`, `LeadPoolWorkspace.test.tsx`,
`lead-pool-storage-layout.spec.ts` y este documento. El estado Git se conserva en
**6 tracked modificados / 35 untracked / 0 staged**, misma rama y HEAD; no hubo
commit, despliegue ni activación.

## Checkpoint anterior F1–F5: validaciones previas a N1/N2

La evidencia de las siguientes secciones corresponde a las fuentes anteriores a
esta remediación focal. El total histórico de 25 suites / 428 PASS no se presenta
como una nueva ejecución de las fuentes N1/N2; la evidencia vigente del alcance
modificado está en la sección precedente.

La auditoría independiente de la entrega inicial emitió **REQUIRES REMEDIATION**.
Las reparaciones de los cinco hallazgos están implementadas y sus validaciones
SOURCE-ONLY concluyeron. El veredicto de aceptación sigue pendiente de una nueva
auditoría independiente. Esta entrega no declara el MVP aceptado, instalado,
desplegado ni listo para producción. Se completó el cierre con autorización
expresa, una comprobación a la vez y evidencia persistente; no se reinició el
entorno ni se repitió automáticamente la batería al perder una sesión.

Preflight de esta reanudación: misma rama `feature/inconnect-lead-management` y
HEAD `0c5936907b61ff1989ffac566e9fb6e036bb6d26`; **6 tracked modificados,
35 untracked, 0 staged**. Se conservaron los archivos de entrada. Git fue de
sólo lectura. No se inició PostgreSQL, Redis, servidor Nest, workers ni servicios
externos. El escáner de dependencias de Nest se ejecutó dentro de Jest, sin
instance loader de la aplicación ni lifecycle de arranque de infraestructura.

### Reparaciones implementadas

| Hallazgo y causa                                                                           | Reparación conservada                                                                                                                                                                                                                                                                           | Evidencia actual                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| F1/P1: el módulo sólo estaba en `ModulesModule`, fuera del árbol incluido por `/metadata`. | `MetadataEngineModule` importa `LeadManagementModule`; el registro anterior en `ModulesModule` se retiró. El scope `metadata` y los guards originales permanecen. Se exporta el provider existente de miembros desde Record Access y se elimina su duplicación local.                           | Focal PASS: 1 suite / 1 prueba, exit 0.                        |
| F2/P1: un fallo de rollback se silenciaba antes de liberar normalmente el cliente.         | El Store distingue finalización confirmada de COMMIT/ROLLBACK incierto y descarta la conexión incierta mediante un adaptador acotado al driver instalado. Conserva la reconciliación primaria del servicio.                                                                                     | Focal PASS: 1 suite / 6 pruebas, exit 0.                       |
| F3/P2: un preview rechazado conservaba una intención congelada sin permitir corregir.      | Señal explícita y correlacionada de rechazo cuando la intención está ausente y el rollback se confirma; corrección de formulario y nueva selección seguras. Errores genéricos o de red conservan la identidad para recuperación. Cuotas locales y protección contra dos peticiones simultáneas. | Focales: 14 PASS, incluidos en las regresiones completas PASS. |
| F4/P2: una operación recuperada podía ejecutarse sin identificar sus destinos.             | La respuesta incluye intención, IDs originales, etiquetas actuales autorizadas, asignabilidad y `canExecute`. La UI no depende de nombres locales y bloquea continuación sin destinos identificables.                                                                                           | Focales: 11 PASS, incluidos en las regresiones completas PASS. |
| F5/P2: readiness no exigía `updatedAt` ni todo el contrato estructural.                    | Lectura de columnas y catálogo PostgreSQL con decoder estructural; ausencia, incompatibilidad o fallo SQL producen NOT_READY. El drift posterior sigue sujeto al rollback transaccional.                                                                                                        | Focal PASS: 1 suite / 19 pruebas, exit 0.                      |

F1 recorre imports/providers reales mediante `DependenciesScanner` y
`BaseExplorerService`, antes de construir el fragmento de schema del distribuidor
con los resolvers descubiertos. Verifica descubrimiento único del módulo y su
resolver, seis operaciones, scope/guards declarados, provider de miembros único,
registros de Messaging y Record Access, y valida los seis documentos frontend
contra ese fragmento. El archivo de schema descubierto se conserva en
`.cache/lead-remediation/closure-discovered-schema.graphql`. Esto no acredita DI
completa de la aplicación, resolución HTTP de guards/contexto ni el schema
completo servido por un endpoint desplegado. El codegen focal offline pasó con
la salida de este descubrimiento y generó los seis documentos dentro de la
carpeta ignorada, sin consultar `/metadata` por red ni editar generados globales.

F2 usa `discard-lead-pool-connection.ts`: en TypeORM **0.3.31**,
`releasePostgresConnection(error)` existe en el runtime aunque sea privado en
sus declaraciones TypeScript. El adaptador comprueba `PostgresQueryRunner` y
mantiene esa dependencia explícita. La implementación instalada elimina el
runner, retira el listener y pasa el error al callback de liberación;
**pg-pool 3.6.2** elimina/termina el cliente en lugar de dejarlo idle. Las pruebas
usan QueryRunner TypeORM, `GlobalWorkspaceDataSource`, buffer de eventos y
`pg-pool` reales, sustituyendo sólo el cliente de transporte sin abrir sockets.
Verifican rollback confirmado, fallo previo al envío, fallo durante rollback,
release posterior idempotente, cliente terminado/no reutilizable, siguiente
conexión sana, commit confirmado y commit ambiguo antes/después de aplicarse.
Un COMMIT incierto no se convierte en rollback confirmado ni anuncia sus eventos
como confirmados. Las regresiones integradas del servicio también pasaron para
reconciliación del resultado persistido, ExpectedVersion e idempotencia sin
admitir otro lote por repetir una versión consumida. Se trata de I/O simulado,
no de prueba física de commit ambiguo o locks multiproceso. Una actualización de TypeORM/pg requiere revisar este adaptador y
su prueba de compatibilidad; no es una API pública estable garantizada.

F3 comprueba ausencia bajo locks de origen e intención y contempla una intención
persistida para el mismo usuario con otra identidad histórica de miembro. Sólo
un rollback confirmado permite emitir `leadPoolPreview` con rechazo, razón e
intención correlacionados. El hook reconoce esa señal estructurada, no textos
arbitrarios de error. Timeout, fallo de red, respuesta perdida o error sin esa
prueba conservan la intención exacta. Recuperar una operación de otra intención
no reemplaza silenciosamente la intención pendiente. El backend conserva la
validación final de cuotas y autoridad. Las focales F3 y las suites completas
backend/frontend pasaron con exit codes conservados. Los logs antiguos perdidos
no se usan para acreditar el cierre actual.

F4 conserva los IDs planificados y resuelve etiquetas bajo la autoridad vigente.
La consulta puede mantener el progreso de la propia operación sin divulgar
nombres no legibles; destinos eliminados/inactivos o etiquetas no disponibles
bloquean nuevos cambios. `canExecute` es una señal de presentación, no una
capacidad: confirmar vuelve a validar autoridad, metadata, destinos y versión.
No se usan nombres previos a la recarga ni los destinos del formulario actual.

F5 verifica tabla/esquema, tipo de relación, ausencia de RLS en esta tabla Core,
las nueve columnas propuestas, tipos nativos, NOT NULL, defaults `now()` de
createdAt/updatedAt y ausencia de columnas adicionales obligatorias sin default.
Comprueba PK y UNIQUE de intención no diferibles/validados, con índices válidos,
listos, únicos y sin predicado/expresión; también los CHECKs y FKs RESTRICT de la
propuesta. El índice auxiliar actor/createdAt es una ayuda de rendimiento, no
una garantía de identidad. No existe marcador fiable de versión de instalación.
El chequeo es conservador y no instala ni repara el esquema. Las pruebas simulan
las filas de catálogo y el transporte SQL, incluyendo el contraejemplo original
sin updatedAt, incompatibilidades y drift después de readiness con rollback.
La consulta de catálogo y la representación física de constraints/defaults aún
requieren validación contra PostgreSQL autorizado; no se ejecutó DDL físico.

### Evidencia final persistida y conteo único

Cada comprobación se ejecutó secuencialmente, con Jest `--runInBand`, recursos y
boot ID registrados antes/después. Los lints focales finales utilizaron dos
threads. Por prefijo se conservan `.stdout.log`, `.stderr.log`, `.exit`,
`.meta.json`, `.before.json`, `.after.json` y, para Jest, `.jest.json` en
`.cache/lead-remediation/`, ignorado por Git. El comando exacto y los límites
aplicados están en cada `.meta.json`. El resumen incremental es `resume-status.md`;
la consolidación final es `closure-final-results.json`.

| Conjunto final                                                             | Prefijo                             | Suites |    PASS | FAIL / omitidas |  Exit |
| -------------------------------------------------------------------------- | ----------------------------------- | -----: | ------: | --------------: | ----: |
| Backend Lead Management completo                                           | `closure-a1-backend`                |      9 |     121 |           0 / 0 |     0 |
| Frontend Lead Management completo                                          | `closure-a2-frontend`               |      2 |      23 |           0 / 0 |     0 |
| Planificador aceptado 1B-1A                                                | `closure-a3-planner`                |      3 |      76 |           0 / 0 |     0 |
| Record Access, Commercial Teams, permisos, Owner Integrity y Common Update | `closure-a4-security-common-update` |     11 |     208 |           0 / 0 |     0 |
| **Total único**                                                            |                                     | **25** | **428** |       **0 / 0** | **0** |

El baseline de 21 suites / 379 PASS es histórico. Las 51 focales acreditadas
(F1: 1, F2: 6, F3: 14, F4: 11, F5: 19) están contenidas en estos conjuntos y
**no se suman nuevamente**. La repetición necesaria de las dos suites ajustadas
por errores de tipado (`closure-b1-affected-test-regression`, 2 suites / 7 PASS,
exit 0) sustituye su evidencia para las fuentes finales y tampoco aumenta el
total. La deduplicación utiliza archivo, nombre completo y ordinal dentro de los casos
parametrizados con título repetido; NaN/Infinity/null pueden imprimir el mismo
título sin ser la misma invocación. No se colapsan esas entradas distintas.

| Calidad / integración                                           | Evidencia final                                                             | Resultado                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Typecheck completo server                                       | `closure-b1-type-server-final`                                              | PASS, exit 0                                                     |
| Typecheck completo frontend                                     | `closure-b2-type-frontend`                                                  | PASS, exit 0                                                     |
| Contrato compartido, comprobación estricta focal                | `closure-b3-shared-contract`                                                | PASS, exit 0                                                     |
| Typed lint frontend, 13 archivos explícitos                     | `closure-b4-lint-frontend-final`                                            | PASS, exit 0; 0 warnings                                         |
| Typed lint shared, 2 archivos explícitos                        | `closure-b5-lint-shared`                                                    | PASS, exit 0; 0 warnings                                         |
| Typed lint server, 23 archivos explícitos                       | `closure-b6-lint-server-final`                                              | PASS, exit 0; 0 warnings                                         |
| Formato focal de fuentes                                        | `closure-b7-format-source`                                                  | PASS, exit 0                                                     |
| Whitespace tracked/untracked previo a edición documental        | `closure-b8-whitespace`                                                     | PASS, exit 0                                                     |
| Grafo metadata, seis operaciones/documentos y guards declarados | `closure-a1-backend`, actualizado por `closure-b1-affected-test-regression` | PASS, exit 0                                                     |
| Codegen focal offline del schema descubierto                    | `closure-c1-codegen`                                                        | PASS, exit 0                                                     |
| Diff lint server                                                | `closure-c2-diff-lint-server`                                               | PASS, exit 0                                                     |
| Diff lint frontend                                              | `closure-c3-diff-lint-frontend`                                             | PASS, exit 0                                                     |
| Inventario de artefactos GraphQL                                | `closure-c4-graphql-artifacts`                                              | PASS, exit 0; seis documentos, sin cambios en generados globales |

El formato del documento y el whitespace/inventario posteriores a esta edición
se registran al finalizar como `closure-d2-document-check` y
`closure-d3-final-whitespace-inventory`. Los resultados y códigos de salida de
cierre quedan incluidos en `closure-final-results.json`.

Los targets Nx de diff lint se ejecutaron sin dependencias ni cache de tarea;
comparan `main...HEAD`. Por eso no sustituyen al typed lint explícito de los
archivos locales y untracked. No se inició ningún build/setup de infraestructura.
Los typechecks usaron `tsgo --noEmit --incremental false` con los tsconfigs reales
de server/frontend. El contrato compartido fue comprobado también de manera
focal con `--strict`; no se afirma haber ejecutado un typecheck global de todo
`twenty-shared`.

### Incidencias de validación resueltas

El primer typecheck server falló con diagnóstico persistido en
`closure-b1-type-server`; el siguiente aisló un último error en
`closure-b1-type-server-recheck`. Se corrigieron únicamente el import del
BaseExplorer instalado (extensión `.js`), el narrowing del provider descubierto
antes de construir el schema y el tipo del callback de release en la prueba de
pg-pool. No se añadió un resolver manual al SchemaFactory ni se sustituyó el
pool real de la prueba. Las dos suites afectadas volvieron a pasar.

La declaración compilada del contrato compartido era anterior a F3/F4. Se
regeneró sólo `packages/twenty-shared/dist/types/InconnectLeadManagement.d.ts`,
artefacto ignorado, mediante `closure-b1-shared-contract-refresh`; no se editaron
manualmente declaraciones generadas ni se regeneraron paquetes completos.
Esto eliminó el desfase de `intentionId`, etiquetas y `canExecute` consumidos
por los typechecks reales. Una instalación limpia debe compilar las dependencias
compartidas antes de verificar sus consumidores.

El lint frontend inicial (`closure-b4-lint-frontend`) señaló la regla general
`twenty/no-state-useref` sobre el bloqueo síncrono que evita dos solicitudes antes
del siguiente render. Se documentó una excepción local de esa regla: el ref es
un mutex de peticiones, mientras `busy` sigue siendo estado React para la UI.
No se eliminó esa protección ni se alteró su comportamiento. Tras este cambio
exclusivamente de comentario, el typed lint y el formato pasaron; no fue necesario
repetir typecheck o tests de comportamiento. No se modificó ninguna regla global.
Los intentos fallidos de calidad conservan sus logs/exit codes y no se reportan
como PASS. Ninguna suite Jest falló durante el cierre actual. El intento de formatear
Markdown con oxfmt (`closure-d1-format-document`, exit 2) no procesó el archivo
porque la configuración excluye `.md`. El documento se formateó y comprobó
posteriormente con Prettier, sin alterar esa configuración.

### Estabilidad y límites de ejecución

Boot ID inicial y final del cierre: `9814242c-895b-4400-bb5c-15245b20c8ca`.
No hubo reinicios durante las focales F3/F4 ni durante las comprobaciones generales
de cierre. `closure-start.json` conserva uptime, memoria, swap y hashes iniciales;
los snapshots por comando y `closure-final-results.json` conservan la evidencia
posterior. Sólo se admitió una validación a la vez mediante lock de orquestación.

Los reinicios anteriores siguen siendo hechos históricos; sus causas no se
atribuyen a OOM, Windows o WSL sin evidencia. La observación de arranque anterior
permanece en `reboot-observation-2026-10-27.json`. No se utilizó `/tmp` como única
ubicación de resultados ni se reinició automáticamente una batería al retomar.

### Archivos y límites de esta remediación

Wiring: `engine/metadata-modules/metadata-engine.module.ts`, el export de
`InconnectWorkspaceMemberService` en el módulo Record Access,
`lead-management.module.ts` y retiro del registro anterior en `modules.module.ts`
(este último ya coincide con HEAD y no aparece como tracked modificado).
Store/adaptador: `lead-pool-store.service.ts`,
`discard-lead-pool-connection.ts` y `lead-pool-storage-layout.ts`.
Preview/recuperación: `lead-pool.service.ts`, `lead-pool-contract.ts`,
`lead-pool-authority.service.ts`, contrato compartido `InconnectLeadManagement.ts`,
hook `useLeadPool.ts` y componentes `LeadPoolWorkspace`, `LeadPoolStrategy` y
`LeadPoolResult`. Pruebas: cuatro specs nuevas `lead-pool-discovery`,
`lead-pool-store`, `lead-pool-storage-layout`, `lead-pool-recovery`, ajustes de
fixtures/API/state y ampliación de `LeadPoolWorkspace.test.tsx`.

Se conserva la implementación del distribuidor explícito, sus tres modos,
idempotencia, ExpectedVersion, cancelación, Common Update y controles existentes.
No se inició otra fase. No se modificó el motor 1B-1A ni WhatsApp/Attention/Folio.
El catálogo genérico sigue sujeto a autoridad por objeto; una delimitación
exclusiva a Leads exige una decisión de producto/autorización independiente y
no se amplió automáticamente la capacidad de transferencia.

La evidencia SOURCE-ONLY final está completada; falta una auditoría independiente
focal de F1–F5. La instalación revisada y la prueba física aislada necesitan autorización
específica, aislamiento aceptado y validación real de constraints, locks, commit
ambiguo, reconciliación, eventos y HTTP/E2E. Esta actualización no concede esos
permisos ni declara aceptación operacional.

## Estado y preflight de la entrega inicial (histórico)

Preflight anterior a la primera edición: rama `feature/inconnect-lead-management`,
HEAD `0c5936907b61ff1989ffac566e9fb6e036bb6d26`, worktree limpio y staging vacío.
Ese commit registra R4 (`add accepted source-only tracked inbound integration R4`).
No había cambios de WhatsApp sin registrar que separar. No se modificó AGENTS.md,
el planificador 1B-1A, Attention, Record Access, permisos o Commercial Teams.
Git se utilizó exclusivamente en lectura durante toda esta entrega.

Se revisaron el contrato y los archivos completos del planificador, el facade de
Record Access, resolución de políticas y Teams, validación de escrituras/Owner
Integrity, membresías, permisos estándar, Common Update con transacción del
caller, metadata dinámica, lectura CRM, resolvers y navegación/listas/acciones
masivas OSS. No se inspeccionó Enterprise RLS.

La entrega implementa este recorrido con código de producto:

```text
Navegación Twenty → /inconnect-lead-management → catálogo autorizado
  → consulta SQL con filtros, conteo y paginación autorizados
  → selección explícita → destinatarios autorizados → estrategia sin categorías
  → preview persistido → confirmación de un lote
  → revalidación → Common Update ordinario → COMMIT de cambios y resultados
  → progreso guardado / siguiente lote / consulta / cancelación
```

**No se ha instalado la nueva tabla.** No se consultó PostgreSQL para averiguar
su estado real. El código comprueba su disponibilidad cuando se invoca el API;
si falta o no puede acreditar PK/UNIQUE no diferibles, bloquea preview/ejecución.
Las pruebas sustituyen I/O; no prueban locks, MVCC, durabilidad o persistencia
física. La integración Nest completa, HTTP/navegador y los eventos después del
commit requieren validación física autorizada antes de una activación.

## Selección y modos efectivos

El origen se elige entre objetos administrados con metadata compatible y permisos
actuales de lectura y transferencia. No hay un identificador de Lead fijo en
producto ni un nombre de tabla inferido desde el cliente. El operador elige el
objeto de Leads que reconoce en la metadata de su workspace. La infraestructura
es genérica: también podría ofrecer otro objeto administrado si la autoridad
vigente permite su transferencia. Cada operación afecta exclusivamente al objeto
que el operador eligió; no sincroniza Owners de objetos relacionados.

Se requiere una etiqueta canónica `TEXT` legible y una relación Owner
`MANY_TO_ONE → workspaceMember` acreditada por la política actual. Un origen sin
estas condiciones queda fuera del catálogo. No se intenta adivinar o crear su
metadata.

| Modalidad                         | Estado y contrato                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SINGLE explícito                  | Implementado: toda la selección a un destinatario autorizado.                                                                            |
| EVEN explícito                    | Implementado: cuotas floor/ceil sobre el conjunto seleccionado, conserva Owners cuando es viable; no balancea carteras históricas.       |
| MANUAL_QUOTAS explícito           | Implementado: cantidades enteras por destinatario, suma no mayor que el pool; deja restantes separados.                                  |
| NORMAL/MESSAGE_PENDING            | NOT_READY; no se consulta ni se inventa ninguna categoría.                                                                               |
| Todos los resultados de un filtro | Deshabilitado con razón visible. Falta materializar una selección masiva estable en servidor y aceptar su recuperación y escala físicas. |

`planExplicitLeadPool` es un contrato separado de **pool no categorizado**. Ordena
IDs canónicos, reserva asignaciones conservables y llena cuotas de forma
determinista. No invoca `buildLeadDistributionPlan`, no le pasa NORMAL ficticio,
no modifica su contrato y no transforma cuotas explícitas en cuotas de Messaging.

La lista carga 50 filas por página; el backend admite páginas de hasta 100. El
botón **Seleccionar primeros 50 elegibles** vuelve a consultar el prefijo ordenado
autorizado del servidor. Puede haber 1,000 o más coincidencias consultables sin
cargarlas todas en el navegador. Añadir página e indicadores individuales permiten
construir una selección explícita de hasta **1,000 registros por operación**.
Ese límite de selección no es un límite de resultados. El procesamiento es de
**1–100 registros por confirmación**, valor inicial 50. No existe un botón que
prometa repartir todos pero sólo procese 50.

## Filtros y equivalencias de Salesforce

Los campos se obtienen de metadata activa y permisos actuales. La UI muestra los
IDs lógicos y etiquetas permitidos, nunca columnas o tablas físicas. El backend
resuelve y valida cada filtro y cada ordenamiento otra vez.

| Operación                                         | Implementación                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propietario actual                                | Igualdad sobre el Owner acreditado por política; el selector muestra destinatarios activos visibles, por lo que no es un directorio de Owners históricos. |
| Búsqueda                                          | ILIKE parametrizado sobre la etiqueta canónica TEXT legible; escapa comodines del texto.                                                                  |
| Estado / clasificación                            | EQ/NEQ sobre campos SELECT existentes; valida valores contra sus opciones vigentes.                                                                       |
| Indicador booleano, por ejemplo Edenred si existe | EQ/NEQ sobre BOOLEAN existente, con valores `true`/`false` estrictos.                                                                                     |
| Fecha de intento / IU si existe                   | EQ/NEQ/BEFORE/AFTER sobre DATE o DATE_TIME existente.                                                                                                     |
| Condiciones combinadas                            | Hasta diez condiciones AND; búsqueda y propietario se añaden con AND.                                                                                     |
| Orden                                             | Campo escalar legible elegido por metadata, dirección ASC/DESC, NULLS LAST y desempate por UUID ASC. Sin campo elegido, UUID ASC.                         |

No se ha acreditado físicamente que el workspace real contenga Estado, Edenred,
Tipo de registro o Fecha IU: no hay autorización de inspección PostgreSQL. Las
fuentes revisadas no proporcionan un contrato autoritativo de esos campos del
workspace actual. No se hardcodearon equivalencias, IDs de Salesforce, nombres
de personas ni record types. Los campos ausentes/no legibles no aparecen. Los
campos de tipos no soportados se rechazan. `NEQ` conserva semántica SQL: un valor
NULL no se incluye automáticamente como "distinto".

La paginación de consulta utiliza offset y un orden estable, no un snapshot
congelado entre páginas. Las altas/cambios concurrentes pueden mover resultados.
El preview congela los IDs explícitamente seleccionados y sus Owners/versiones;
la ejecución vuelve a comprobar el filtro sobre cada registro.

## Autoridad y destinatarios

Se admiten únicamente sesiones humanas ordinarias activas de Twenty. SYSTEM,
API keys, aplicaciones y humanos ligados a una aplicación se rechazan; no se
elimina la aplicación de un principal para ampliar su autoridad.

La autorización exige:

1. Usuario, WorkspaceMember y UserWorkspace coherentes y vigentes en el workspace.
2. Role actual resuelto por las primitivas estándar; lectura y modificación del
   objeto, lectura y modificación del Owner y lectura de la etiqueta canónica.
3. Política INCONNECT aplicable, no ambigua, con transferencia permitida.
4. Record Access en el SQL final de consulta, conteo, selección y revalidación.
5. Owner Integrity y alcance de destino mediante el validador existente.
6. WorkspaceMember de destino activo/asignable, User/UserWorkspace vigentes y Role
   disponible; Team actual cuando la política requiere autoridad de Teams.
7. Permiso estándar de lectura del objeto workspaceMember y de su nombre antes
   de publicar nombres de destinatarios.

No se conceden permisos por una etiqueta textual de Role. Ejecutivo/Coordinador
con `ownerTransferPolicy = denied` no reciben un origen transferible. Supervisor
/Admin siguen sujetos a sus permisos y políticas actuales. No se introdujo un
nuevo permiso que conceda lectura de Messaging.

Se comparan definiciones vivas de metadata con las del ORM. Se rechazan drift de
Owner, etiqueta, workspace, aplicación, tipos, configuración o destino de la
relación. La huella de autoridad incluye Role/permiso de objeto, decisión de
política, Teams requeridos y definiciones relevantes. Su cambio invalida el
preview aunque el cambio amplíe autoridad. Un destino desactivado o que deje de
ser asignable también bloquea la confirmación.

Se conservan las garantías y límites de la autoridad/cache existente de Twenty e
INCONNECT: no se inventa atomicidad global entre una revocación externa,
invalidación de cache y commit. Antes de activar hay que verificar físicamente
esas carreras con los escritores de seguridad vigentes. Esta entrega no cambia
sus protocolos de publicación o bloqueo.

## Preview, intención y API

El backend produce y persiste el preview. El navegador envía selección y
preferencias; nunca envía un plan con autoridad de escritura. Se informa:
encontrados, seleccionados, autorizados al preparar, cambios reales previstos,
conservados, restantes, cantidades por destinatario, resultados individuales
actualmente visibles y progreso confirmado. Los bloqueos globales de autoridad,
metadata o destinos rechazan el preview completo con un error; no se construye
un plan parcial con registros inaccesibles.

Identidad durable: `(workspaceId, actorUserId, intentionId)` y UUID de operación.
También se conserva el WorkspaceMember del actor. Misma intención y mismo payload
normalizado recuperan el resultado original; otro payload produce conflicto.
No se elimina el registro de idempotencia al expirar la ejecución.

El preview vence a las 24 horas; se puede consultar o cancelar después, pero no
seguir transfiriendo. La caducidad no sustituye la revalidación actual. La UI
conserva la intención ante una respuesta incierta. Un rechazo explícito,
correlacionado y con ausencia/rollback acreditados permite corregir el formulario;
un error sin esa prueba conserva la identidad para recuperación explícita.

Superficie metadata GraphQL:

| Operación                    | Argumentos                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `inconnectLeadPoolCatalog`   | Ninguno; workspace y actor autenticados.                                                             |
| `inconnectLeadPoolRecords`   | `input: JSONObject!`: objectId, filter, first, offset.                                               |
| `previewInconnectLeadPool`   | `input`: intentionId, objectId, recordIds, recipientIds, mode, quotas opcionales, filter, batchSize. |
| `inconnectLeadPoolOperation` | `input`: operationId.                                                                                |
| `executeInconnectLeadPool`   | `input`: operationId, expectedVersion.                                                               |
| `cancelInconnectLeadPool`    | `input`: operationId, expectedVersion.                                                               |

Las respuestas son JSONObject con contratos TypeScript compartidos en
`twenty-shared/types/InconnectLeadManagement`. Zod rechaza campos desconocidos,
UUID inválidos, duplicados normalizados, cuotas incompatibles y versiones fuera
de límites. No acepta workspace, actor, Role, Team, schema, tabla, columna,
categoría, `all`, `balanceBy: CATEGORY` ni un plan fabricado.

Se añadió la carpeta de operaciones al descubrimiento metadata de codegen. La
validación/codegen focal se ejecuta **offline contra el schema creado por Nest
con el resolver real**, sin llamar a `/metadata`. Los TypedDocumentNode usan los
contratos compartidos de payload; no se editaron los archivos generados globales.
La regeneración/verificación del schema completo desplegado queda pendiente del
entorno autorizado, junto con la prueba HTTP de guards y DI completa.

## Transacciones, resultados, auditoría y recuperación

El almacén crea un WorkspaceQueryRunner **master**, READ COMMITTED, con manager
original y begin/commit/rollback/release propios. No crea otro EntityManager para
el Core. Sólo el registro operativo se escribe mediante SQL Core parametrizado.
La escritura CRM utiliza `CommonUpdateManyQueryRunnerService.executeWithQueryRunner`
con el AuthContext humano y metadata actuales. El payload deliberado contiene
únicamente el Owner en formato connect; las primitivas normales conservan
preprocesamiento, hooks de auditoría, permisos de campo, Record Access y eventos.

Orden principal de locks: advisory transaccional por workspace/origen → operación
FOR UPDATE → registros autorizados FOR UPDATE, en orden canónico → validación
final y locks SHARE de miembros/UserWorkspace/User. El locator de operación se
lee sin lock para derivar el origen; después se relee la operación bajo lock.
La creación/repetición de preview intercala el lock de intención autenticada
entre origen y operación; este orden también serializa la misma intención entre
orígenes distintos. Los locks
finales de miembros se adquieren después de las consultas del facade, que usa
sus propias comprobaciones cortas de vigencia. Los timeouts de lock/statement
son locales a la transacción (2 s / 10 s por sentencia).

Antes de cada cambio se exige el Owner y `updatedAt` originales. El token de
versión es texto PostgreSQL, conserva microsegundos y no se redondea a Date JS.
La selección final conserva Record Access y el filtro. El UPDATE ordinario
incluye además el ID y Owner esperado en su predicado, junto con los controles
del ORM. No hay un SELECT global seguido de filtrado en memoria.

| Resultado | Significado                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CHANGED   | El cambio y su resultado fueron confirmados en el mismo lote.                                                                                   |
| UNCHANGED | El registro conserva el Owner previsto; no se emite un UPDATE deliberado.                                                                       |
| CONFLICT  | Un registro todavía accesible cambió de Owner o versión. No se sobrescribe.                                                                     |
| REJECTED  | No satisface actualmente la selección autorizada; puede estar eliminado, fuera del filtro o inaccesible. No revela cuál de esas causas ocurrió. |
| FAILED    | El lote agotó tres intentos fallidos reconciliados; esos registros no se transfirieron.                                                         |
| REMAINING | Fuera de las cuotas o cancelado antes de procesarse.                                                                                            |
| PENDING   | Todavía no procesado; no es un éxito.                                                                                                           |

Los registros, cambios y estado/resultados del lote comparten transacción. Un
fallo revierte el lote completo, conservando lotes anteriores. Se conserva un
historial de versiones de lote COMMITTED/ROLLED_BACK y diagnóstico seguro; no se
publican errores SQL crudos. Tras tres fallos del mismo lote se marcan FAILED.
Cada nuevo intento requiere confirmación humana; no hay bucle de reintentos ni
worker nuevo.

`expectedVersion` funciona como identidad de continuación: repetir una versión
ya consumida devuelve el estado guardado y **no procesa otro lote**. Un COMMIT de
respuesta incierta se reconcilia mediante lectura primaria bajo los mismos locks
antes de registrar fallo o admitir otro intento. Si no se puede reconciliar,
se responde indisponible y se conserva la identidad; no se repiten transferencias
a ciegas. La UI permite recuperar por UUID tras recargar y continuar con la
versión devuelta. No guarda datos CRM ni autoridad en localStorage/sessionStorage.

Los previews activos reservan registros pendientes frente a otra operación del
distribuidor. Los escritores CRM ordinarios siguen operando y provocan conflicto
por Owner/versión. Dos operaciones distintas por origen se serializan por lote.
La cancelación adquiere el lock de operación, conserva cambios confirmados y
convierte sólo pendientes a REMAINING. No deshace lotes anteriores ni interrumpe
un lote que ya está dentro de su transacción.

La auditoría propia conserva actor, workspace, miembro, intención, payload,
Owner/versiones anteriores, destinatarios previstos y resultado por registro y
lote. Los eventos/auditoría ordinarios siguen su lifecycle de commit. Los IDs de
resultados individuales se vuelven a filtrar mediante SQL autorizado; pueden
ocultarse después de una transferencia que retire el registro del scope del
actor. Los contadores históricos describen exclusivamente su propia operación.

## Límites y trabajo físico pendiente

- TODOS sigue bloqueado: no hay snapshot/materialización arbitraria de filtros,
  cola masiva ni recuperación física aceptada para un volumen no acotado.
- La recuperación implementada cubre selección explícita de hasta 1,000 IDs;
  requiere la tabla propuesta, el mismo clúster/transacción para Core y Workspace,
  y validación física independiente. No se afirma aceptación operacional.
- El preview y su registro se persisten al invocar la mutación; esto no cambia
  Owners hasta una confirmación. Una intención cuya respuesta se pierde se
  recupera enviando exactamente la misma intención, sin ampliar selección.
- No hay directorio histórico de operaciones ni descubrimiento automático tras
  recarga: se recupera mediante el ID mostrado, o repitiendo la misma intención
  mientras la página todavía la conserva. No se inventó retención/purge/borrado
  de workspace; las FKs propuestas son RESTRICT.
- No hay bloqueo global de escritores ajenos al distribuidor. Se detectan cambios
  mediante el Owner/versión esperado y el scope SQL ordinario.
- No se usa WhatsApp Attention, contenido Messaging, Pending legacy, Unread,
  teléfono ni matching. NORMAL/MESSAGE_PENDING requiere autoridad persistida y
  aprobación separada de divulgación. C2/B2/C no se iniciaron.
- No hay transferencia indirecta de Folios ni escrituras de Conversation,
  Message, Pending, Unread o Favorites. No se modificaron esos módulos.
- No se modificaron políticas/Roles/Teams ni datos reales, y no se creó un bypass.
- El DDL es un script propuesto; no es una migración ejecutada ni un comando de
  upgrade registrado. Requiere revisión, empaquetado/instalación autorizados y
  pruebas físicas de FKs, UNIQUE, locks, rollback, commit ambiguo, dos procesos y
  eventos reales. Las restricciones PG0/PG1/Stage C5/exact-upgrade siguen intactas.
- Para probar en Twenty: preparar un entorno físicamente autorizado, instalar el
  esquema revisado, verificar metadata/permisos/Owner/etiqueta del origen real,
  compilar frontend/backend y comprobar schema/DI/HTTP y UI reales. El acceso es
  desde la navegación lateral o `/inconnect-lead-management`. Nada de ello se
  ejecutó sobre un workspace real en esta entrega.

## Evidencia de validación inicial (histórica; no acredita remediación)

Resultados finales únicos, sin sumar reejecuciones:

| Conjunto                                                  | Suites |    PASS | FAIL / omitidas |
| --------------------------------------------------------- | -----: | ------: | --------------: |
| Backend Lead Management nuevo                             |      5 |      83 |           0 / 0 |
| Planificador 1B-1A sin cambios                            |      3 |      76 |           0 / 0 |
| UI, hook de transporte y filtros                          |      2 |      12 |           0 / 0 |
| Regresiones Record Access, Teams, permisos estándar y ORM |     11 |     208 |           0 / 0 |
| **Total**                                                 | **21** | **379** |       **0 / 0** |

Los tamaños 0, 1, 49, 50, 51, 100 y 1,000 recorren preview y ejecución acotada.
Las pruebas nuevas cubren SINGLE, EVEN, cuotas/restantes, preview/confirmación,
Owner y microsegundos de versión cambiados, destino inactivo, permiso revocado,
Team movido, metadata/Role inválidos, workspace/actor cruzados, selección
inaccesible, registro eliminado, deduplicación, doble ejecución concurrente,
solapamiento, fallo entre lotes, rollback y reanudación, COMMIT de respuesta
perdida, tres fallos terminales, cancelación y ausencia de dependencias Messaging.
Se prueban el schema/resolver real, SQL TypeORM real sin abrir conexión, el facade
real de Record Access en SQL, autorización real con repositorios/cache simulados,
Common Update `run` real con su límite ORM simulado y los componentes/hook reales
con transporte Apollo simulado. Las regresiones existentes cubren además los
builders/controles comunes. **El harness serializa transacciones simuladas: la
prueba concurrente no acredita locks multiproceso ni PostgreSQL físico.**

Las primeras ejecuciones detectaron un fixture de Teams inconsistente, la
expectativa de guards desactualizada y la necesidad de aria-label explícito en
los botones Twenty. Se corrigieron y las ejecuciones finales no tienen fallos.
Las comprobaciones de tipos detectaron también `Array.at` en un fixture del
servidor; se sustituyó por indexación compatible con su target.

Typecheck completo `tsgo --noEmit --incremental false`: servidor y frontend PASS.
Typed lint focal explícito: servidor y frontend PASS, sin warnings. También se
comprueban los dos archivos compartidos. Ambos targets Nx `lint:diff-with-main`
PASS, sin dependencias y sin cache de tarea; revisan `main...HEAD`, por lo que se
complementan con lint explícito de archivos locales/untracked. Formato focal y
whitespace tracked/untracked se verifican al cierre.

Comandos ejecutados (Node local v24.16.0 añadido al PATH):

```bash
node_modules/.bin/jest --config packages/twenty-server/jest.config.mjs --runInBand packages/twenty-server/src/modules/inconnect-lead-management --json --outputFile=/tmp/lead-mvp-backend-tests.json
node_modules/.bin/jest --config packages/twenty-front/jest.config.mjs --runInBand packages/twenty-front/src/modules/inconnect-lead-management/__tests__ --json --outputFile=/tmp/lead-mvp-ui-tests.json
node_modules/.bin/tsgo -p packages/twenty-server/tsconfig.json --noEmit --incremental false
node_modules/.bin/tsgo -p packages/twenty-front/tsconfig.json --noEmit --incremental false
node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies --skip-nx-cache
node_modules/.bin/nx run twenty-front:lint:diff-with-main --excludeTaskDependencies --skip-nx-cache
node_modules/.bin/graphql-codegen --config /tmp/lead-mvp-codegen.cjs
git diff --check
```

Codegen focal PASS: seis operaciones, contra `/tmp/lead-management-schema.graphql`
generado por `GraphQLSchemaFactory` con el resolver real; salida de validación en
`/tmp/lead-management-generated.ts`. No hubo llamada al endpoint ni regeneración
global manual. Los contratos de payload de producto son compartidos.

Las once regresiones son `inconnect-record-access-write-values`,
`inconnect-record-access.service`, `inconnect-record-access-authorization.service`,
`inconnect-commercial-team.service`, `workspace-select-query-builder.inconnect-record-access`,
`inconnect-standard-write-permissions`, `internal-write-provenance-permissions`,
`workspace-update-query-builder.events`, `common-update-many-query-runner.internal-write-provenance`,
`get-objects-permissions-from-role-permission-config.util` y
`compute-permission-intersection.util`, cada una con su sufijo `.spec.ts`.

Logs/JSON temporales `/tmp/lead-mvp-*`: backend-tests, ui-tests, regressions,
typecheck-server/front, lint-server/front, diff-lint-server/front, codegen,
format y whitespace. El reinicio del entorno interrumpió una tanda anterior de
validaciones y eliminó sus logs; las ejecuciones finales se repitieron completas
de una en una. No se cuentan procesos interrumpidos como PASS.

## Inventario inicial (histórico; sustituido por el estado de remediación)

Estado final: misma rama y HEAD de entrada; **5 archivos tracked modificados,
29 nuevos/untracked, 0 staged**. No se hizo commit, add, push, fetch, checkout ni
ninguna otra escritura Git. No hubo cambios preexistentes: el inventario de esta
entrega coincide con el worktree final.

Archivos principales: `manual-pool/lead-pool.service.ts` coordina la operación;
`lead-pool-authority.service.ts` resuelve autoridad; `lead-pool-query.service.ts`
construye SQL autorizado; `lead-pool-store.service.ts` persiste operaciones;
`lead-pool-contract.ts` decodifica; `plan-explicit-lead-pool.ts` planifica el pool;
`lead-management.module.ts` y resolver integran Nest. En frontend, Page,
Workspace, Filters, Strategy, Result, hook y GraphQL completan el recorrido.
El DDL propuesto es `sql/lead-pool-operation.proposed.sql`. Los únicos archivos
previos modificados registran ruta/navegación, módulo, descubrimiento codegen y
exportación de tipos compartidos.

Inventario completo (`git status --short --untracked-files=all`):

```text
 M packages/twenty-front/codegen-metadata.cjs
 M packages/twenty-front/src/modules/app/hooks/useCreateWorkspaceAppRouter.tsx
 M packages/twenty-front/src/modules/navigation/components/MainNavigationDrawerScrollableItems.tsx
 M packages/twenty-server/src/modules/modules.module.ts
 M packages/twenty-shared/src/types/index.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/__tests__/LeadPoolFilters.test.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/__tests__/LeadPoolWorkspace.test.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadManagementNavigationItem.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPool.styles.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolFilters.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolResult.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolStrategy.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolWorkspace.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/graphql/leadPoolOperations.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/hooks/useLeadPool.ts
?? packages/twenty-front/src/pages/inconnect-lead-management/InconnectLeadManagementPage.tsx
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-api.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-authority.fixtures.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-authority.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-query.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-state.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool.fixtures.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool.service.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/lead-management.module.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/lead-management.resolver.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-contract.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/plan-explicit-lead-pool.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/sql/lead-pool-operation.proposed.sql
?? packages/twenty-shared/src/types/InconnectLeadManagement.ts
```

`git diff --stat` (no incluye untracked):

```text
 packages/twenty-front/codegen-metadata.cjs                 |  1 +
 .../src/modules/app/hooks/useCreateWorkspaceAppRouter.tsx  | 14 ++++++++++++++
 .../components/MainNavigationDrawerScrollableItems.tsx     |  2 ++
 packages/twenty-server/src/modules/modules.module.ts       |  2 ++
 packages/twenty-shared/src/types/index.ts                  |  1 +
 5 files changed, 20 insertions(+)
```

`git diff --cached --stat`: vacío. AGENTS.md, distribución 1B-1A y módulos
WhatsApp/Folio/Record Access/Commercial Teams sin modificaciones.

## Inventario Git al cierre de remediación

Misma rama y HEAD de entrada: `feature/inconnect-lead-management`,
`0c5936907b61ff1989ffac566e9fb6e036bb6d26`. **6 tracked modificados,
35 untracked, 0 staged.** Ninguna escritura Git. AGENTS.md, planificador 1B-1A
y módulos Messaging/Folio sin modificaciones. El cambio de Record Access se
limita al export del provider ya existente para evitar duplicación; no se
modificaron sus políticas, Roles, Teams ni la lógica de autorización.

```text
 M packages/twenty-front/codegen-metadata.cjs
 M packages/twenty-front/src/modules/app/hooks/useCreateWorkspaceAppRouter.tsx
 M packages/twenty-front/src/modules/navigation/components/MainNavigationDrawerScrollableItems.tsx
 M packages/twenty-server/src/engine/core-modules/inconnect-record-access/inconnect-record-access.module.ts
 M packages/twenty-server/src/engine/metadata-modules/metadata-engine.module.ts
 M packages/twenty-shared/src/types/index.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/__tests__/LeadPoolFilters.test.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/__tests__/LeadPoolWorkspace.test.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadManagementNavigationItem.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPool.styles.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolFilters.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolResult.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolStrategy.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/components/LeadPoolWorkspace.tsx
?? packages/twenty-front/src/modules/inconnect-lead-management/graphql/leadPoolOperations.ts
?? packages/twenty-front/src/modules/inconnect-lead-management/hooks/useLeadPool.ts
?? packages/twenty-front/src/pages/inconnect-lead-management/InconnectLeadManagementPage.tsx
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-api.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-authority.fixtures.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-authority.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-discovery.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-query.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-recovery.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-state.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-storage-layout.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool-store.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool.fixtures.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/__tests__/lead-pool.service.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/lead-management.module.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/lead-management.resolver.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/discard-lead-pool-connection.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-contract.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-storage-layout.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/lead-pool.service.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/manual-pool/plan-explicit-lead-pool.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/sql/lead-pool-operation.proposed.sql
?? packages/twenty-shared/src/types/InconnectLeadManagement.ts
```

Los artefactos de evidencia, codegen focal y la declaración compartida compilada
son ignorados por Git; no se añaden al inventario de fuentes. No hubo despliegue,
activación, instalación PostgreSQL, DDL ni prueba HTTP/E2E. El siguiente paso es
una auditoría independiente focal; después, una prueba física con autorización
específica y aislamiento acreditado.
