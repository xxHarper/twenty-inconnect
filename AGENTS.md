# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Twenty is an open-source CRM built with modern technologies in a monorepo structure. The codebase is organized as an Nx workspace with multiple packages.

## INCONNECT Project Overrides

- Do not use or derive Enterprise-licensed implementations for INCONNECT custom features.
- INCONNECT Record Access must be implemented independently using modifiable open-source code.
- Context7 and PostgreSQL MCP availability must not be assumed.
- The syncable-entity skills apply only when actually creating or modifying syncable metadata entities.
- Record-level authorization work must not be treated as creation of a syncable entity unless explicitly justified.

## Key Commands

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

# Format code
npx nx fmt twenty-front
npx nx fmt twenty-server
```

### Build
```bash
# Build packages (twenty-shared must be built first)
npx nx build twenty-shared
npx nx build twenty-front
npx nx build twenty-server
```

### Database Operations
```bash
# Database management
npx nx database:reset twenty-server         # Reset database
npx nx run twenty-server:database:init:prod # Initialize database
npx nx run twenty-server:database:migrate:prod # Run instance commands (fast only)

# Generate an instance command (fast or slow)
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
```

### Database Inspection (Postgres MCP)

A read-only Postgres MCP server is configured in `.mcp.json`. Use it to:
- Inspect workspace data, metadata, and object definitions while developing
- Verify migration results (columns, types, constraints) after running migrations
- Explore the multi-tenant schema structure (core, metadata, workspace-specific schemas)
- Debug issues by querying raw data to confirm whether a bug is frontend, backend, or data-level
- Inspect metadata tables to debug GraphQL schema generation issues

This server is read-only — for write operations (reset, migrations, sync), use the CLI commands above.

### GraphQL
```bash
# Generate GraphQL types (run after schema changes)
npx nx run twenty-front:graphql:generate
npx nx run twenty-front:graphql:generate --configuration=metadata
```

## Architecture Overview

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

### Database & Upgrade Commands
- **PostgreSQL** as primary database
- **Redis** for caching and sessions
- **ClickHouse** for analytics (when enabled)
- When changing entity files, generate an **instance command** (`database:migrate:generate --name <name> --type <fast|slow>`)
- **Fast** instance commands handle schema changes; **slow** ones add a `runDataMigration` step for data backfills
- **Workspace commands** iterate over all active/suspended workspaces for per-workspace upgrades
- Commands use `@RegisteredInstanceCommand` and `@RegisteredWorkspaceCommand` decorators for automatic discovery
- Include both `up` and `down` logic in instance commands
- Never delete or rewrite committed instance command `up`/`down` logic
- See `packages/twenty-server/docs/UPGRADE_COMMANDS.md` for full documentation

### Utility Helpers
Use existing helpers from `twenty-shared` instead of manual type guards:
- `isDefined()`, `isNonEmptyString()`, `isNonEmptyArray()`

## Development Workflow

IMPORTANT: Use Context7 for code generation, setup or configuration steps, or library/API documentation. Automatically use the Context7 MCP tools to resolve library IDs and get library docs without waiting for explicit requests.

### Before Making Changes
1. Always run linting (`lint:diff-with-main`) and type checking after code changes
2. Test changes with relevant test suites (prefer single-file test runs)
3. Ensure instance commands are generated for entity changes (`database:migrate:generate`)
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

## Dev Environment Setup

All dev environments (Codex web, Cursor, local) use one script:

```bash
bash packages/twenty-utils/setup-dev-env.sh
```

This handles everything: starts Postgres + Redis (auto-detects local services vs Docker), creates databases, copies `.env` files, and initializes the database schema (runs migrations) on a fresh database. Idempotent — safe to run multiple times.

- `--docker` — force Docker mode (uses `packages/twenty-docker/docker-compose.dev.yml`)
- `--down` — stop services
- `--reset` — wipe data and restart fresh
- **Skip the setup script** for tasks that only read code — architecture questions, code review, documentation, etc.

**Note:** CI workflows (GitHub Actions) manage services via Actions service containers and run setup steps individually — they don't use this script.

## Important Files
- `nx.json` - Nx workspace configuration with task definitions
- `tsconfig.base.json` - Base TypeScript configuration
- `package.json` - Root package with workspace definitions
- `.cursor/rules/` - Detailed development guidelines and best practices

# INCONNECT - Stable Project State / Handoff

This section is the authoritative technical handoff for INCONNECT. It supplements the repository-wide instructions above and describes the current stable capabilities rather than the implementation chronology. It was verified on 2026-08-24 against branch `chore/inconnect-stable-checkpoint` at commit `6be7733df3b52063552b6f800518ea0baa8277bc`.

## Purpose and Licensing Boundary

INCONNECT is an independent OSS record-authorization and commercial-team implementation built on Twenty OSS. Its operating model is:

- Executive: own records.
- Coordinator: own records plus records owned by members of the coordinator's commercial team.
- Supervisor: all records, subject to Twenty standard permissions.
- Admin: all records, subject to Twenty standard permissions.

Lead and Folio ISO are the currently managed custom objects, but the engine is metadata-driven and must remain generic. Never hardcode their names, physical tables, owner columns, workspace IDs, Role IDs, or Workspace Member IDs.

The Enterprise boundary is strict:

- Never copy, derive, adapt, reuse, or inspect Twenty Enterprise Row-Level Permissions for INCONNECT design or implementation.
- Never modify `engine/core-modules/enterprise/**` for this project.
- Never import Enterprise RLS predicates, evaluators, renderers, builders, metadata entities, migrations, or tests.
- OSS shared infrastructure may be reused when appropriate.
- Keep INCONNECT an independently designed OSS implementation under the INCONNECT module and OSS ORM integration points.

INCONNECT operational configuration is not a syncable metadata entity. Do not start a `syncable-entity-*` workflow unless a future task explicitly introduces a real syncable metadata entity and justifies it.

## Completed Security Model

Record effects:

- `ownRecords`
- `ownAndTeamRecords`
- `allRecords`

Effective authorization is always:

    Twenty standard permissions
    AND INCONNECT operation policy
    AND INCONNECT record scope
    AND INCONNECT owner integrity, when configured

`allRecords` only omits an additional INCONNECT row predicate. It never bypasses standard object or field permissions.

Strict behavior:

- Managed object plus Role without exactly one applicable Policy: denied.
- Duplicate, invalid, incomplete, corrupt, or unavailable authoritative policy/cache: denied.
- Human policy requiring a Workspace Member with no authenticated Workspace Member: denied.
- Object not managed by INCONNECT: standard Twenty behavior.
- `system` bypass is reserved only for explicitly authorized internal operations already trusted by Twenty.
- Unsupported managed-object write paths remain fail-closed unless a later phase explicitly designs and tests them.

The resolved decision model distinguishes `not-managed`, `system-bypass`, `denied`, `all-records`, and `owner-workspace-member-ids`. Scoped decisions keep two independent sets:

- `recordScopeOwnerWorkspaceMemberIds`: owners whose existing records the actor may access.
- `assignableOwnerWorkspaceMemberIds`: owners that may receive a new record or transfer when operation policy permits.

Never cache a complete actor-specific decision by only workspace + Role. Policy snapshots and Team maps may be workspace-level; authenticated Workspace Member and owner-ID decisions must be resolved per request.

## Completed SQL Enforcement

Authorization is enforced in backend SQL, never by frontend filtering or post-filtering.

Reads cover the protected ORM v1 and ORM v2 paths, including:

- list/find-many and direct find-by-ID/find-one;
- count and pagination;
- Search through the existing FTS/ILIKE pipelines;
- protected raw/select execution paths;
- relations and managed `JOIN ... ON` targets.

Predicates preserve grouping:

    OWNER_SCOPE AND (USER_FILTER)

A managed joined object receives its own scope. An accessible Lead must not expose an inaccessible related Folio ISO, and vice versa.

Writes cover the supported common Create/Update/Delete-style builders:

- Current-owner scope is part of the same mutation SQL predicate, preventing permission-check-then-write TOCTOU.
- Owner transfer validates both current-record scope and destination-owner policy.
- Client-provided owner values remain subject to Twenty standard owner-field permission.
- Security-injected owner defaults do not grant client permission to edit the owner field.
- UUIDs are parameters and owner columns/tables are derived from metadata.
- Direct-by-ID operations outside scope behave as not found/no affected rows without existence disclosure.
- Internal provenance for `createdBy`/`updatedBy` remains protected and only explicitly tracked system side effects may bypass client field-write checks.

The following generic EntityManager/Repository operations remain fail-closed for managed objects unless explicitly expanded later:

- `upsert`
- `merge`
- `save`
- `remove`
- `softRemove`
- `recover`

Do not move enforcement into individual REST/GraphQL resolvers; preserve the common ORM/query-builder coverage.

## Operation Policies and Owner Integrity

Create policy values:

- `denied`
- `defaultOwner`
- `assignableOwners`
- `standardPermissionsOnly`

Owner-transfer policy values:

- `denied`
- `assignableOwners`
- `standardPermissionsOnly`

These are independent of `recordEffect`. Twenty shares `canUpdateObjectRecords` between Create and Update, so INCONNECT intentionally adds a separate Create dimension.

Owner requirement values:

- `required`
- `optional`

Missing-owner policy values:

- `self`
- `requireExplicit`
- `singleActiveMemberOfRole`
- `standard`

Owner omission and explicit null are distinct. When owner is required:

- explicit null on Create: denied;
- explicit null on Update: denied;
- omitted owner: resolved according to `missingOwnerPolicy`.

Normalization covers relation values, normalized FK values, relation objects, nested connect, and equivalent representations reaching the common write pipeline. Contradictory relation/FK owner inputs are denied. Owner join columns are derived with Twenty metadata helpers.

For `singleActiveMemberOfRole`, the default is a Role reference, never a hardcoded person:

- 0 active candidates: Create without owner denied.
- 1 active candidate: use that Workspace Member.
- 2 or more active candidates: Create without owner denied.

## Current Functional Policies

### Lead

- Ejecutivo INCONNECT: `ownRecords`, Create denied, transfer denied, owner required, missing owner `requireExplicit`.
- Coordinador INCONNECT: `ownAndTeamRecords`, Create denied, transfer denied, owner required, missing owner `requireExplicit`.
- Supervisor INCONNECT: `allRecords`, standard Create/transfer, owner required, missing owner `singleActiveMemberOfRole`, default Role Supervisor INCONNECT.
- Admin: `allRecords`, standard Create/transfer, owner required, same Supervisor default.

### Folio ISO

- Ejecutivo INCONNECT: `ownRecords`, Create `defaultOwner`, missing owner `self`, transfer denied, owner required.
- Coordinador INCONNECT: `ownAndTeamRecords`, Create `defaultOwner`, missing owner `self`, transfer denied, owner required.
- Supervisor INCONNECT: `allRecords`, standard Create/transfer, missing owner `self`, owner required.
- Admin: `allRecords`, standard Create/transfer, missing owner `self`, owner required.

Twenty creates a Folio ISO immediately when opening a new record, so all configured Roles use self for an omitted Folio owner. Supervisor/Admin may transfer it later only when standard permissions permit. Lead and Folio ISO owners are independent; there is no inherited Lead-to-Folio access or automatic owner synchronization.

## Commercial Teams

Persisted entities/tables:

- `InconnectCommercialTeamEntity` / `core.inconnectCommercialTeam`
- `InconnectCommercialTeamMembershipEntity` / `core.inconnectCommercialTeamMembership`

Membership types:

- `COORDINATOR`
- `EXECUTIVE`

Invariants:

- A Workspace Member has at most one active commercial-team membership.
- A Team has at most one active Coordinator.
- Team and membership references are workspace-isolated.
- Roles determine the type of record-access policy; Team membership determines which Workspace Members expand `ownAndTeamRecords`. They are independent dimensions.
- A historical/non-assignable member may remain in record scope but must not be an assignment destination.
- Workspace Member validity/assignability uses active Workspace Member, UserWorkspace, User, and supported non-disabled status checks.

The security-sensitive Team cache provides workspace-level maps for membership, record scope, and assignable destinations. It uses:

- read-only `REPEATABLE READ` snapshots;
- runtime payload/version validation;
- strict shared Redis authority;
- shared-generation validation before trusting local state;
- generation fencing/CAS;
- stale recomputation protection;
- fail-closed absent/invalid/corrupt/recomputation-failed states;
- after-commit invalidation and recomputation;
- multi-process protection and deterministic lock ordering.

Authorization uses Team maps only for `ownAndTeamRecords`. `ownRecords` and `allRecords` do not depend on Team cache availability.

Commercial Teams administration is complete:

- Settings API lists Teams and available Workspace Members and exposes create, rename, assign/change Coordinator, add/remove Executive, atomic move Executive, and delete Team.
- Every mutation derives workspace from authenticated context, uses existing Team services, and is protected by `WorkspaceAuthGuard` plus `SettingsPermissionGuard(PermissionFlagType.SECURITY)`.
- Settings UI is available at Settings -> Security -> Commercial Teams.
- UI and API never change Roles when memberships change.
- Administrative reads use PostgreSQL authority; runtime authorization uses the hardened Team cache.
- Mutation results distinguish `recomputed` from `recomputation-failed`.
- Pre-commit revoke/validation/locking/DB failure rejects the mutation with no commit.
- Post-commit recomputation failure reports successful persistence plus `recomputation-failed`; runtime remains fail-closed until cache recovery.

Do not redesign Commercial Teams while changing Record Access persistence unless a concrete security requirement demands it.

## Persisted Record Access Authority

Persisted core model:

    inconnectRecordAccessConfiguration
      -> inconnectRecordAccessManagedObject
           -> inconnectRecordAccessPolicy

Configuration stores workspace, `MANAGED | UNMANAGED`, bigint revision represented as a TypeScript string, and timestamps. Managed Object stores ObjectMetadata, owner FieldMetadata, and owner requirement. Policy stores Role, principal type, record effect, operation policies, missing-owner policy, and optional default-owner Role.

Real IDs/FKs are persisted authority. Universal identifiers are used only at import/export/API boundaries. Composite reference keys enforce strong workspace isolation:

- Role: `(id, workspaceId)`
- ObjectMetadata: `(id, workspaceId)`
- FieldMetadata: `(id, objectMetadataId, workspaceId)`

The owner Field FK physically guarantees same Field -> Object -> Workspace. Runtime validation additionally requires live metadata, RELATION, MANY_TO_ONE, Workspace Member target, and derivable join column. A Managed Object with zero Policies remains managed and denies all human Roles. `MANAGED` with zero Managed Objects is invalid/fail-closed. `UNMANAGED` must have no children.

The persistence DDL is the Fast Instance Command:

`packages/twenty-server/src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence.ts`

It has been executed and audited in local development. Other environments must run their own authorized upgrade process; local execution never affects production.

## Source Modes and Policy Cache

`INCONNECT_RECORD_ACCESS_SOURCE_MODE` supports:

### `env` (default)

- Uses only `INCONNECT_RECORD_ACCESS_CONFIG`.
- Does not require the DB policy cache.

### `transition`

- DB Configuration absent: legacy ENV.
- DB Configuration present: DB claims full workspace authority.
- Once claimed, invalid DB/cache or failed recomputation denies; never fall back to ENV.

### `database`

- Uses DB only.
- Configuration absent: denied.
- Valid `MANAGED`: persisted policy enforcement.
- Valid `UNMANAGED`: standard Twenty behavior.
- Never falls back to ENV.

ENV and DB normalize into the same `InconnectRecordAccessWorkspacePolicy`; ORM enforcement does not know the source.

The security-sensitive DB policy cache is workspace-level and uses runtime decoding/versioning, a read-only `REPEATABLE READ` DB snapshot, strict Redis generation validation on security retrieval, generation fencing/CAS, multi-instance protection, and fail-closed cache states. It never caches actor-specific owner IDs. Redis failure is irrelevant in `env` mode but denies when transition/database needs DB authority.

Configuration publication is complete:

- `replaceConfiguration` replaces the whole active set transactionally.
- First publication uses `expectedRevision = null` and produces revision 1.
- Later publication locks Configuration `FOR UPDATE`, requires exact bigint-string revision, and increments it.
- Concurrent/stale publication conflicts instead of last-write-wins.
- Cache generation is revoked before DB authority changes.
- Rollback after revoke attempts to recompute the previous state; failure remains fail-closed.
- Recompute occurs after commit and is generation-fenced.
- Post-commit recomputation failure does not pretend DB rollback; it returns persisted success with fail-closed cache status.
- The ENV importer supports dry-run and guarded initial publication, resolving universal identifiers to workspace-local IDs through the same candidate validator.

## Record Access Settings

Settings -> Security -> Record Access is complete.

Backend:

- `getInconnectRecordAccessConfiguration`
- `getInconnectRecordAccessAvailableMetadata`
- `replaceInconnectRecordAccessConfiguration(input)`

The API derives workspace from authenticated context, uses PostgreSQL as the administrative read authority, publishes only through `replaceConfiguration`, and is protected by `WorkspaceAuthGuard` plus `SettingsPermissionGuard(PermissionFlagType.SECURITY)`. It distinguishes ABSENT, MANAGED, and UNMANAGED and returns revision plus cache status.

Frontend:

- Uses backend-provided valid Objects, owner Fields, and Roles; it does not reconstruct security metadata rules.
- Edits a local full-set draft and publishes only on Save.
- Uses optimistic revision and surfaces conflicts without retry/overwrite.
- Warns before MANAGED -> UNMANAGED and Managed Object removal.
- Preserves Managed Object with zero Policies and shows its fail-closed meaning.
- Distinguishes DB persistence success from cache recomputation failure.
- Refetches normalized PostgreSQL state after publication.

Administrative visibility is controlled by `PermissionFlagType.SECURITY` in both frontend navigation and backend guards; backend remains authoritative. Record Access policy administration and Commercial Team administration are separate domains.

## Local Apple Baseline

The following is demo data for local smoke testing only and must never become product constants. It was verified read-only on 2026-08-24:

Record Access:

- Workspace: Apple.
- Enforcement: `MANAGED`.
- Revision: `5` at verification time; always re-read before an optimistic update.
- Managed Objects: `2`.
- Policies: `8`.
- The local operational baseline has been manually validated with `INCONNECT_RECORD_ACCESS_SOURCE_MODE=database` and without relying on the ENV policy JSON.

Commercial Teams:

- Active Teams: `1`.
- Active memberships: `2`.
- Equipo Norte: Tim Apple as `COORDINATOR`; Scott Forstall as `EXECUTIVE`.
- Phil Schiler and Jane Austen are not required to belong to a Team for `allRecords`.

Expected smoke behavior:

- Scott: own Leads/Folios; no Lead Create; Folio Create defaults to self; no transfer.
- Tim: Tim + Team Leads/Folios; no Lead Create; Folio Create defaults to self; no transfer.
- Phil: all managed records subject to standard permissions; Lead without owner defaults to the unique active Supervisor; Folio without owner defaults to self; transfer only when standard permissions allow.
- Jane: all managed records subject to standard permissions; same Lead Supervisor default; Folio without owner defaults to self; transfer only when standard permissions allow.

Production is a separate environment. Never imply that local configuration, migrations, data, or smoke tests changed production.

## Repository Snapshot

Expected WSL path:

`/home/alberto/projects/twenty-inconnect`

Verified on 2026-08-24 before this AGENTS.md edit:

- Current branch: `chore/inconnect-stable-checkpoint`.
- HEAD: `6be7733df3b52063552b6f800518ea0baa8277bc` - `feat: add INCONNECT commercial teams settings UI`.
- `origin`: `https://github.com/xxHarper/twenty-inconnect.git`.
- `upstream`: `https://github.com/twentyhq/twenty.git`.
- Current local remote-tracking refs `origin/main` and `upstream/main`: `bcdac3e8245fb55e1f3c648eb136680c79ef6312`.
- Their recorded divergence is 0/0; no network fetch was performed during this documentation-only audit.
- Current HEAD is 16 commits ahead of that main baseline and main is its merge base.
- All local and origin `feature/inconnect-*` heads are reachable from current HEAD.
- Local INCONNECT feature heads are pairwise comparable by ancestry; the completed development chain is linear.
- The worktree was clean before this documentation edit.
- Node: `24.16.0` from `.nvmrc`.
- Yarn: `4.13.0` from `packageManager`.

Always re-run Git inspection before acting; this is a dated snapshot, not authority for future destructive operations.

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

## Working Rules

- Work incrementally by explicitly authorized phase.
- Before security-sensitive migrations, perform a read-only preflight and Entity-to-DDL audit.
- Never run `database:reset`, setup/reset scripts, migrations, generators, or PostgreSQL writes without explicit authorization for that exact action.
- Do not modify local Roles, Workspace Members, Leads, Folios, Teams, memberships, or persisted policies without explicit authorization.
- Do not make commits, push, create/delete branches or tags, change branches, or rewrite history unless the user explicitly asks.
- Preserve unrelated and pre-existing worktree changes.
- Prefer focused tests plus relevant INCONNECT regressions over destructive suites.
- Keep security predicates in SQL and fail closed at every unavailable/invalid authority boundary.
- Do not broaden unsupported mutation/API paths or security scope silently.
- Never hardcode demo workspace, user, Role, Object, Field, Lead, Folio, Team, or membership IDs in product code.
- Report tests, typecheck/lint/format, `git status --short`, and `git diff --stat` at the end of implementation tasks.
- If a requirement would change security architecture, schema, data, permissions, or authorized scope, stop and report the blocker before improvising.
- Never inspect or use Enterprise RLS as a shortcut.
