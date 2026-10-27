# INCONNECT — operaciones, dependencias, upgrades y gates

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

## Autoridad y lectura de esta guía

Todos los comandos siguientes son referencias NO AUTORIZANTES. Git writes son
exclusivos del usuario; ni los ejemplos ni la autorización de edición permiten
a Codex ejecutarlos. Base/infraestructura/proveedores requieren autorización
específica y gates aceptados incluso para inspección read-only o CLI preview
que abra conexión. Nunca resetear un entorno existente.

Las secciones fechadas 2026-10-14 describen evidencia histórica; el estado vigente
es [Project Status](INCONNECT_PROJECT_STATUS.md). El checkpoint lifecycle del
15 de octubre superó sólo su condición de reconciliación documental, sin levantar
PG0/PG1/Stage C5/exact-upgrade. No hay adaptador live ni evidencia kernel nueva.

## Validación recuperable y dependencias

Ejecutar una validación a la vez, con recursos limitados y Jest --runInBand.
Conservar comando, fuentes/scope, stdout/stderr, exit, JSON cuando aplique,
boot ID y recursos antes/después, y resumen incremental. Tras interrupción,
comparar identidad/estado y validar evidencia antes de continuar; una sesión
perdida o logs incompletos no acreditan PASS. No reiniciar infraestructura ni
repetir automáticamente baterías completas. No elevar límites para ocultar fallos.

Usar runtime WSL/Linux y dependencias nativas correspondientes, versión declarada
por el repo y lockfile inmutable. No actualizar dependencias oportunistamente.
Revisar impactos de versiones en autorización, ORM, drivers y contratos; el
adaptador de descarte del MVP depende explícitamente de TypeORM/pg-pool y exige
revisión de compatibilidad tras un upgrade. Herramientas y versiones observadas
en checkpoints son evidencia fechada, no una autorización de instalación.

Antes de migraciones sensibles, preflight autorizado y auditoría Entity-to-DDL.
Registrar nuevos comandos en descubrimiento normal; no editar up/down ya
committed. Revisar código, locks, efectos y rollback, backups y restauración
por entorno antes de ejecutar. La aceptación source-only no sustituye esos gates.

## Referencias históricas y procedimientos vigentes


## Evidencia histórica 2026-10-14 — gates retenidos

This dated operational snapshot extends the historical 2026-10-12 product/runtime checkpoint below.
It governs F13 execution readiness; all existing licensing, security, authorization,
transaction, Messaging, and Record Access contracts remain in force.
Git and database state must be rechecked before action under the applicable authorization;
this documentation update performs no database inspection or physical execution.

### Product status and deployment boundary

- **IMPLEMENTED — F13A/B:** canonical phone resolution and automatic existing-record linking.
- **IMPLEMENTED / PHYSICALLY VERIFIED IN DEVELOPMENT — F13C.2B:** conditional fresh
  `NO_MATCH -> CRM create -> link` orchestration, physically accepted in disposable development PostgreSQL.
  This acceptance does not imply production activation, deployment, or environment provisioning.
- **PENDING — F13C.3:** deployment/migration preparation remains pending.
- **NOT ACTIVATED by this checkpoint:** no migration, principal provisioning, configuration activation,
  or deployment in normal local `default`, another environment, or production is asserted.
- Registered Fast Instance Commands: `1790793305698` (Auto Create Configuration) and
  `1790793305700` (Automation Principal); required order is **5698 before 5700**.
  Registration, local commits, and test success never authorize migration execution.
  Do not claim either command ran in normal local `default` or production without checking actual
  environment-specific tracking through a separately authorized inspection.

### Committed development preparation

- Exact-upgrade guards and writer-session verification tooling were committed locally:
  `ab6845a6489069db6663bc86c274e981e2478929` and `da8f1ab090805b2f89f5b12f105a24fddadbce59`.
- PG0 disposable physical-harness preparation was committed locally at
  `bd4b762e35b22c21cf5c57353eb5907d16df7c79`, adding exactly **16 files**.
  Its tests passed; its physical execution gate remains **BLOCKED**.
- The operational exact-upgrade executor also remains **BLOCKED**.
- Earlier documentation preflight matched branch `feature/inconnect-messaging` and HEAD
  `bd4b762e35b22c21cf5c57353eb5907d16df7c79`, with no tracked modifications or staged changes
  and exactly the 11 untracked lifecycle files described below. This is a snapshot, not a future guarantee.

### PG1 isolation evidence and limits

The following are reported results of earlier probes, not probes performed by this update:

- Rootless user/network/mount/PID namespaces work inside the normal Codex WSL sandbox.
- Private loopback and private procfs work.
- Minimal filesystem fencing hid the normal PostgreSQL socket and data directory for the
  inspected harmless workload; this is not blanket isolation acceptance for a database workload.
- Parent mounts and networking remained unchanged in successful probes.
- Supervised normal exit passed; a forced-timeout cleanup test passed.

Remaining limits and gates:

- Supervisor SIGTERM lifecycle acceptance remains incomplete.
- Automatic supervisor death propagation was not established.
- SIGKILL Stage D was not executed; guardian death recovery was not validated.
- Disposable PostgreSQL provisioning, session inspection, and physical command execution were not authorized.
- Successful namespace tests are not proof of a production-ready PostgreSQL supervisor.

### F13C.3B1 lifecycle tooling — SOURCE-ONLY IMPLEMENTATION COMPLETE

Exactly **11 source/test files** under
`packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/`
are accepted **ONLY as inert source-only development preparation** for a local development commit.
There is no live process adapter, no real filesystem evidence writer, and no physical lifecycle
acceptance. The tooling is not integrated into a live runner.

- **P1-A:** corrected and regression-tested.
- **P1-B:** corrected and regression-tested.
- **P1-C:** validated under the pure source contract; this does not establish kernel-backed identity authority.
- **P2-A:** historical reporting, current acceptance, and revocation reconciled.
- **P2-B:** malformed inventories fail closed while independently safe finalization continues.
- **P2-C:** kernel process identity, approved executable provenance, exec transitions, and partial
  acquisition are modeled separately.

Final independent review: **PASS_WITH_CONDITIONS**. Its only condition was documentation
reconciliation, satisfied by this checkpoint update. This supersedes the earlier M1-R failure,
pending P1-A/P1-B corrections, and pending M2 source review.

Latest reported validation: **4 focused Jest suites / 256 tests PASS**; server typecheck **PASS**;
targeted typed lint **PASS**; formatting and whitespace **PASS**; inert imports **PASS**.
These source-validation results were not rerun by this documentation update and do not authorize
physical lifecycle execution, PostgreSQL upgrades, or production activation.

### Execution boundary

- **BLOCKED:** Stage C5, PG1 physical execution, PG0 physical execution, and the operational
  exact-upgrade executor. Source tests and local commits do not lift these gates.
- Do not run Stage C or Stage D, enable PG1, provision disposable PostgreSQL, or inspect sessions
  without action-specific user authorization and satisfaction of the relevant acceptance gates.
- Do not run F13C Fast Commands 5698 or 5700, database setup/reset, or BullMQ consumers;
  do not modify normal PostgreSQL or change the current Codex WSL sandbox repair bind mount.
  This checkpoint grants no execution permission.
- Fixture IDs, local Workspace/Role IDs, and cluster identities are temporary evidence,
  never permanent product constants. Normal local `default` and disposable targets remain distinct.

## Key Commands

All examples below are references subject to the execution warning and action-specific authorization.

### Development
```bash
# Start development environment (frontend + backend + worker)
yarn start

# Individual package development
npx nx start twenty-front     # Start frontend dev server
npx nx start twenty-server    # Start backend server
npx nx run twenty-server:worker  # Start background worker
```

### Testing

Prefer source-only focused tests. Integration tests with DB reset require explicit authorization for that reset and target.

```bash
# Preferred: run a single test file (fast)
npx jest path/to/test.test.ts --config=packages/PROJECT/jest.config.mjs

# Run all tests for a package
npx nx test twenty-front      # Frontend unit tests
npx nx test twenty-server     # Backend unit tests
npx nx run twenty-server:test:integration:with-db-reset  # Integration tests with DB reset
# To run an individual test or a pattern of tests, use the following command:
cd packages/{workspace} && npx jest "pattern or filename"

# Storybook
npx nx storybook:build twenty-front
npx nx storybook:test twenty-front

# When testing the UI end to end, click on "Continue with Email" and use the prefilled credentials.
```

### Code Quality
```bash
# Linting (diff with main - fastest, always prefer this)
npx nx lint:diff-with-main twenty-front
npx nx lint:diff-with-main twenty-server
npx nx lint:diff-with-main twenty-front --configuration=fix  # Auto-fix

# Linting (full project - slower, use only when needed)
npx nx lint twenty-front
npx nx lint twenty-server

# Type checking
npx nx typecheck twenty-front
npx nx typecheck twenty-server

# Format selected files
npx nx format:write --files=path/to/file.ts,path/to/other-file.ts

# Check formatting without writing
npx oxfmt --check path/to/file.ts path/to/other-file.ts
```

### Build
```bash
# Build packages (twenty-shared must be built first)
npx nx build twenty-shared
npx nx build twenty-front
npx nx build twenty-server
```

### Database Operations

Setup, reset, initialization, migration, and migration generation require action-specific authorization; listing them here grants none.

```bash
# Database management
npx nx database:reset twenty-server         # Reset database
npx nx run twenty-server:database:init:prod # Initialize database
npx nx run twenty-server:database:migrate:prod # Run instance commands (fast only)

# Generate an instance command (fast or slow)
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
```

### Database Inspection (Postgres MCP)

The repository includes a read-only Postgres MCP configuration in `.mcp.json`. Only when that MCP is available in the current runtime and the specific database inspection is authorized, use it to:
- Inspect workspace data, metadata, and object definitions while developing
- Verify migration results (columns, types, constraints) after running migrations
- Explore the multi-tenant schema structure (core, metadata, workspace-specific schemas)
- Debug issues by querying raw data to confirm whether a bug is frontend, backend, or data-level
- Inspect metadata tables to debug GraphQL schema generation issues

Do not assume the MCP is available. When it is, treat it as read-only; for authorized write operations (reset, migrations, sync), use the CLI commands above.

### GraphQL
```bash
# Generate GraphQL types (run after schema changes)
npx nx run twenty-front:graphql:generate
npx nx run twenty-front:graphql:generate --configuration=metadata
```

### Database & Upgrade Commands
- **PostgreSQL** as primary database
- **Redis** for caching and sessions
- **ClickHouse** for analytics (when enabled)
- When changing entity files, an **instance command** is required; run its generator only with action-specific authorization (`database:migrate:generate --name <name> --type <fast|slow>`)
- **Fast** instance commands handle schema changes; **slow** ones add a `runDataMigration` step for data backfills
- **Workspace commands** iterate over all active/suspended workspaces for per-workspace upgrades
- Commands use `@RegisteredInstanceCommand` and `@RegisteredWorkspaceCommand` decorators for automatic discovery
- Include both `up` and `down` logic in instance commands
- Never delete or rewrite committed instance command `up`/`down` logic
- See `packages/twenty-server/docs/UPGRADE_COMMANDS.md` for full documentation

## Dev Environment Setup

For explicitly authorized environment setup, dev environments (Codex web, Cursor, local) use one script:

```bash
bash packages/twenty-utils/setup-dev-env.sh
```

This script starts Postgres + Redis (auto-detecting local services versus Docker), creates databases, copies `.env` files, and initializes the database schema by running migrations on a fresh database. It is designed to be idempotent, but repeated runs can still start services, create resources, modify files/data, or run migrations. Each invocation requires action-specific user authorization for its target and possible side effects; idempotence does not make it harmless validation.

- `--docker` — force Docker mode (uses `packages/twenty-docker/docker-compose.dev.yml`)
- `--down` — stop services
- `--reset` — wipe data and restart fresh
- **Skip the setup script** for source-only tasks, including architecture questions, code review, documentation, and focused source validation. Prefer Jest, TypeScript, lint, and formatting without starting services or databases.

**Note:** CI workflows (GitHub Actions) manage services via Actions service containers and run setup steps individually — they don't use this script.

## Registro de comandos: cadena base y extensión C2

La cadena base siguiente es la reportada en octubre antes de C2, no el total
actual universal. I-B añade en fuente el Fast `1792540800000`,
`CreateInconnectMessagingAttentionLedgerFastInstanceCommand`, registrado para
2.32.0 después de 5698/5700. Ver [I-B](INCONNECT_ATTENTION_ADAPTER_C2_I_B.md).
Registro no implica instalación; no se ha acreditado ejecución física de C2.
La tabla propuesta del distribuidor no es un comando registrado ni instalado.

### Messaging Instance Command Registration

The required Messaging upgrade chain is registered and discoverable by the normal upgrade runner, not merely present in the filesystem. Registered Fast commands are:

- Transport Spine — `1788982508902`
- Webhook Projection — `1789040000000`
- Template Intent — `1789473600000`
- Inbound Attachments — `1789682400000`
- Outbound Uploads — `1789768800000`
- Conversation Work State — `1790006024000`
- CRM Context Fields — `1790010000000`
- Phone Identity Fields — `1790550000000`
- Auto Create Configuration — `1790793305698`
- Automation Principal — `1790793305700`

The registered Slow command is Webhook Backfill — `1789040000001`. Current registration inspection found ten Messaging Fast Instance Commands, the one existing Messaging Slow Instance Command, and the existing Workspace Command in the normal provider discovery. The real upgrade mechanism groups and orders all Fast commands in the Fast sequence, then all Slow commands in the Slow sequence, then workspace commands; Slow is not interleaved globally with Fast by timestamp. The missing registrations previously identified for Webhook Projection Fast, Webhook Backfill Slow, and Outbound Upload Fast were corrected before this checkpoint. Permanent rule: every new Messaging Instance Command must be registered so that the normal upgrade runner can discover it.

The F13C commands are `2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration.ts`, implemented by `AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand`, and `2-32-instance-command-fast-1790793305700-add-inconnect-messaging-automation-principal.ts`, implemented by `AddInconnectMessagingAutomationPrincipalFastInstanceCommand`. Both are registered for `2.32.0` at their filename timestamps. Registration and disposable validation do not imply execution in production.

The CRM Context Fields command is `2-32-instance-command-fast-1790010000000-add-inconnect-messaging-context-fields.ts`. It adds `core.inconnectMessagingContextField` with seven columns, a UUID primary key, Workspace FK, configuration/anchor composite FK, FieldMetadata/object/workspace composite FK, unique workspace + field, unique workspace + ordinal, `ordinal >= 0`, and cascading presentation-row lifecycle. It has no `messagingConfigurationId` column and requires no Slow Command. Its `down` removes only the ContextField table and its owned constraints/indexes; MessagingConfiguration, Conversations, Messages, ConversationMemberState, ObjectMetadata, FieldMetadata, and CRM record data remain. Loss of presentation configuration on downgrade is acceptable.

The Phone Identity Fields command is `2-32-instance-command-fast-1790550000000-add-inconnect-messaging-phone-identity-fields.ts`, implemented by `AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand` and registered for `2.32.0` at timestamp `1790550000000`. It adds `core.inconnectMessagingPhoneIdentityField` with Workspace, exact MessagingConfiguration anchor, and exact FieldMetadata/object/workspace integrity; unique workspace + Field and workspace + ordinal constraints; role and ordinal checks; and a partial unique index allowing at most one `PRIMARY` per workspace. Non-empty configuration having exactly one `PRIMARY` is additionally revalidated by the application service. No Slow Command or CRM backfill is required.

### Local Development Runtime

This checkout expects WSL/Linux for local Codex work. Node Linux v24.16.0 and repository Yarn 4.13.0 were validated. Do not mix Windows-installed `node_modules` native bindings with WSL Node, Nx, or Jest. A WSL `yarn install --immutable` restored Linux bindings without changing `yarn.lock`.

### PostgreSQL Environment Precedence

All dotenv loaders owned by `twenty-server` use fallback-only semantics. The stable precedence contract is:

1. An explicit value already present in `process.env`.
2. `.env.test` when `NODE_ENV === 'test'`, or `.env` otherwise, for variables absent from the process environment.
3. Existing undefined/default handling when neither source supplies a value.

Dotenv files must never silently replace caller-provided configuration from a shell, CI, container, or script. If explicit `process.env.PG_DATABASE_URL` points to a disposable database while `.env` points to `default`, the disposable URL remains effective. The same precedence preserves an explicit `process.env.PG_DATABASE_REPLICA_URL`; `.env` or `.env.test` supplies either URL only when that variable is absent externally.

`core.datasource.ts` and `raw.datasource.ts` intentionally retain their own dotenv loading because direct and CLI consumers outside Nest depend on the file fallback. Both obey the same safe precedence. Importing Core then Raw, or Raw then Core, cannot change an explicit database or replica URL. This invariant applies to later `twenty-server` dotenv loaders as well: never reintroduce `override: true` or equivalent behavior that silently replaces explicit process configuration.

Normal local development retains its existing fallback. When `PG_DATABASE_URL` is absent from the external environment and the selected dotenv file contains it, the application and CLI receive that value; developers do not need to export it manually. Environment-file discovery itself was not redesigned, so fallback still depends on the existing working-directory assumptions, including `packages/twenty-server` for the relevant direct loaders. This is a non-blocking tooling limitation, not a product defect.

For separately authorized destructive or disposable database validation, explicit `PG_DATABASE_URL` retains the precedence above, but defense in depth still applies. Under that authorization, verify the actual target and command tracking before an environment-specific execution claim or write, including `current_database()`, `inet_server_port()`, and `current_setting('data_directory')` where appropriate. A changed port or database name alone does not establish physical isolation. The current F13 physical-execution gates above remain blocked; this guidance does not authorize connecting, probing, provisioning, or running commands.

### Historical Fase 12A Tooling Incident

This note is historical and does not describe current environment-precedence behavior. Before the hardening, the then-active `override: true` policy caused a Fase 12A run intended for a disposable database to use the local `default` database. The mismatch was detected and stopped; it was local development only and never production. Read-only forensic review found no evidence of application-data DML, the Messaging tables were empty, and the Messaging upgrade chain registered at that time remained applied and marked complete locally. The local `default` database was intentionally left at the valid Messaging schema state of that incident; no rollback is implied. This historical observation is not current command tracking and makes no execution claim for the later F13C commands 5698 or 5700.

## INCONNECT Upstream Upgrade Procedure

Remote and branch model:

- `upstream`: official `twentyhq/twenty`.
- `origin`: INCONNECT fork.
- Stable product branch: `inconnect-main`.
- Feature branches: `feature/*`.
- Upgrade branches: `update/twenty-<version-or-date>`.

Before selecting an upstream reference, perform an INCONNECT impact analysis covering:

- ORM/query builders and Search;
- workspace permissions and actor context;
- Nest module wiring;
- metadata and owner relation helpers;
- GraphQL schema/codegen;
- Settings routes, API, and UI;
- Redis/cache contracts and generation fencing;
- instance/workspace/legacy migrations;
- authentication and workspace context.

Upgrade procedure:

Git writes in this procedure and its examples are performed personally by the user. Codex is restricted to read-only Git inspection; database, infrastructure and deployment actions retain their separate authorization gates.

1. Start from a clean, synchronized `inconnect-main`.
2. Run `git fetch upstream --tags`.
3. Inspect upstream commits, release notes, schema changes, and migrations before merging.
4. Create `update/twenty-<version-or-date>` from `inconnect-main`.
5. Merge the chosen upstream Twenty reference into the update branch without rewriting INCONNECT history.
6. Resolve conflicts preserving both the new upstream architecture and every INCONNECT security invariant.
7. Do not resolve generated GraphQL output manually when regeneration is the correct solution; update source operations/schema and run the repository codegen.
8. Review every upstream migration/instance/workspace command before applying it.
9. Never run `database:reset` against an existing environment.
10. Test the upgrade in local development and staging before production.
11. Run focused and regression coverage for `ownRecords`, `ownAndTeamRecords`, `allRecords`, writes, owner integrity, Team cache, policy cache, Record Access Settings, and Commercial Teams Settings.
12. Bootstrap the real backend and frontend; do not rely only on isolated tests.
13. Perform a manual smoke test for representative Executive, Coordinator, Supervisor, and Admin actors.
14. Back up the production database and establish rollback/recovery steps before deployment.
15. Merge the validated update branch into `inconnect-main` only after all checks pass.

Suggested commands after choosing a reviewed upstream reference:

```bash
git switch inconnect-main
git pull --ff-only origin inconnect-main
git fetch upstream --tags
git switch -c update/twenty-<version-or-date>
git merge --no-ff <reviewed-upstream-reference>
```

Do not apply migrations merely because the merge completed. Migration authorization and environment-specific backups remain separate gates.

## Convenciones de ingeniería y validación de fuente

Estas convenciones se aplican cuando la fase autoriza código. Los comandos no
son autorización y documentación sola no requiere builds/tests/codegen.

### Tech Stack
- **Frontend**: React 18, TypeScript, Jotai (state management), Linaria (styling), Vite
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, GraphQL (with GraphQL Yoga)
- **Monorepo**: Nx workspace managed with Yarn 4

### Package Structure
```
packages/
├── twenty-front/          # React frontend application
├── twenty-server/         # NestJS backend API
├── twenty-ui/             # Shared UI components library
├── twenty-shared/         # Common types and utilities
├── twenty-emails/         # Email templates with React Email
├── twenty-website/    # Next.js marketing website
├── twenty-docs/           # Documentation website
├── twenty-zapier/         # Zapier integration
└── twenty-e2e-testing/    # Playwright E2E tests
```

### Key Development Principles
- **Functional components only** (no class components)
- **Named exports only** (no default exports)
- **Types over interfaces** (except when extending third-party interfaces)
- **String literals over enums** (except for GraphQL enums)
- **No 'any' type allowed** — strict TypeScript enforced
- **Event handlers preferred over useEffect** for state updates
- **Props down, events up** — unidirectional data flow
- **Composition over inheritance**
- **No abbreviations** in variable names (`user` not `u`, `fieldMetadata` not `fm`)

### Naming Conventions
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Types/Classes**: PascalCase (suffix component props with `Props`, e.g. `ButtonProps`)
- **Files/directories**: kebab-case with descriptive suffixes (`.component.tsx`, `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`)
- **TypeScript generics**: descriptive names (`TData` not `T`)

### File Structure
- Components under 300 lines, services under 500 lines
- Components in their own directories with tests and stories
- Use `index.ts` barrel exports for clean imports
- Import order: external libraries first, then internal (`@/`), then relative

### Comments
- Use short-form comments (`//`), not JSDoc blocks
- Explain WHY (business logic), not WHAT
- Do not comment obvious code
- Multi-line comments use multiple `//` lines, not `/** */`

### State Management
- **Jotai** for global state: atoms for primitive state, selectors for derived state, atom families for dynamic collections
- Component-specific state with React hooks (`useState`, `useReducer` for complex logic)
- GraphQL cache managed by Apollo Client
- Use functional state updates: `setState(prev => prev + 1)`

### Backend Architecture
- **NestJS modules** for feature organization
- **TypeORM** for database ORM with PostgreSQL
- **GraphQL** API with code-first approach
- **Redis** for caching and session management
- **BullMQ** for background job processing


## Development Workflow

IMPORTANT: When Context7 is available and appropriate, use it for code generation, setup or configuration steps, and library/API documentation. Do not assume Context7 or another MCP is configured, and do not block work only because it is absent unless the requested task genuinely depends on that external source.

### Before Making Changes
1. Always run linting (`lint:diff-with-main`) and type checking after code changes
2. Test changes with relevant test suites (prefer single-file test runs)
3. Ensure entity changes include instance commands; running `database:migrate:generate` requires action-specific authorization
4. Check that GraphQL schema changes are backward compatible
5. Run `graphql:generate` after any GraphQL schema changes

### Code Style Notes
- Use **Linaria** for styling with zero-runtime CSS-in-JS (styled-components pattern)
- Follow **Nx** workspace conventions for imports
- Use **Lingui** for internationalization
- Apply security first, then formatting (sanitize before format)

### Testing Strategy
- **Test behavior, not implementation** — focus on user perspective
- **Test pyramid**: 70% unit, 20% integration, 10% E2E
- Query by user-visible elements (text, roles, labels) over test IDs
- Use `@testing-library/user-event` for realistic interactions
- Descriptive test names: "should [behavior] when [condition]"
- Clear mocks between tests with `jest.clearAllMocks()`


## Important Files
- `nx.json` - Nx workspace configuration with task definitions
- `tsconfig.base.json` - Base TypeScript configuration
- `package.json` - Root package with workspace definitions
- `.cursor/rules/` - Detailed development guidelines and best practices
