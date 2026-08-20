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

# INCONNECT Record Access — Project State / Handoff

This section is the technical handoff for the custom INCONNECT work. It supplements, and does not replace, the repository-wide instructions above. It was last verified on 2026-08-20 against branch feature/inconnect-policy-cache-source at commit 4acfa727ec01b43c0029f16e66c5578c3342d059.

## Purpose and Licensing Boundary

INCONNECT Record Access is an independent record-authorization system built on Twenty OSS. Its operating model is:

- Executive: own records.
- Coordinator: own records plus records owned by members of the coordinator's commercial team.
- Supervisor: all records, still subject to Twenty standard permissions.
- Admin: all records, still subject to Twenty standard permissions.

The currently managed CRM objects are Lead and Folio ISO, both custom objects in workspace metadata. The engine must remain generic: do not hardcode these object names, their physical tables, owner column names, workspace IDs, Role IDs, or Workspace Member IDs.

The Enterprise boundary is strict:

- Do not copy, derive, adapt, or reuse Twenty Enterprise Row-Level Permissions.
- Do not inspect Enterprise RLS internals to design INCONNECT.
- Do not modify engine/core-modules/enterprise/** for INCONNECT work.
- Do not import Enterprise RLS predicates, evaluators, renderers, builders, metadata entities, migrations, or tests.
- OSS shared infrastructure may be reused when appropriate.
- Keep INCONNECT an independently designed OSS implementation under engine/core-modules/inconnect-record-access/ and the OSS ORM integration points.

INCONNECT is operational core configuration, not a syncable metadata entity. Do not start a syncable-entity-* workflow unless a future task explicitly introduces a real syncable metadata entity and justifies it.

## Security Model and Decision Semantics

Record effects are:

- ownRecords
- ownAndTeamRecords
- allRecords

The effective authorization rule is always:

    Twenty standard permissions
    AND INCONNECT operation policy
    AND INCONNECT record scope
    AND INCONNECT owner integrity, when configured

INCONNECT must never grant an object operation or field write denied by Twenty standard Role permissions. allRecords means only that no extra INCONNECT row predicate is added; it is not a bypass of standard permissions.

Strict behavior:

- Managed object plus Role without exactly one applicable policy: denied.
- Duplicate or ambiguous policy: denied.
- Invalid policy/configuration/cache when that source is authoritative: denied.
- Human policy requiring a Workspace Member but receiving an API key/application context without one: denied.
- Object not managed by INCONNECT: standard Twenty behavior.
- system auth context: the existing explicit trusted internal bypass.

The current resolved decision union is defined in types/inconnect-record-access-workspace-policy.type.ts and uses:

- not-managed
- system-bypass
- denied
- all-records
- owner-workspace-member-ids

For scoped decisions, recordScopeOwnerWorkspaceMemberIds controls access to current records and assignableOwnerWorkspaceMemberIds controls owner destinations. Do not conflate these arrays.

## Actor-Specific Resolution

The final authorization decision is actor-specific. Never cache a complete resolved decision solely by workspaceId + roleId when it contains any of:

- authenticatedWorkspaceMemberId
- recordScopeOwnerWorkspaceMemberIds
- assignableOwnerWorkspaceMemberIds

A policy snapshot may be cached at workspace level. Team maps may be cached at workspace level. The final decision must be resolved per request and actor.

For ownAndTeamRecords, expansion requires both a matching policy and a valid COORDINATOR membership. With a valid Team cache:

- Coordinator membership: self plus memberWorkspaceMemberIdsByTeamId[teamId] for record scope.
- Coordinator membership: self plus assignableMemberWorkspaceMemberIdsByTeamId[teamId] for assignment scope when the operation policy uses assignable owners.
- No membership or an EXECUTIVE membership: self only.
- Absent, invalid, corrupt, or recomputation-failed Team authority: complete denial, not self-only fallback.

The main actor resolver is utils/resolve-inconnect-record-access-decision.util.ts.

## Commercial Teams

The INCONNECT Commercial Team subsystem is already implemented and persisted independently from CRM metadata and policy persistence.

Entities/tables:

- InconnectCommercialTeamEntity / core.inconnectCommercialTeam
- InconnectCommercialTeamMembershipEntity / core.inconnectCommercialTeamMembership

Membership types:

- COORDINATOR
- EXECUTIVE

Active membership means deletedAt IS NULL. Database and service invariants include:

- A Workspace Member has at most one active commercial-team membership.
- A Team has at most one active Coordinator.
- Team and membership data are workspace-isolated.
- Role policies decide the kind of scope; Team membership decides which Workspace Members expand it.
- A historical/non-assignable member may remain in record scope while being excluded from assignment destinations.

The authoritative maps are conceptually:

- membershipByWorkspaceMemberId
- memberWorkspaceMemberIdsByTeamId
- assignableMemberWorkspaceMemberIdsByTeamId

The Team cache is security-sensitive and already hardened with:

- workspace-level Redis/shared authority;
- runtime payload validation;
- REPEATABLE READ, read-only snapshot construction;
- generation fencing and shared-generation validation;
- fail-closed cache states;
- after-commit invalidation/recomputation;
- multi-process protection against an older recomputation overwriting a newer one.

Its cache config uses generationFenced: true. Authorization understands available and denied reasons absent, invalid, corrupt, and recomputation-failed. None may become allRecords.

Key files:

- services/inconnect-commercial-team.service.ts
- services/inconnect-workspace-member.service.ts
- services/workspace-inconnect-team-access-maps-cache.service.ts
- types/inconnect-team-access-maps.type.ts
- utils/parse-inconnect-team-access-maps.util.ts

Do not redesign Teams as part of persisted Record Access policy work unless a concrete security requirement makes it necessary.

## Operation Policies and Writes

Create policy values:

- denied
- defaultOwner
- assignableOwners
- standardPermissionsOnly

Owner-transfer policy values:

- denied
- assignableOwners
- standardPermissionsOnly

These dimensions are independent of recordEffect. Twenty currently shares canUpdateObjectRecords between Create and Update, so INCONNECT intentionally separates Create policy from normal Update authorization.

Write behavior:

- Normal Update uses the current owner scope in the SQL mutation predicate.
- Owner transfer validates both access to the record under its old owner and permission for the destination owner.
- Client-supplied owner values remain subject to standard owner-field permissions.
- Security-injected default owners are internal values and must not grant the client permission to edit the owner field.
- Update/Delete-style mutation scopes are rendered atomically in SQL; do not add a separate permission SELECT followed by an unscoped mutation.
- Direct-by-ID operations outside scope must behave as not found/no affected rows without existence disclosure.

Internal write provenance is security-sensitive. Fields injected by trusted Twenty hooks, such as actor side effects, may bypass client field-write checks only when they were explicitly tracked as internally injected and their FieldMetadata has isSystemSideEffect === true. A client sending the same field directly must still be checked normally.

The following generic EntityManager/Repository operations remain fail-closed for managed objects unless a later phase explicitly designs and tests them:

- upsert
- merge
- save
- remove
- softRemove
- recover

The guard is utils/assert-inconnect-record-access-operation-supported.util.ts. Do not expand these routes accidentally.

## Owner Integrity

Owner requirement values:

- required
- optional

Missing-owner policy values:

- self
- requireExplicit
- singleActiveMemberOfRole
- standard

Owner omission and explicit null are different inputs. When ownerRequirement = required:

- Explicit owner null on Create: denied.
- Explicit owner null on Update: denied.
- An omitted owner follows missingOwnerPolicy.

Owner normalization must cover every supported Twenty representation, including:

- relation property;
- normalized foreign key;
- relation object;
- nested connect;
- equivalent relation/FK representations reaching the common write pipeline.

Contradictory relation and FK owner values must be rejected. Do not hardcode physical join-column names; derive them from the configured owner FieldMetadata using Twenty's metadata helpers.

The central write normalization/enforcement helper is utils/apply-inconnect-record-access-to-write-values.util.ts. Default-owner resolution by Role is in utils/resolve-inconnect-single-active-member-of-role.util.ts.

## Current Functional Policy: Lead

The intended current ENV configuration represents:

### Ejecutivo INCONNECT

- recordEffect = ownRecords
- createPolicy = denied
- ownerTransferPolicy = denied
- ownerRequirement = required
- missingOwnerPolicy = requireExplicit, as required by the denied-Create policy contract.
- Updates to owned records remain allowed only when Twenty object/field permissions allow them.

### Coordinador INCONNECT

- recordEffect = ownAndTeamRecords
- createPolicy = denied
- ownerTransferPolicy = denied
- ownerRequirement = required
- missingOwnerPolicy = requireExplicit
- Updates to self/Team records remain allowed only when standard permissions allow them.

### Supervisor INCONNECT

- recordEffect = allRecords
- createPolicy = standardPermissionsOnly
- ownerTransferPolicy = standardPermissionsOnly
- ownerRequirement = required
- missingOwnerPolicy = singleActiveMemberOfRole
- Default owner Role: Supervisor INCONNECT.

### Admin

- recordEffect = allRecords
- createPolicy = standardPermissionsOnly
- ownerTransferPolicy = standardPermissionsOnly
- ownerRequirement = required
- missingOwnerPolicy = singleActiveMemberOfRole
- Default owner Role: Supervisor INCONNECT.

The Lead default owner is never a hardcoded Workspace Member. It resolves the unique active/assignable Workspace Member holding the configured Supervisor Role:

- 0 candidates: Create without owner is denied.
- 1 candidate: use that Workspace Member.
- 2 or more candidates: Create without owner is denied.

An explicit valid owner does not require the default Role to have exactly one candidate and remains governed by standard permissions and the configured operation policy.

## Current Functional Policy: Folio ISO

The intended current ENV configuration represents:

### Ejecutivo INCONNECT

- recordEffect = ownRecords
- createPolicy = defaultOwner
- missingOwnerPolicy = self
- ownerTransferPolicy = denied
- ownerRequirement = required

### Coordinador INCONNECT

- recordEffect = ownAndTeamRecords
- createPolicy = defaultOwner
- missingOwnerPolicy = self
- ownerTransferPolicy = denied
- ownerRequirement = required

### Supervisor INCONNECT

- recordEffect = allRecords
- createPolicy = standardPermissionsOnly
- missingOwnerPolicy = self
- ownerTransferPolicy = standardPermissionsOnly
- ownerRequirement = required

### Admin

- recordEffect = allRecords
- createPolicy = standardPermissionsOnly
- missingOwnerPolicy = self
- ownerTransferPolicy = standardPermissionsOnly
- ownerRequirement = required

Twenty creates a Folio ISO immediately when the UI action opens a new record, before the complete form can collect an owner. Therefore missing owner resolves to the authenticated Workspace Member for every configured Role. Supervisor/Admin may transfer the owner later only when Twenty's standard object and owner-field permissions allow it. Explicit owner null remains denied.

Lead and Folio ISO owners are independent. There is currently no inherited rule such as Folio access following its related Lead, and no automatic synchronization of their owners:

    Folio access != related Lead owner inheritance

## SQL Enforcement, Search, and Relations

INCONNECT enforcement is backend/SQL authorization, never a UI/view filter or post-query result filter.

Reads are integrated into:

- ORM v1;
- ORM v2;
- list/find-many;
- direct find-by-ID/find-one;
- counts and pagination;
- Search through the existing FTS/ILIKE read pipelines;
- raw/select execution paths already protected by the workspace query builders;
- relations and JOINs.

The security predicate is grouped as:

    OWNER_SCOPE AND (USER_FILTER)

User filters containing OR must never escape the owner predicate. Managed relation targets receive their own predicate in JOIN ... ON; for example, an accessible Lead must not expose an inaccessible related Folio ISO, and vice versa.

Writes reuse the same metadata-derived owner column and apply current-owner IDs inside the mutation SQL predicate to prevent TOCTOU. UUIDs are parameters, not interpolated SQL.

Important OSS integration points include:

- inconnect-record-access.service.ts: current ENV parse and metadata resolution.
- utils/resolve-inconnect-record-access-decision.util.ts: per-actor decision.
- utils/render-inconnect-record-access-condition.util.ts: reusable SQL condition rendering.
- global-workspace-datasource/global-workspace-orm.manager.ts: workspace ORM context assembly.
- interfaces/workspace-internal-context.interface.ts: policy and Team maps carried in ORM context.
- ORM v1 workspace-select-query-builder.ts, workspace-insert-query-builder.ts, workspace-update-query-builder.ts, workspace-delete-query-builder.ts, and workspace-soft-delete-query-builder.ts.
- utils/apply-inconnect-record-access-to-mutation-query-builder.util.ts: atomic mutation scope.
- ORM v2 workspace-select-query-builder-v2.ts and workspace-repository-v2.ts for reads.
- Common query runners for client payload provenance and Create/Update paths.

Do not move enforcement into individual REST/GraphQL resolvers; preserve the common ORM/query-builder coverage.

## Persisted Configuration: Phase 6B.1 Complete

Phase 6B.1 added relational core persistence without connecting it to runtime authorization.

Model:

    Configuration
      └── ManagedObject
            └── Policy

Entities/tables:

- InconnectRecordAccessConfigurationEntity / core.inconnectRecordAccessConfiguration
- InconnectRecordAccessManagedObjectEntity / core.inconnectRecordAccessManagedObject
- InconnectRecordAccessPolicyEntity / core.inconnectRecordAccessPolicy

Configuration:

- workspaceId is the PK and FK to core.workspace, with cascade on workspace deletion.
- enforcementMode is MANAGED or UNMANAGED.
- revision is PostgreSQL bigint and a TypeScript string to avoid precision loss.
- createdAt and updatedAt are present.
- There is no deletedAt.

ManagedObject:

- References Configuration/workspace.
- References ObjectMetadata and owner FieldMetadata.
- Stores ownerRequirement.
- Is unique by workspaceId + objectMetadataId.
- May validly have zero Policy rows; this keeps the object managed and denies all human Roles.

Policy:

- References ManagedObject, Role, and optional default-owner Role.
- Stores principalType, recordEffect, createPolicy, ownerTransferPolicy, and missingOwnerPolicy.
- Is unique by workspaceId + managedObjectId + roleId.
- Uses principalType = WORKSPACE_MEMBER in the current schema.
- Requires defaultOwnerRoleId if and only if missingOwnerPolicy = singleActiveMemberOfRole.

Real IDs/FKs are the persisted authority. Universal identifiers are deliberately not duplicated as authority; use them later only at import/export/bootstrap/API boundaries to resolve workspace-local references.

The pure candidate validator is utils/validate-inconnect-record-access-persisted-candidate.util.ts. It validates full-set uniqueness and references, active metadata/Role state, workspace consistency, supported policy combinations, owner Field ownership/type/cardinality/target, and derivability of the owner join column. A ManagedObject with zero Policies is valid. A MANAGED Configuration with zero ManagedObjects is invalid/fail-closed.

## Strong Workspace Isolation

Phase 6B.1 added the composite reference keys needed for physical workspace isolation:

- core.role(id, workspaceId)
- core.objectMetadata(id, workspaceId)
- core.fieldMetadata(id, objectMetadataId, workspaceId)

Persisted FKs guarantee:

- Managed Object and owner Field belong to the same Object and Workspace.
- Policy Role belongs to the same Workspace as its Managed Object.
- Default-owner Role belongs to the same Workspace.
- A cross-workspace UUID cannot be accepted merely because it exists globally.

Preserve the composite column order and the explicit PK/FK constraint names. Entity metadata and DDL have a real contract test; do not let them drift.

## Phase 6B.1 Fast Instance Command

The command is:

- File: packages/twenty-server/src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence.ts
- Class: CreateInconnectRecordAccessPersistenceFastInstanceCommand
- Registration: RegisteredInstanceCommand version 2.32.0, timestamp 1786740000000.
- Tracking name: 2.32.0_CreateInconnectRecordAccessPersistenceFastInstanceCommand_1786740000000

The command was executed successfully in the local development PostgreSQL on 2026-08-20. Post-migration verification found:

- exactly one global execution at attempt 1, plus normal per-workspace tracking markers;
- zero pending Fast Instance Commands;
- zero pending legacy TypeORM migrations;
- all three new tables present;
- Entity PK/FK metadata exactly aligned with DDL;
- expected checks, indexes, composite FKs, and delete behavior present;
- all three new tables empty.

The migration contains DDL only. It does not insert the Apple workspace, Roles, Lead/Folio managed objects, or the eight policies. Other environments, including production, are separate and must run their own authorized upgrade process; local execution does not affect them.

Tests specifically cover entity metadata, schema/identifier contracts, composite reference indexes, DDL, Entity-to-DDL PK/FK alignment, and persisted-candidate validation.

## Current Runtime Source: ENV Only

This is the most important operational fact for the next phase: the new DB tables do not yet participate in authorization.

Current runtime flow:

    INCONNECT_RECORD_ACCESS_CONFIG
      -> InconnectRecordAccessService parser/metadata validation
      -> InconnectRecordAccessWorkspacePolicy
      -> per-actor decision resolver
      -> ORM v1/v2 enforcement

InconnectRecordAccessService reads INCONNECT_RECORD_ACCESS_CONFIG through TwentyConfigService. The persisted entities are registered with TypeORM, but no DB loader, persisted policy cache, or source selector is wired into the authorization flow.

INCONNECT_RECORD_ACCESS_SOURCE_MODE does not exist in the current code yet.

Consequences:

- INCONNECT_RECORD_ACCESS_CONFIG must be exported in the same shell/process environment used to start Twenty.
- A shell export is temporary and is not inherited by a separately launched process unless explicitly provided.
- If the variable is absent, the current ENV parser returns a non-configured workspace policy; the objects are then not managed by INCONNECT and Twenty standard permissions apply.
- This already caused Scott/Tim to see records allowed by standard permissions until the ENV configuration was exported again.
- Do not diagnose that symptom as a failure of the Phase 6B.1 migration; first verify the actual server process environment without printing secrets.

Do not put workspace-specific UUIDs into source constants or migrations.

## Next Phase: 6B.2 Policy Cache and Source Selector

The next implementation task is the DB Policy Cache plus the source selector. The approved target variable is:

    INCONNECT_RECORD_ACCESS_SOURCE_MODE = env | transition | database

Initial/default mode must be env for compatibility.

Approved source semantics:

### env

- Use only INCONNECT_RECORD_ACCESS_CONFIG.
- Do not require or consult the DB policy cache for authorization.

### transition

- DB Configuration absent: use legacy ENV.
- DB Configuration present: DB has claimed authority for that workspace.
- After DB claims authority, malformed DB rows, invalid configuration, unavailable/corrupt cache, or failed recomputation must deny; never fall back to ENV.
- No partial DB configuration may silently reopen access through ENV.

### database

- Use DB only.
- Configuration absent: deny.
- Valid MANAGED: enforce persisted managed objects and policies.
- Explicit valid UNMANAGED: standard Twenty behavior.
- Never fall back to ENV.

The source selector should feed the same InconnectRecordAccessWorkspacePolicy shape and existing decision/ORM layers. Enforcement should not need to know whether a valid workspace policy came from ENV or DB.

## Future DB Policy Cache Requirements

The policy cache is security-sensitive. Do not accept the normal approximately 100 ms local-stale window as authorization authority.

Required design:

- workspace-level policy snapshot;
- runtime payload decoding, schema versioning, and structural validation;
- a coherent REPEATABLE READ DB snapshot;
- shared Redis generation as authority;
- shared-generation validation before trusting any local snapshot;
- generation fencing/CAS so an older recomputation cannot overwrite a newer result;
- correct multi-instance behavior;
- fail-closed absent/invalid/corrupt/recomputation-failed states when DB is required;
- Redis unavailable means denial when DB policy authority is required;
- after-commit invalidation and safe recomputation;
- no actor-specific decision caching.

Follow the already hardened Team cache patterns in OSS infrastructure, without importing or studying Enterprise RLS.

## Future Managed-Object Semantics

With DB persistence active:

- ManagedObject exists plus Role without Policy: deny.
- ManagedObject with zero Policies: remains managed; all human Roles are denied.
- Do not infer managed objects only from Policy rows.
- MANAGED Configuration with zero ManagedObjects: invalid/fail-closed.
- Valid explicit UNMANAGED: standard Twenty behavior.
- Invalid/missing references, inactive Role/Object/Field, incompatible owner Field, ambiguous rows, or invalid cache: deny.

The owner Field must remain a live RELATION, MANY_TO_ONE, targeting workspaceMember, on the same Object and Workspace, with a join column derivable by the official metadata helper.

## Future Bootstrap and Administration

Not implemented yet:

- atomic replaceConfiguration service;
- ENV import command;
- dry-run/bootstrap command;
- DB source cache/selector;
- public administrative API;
- Settings UI.

Approved later migration path:

    current ENV configuration
      -> explicit import --dry-run
      -> resolve universal identifiers to workspace-local IDs
      -> validate complete candidate set
      -> atomically persist Configuration + 2 ManagedObjects + 8 Policies
      -> increment revision
      -> invalidate/recompute shared policy cache
      -> transition mode uses DB claim
      -> compare authorization behavior
      -> database mode
      -> retire operational dependency on ENV JSON

Do not hardcode Apple workspace IDs or its Role/Object/Field identifiers in an Instance Command. Future administration should use standard OSS Settings permissions rather than treating an INCONNECT business Role as permission to administer security policy.

## Local Demo Model and Smoke Baseline

These names are local test fixtures for manual smoke testing only; never use them as product constants:

- Scott Forstall: Ejecutivo INCONNECT.
- Tim Apple: Coordinador INCONNECT.
- Phil Schiler: Supervisor INCONNECT.
- Jane Austen: Admin.
- Equipo Norte: Tim as Coordinator and Scott as Executive.

Supervisor does not need Team membership because allRecords does not consult Team authority.

Expected smoke behavior:

### Scott

- Sees/updates own Leads and own Folios according to standard permissions.
- Cannot create Leads.
- Creating Folio ISO without owner assigns Scott.
- Cannot transfer owners.

### Tim

- Sees/updates Leads and Folios owned by Tim or Scott according to standard permissions.
- Cannot create Leads.
- Creating Folio ISO without owner assigns Tim.
- Cannot transfer owners under the current configured policies.

### Phil

- Sees all managed records, subject to standard permissions.
- Creating Lead without owner resolves the unique active Supervisor and therefore currently assigns Phil.
- Creating Folio ISO without owner assigns Phil.
- May transfer owner only when standard object and field permissions allow it.

### Jane

- Sees all managed records, subject to standard permissions.
- Creating Lead without owner assigns the unique active Supervisor.
- Creating Folio ISO without owner assigns Jane.
- May transfer owner only when standard object and field permissions allow it.

## Repository and Development Snapshot

Expected local repository path:

    /home/alberto/projects/twenty-inconnect

Verified Git/runtime state on 2026-08-20:

- Current branch: feature/inconnect-policy-cache-source.
- The current branch had no upstream tracking branch configured at verification time.
- HEAD: 4acfa727ec01b43c0029f16e66c5578c3342d059 — feat: add persisted INCONNECT access schema.
- origin: https://github.com/xxHarper/twenty-inconnect.git.
- upstream: https://github.com/twentyhq/twenty.git.
- Node: v24.16.0 from .nvmrc.
- Yarn: 4.13.0 from packageManager.

Recent INCONNECT history:

- 4acfa727ec01b43c0029f16e66c5578c3342d059 — persisted access schema.
- ab7675edd34f48ecdd7fdaa3be35c9faad7337bc — owner integrity.
- 3e9d85a412714187d67bd209abdbdcc9e8c72ae0 — operation policies.
- 8a94cdade1ed34fcda0e871f2047fa4ab48fe012 — Team write access.
- ea7ddbcb436c18b6cb066b402f6a4c1cc5c6652d — Team read access.

The worktree was clean before this handoff edit. Always inspect git status --short, branch, and recent history again instead of assuming this snapshot is still current.

Development is local under WSL. Production is separate: never imply that a local migration, configuration export, Role change, or data mutation affects production.

## Working Rules for the Next Codex Session

- Work incrementally by explicitly authorized phase.
- Before security-sensitive migrations, perform a read-only preflight and Entity-to-DDL audit.
- Never run database:reset, setup/reset scripts, migrations, generators, or local DB writes without explicit authorization for that exact action.
- Do not modify local Roles, Workspace Members, Leads, Folios, Teams, memberships, or persisted policies without explicit authorization.
- Do not make commits, push, change branches, or rewrite history unless the user explicitly asks.
- Preserve unrelated and pre-existing worktree changes.
- Prefer focused unit/integration tests plus relevant INCONNECT regressions over giant or destructive suites.
- Keep security predicates in SQL and fail closed at every unavailable/invalid authority boundary.
- Do not broaden unsupported mutation or API paths silently.
- Report important tests, typecheck/lint/format results, git status --short, and git diff --stat at the end of implementation tasks.
- If a requirement would change security architecture, migration schema, data, permissions, or scope beyond the authorized phase, stop and report the blocker before improvising.
- Never inspect or use Enterprise RLS as a shortcut.
