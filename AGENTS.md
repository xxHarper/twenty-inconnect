# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Twenty is an open-source CRM built with modern technologies in a monorepo structure. The codebase is organized as an Nx workspace with multiple packages.

## INCONNECT Project Overrides

- Do not use or derive Enterprise-licensed implementations for INCONNECT custom features.
- INCONNECT Record Access must be implemented independently using modifiable open-source code.
- Context7 and PostgreSQL MCP availability must not be assumed. Use them when available and appropriate, but do not block a task solely because they are unavailable unless the task genuinely requires that external source.
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
```bash
# Database management
npx nx database:reset twenty-server         # Reset database
npx nx run twenty-server:database:init:prod # Initialize database
npx nx run twenty-server:database:migrate:prod # Run instance commands (fast only)

# Generate an instance command (fast or slow)
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
```

### Database Inspection (Postgres MCP)

The repository includes a read-only Postgres MCP configuration in `.mcp.json`. When that MCP is available in the current runtime, use it to:
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

IMPORTANT: When Context7 is available and appropriate, use it for code generation, setup or configuration steps, and library/API documentation. Do not assume Context7 or another MCP is configured, and do not block work only because it is absent unless the requested task genuinely depends on that external source.

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

This section is the authoritative technical handoff for INCONNECT. It supplements the repository-wide instructions above and describes current capabilities rather than implementation chronology. The 2026-09-18 checkpoint on `feature/inconnect-messaging` includes Twilio inbound, secure inbound media ingestion into `FileEntity`/`FileStorage`, authorized attachment access, rich inbound `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, `CONTACT`, and `LOCATION` content, media-ready realtime updates, real frontend media rendering, the authorized Read API, the native inbox, outbound free-form Messaging, server-authoritative WhatsApp session policy, durable dispatch, templates, the functional composer and template picker, secure outbound media backend preparation, actor/workspace-scoped upload staging, deterministic and idempotent server-owned file identities, `FileStorage`/`FileEntity` outbound preparation, transactional outbound `Message` + `Attachment` consumption, provider-neutral media dispatch, Twilio outbound media delivery, an expiring provider-media capability, metadata GraphQL upload mutations, and the user-facing attachment composer. The composer provides a file picker, secure outbound upload UX, honest selection/upload/finalization states, retry and remove, local previews, capability-driven captions, and media send through opaque `outboundUploadIds`. This feature branch is a development checkpoint, not a stable product release. Live Git state remains authority; older dated evidence below is historical.

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

## INCONNECT Messaging

Backend: `packages/twenty-server/src/modules/inconnect-messaging/`. Frontend: `packages/twenty-front/src/modules/inconnect-messaging/` and `packages/twenty-front/src/pages/inconnect-messaging/`.

INCONNECT Messaging is a provider-neutral native Twenty feature with durable inbound processing, secure rich-media ingestion, authorized reads and file access, secure realtime, a secure outbound media backend, and a functional Messaging frontend. The native inbox supports text free-form, templates, and one capability-supported outbound attachment through its composer, secure upload UX, and template picker. It is not a Twenty App and must not reuse `modules/messaging` email functionality as the WhatsApp domain. Twilio remains behind the provider port; provider-specific concepts must not become domain authority.

### Implemented Persistence Foundation

The following TypeORM entities and dedicated `core` tables are implemented:

- `InconnectMessagingConfigurationEntity` / `core.inconnectMessagingConfiguration`
- `InconnectMessagingProviderConnectionEntity` / `core.inconnectMessagingProviderConnection`
- `InconnectMessagingConversationEntity` / `core.inconnectMessagingConversation`
- `InconnectMessagingMessageEntity` / `core.inconnectMessagingMessage`
- `InconnectMessagingDispatchAttemptEntity` / `core.inconnectMessagingDispatchAttempt`
- `InconnectMessagingWebhookReceiptEntity` / `core.inconnectMessagingWebhookReceipt`
- `InconnectMessagingProviderStatusEventEntity` / `core.inconnectMessagingProviderStatusEvent`
- `InconnectMessagingOutboxEventEntity` / `core.inconnectMessagingOutboxEvent`
- `InconnectMessagingAttachmentEntity` / `core.inconnectMessagingAttachment`
- `InconnectMessagingOutboundUploadEntity` / `core.inconnectMessagingOutboundUpload`

These are core operational tables, not workspace objects. PostgreSQL is the operational authority: do not introduce dual-write authority. The persistence spine supplies durable-inbox and transactional-outbox records, idempotency keys, leases, `DispatchAttempt` audit, checks, and workspace-isolated composite foreign keys. Twilio webhook receipt processing and inbox recovery, inbound media ingestion and recovery, outbound WhatsApp dispatch, realtime outbox publishing, and their BullMQ workers are implemented. BullMQ is at-least-once transport and must never become authority.

An Attachment has the durable logical identity `Message + ordinal`, a provider-neutral attachment type, and one of the ingestion states `PENDING`, `PROCESSING`, `AVAILABLE`, `FAILED`, or `EXPIRED`. It stores an opaque server-only provider media locator only while needed for ingestion, an optional workspace-isolated `FileEntity` reference, lease and attempt data, and safe presentation metadata. Composite foreign keys prevent its Message, workspace, and Provider Connection from diverging and require a referenced File to belong to the same workspace. A File cannot be deleted while an Attachment references it; Message deletion cascades its Attachments.

An Outbound Upload is actor/workspace-scoped staging with states `CREATING`, `PENDING`, `AVAILABLE`, and `CONSUMED`. It persists workspace, uploading Workspace Member, actor-scoped `clientUploadId`, provider-neutral media type, safe filename, size, workspace-local `FileEntity`, detected MIME, durable content fingerprint, expiration, and optional consumed Message/timestamp. Idempotency is unique by workspace + actor + `clientUploadId`; composite references keep File and consumed Message in the same workspace. PostgreSQL remains staging and consumption authority.

`MessagingConfiguration` selects the anchor through a real workspace-local `ObjectMetadata` reference. A `Conversation` references the CRM record with:

    workspaceId
    linkedRecordObjectMetadataId
    linkedRecordId

The linked tuple is either fully null or fully present, and a composite FK requires its ObjectMetadata to match the configured workspace anchor. Runtime authority must not come from physical names, schema names, a hardcoded `lead`, an owner column, or a universal identifier. Dynamic table and owner details come from live metadata.

`Message.providerConnectionId` is persisted because provider message identity is connection-scoped. Its composite FK `(conversationId, providerConnectionId, workspaceId)` to `Conversation` prevents the Message connection or workspace from diverging from its Conversation. Retry lineage is also connection/workspace constrained.

### Implemented Secure Outbound Upload Staging

The outbound upload backend follows:

    authenticated human
    -> createInconnectMessagingOutboundUpload
    -> actor/workspace-scoped Outbound Upload staging
    -> generic FileUploadService server-owned primitive
    -> FileStorage + FileEntity
    -> completeInconnectMessagingOutboundUpload
    -> verify actual stored size
    -> detect MIME from bytes
    -> content fingerprint
    -> Outbound Upload AVAILABLE

Creation and completion require an authenticated human Workspace Member with `INCONNECT_MESSAGING` and `SEND_INCONNECT_MESSAGING`. Knowing an upload ID is not authorization: every operation resolves the staging row for the current workspace + actor. Staging authorization never substitutes for current Conversation authorization, which is evaluated again at send time.

The raw `clientUploadId` is scoped by workspace + actor. The server derives deterministic staging and `FileEntity` identities so retries of the same upload intention reuse one logical upload; conflicting filename, type, or size metadata for that intention fails. Public clients never choose a `FileEntity` ID. Frontend/API callers receive only an opaque upload identity and a bounded upload capability.

Outbound staging expires after 24 hours, and expired uploads cannot be consumed. An `AVAILABLE` upload that is never sent remains private and actor-scoped but may leave its `FileEntity` and storage object until future explicit garbage collection or reconciliation; no automatic GC is implemented.

### Core File Upload Boundary

Twenty's `FileUploadService` exposes generic reusable server-owned create, refresh, and completion primitives. It does not know that INCONNECT Messaging exists. Core owns generic upload mechanics such as configured global size ceilings, pending `FileEntity` creation, upload capabilities, storage metadata verification, byte-based file detection, and temporary-file completion rules.

INCONNECT Messaging owns `FileFolder.InconnectMessaging` selection, logical media policy, MIME allowlists, media size limits, workspace/actor authorization, deterministic upload identity, and staging lifecycle. Permanent boundary: core provides generic file-upload primitives; feature modules own feature-specific upload policy. A public upload API must never expose the server-owned file-ID capability.

The frontend shares the feature-neutral `uploadFileToUrl` transport primitive extracted from the previous `useDirectFileUpload` transport. It uses the exact backend-provided upload URL with `PUT`, the `File` as the request body, the backend-provided `Content-Type`, the caller's `AbortSignal`, and `credentials: 'omit'`; non-successful HTTP responses retain the existing failure behavior. It does not derive a bucket/path, alter the upload authority, persist the URL, or contain INCONNECT, Messaging, WhatsApp, or Twilio logic. Existing Twenty `useDirectFileUpload` consumers retain their prior behavior. Shared upload transport must remain feature-neutral.

### Implemented Message and Media Content Taxonomy

The implemented provider-neutral Message types are `TEXT`, `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, `CONTACT`, and `LOCATION`.

- Normal Unicode, emoji, multi-codepoint emoji, and ZWJ sequences remain `TEXT`; there is no separate emoji Message type.
- `LOCATION` is structured provider-neutral inbound content and is not stored as a File or Attachment; outbound `LOCATION` is not implemented.
- `CONTACT` represents a vCard for safe presentation/download and supported outbound delivery. Supported normalization includes `text/vcard`, `text/x-vcard`, and `application/vcard`; it never auto-imports CRM data, creates a Lead, or changes ownership.
- `STICKER` is provider-neutral domain semantics. The Twilio WhatsApp adapter classifies `image/webp` as `STICKER` according to the documented contract for that specific provider/channel; never generalize WEBP-to-STICKER classification to future providers.
- Reactions are not implemented and must not be modeled as ordinary TEXT emoji. No stable reaction model exists.

### Durable Template Intent

`Message` stores provider-neutral template intent and historical audit through:

- `templateId`
- `templateProviderReference`
- `templateDisplayName`
- `templateLanguage`
- `templateVariables`
- `templateDefinitionFingerprint`

Outbound intent is classified provider-neutrally as `FREEFORM` or `TEMPLATE`. The frontend selects a local opaque `templateId`; `templateProviderReference` and the real provider identity remain server-side. A Message retains enough normalized template identity, display, language, variables, and definition fingerprint to interpret a historical send without depending on the current provider catalog.

The Fast Instance Command is `2-32-instance-command-fast-1789473600000-add-inconnect-messaging-template-intent.ts`. It was validated against an isolated disposable PostgreSQL database, not asserted as applied to production. Existing PRE-7B rows remain valid immediately after `up`, so no Slow Command or backfill is required. `down` converts existing `TEMPLATE` Messages to `FREEFORM` before dropping template metadata; this intentionally loses template classification and metadata but restores a valid PRE-7B schema.

### Implemented Outbound State Machine

Persisted outbound states are `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, and `UNKNOWN`.

The pure central authority is `resolveInconnectMessagingOutboundStateTransition` in `state-machine/outbound-message-state-machine.ts`. Its authoritative transition table rejects undeclared transitions and ignores duplicate or lower-progress callbacks.

- `LOCAL_PENDING` is UI-only and must never be persisted.
- `READ` never degrades and is terminal.
- `FAILED` is terminal and never reopens.
- `UNKNOWN` represents an ambiguous provider outcome and must not trigger blind automatic retry; a later definitive callback may resolve it.
- A future business retry creates a new `Message` linked through `retryOfMessageId`; it does not reopen the old Message.
- The Twilio adapter normalizes provider `UNDELIVERED` to `FAILED` while preserving provider status/error metadata.

The state machine is used by the operational dispatch pipeline. `providerRequestStartedAt` marks the conservative submit boundary: a crash or transport ambiguity after it may produce `UNKNOWN`. The system prefers a possible missed send over a possible duplicate send and never automatically retries an ambiguous provider outcome. A later definitive callback may resolve `UNKNOWN` only through an allowed state-machine transition.

### Implemented Provider Architecture

The current symbols are `InconnectMessagingProvider`, `InconnectMessagingProviderRegistry`, and `FakeInconnectMessagingProvider`.

- `(provider, channel)` identifies an adapter.
- Unknown combinations and duplicate registrations fail closed.
- The provider contract supports provider-neutral free-form text and media dispatch, template dispatch capability, and a normalized template catalog when the adapter supports them. Media capabilities declare supported logical types, supported MIME, maximum attachment count, and whether body/caption is supported.
- The inbound provider boundary can supply provider-neutral `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, and `CONTACT` attachments without exposing Twilio locator semantics to the domain or frontend. `LOCATION` remains structured content.
- The Fake Provider supports the dispatch and template cases needed by tests/development and is not registered automatically by `InconnectMessagingModule`.
- `TwilioWhatsappMessagingProvider` is registered by `InconnectMessagingModule` for inbound normalization, authenticated media retrieval, signed status callbacks, outbound free-form text/media dispatch, outbound template dispatch, and template catalog normalization.
- Provider account, sender, credentials, Content SIDs, and raw provider template payloads do not become public domain authority.

The current Twilio WhatsApp adapter accepts at most one outbound media item. Its own adapter-local capability supports `IMAGE` as JPEG/PNG, `STICKER` as WEBP, supported WhatsApp audio MIME, `VIDEO` as MP4, supported PDF/Office `DOCUMENT`, and vCard `CONTACT`. `IMAGE` may carry the current free-form body as a caption; the other currently supported media types do not. Unsupported type, MIME, count, or caption combinations fail closed. These are Twilio adapter constraints, not universal domain rules. Outbound `LOCATION` and rich/media templates are not implemented.

### Implemented Twilio Inbound and Status Pipeline

Public Twilio WhatsApp endpoints route only by the opaque `ProviderConnection.inboundRoutingKey`. They resolve exactly one enabled connection before decrypting its provider credential object with `SecretEncryptionService`; no webhook-supplied workspace identifier is authoritative. The Twilio adapter validates the effective proxy-aware request URL and form/body data with the official Twilio validator before any receipt or domain effect is written.

Validated events are normalized provider-neutrally and persisted idempotently in `WebhookReceipt`. The HTTP path commits PostgreSQL before requesting BullMQ processing. A recurring recovery scan re-enqueues `RECEIVED` receipts and expired `PROCESSING` leases, covering a successful DB commit followed by enqueue failure. Processing claims receipts with a lease and performs each domain effect, receipt completion, and `OutboxEvent` in one transaction.

Inbound senders are canonicalized within their Provider Connection. Processing creates or reuses one unassigned Conversation and creates one inbound Message per connection-scoped provider message ID. It normalizes the implemented Message taxonomy, records server/provider/effective timestamps, and advances `lastInboundAt` monotonically. The signed HTTP webhook never downloads media and never performs a network fetch inside a long SQL transaction.

Inbound media follows the durable pipeline:

    signed Twilio webhook
    -> durable WebhookReceipt
    -> Message + Attachment PENDING
    -> COMMIT
    -> BullMQ media ingestion
    -> authenticated Twilio media fetch
    -> MIME, size, and security validation
    -> FileStorage
    -> FileEntity
    -> Attachment AVAILABLE
    -> OutboxEvent
    -> MESSAGE_UPDATED
    -> authorized API refetch

Twilio `MediaUrl` values are opaque temporary ingestion locators, not product download URLs or historical storage. They are accepted only after normalization from a signed Twilio webhook and are never returned to the frontend. Media retrieval is HTTPS-only and fail-closed: it validates Twilio account, message, media, host, and path correlation; limits redirects to allowed Twilio/CDN destinations; does not forward credentials arbitrarily; and enforces timeout, maximum size, MIME verification, and SSRF protections. Never fetch an arbitrary URL supplied by a client or user.

The media policy requires provider-declared MIME, response MIME, detected file content, and logical attachment type to agree. The current maximum is 16 MiB. Unsupported, mismatched, or unsafe content fails closed; filename extensions are not authority, and active HTML/SVG is not accepted for inline media.

Successfully ingested media uses Twenty's existing `FileEntity`, `FileStorageService`, storage drivers, `FileFolder.InconnectMessaging`, `FileService`, and Content-Disposition helpers. There is no parallel INCONNECT storage system. `FileStorage`/`FileEntity` becomes durable media authority after successful ingestion; Twilio is not historical media storage.

Attachment creation is idempotent by `Message + ordinal`. File identity and storage path are deterministic, duplicate webhook/job processing does not create multiple logical Attachments, and recovery re-enqueues `PENDING` Attachments and expired `PROCESSING` leases. Temporary failures retry under a controlled maximum; terminally unavailable provider media can become `EXPIRED`. PostgreSQL state, not BullMQ job deduplication, is the correctness boundary.

PRE-8A Messages with historical media metadata but no Attachment remain valid. The current policy ingests new inbound media but does not automatically download or backfill historical Twilio media; legacy media without Attachment may remain unavailable or `UNKNOWN`. Any historical backfill requires separate explicit design and authorization, and no Fast migration performs network downloads.

The Fast Instance Command is `2-32-instance-command-fast-1789682400000-add-inconnect-messaging-inbound-attachments.ts`. It was validated by executing the real command against disposable PostgreSQL, not asserted as applied to production. Validation established that `up` accepts PRE-8A data, no Slow Command is required, the physical Attachment schema matches the entities, and the Message type constraint adds `STICKER` and `CONTACT`. `down` succeeds with POST-8A rows by converting `STICKER` to `IMAGE` and `CONTACT` to `DOCUMENT` before restoring the PRE-8A constraint; it removes the Attachment table but does not clean `FileEntity` or physical storage rows.

The current file lifecycle can leave orphan `FileEntity` or storage objects. Message deletion cascades Attachment deletion, but the File row and physical object may remain. A crash after a successful inbound storage write but before Attachment reaches `AVAILABLE` can leave bytes and/or a File row orphaned if later provider refetch is impossible. Outbound debt also includes abandoned `AVAILABLE` staging and `FileEntity`/storage that survive staging removal or the Outbound Upload Fast Command `down`. Deterministic identity prevents multiplication during ordinary retry but is not full garbage collection or reconciliation. A consumed Outbound Upload references its Message, and the current restrictive FK can prevent Message deletion while that staging row exists. Safe explicit GC/reconciliation is future work; do not add destructive cascade rules without a separate design.

Status callbacks resolve only an exact local outbound Message by workspace, Provider Connection, and provider message ID. Every accepted callback can produce a `ProviderStatusEvent`; projection changes use the existing outbound state machine, so duplicates and late lower-progress states do not degrade the Message. Missing local Messages remain durable and retryable until controlled operational failure. Webhook processing has no CRM-record, Lead, linking, ownership, or human-authorization capability.

A status callback can arrive before the provider SDK call returns. Correlation uses the opaque Provider Connection routing key, a signed local Message ID, workspace, Provider Connection, `OUTBOUND` direction, and the Twilio Message SID after signature validation. A late dispatcher response cannot degrade `DELIVERED` or `READ` back to `SENT`.

### Implemented Durable Outbound Dispatch

Human outbound dispatch follows one durable pipeline:

    authenticated human mutation
    -> InconnectMessagingAuthorizationService
    -> server-side send/session policy
    -> resolve and lock any actor-owned outbound staging
    -> transactional Message QUEUED + optional Attachment AVAILABLE
    -> mark staging CONSUMED + DispatchAttempt + OutboxEvent
    -> COMMIT
    -> immediate BullMQ enqueue
    -> durable claim
    -> provider-neutral text/template/media dispatch
    -> normalized result
    -> outbound state machine
    -> status callback progression
    -> realtime hint and authorized refetch

No Twilio call occurs inside the database transaction, and enqueue happens only after a successful commit. PostgreSQL remains authority. Recovery scans cover a lost post-commit enqueue, process restart, queued work, and expired leases without making BullMQ authoritative.

At send time the server authorizes the Conversation, revalidates the 24-hour free-form session when applicable, locks and resolves the current actor's staging rows, creates or reuses the idempotent Message, creates outbound `Attachment` rows already in `AVAILABLE`, marks staging `CONSUMED`, and records `DispatchAttempt` + `OutboxEvent` in the same transaction. After commit, `Message` + `Attachment` + `FileEntity` are historical authority; later reads and renders do not depend on the staging row.

Outbound Attachment `AVAILABLE` means only that durable validated media is ready for provider delivery. It does not mean the Message was sent. Message state remains independently `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, or `UNKNOWN`; provider delivery failure never reuses Attachment ingestion state. Media dispatch preserves the `providerRequestStartedAt` conservative boundary: an ambiguous submit becomes `UNKNOWN`, is never blindly retried, and may be resolved later only by a definitive callback allowed by the existing state machine.

### Implemented Security Foundation

#### Public Record Access Facade

`InconnectRecordAccessAuthorizationService` is implemented at `packages/twenty-server/src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service.ts` and exported by `InconnectRecordAccessModule`. Its public API is:

- `resolveReadScope`
- `applyReadScopeToQueryBuilder`
- `isRecordReadable`
- `buildAuthorizedRecordExistsCondition`
- `isAuthenticatedWorkspaceMemberValid`

Core consumers receive only the public scopes `not-managed`, `system-bypass`, `denied`, `all-records`, and `owner-scoped`. The facade encapsulates raw policies, Redis/cache payloads, Team maps, owner parsing, ENV/database source internals, renderers, and generation fencing. `not-managed` means only that INCONNECT adds no record predicate; it is not authorization and never bypasses Twenty standard permissions. Invalid or unavailable actor, workspace, metadata, policy, cache, or required Team authority denies.

#### Messaging Authorization

`InconnectMessagingAuthorizationService` is the centralized authority for human Messaging operations, including the implemented outbound send. It composes:

    authenticated Workspace
    AND valid authenticated Workspace Member
    AND Messaging functional permission
    AND Twenty standard object permission
    AND INCONNECT Record Access
    AND resource-specific authorization

For a linked Conversation the chain is `Conversation -> configured dynamic anchor record -> Twenty standard permission -> INCONNECT Record Access`. Messaging has no parallel owner or Team. Knowing a Conversation UUID grants nothing; unauthorized direct lookup returns no Conversation to avoid existence disclosure. Human operations reject system contexts and permission-bypass role configurations.

A human send requires `INCONNECT_MESSAGING AND SEND_INCONNECT_MESSAGING AND current Conversation authorization`. Linked Conversations preserve Twenty standard permission **and** INCONNECT Record Access. Access to an unassigned Conversation requires `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING`, and `SEND_INCONNECT_MESSAGING` is additionally required to send. `TRIAGE_INCONNECT_MESSAGING` and `MANAGE_INCONNECT_MESSAGING` never imply send. System context is not valid for the human send mutation.

`InconnectMessagingConversationQueryService` implements internal list, count, search, and pagination helpers. It applies workspace, permission, anchor, and correlated authorized-record `EXISTS` conditions in SQL before search results, counting, ordering, or pagination. Never fetch all Conversations and filter in memory or in the frontend.

#### Permission Flags

All defaults are `false`:

- `INCONNECT_MESSAGING` — tool; enables the module but grants no universal Conversation access.
- `SEND_INCONNECT_MESSAGING` — tool; also requires access to the Conversation and, when linked, its anchor record.
- `TRIAGE_INCONNECT_MESSAGING` — tool; with the base flag permits access to unassigned Conversations only.
- `MANAGE_INCONNECT_MESSAGING` — settings; does not imply Read or Send.

`canAccessAllTools` and `canUpdateAllSettings` retain standard Twenty semantics; neither converts a functional flag into record authorization.

#### Unassigned Conversations

A Conversation is unassigned only when both `linkedRecordObjectMetadataId` and `linkedRecordId` are null. Human access requires `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING`. There is no Messaging owner, parallel Team, auto-link, or automatic Lead creation. The native inbox labels authorized unassigned Conversations; triage mutations are not implemented.

### Implemented Read API

The metadata GraphQL schema exposes `inconnectMessagingConversation(id)`, `inconnectMessagingConversations(search, paging)`, and `inconnectMessagingMessages(conversationId, paging)`. The authorized list provides edges, total count, search, and cursor pagination; Message history has deterministic newest-first cursor pagination. Responses use safe DTOs, never TypeORM entities or provider metadata.

`InconnectMessagingAuthorizationService` remains the authority. Linked Conversations require Twenty standard permission on the configured CRM anchor **and** INCONNECT Record Access. Unassigned Conversations require `INCONNECT_MESSAGING` **and** `TRIAGE_INCONNECT_MESSAGING`. Direct unauthorized Conversation lookup returns null/not found without existence disclosure, and Message access first authorizes its Conversation. Backend SQL applies authorization scope before search, count, ordering, and pagination; the frontend does not reconstruct record access.

Safe Message DTOs can include media descriptors containing an opaque Attachment ID, provider-neutral logical type, safe filename, MIME, size, ingestion/availability state, and an authorized same-origin access path. They never expose a Twilio media locator, storage key/path, credentials, or provider secret.

### Implemented Authorized Attachment Access

Every file request follows `Attachment -> Message -> Conversation -> InconnectMessagingAuthorizationService -> Twenty standard permission -> INCONNECT Record Access`. For an unassigned Conversation, the existing `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING` contract applies. Never authorize from only `workspaceId + fileId` or `workspaceId + attachmentId`; knowing a UUID grants neither existence disclosure nor download access.

The file stream is opened only after current Conversation authorization succeeds. Missing, unavailable, unauthorized, revoked, and cross-workspace resources use the same not-found/non-disclosing behavior for an authenticated caller. Download responses use `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, safe filenames, and Twenty's existing Content-Disposition policy. Only allowlisted media can render inline; active HTML/SVG is not served inline.

Human and provider access are intentionally distinct:

    HUMAN: Attachment -> Message -> Conversation authorization -> FileEntity/FileStorage
    PROVIDER: expiring provider-media capability -> exact OUTBOUND AVAILABLE Attachment
              -> exact workspace FileEntity -> FileStorage stream

Twilio has no human session and cannot use the human attachment endpoint. Provider delivery therefore uses a server-generated, signed, expiring, attachment-bound, workspace-bound, exact-purpose capability with dedicated JWT type `INCONNECT_MESSAGING_PROVIDER_MEDIA`. It is valid only for an exact outbound `AVAILABLE` Attachment. It is not a human access token, workspace session, API key, GraphQL authentication token, or upload token and cannot authenticate a human.

The provider delivery route supports `GET`/`HEAD` for one exact outbound Attachment. It resolves the `FileEntity` server-side and serves only `FileFolder.InconnectMessaging`; it accepts no arbitrary file ID, path, workspace selection, or inbound Attachment, and invalid capabilities fail closed as not found. Provider access never makes FileStorage public, and provider URLs/tokens are never returned through normal frontend GraphQL DTOs.

The provider-media capability currently reuses `FILE_TOKEN_EXPIRES_IN`; the effective/default value validated at this checkpoint is one day. This is a non-blocking **FOLLOW-UP RECOMMENDED**: a dedicated provider-media TTL may later reduce exposure without changing normal Twenty signed-file flows. It is not a current security defect.

Once outbound staging is consumed, its Attachment uses the same authorized human file path as inbound media. Provider capability expiration does not affect historical Conversation access, and no separate outbound-media read API exists.

### Implemented Human Send and Idempotency

The metadata GraphQL mutation `sendInconnectMessagingMessage` reauthorizes the current human and Conversation on every request and accepts optional opaque `outboundUploadIds` for server-resolved media. The public client does not provide a `FileEntity` ID, storage path, authoritative MIME, provider URL/token, sender, or Provider Connection. The frontend creates one raw `clientRequestId` for each user send intention and preserves it across safe retries. The backend derives a scoped UUID v5 from workspace, actor, Conversation, and the raw client request ID. Outbound Messages with a non-null client request ID have unique protection on `(workspaceId, clientRequestId)`.

The normalized content, template identity, and template variables participate in `requestFingerprint`. For outbound media it also includes normalized media intent: body/caption, ordered upload/attachment identity, logical media type, and durable content fingerprint. The same `clientRequestId` with the same media intention returns the same logical Message; the same key with different media fails with `IDEMPOTENCY_KEY_CONFLICT`. Correctness never depends only on disabling the Send button or frontend debounce, and the frontend does not create a duplicate optimistic Message.

`clientRequestId` identifies one user send intention, independently from upload idempotency. An uncertain retry of the same send preserves it. Editing text/caption, changing an attachment, selecting or changing a template or its variables, or changing send mode creates a new send intention. A successful send clears the current send and upload composer state.

### Implemented WhatsApp Session Policy

Free-form text and media send authority is server-side. The WhatsApp session is open only when `0 <= now - lastInboundAt < 24 hours`; no inbound timestamp, exactly 24 hours, more than 24 hours, or a future/skewed timestamp is closed. The UI reflects this state but is not authority. Both the mutation and dispatcher reauthorize and revalidate before submit. An `AVAILABLE` outbound Attachment never bypasses the session policy.

If the session closes after queueing but before dispatch, Twilio is not called, the Message becomes `FAILED`, the `DispatchAttempt` becomes `FAILED_BEFORE_SUBMIT`, and the safe error is `SESSION_WINDOW_CLOSED`; there is no automatic retry.

### Implemented Templates and Send Capabilities

The provider-neutral template catalog and dispatch path support currently approved WhatsApp templates with compatible textual `twilio/text` content. Rich, card, list, and media templates remain unsupported and fail closed. Template selection uses a local opaque ID; the public domain and UI do not know the Content SID, provider account, sender, or credentials.

`InconnectMessagingAuthorizedProviderContextService` centralizes the shared internal provider-context resolution without duplicating authorization. It authorizes the Conversation for send, derives the Provider Connection server-side, verifies its workspace and enabled state, decrypts credentials server-side, resolves the provider/channel through the registry, and returns an internal provider context. The frontend cannot provide or select a Provider Connection or provider. This service performs no provider network I/O.

`inconnectMessagingSendCapabilities(conversationId)` uses that authorized context, local `provider.capabilities`, local `provider.outboundMediaCapabilities`, and server session policy. Its safe provider-neutral DTO includes `canSend`, `canSendFreeform`, `canSendTemplate`, session-window state, expiry, safe reason information, and media hints: `canSendMedia`, `maxMediaItems`, `mediaTypes`, per-type `mimeTypes`, `maxBytes`, and `captionSupported`. These are UX hints only; upload completion, the send mutation, and the dispatcher remain MIME, size, session, authorization, and send authority. The DTO exposes no provider name, Provider Connection, sender, Content SID, upload/provider-media URL or token, storage path, or `FileEntity` authority.

Send-capability resolution must not call `provider.listTemplates()` or depend on the Twilio Content API. `canSendTemplate` means that the resolved provider structurally supports template dispatch; it does not mean that at least one approved/selectable remote template currently exists. Actual current template availability comes from the authorized template catalog and picker. A remote catalog outage must not disable unrelated `canSendFreeform`, `canSendMedia`, media count/type/MIME/size/caption hints, or session capability resolution.

`inconnectMessagingTemplates(conversationId)` uses the same authorized provider context and then calls `provider.listTemplates()` to normalize, filter, and fingerprint current templates. It returns a safe normalized DTO containing concepts such as local template ID, display name, language, textual preview, and variable descriptors. It never returns Content SIDs or raw provider metadata, and only currently usable, approved, supported templates are selectable. A remote catalog outage may fail this template-specific query according to its contract, but cannot fail send-capability resolution. Template-specific validation and send may legitimately re-resolve the catalog; free-form and media capability resolution may not.

Template variables have normalized keys and deterministic values. Required variables must be present; extras, duplicates, missing values, and provider/template constraint violations are rejected. Normalized variables participate in the idempotency fingerprint. Arbitrary raw JSON is never forwarded directly to Twilio.

Before a template submit, the Twilio adapter resolves the exact server-side provider reference and uses the official Content API/Message Resource path. The worker re-resolves that identity and compares `templateDefinitionFingerprint`; a modified or revoked template fails closed and is never silently substituted.

### Implemented Realtime Outbox and Subscription

Realtime publishing follows:

    domain transaction -> OutboxEvent PENDING -> COMMIT -> immediate enqueue
    -> BullMQ publishing job -> authorized member-scoped fanout -> Redis PubSub

The outbox publisher, BullMQ job, immediate enqueue after successful commit, member-scoped fanout, and at-least-once retry are implemented. Enqueue, processing, or publishing failure leaves durable PostgreSQL authority for retry by the one-minute recovery cron. That cron is a recovery fallback, not the normal publication path. An event with zero authorized recipients can complete without inventing recipients.

The dedicated metadata GraphQL subscription is `onInconnectMessagingEvent` on `INCONNECT_MESSAGING:{workspaceId}:{workspaceMemberId}`. Inbound, outbound, and media-readiness activity reuse the provider-neutral `MESSAGE_CREATED`, `MESSAGE_STATUS_CHANGED`, and `MESSAGE_UPDATED` hints with `eventId`, `eventType`, `conversationId`, optional `messageId`, and `occurredAt`; `MESSAGE_UPDATED` covers changes such as media ingestion completion or failure. There is no parallel outbound or file realtime channel. Hints contain no body, template details, address, location, file URL, bytes, MIME details, provider locator, CRM data, provider metadata, credentials, or raw webhook payload. The server enumerates candidate members and reauthorizes each recipient against current Conversation access before publishing; clients cannot choose workspace/member IDs and there is no system bypass. Revocation before publication prevents delivery.

PostgreSQL and the authorized Read API remain authority. Redis realtime is not a data store; duplicate hints are harmless, and reconnect triggers authorized API refetch rather than client-side historical replay. Never use generic object SSE or a workspace-wide stream as a Messaging authorization shortcut.

### Implemented Native Messaging Frontend

Twenty has a native Messaging navigation entry and route. Navigation visibility uses `INCONNECT_MESSAGING`, while backend authorization still decides which Conversations and Messages are returned. The inbox has a Conversation list, backend-authorized search, cursor pagination, selection, and Message history with older-message loading. It renders inbound and outbound bubbles, text, structured locations, authorized lazy image previews, visual stickers, authorized audio and supported video playback, document filename/type/size with authorized open/download, and safe vCard/contact presentation with download. `PENDING` media shows processing state; `FAILED`, `EXPIRED`, unavailable, and legacy media without an Attachment show a safe unavailable state. It also renders persisted outbound states and durable template audit details, handles desktop and narrow screens, loading/empty/error states, and lost access by clearing previously visible Conversation content. `MESSAGE_UPDATED` and other realtime hints, plus reconnect, cause localized authorized refetches.

The functional composer supports text free-form sends, a Send button, server-driven 24-hour-window UX, a template picker, dynamic variable inputs, a safe template preview, an attachment button, and a hidden accessible file picker. It supports one current attachment under the resolved provider capability, with `SELECTED`, `UPLOADING`, `FINALIZING`, `READY`, and `FAILED` lifecycle states, Retry, Remove/cancel, and explicit replacement by removing and selecting a new file. Uploading is an honest indeterminate state; no real percentage progress is claimed. Drag/drop and clipboard image paste are not implemented.

The outbound attachment flow is:

    select File
    -> generate clientUploadId
    -> createInconnectMessagingOutboundUpload
    -> use the exact backend upload capability
    -> PUT through feature-neutral uploadFileToUrl
    -> completeInconnectMessagingOutboundUpload
    -> backend validates stored bytes, MIME, and size
    -> READY
    -> sendInconnectMessagingMessage(outboundUploadIds)
    -> authorized Read API/realtime renders the persisted Message

The frontend never supplies a file ID, storage path, authoritative MIME, provider URL or provider-media token, sender, or Provider Connection. It creates one `clientUploadId` for one selected-file upload intention. Retry of that same intention, including upload or completion failure, preserves the ID; Remove plus a new selection/replacement creates a new ID. Conversation switch or authorization loss discards the old local upload intention. `clientUploadId` is upload idempotency and is distinct from `clientRequestId`, which is Message-send idempotency.

`IMAGE` and `STICKER` have a local visual preview; `AUDIO` and `VIDEO` use local browser playback when supported; `DOCUMENT` and `CONTACT` use a safe file representation. Object URLs are ephemeral and are revoked on Remove, replacement, successful send, Conversation switch/unmount, and authorization loss. Active PUT requests are aborted where possible. File bytes and object URLs are never persisted in localStorage or durable global state.

Late completion from an obsolete upload intention must never mutate the current composer. The current frontend uses an `AbortController`, aborted checks after asynchronous boundaries, and upload-intention identity guards. A late result from File A cannot replace File B after remove/replace, and a late upload from Conversation A cannot populate Conversation B. Attachment/upload state is Conversation-scoped; switching Conversation clears it, aborts the current PUT where possible, revokes previews, and never silently retargets staged media.

Caption/body support comes from provider media capabilities, not a universal frontend media-type rule. The current Twilio capability permits the current `IMAGE` caption behavior. Non-empty text with a media type that does not support captions blocks Send without silently erasing the draft.

Template and free-form outbound media are separate modes. Templates cannot send `outboundUploadIds`, media mode cannot retain template variables, and an existing attachment is not silently deleted when the template picker is opened or a template is selected; the user must explicitly resolve the conflict. Media templates are not implemented. Changing modes creates a new send intention.

When `canSendFreeform` is false, attachment selection and media Send are disabled while an existing attachment can still be removed; the template flow remains separate when available. If the session closes during upload or after the user initiates Send, the backend remains authority and safely returns `SESSION_WINDOW_CLOSED`; there is no automatic retry or media-to-template conversion. `NOT_FOUND`, `FORBIDDEN`, and `UNAUTHENTICATED` paths clear sensitive composer state, including previews, upload state, active requests, and the send intention, while preserving the existing unavailable-Conversation behavior.

The current safe Twilio capabilities expose outbound selection/upload/send for `IMAGE`, `STICKER`, audio files, `VIDEO`, `DOCUMENT`, and `CONTACT`/vCard. This does not include microphone voice recording, outbound `LOCATION`, or media templates. Successful media sends are not represented by a permanent optimistic local copy; they render through the existing authorized Message Read API, realtime hints, and Attachment descriptors/components.

The UI never controls Content SID, sender, Provider Connection, credentials, outbound state, session authority, storage paths, or provider media locators. The browser never loads Twilio `MediaUrl` directly, and media bytes are not persisted in localStorage or durable Jotai state. Messaging operations participate in metadata GraphQL codegen, and the frontend consumes generated metadata operation types rather than a parallel handwritten GraphQL contract.

### Current Metadata GraphQL Surface

Relevant queries are:

- `inconnectMessagingConversation`
- `inconnectMessagingConversations`
- `inconnectMessagingMessages`
- `inconnectMessagingTemplates`
- `inconnectMessagingSendCapabilities`

Mutations are:

- `createInconnectMessagingOutboundUpload`
- `completeInconnectMessagingOutboundUpload`
- `sendInconnectMessagingMessage`

`sendInconnectMessagingMessage` accepts opaque `outboundUploadIds`. Public GraphQL does not expose or accept `FileEntity` IDs, storage paths, provider URLs/tokens, sender, Provider Connection, or authoritative MIME. The subscription remains `onInconnectMessagingEvent`. Metadata GraphQL codegen was regenerated and validated successfully, and the frontend continues to consume generated metadata types rather than a parallel handwritten contract.

Send capabilities expose the safe provider-neutral media fields `canSendMedia`, `maxMediaItems`, `mediaTypes`, `mimeTypes`, `maxBytes`, and `captionSupported`. The final capabilities/catalog separation introduced no new GraphQL contract; 8B2 metadata codegen was regenerated successfully.

### Validation Checkpoint

The current Messaging checkpoint has green composer tests and complete frontend Messaging regression coverage, green backend send-capabilities/template-catalog tests, and focused generic upload-transport regression coverage. Direct frontend TypeScript typecheck, touched-file typed lint, diff lint, format, metadata codegen, and diff checks passed. Validation covers stale remove/replace and Conversation-switch upload completions, object URL cleanup, and alignment of safe MIME, size, and caption hints with backend policy. Send capabilities no longer call `provider.listTemplates()` or depend on Twilio Content API; remote template catalog access remains isolated to template-specific flows. No database change was required for the attachment composer, and validation made no real Twilio, WhatsApp, provider catalog, storage, or upload calls.

Outbound upload/media tests and core `FileUploadService` regression tests are green. Read, subscription, human file-access, and provider-media paths preserve their authorization boundaries, including non-disclosing attachment access. Metadata codegen confirmed the upload mutations and opaque send references without exposing file/storage/provider authority. Review found no provider JWT token-type confusion; the provider endpoint is exact Attachment/workspace scoped, and the core `FileUploadService` coupling to INCONNECT was removed.

The inbound-attachment Fast Instance Command was exercised against real disposable PostgreSQL. Entity/schema parity, PRE-8A compatibility, `up`/`down` behavior with `STICKER`, `CONTACT`, and Attachments, physical workspace/File isolation, and download authorization/security were confirmed; the disposable database was removed. This does not assert that the command ran in production.

The outbound-staging Fast Instance Command is `2-32-instance-command-fast-1789768800000-add-inconnect-messaging-outbound-uploads.ts`. Its real `up` was executed against disposable PostgreSQL and accepted PRE-outbound-staging data. Validation confirmed physical parity with `InconnectMessagingOutboundUploadEntity`, actor-scoped uniqueness, workspace-isolated File and consumed-Message references, and no need for a Slow Command. Its real `down` succeeded with `CREATING`, `PENDING`, `AVAILABLE`, and `CONSUMED` rows: the staging table was removed while Message, Attachment, and File rows remained. The disposable database was removed. This does not assert that the command ran in production.

### Planned Boundaries

Personal/shared state is approved but **NOT IMPLEMENTED**: Favorite and Unread are personal per Workspace Member; Pending is shared Conversation state. `ConversationMemberState` does not exist yet.

The outbound media backend **IS IMPLEMENTED**: secure actor/workspace-scoped staging, upload completion and validation, deterministic `FileStorage`/`FileEntity` preparation, transactional outbound Message + Attachment consumption, Twilio free-form media dispatch, and provider-media capability delivery.

The user-facing outbound attachment composer **IS IMPLEMENTED**: attachment button, accessible file picker, indeterminate upload/finalization state UX, Retry, Remove, local previews, and send-media UX for one capability-supported attachment. Replacement is explicit Remove plus a new selection; there is no separate multi-file replacement workflow.

Still **NOT IMPLEMENTED**: drag/drop, clipboard image paste, microphone/voice recording, outbound `LOCATION`, rich/media templates, multi-attachment composer UX, reactions, Favorite, Unread, operational Pending, `ConversationMemberState`, a CRM Lead context panel, Lead matching, auto-link, automatic Lead creation, CRM owner changes from Messaging, historical media backfill, automatic `FileEntity`/FileStorage garbage collection or reconciliation, a dedicated provider-media TTL, template administration/editor, or creating, editing, or approving Twilio templates inside Twenty. The current picker only consumes supported provider-existing templates. No next product phase is selected by this handoff.

### Local Development Runtime

This checkout expects WSL/Linux for local Codex work. Node Linux v24.16.0 and repository Yarn 4.13.0 were validated. Do not mix Windows-installed `node_modules` native bindings with WSL Node, Nx, or Jest. A WSL `yarn install --immutable` restored Linux bindings without changing `yarn.lock`.

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

Historical local Git evidence from 2026-09-10, not the current Messaging checkpoint:

- Stable product branch: `inconnect-main`.
- Checkout at that time: feature branch `feature/inconnect-messaging`; it was not a stable release.
- HEAD at that time: `7583c51d323633e1cd1e1790f203f0ea9ec1b584` - `feat: add INCONNECT Messaging security foundation`.
- `origin`: `https://github.com/xxHarper/twenty-inconnect.git`.
- `upstream`: `https://github.com/twentyhq/twenty.git`.
- The worktree was clean at that preflight.
- No fetch was performed; remote-tracking freshness and divergence were not inferred.

The earlier 2026-08-24 checkpoint at `6be7733df3` remains historical context in Git history, not current repository state. Always re-run Git inspection before acting; this snapshot is dated and is not authority for future operations.

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

### Messaging Rules

- Do not create parallel permission, owner, or Team systems for Messaging.
- Human operations must go through `InconnectMessagingAuthorizationService`; do not add resolver/controller/repository shortcuts.
- Consume Record Access only through `InconnectRecordAccessAuthorizationService`; Messaging must not consume raw policies, cache payloads, Team maps, owner parsing, source-mode internals, or generation fencing.
- Preserve fail-closed behavior and enforce list/count/search/pagination scope in backend SQL, never in memory or the frontend.
- Never hardcode Lead, schema, physical table, owner field, workspace, ObjectMetadata, Role, or Workspace Member identifiers.
- Keep the domain provider-neutral and do not couple it to Twilio.
- PostgreSQL is operational authority. BullMQ may provide at-least-once transport but is never authority.
- Do not reuse email `modules/messaging` as the WhatsApp domain.
- Human send must always use `InconnectMessagingAuthorizationService`; never trust frontend session-window state or send capabilities as authority.
- Outbound staging is actor/workspace scoped and never substitutes for current Conversation authorization; reauthorize the Conversation at send time.
- Public clients never choose server-owned `FileEntity` IDs.
- Keep core `FileUploadService` feature-neutral; INCONNECT owns its upload folder, logical type, MIME, size, actor authorization, and staging policy.
- Keep shared frontend upload transport feature-neutral; `uploadFileToUrl` must use only the exact backend capability and caller-supplied transport inputs, without provider or product policy.
- Never expose or accept a Twilio Content SID as frontend template identity; provider references remain server-side.
- `clientUploadId` identifies one selected-file upload intention: preserve it for retries of that intention and replace it for a new selection.
- `clientRequestId` identifies one Message-send intention: preserve it for uncertain retries of the same send and replace it when text/caption, attachment, template, variables, or mode changes.
- Stale asynchronous upload results must never mutate a newer upload intention or a different Conversation. Conversation switches must clear local attachment state rather than silently retarget staged media.
- Frontend media accept, size, and caption hints derive from safe server capabilities. Upload completion, send, session, MIME, and size enforcement remain backend authority.
- Send capabilities must use local provider capabilities and must never call the remote template catalog. `canSendTemplate` means structural provider template support, not current remote-template availability; catalog/provider network failure must not disable independent free-form or media capabilities.
- Keep template mode and free-form outbound media separate until media templates receive an explicit design.
- Do not blindly retry ambiguous provider outcomes, including media submits; preserve `UNKNOWN` semantics and the conservative provider-submit boundary.
- Template history must not depend on the current provider catalog.
- Do not create a parallel outbound pipeline for templates; free-form and templates converge on durable `Message` and `DispatchAttempt` processing.
- Keep Messaging realtime member-scoped; reauthorize each recipient against current Conversation access before publishing a hint. Never use a workspace-wide or generic object stream as an authorization shortcut, and never substitute hints for authorized API reads/refetches.
- A provider media URL is never a frontend or product download URL. Never expose it, and never fetch an arbitrary client-supplied media URL. Provider-media capability is exact-purpose transport authority, not human authorization, and its URL/token must never appear in normal frontend APIs.
- Inbound media must become durable through Twenty `FileEntity`/FileStorage; do not create a parallel Messaging storage system or treat Twilio as historical media storage.
- Outbound media must converge on the existing durable `Message` + `Attachment` + `DispatchAttempt` pipeline; Attachment `AVAILABLE` is independent of Message delivery state, and free-form media obeys the server-authoritative 24-hour session policy.
- Do not authorize files from only `workspaceId + fileId` or `workspaceId + attachmentId`; always reauthorize the owning Conversation and, when linked, its anchor record before opening a stream.
- Keep Attachment creation, ingestion, and recovery idempotent and PostgreSQL-authoritative; BullMQ deduplication is not the correctness boundary.
- Preserve `LOCATION` as structured content rather than an Attachment, and preserve normal Unicode/emoji as `TEXT` rather than introducing an emoji type.
- Legacy media metadata without an Attachment remains valid unless an explicit historical backfill is separately authorized.
