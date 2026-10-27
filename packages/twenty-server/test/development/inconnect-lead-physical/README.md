# Lead Management — arnés físico en preparación SOURCE-ONLY

## Actualización PHYS-P2 — 2026-10-27

Checkpoint P1 actual: `0fc4a3114dde9f1b6c57c76948b562de0dfe3ada`.
Se añade un adaptador nativo PROBE_ONLY con entradas bloqueadas, máquina de
estados, protocolo acotado, pidfd y pruebas con filesystem/spawn/señales simulados.
Ver [PHYS-P2.md](./PHYS-P2.md) y el [plan A0 actualizado](./PHYS-A0.md).
La primera autorización física excluye PostgreSQL e initdb. No hay promoción
entre capacidades. El inventario Core/Workspace permanece intacto y bloqueado.

Las secciones siguientes conservan la preparación P1 como historial. Sus
limitaciones sobre ausencia de implementación nativa describen P1; P2 añade
código nativo sin ejecutarlo ni acreditar aislamiento/lifecycle físicamente.

## Preparación PHYS-P1 conservada

Fecha: 2026-10-27, America/Mexico_City. Base revisada:
`c67d3bd4ddb6d8c417b97ec57bc06cd3df619d54`, rama
`feature/inconnect-lead-management`, worktree/staging inicialmente limpios.
MVP aceptado: `f164bf937a5260983778dbca8a3a8e833b2e1bde`.

Esta carpeta es infraestructura de pruebas de desarrollo, sin registro Nest/Nx,
upgrade, worker ni import desde producto. No modifica la aceptación del MVP.
El informe de viabilidad previo está en la conversación del usuario; no se
encontró un archivo de informe que sea requisito de esta preparación.

## Estado y límites

| Afirmación                                      | Estado                                  |
| ----------------------------------------------- | --------------------------------------- |
| Contratos y launcher de planificación inerte    | Preparados en PHYS-P1                   |
| Validación unitaria                             | Ver evidencia local y entrega de cierre |
| Supervisor live, observadores kernel y guardian | No implementados                        |
| Aislamiento acreditado físicamente              | NO                                      |
| PostgreSQL/Redis iniciados por esta preparación | NO                                      |
| Fixture instalado / MVP probado físicamente     | NO / NO                                 |
| PG0/PG1, C5, exact-upgrade                      | BLOCKED; sin modificaciones             |

`launcher.ts` exporta una fachada de biblioteca; no es un comando ejecutable.
No lee argv, process.env, archivos ni sockets al importarse. `--describe` es un
argumento de una función pura, no una CLI instalada. Cualquier otra petición
y `requirePhysicalExecution()` rechazan incondicionalmente. Ningún JSON,
variable, flag de autorización ni resultado MATCH desbloquea la ejecución.

No se importan utilidades PG0/PG1 ni componentes de producto. Sólo node:path,
node:crypto y Zod, además de módulos de esta carpeta. Se reutilizan las ideas
de identidad independiente y fail-closed; no sus rutas de ejecución.

## Contratos implementados

- `contracts.ts`: configuración estricta y acotada; root, base y rol derivados
  del UUID exclusivo; namespaces user/net/mount/PID distintos del host; cluster
  distinto al excluido; ejecutables/PID/start ticks/hash; observaciones de rutas.
- `environment.ts`: rechazo de entorno heredado, incluso URLs vacías; entorno
  candidato nuevo con ambas URLs PostgreSQL y ambas Redis explícitas. Comparación
  de credenciales con hashes del manifiesto, Core/Raw/Workspace/réplica y opciones
  que prohíben DDL automático; requiere Redis para el futuro bootstrap Nest.
- `supervisor.ts`: arrays de argumentos sin shell para un probe bwrap y servicios
  futuros. No contiene spawn/exec ni instalación, señales, borrado o conexiones.
  Recursos y límites son propuestas; `limitsEnforced=false`,
  `lifecycleEnforced=false`. No hay watcher, reinicio o fallback de aislamiento.
- `observations.ts`: comparaciones de perímetro, sesión SQL y cleanup contra
  manifiesto. El cluster inicial usa `postgres`; la sesión de aplicación exige
  la base exclusiva. Redis es opcional en A0 para evitar arrancarlo innecesariamente.
  La comparación de cleanup enlaza inventario de creación, observaciones actuales
  y conjunto final, y nunca concede permiso de borrado.

Los manifiestos y observaciones son datos no autenticados. Una etiqueta de origen,
un hash coherente, arrays vacíos o JSON que pasa Zod no prueban origen, completitud,
frescura ni barreras kernel. El futuro observador deberá obtener esas propiedades
de recursos y procesos que el supervisor haya adquirido realmente. La identidad
esperada no se construirá con el resultado SQL comparado.

La representación de procesos usa PID y start ticks observados desde el supervisor
host; un PID SQL interno no se identifica con un PID del host. El observador deberá
correlacionar NSpid/procfs y namespaces de **cada** proceso/conexión. La pureza de
estas funciones no acredita esa correlación ni evita TOCTOU por sí misma.

## Diseño del perímetro pendiente

Un cluster creado de cero con initdb tendrá data, socket, secretos y HOME bajo
la raíz privada registrada, montada como `/lm`. El candidato bwrap crea sus propios
mount namespace y user/net/PID/IPC/UTS namespaces. No monta `/home`, `/etc`, el
directorio de datos PostgreSQL habitual ni sockets del host. `/tmp` y `/run` son
privados; la red no tendrá interfaces/rutas externas. Únicamente loopback privado.
No se inspeccionó ni alteró el bind mount de reparación de WSL.

El array termina en `/usr/bin/true`: es un candidato de probe, sin servicio árbol
implementado. Un exit 0 de ese probe tampoco acreditaría aislamiento. Disponibilidad
de binarios o probes históricos no sustituyen pruebas actuales A0.

Faltan revisión de runtime mounts `/usr`, `/lib`, `/lib64`, capacidades/UID mapping,
private procfs, loopback, IPv4/IPv6, sockets abstractos y filesystem. El futuro
supervisor debe acreditar bibliotecas/ejecutables, ausencia de sockets/secretos
alcanzables, y que sus montajes no cambian el host. No usar `--ro-bind / /`,
host networking, veth, proxies ni sockets Docker. Fallar si no puede acreditarse.

Falta implementar contención del árbol, límites agregados y lifecycle ante salida
normal, timeout, SIGTERM, muerte abrupta y reinicio. `--die-with-parent` solo no
acredita esas propiedades. No se asigna identidad real de supervisor a un JSON
autodeclarado; el manifiesto fija una identidad candidata bwrap que deberá
revisarse contra el diseño live elegido, sin confundirla con su proceso interno.

No hay borrado recursivo ni señales automáticas. El futuro collector debe fijar
handles de directorio, rechazar symlinks/montajes ajenos y proteger cada operación
contra sustitución de paths e inode/PID reuse. La comparación de strings/inodos
no autoriza `rm -rf`. Root y secretos requerirán permisos privados, propietario
correcto y creación exclusiva, sin reutilizar directorios preexistentes.

## Precedencia y barrera antes de bootstrap

En Twenty: process.env explícito precede a `.env.test` con NODE_ENV=test, o `.env`
en otro modo; ambos loaders Core/Raw usan override:false. Omitir una réplica o una
URL Redis permite fallback. Workspace usa TwentyConfigService; PG y Redis están
declarados env-only. El candidato deja deshabilitada configuración general en DB,
manteniendo Record Access en modo database y autoridad real de políticas/caches.

El futuro exec se construirá desde una allowlist, no con spread de process.env.
Dotenv, pgpass/service files y HOME del host estarán ocultos. Las URLs candidatas
contienen secretos y sólo podrán pasar por un canal privado a procesos internos;
no serializar el retorno de buildApplicationEnvironmentCandidate en evidencia.
La evidencia mostrará únicamente proveedor, host/puerto, base/rol y huellas no
secretas. Diagnósticos del contrato nunca incluyen input, password ni URL completa.

La barrera kernel debe estar acreditada **antes de importar/inicializar** Nest,
Core/Raw DataSources o Workspace. TypeORM puede instalar extensiones aun con
synchronize=false y migrationsRun=false. CompareEffectiveConfiguration exige
también installExtensions=false y dropSchema=false en todos los candidatos,
sin opciones extra. El producto actual no implementa ese adaptador específico;
no se modificó para hacerlo pasar. Se necesita revisar un bootstrap de prueba
que conserve auth/ORM reales y capture opciones antes del primer connect.

El helper general test/integration/utils/create-app.ts incorpora JobsModule y
MessageQueueModule.registerExplorer: no se reutiliza automáticamente. No usar
AppModule a ciegas, database:init/reset, setup-dev-env.sh, synchronize ni el runner
general de migraciones para completar el fixture. Si una dependencia exige un
gate bloqueado, detener esa ruta y reportarla, sin cambiar flags ni historia.

## Inventario de fixture y orden de instalación

[dependency-inventory.json](./dependency-inventory.json) fija SHA-256 de 44 fuentes
existentes y el commit revisado. Es un inventario de raíces identificadas, **no un
cierre transitivo completo ni un instalador**: fixtureStatus=BLOCKED,
completeEntityClosure=false, executableInstallation=false. Comprobar existencia
y hashes antes de preparar A1. No importar las entidades para descubrirlas aquí.

| Orden propuesto, después de A0   | Invariantes y dependencias pendientes                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline Core                    | Esquema actual con enums, defaults, índices, FKs y cierre de entidades revisado; extensiones/funciones explícitas según uso real. Sin historia de upgrades fabricada.                                                             |
| Workspace/identidad/aplicaciones | User, Workspace, UserWorkspace, Application, Roles, sesiones. Workspace fuera de creación exige defaultRoleId y databaseSchema; el ciclo Workspace/Role/Application necesita lifecycle OSS válido, no INSERTs mínimos inventados. |
| Metadata y esquemas dinámicos    | ObjectMetadata, FieldMetadata, IndexMetadata/IndexFieldMetadata, WorkspaceMember y Lead. SyncableEntity hereda workspaceId, applicationId, universalIdentifier y sus restricciones; no omitirlos.                                 |
| Permisos humanos                 | RoleTarget tiene exactamente un tipo de principal; ObjectPermission, FieldPermission y RolePermissionFlag. Usuario/UserWorkspace/WorkspaceMember activos y coherentes, con sesión auténtica para C.                               |
| Record Access                    | Configuration → ManagedObject → Policy; referencias compuestas Role/Object/Field y Owner MANY_TO_ONE al WorkspaceMember de ese workspace. Redis generation/fencing y publicación válida; no fallback ENV.                         |
| Teams, si aplica                 | Team/membership workspace-isolated, una membresía activa por miembro y un Coordinator activo por Team según índices parciales; membresía no cambia Role. Sin dependencia Team para allRecords/ownRecords.                         |
| Store                            | DDL existente propuesto de operaciones y readiness real sobre catálogo; PK, UNIQUE, CHECK, FKs RESTRICT. No se instala ni registra en P1.                                                                                         |
| Runtime                          | Common Update real, preprocesamiento/hooks, permisos, SQL Record Access/Owner, manager/runner originales, buffer de eventos; después DI, GraphQL y navegador.                                                                     |

El orden es de dependencias/lifecycle, no un script lineal de DDL/DML ya revisado.
Dos workspaces sintéticos tendrán metadata, esquemas, identidades y políticas
independientes; IDs del test no serán constantes de producto. Lead/Owner/table
se derivarán de metadata viva. Ninguna tabla simplificada representa a Twenty.

TwentyStandardApplicationService sincroniza mediante ApplicationService, caches
y WorkspaceMigrationValidateBuildAndRunService, y calcula todos sus mapas;
no constituye un generador offline mínimo. Usarlo o crear metadata requiere
autorización posterior y revisión del conjunto real de acciones/efectos. La
implementación del fixture se detiene aquí: no se ejecutó ni copió su lógica.

Bloqueos concretos: cierre Core (Workspace/User tienen muchas relaciones), baseline
actual instalable sin migración amplia, lifecycle Workspace/Role/Application,
metadata estándar y física consistente, bootstrap de caches y closure DI sin
workers ajenos. El fixture parcial pre-5698 de PG0 no resuelve estos bloqueos.
No inspeccionar/copiar/importar Enterprise RLS para completarlos. Cualquier
dependencia de ese tipo se reporta y detiene, no se elimina para hacer pasar tests.

## Validación permitida

Jest dedicado no extiende configuraciones compartidas: sin setup/global hooks,
dotenv, plugins Lingui, Nest, Nx ni integración DB. Una suite por invocación con
--runInBand, evidencia y cache bajo `.cache/lead-phys-p1-20261027/` ignorado.
La suite import-safety intercepta imports de filesystem, procesos, red, workers,
drivers y bootstrap, además de señales/exit/fetch. No ejecuta el launcher.

Ejemplo de una invocación SOURCE-ONLY (con entorno del runner saneado):

```bash
node node_modules/jest/bin/jest.js \
  --config packages/twenty-server/test/development/inconnect-lead-physical/jest.config.cjs \
  --runInBand --runTestsByPath \
  packages/twenty-server/test/development/inconnect-lead-physical/__tests__/configuration.spec.ts \
  --cacheDirectory .cache/lead-phys-p1-20261027/jest-cache \
  --json --outputFile .cache/lead-phys-p1-20261027/configuration-tests.json
```

Repetir únicamente para observations.spec.ts e import-safety.spec.ts, cada uno
con prefijo de evidencia propio. El tsconfig dedicado comprueba sólo este arnés;
no emite archivos. Nuevos archivos se verifican también con lint directo porque
lint:diff-with-main no incluye untracked. Ningún test del MVP se vuelve a auditar.

Cada comando conserva identidad de fuentes, stdout/stderr, exit, JSON, boot ID,
uptime y memoria antes/después. No sobreescribir intentos anteriores ni contar
ejecuciones interrumpidas como PASS. Ante reboot detenerse, sin reanudación,
cleanup ni reinicio de infraestructura automáticos.

Siguiente documento: [PHYS-A0.md](./PHYS-A0.md). Ninguna aceptación de P1 habilita A0.
