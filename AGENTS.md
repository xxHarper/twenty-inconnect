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

This section is the authoritative technical handoff for INCONNECT. It supplements the repository-wide instructions above and describes current capabilities rather than implementation chronology. The 2026-09-23 checkpoint on `feature/inconnect-messaging` includes Twilio inbound, secure inbound media ingestion into `FileEntity`/`FileStorage`, authorized attachment access, rich inbound `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, `CONTACT`, and `LOCATION` content, media-ready realtime updates, real frontend media rendering, the authorized Read API, the native inbox, outbound free-form Messaging, server-authoritative WhatsApp session policy, durable dispatch, templates, the functional composer and template picker, secure outbound media backend preparation, actor/workspace-scoped upload staging, deterministic and idempotent server-owned file identities, `FileStorage`/`FileEntity` outbound preparation, transactional outbound `Message` + `Attachment` consumption, provider-neutral media dispatch, Twilio outbound media delivery, an expiring provider-media capability, metadata GraphQL upload mutations, the user-facing attachment composer, the secure dynamic CRM Conversation context backend, and the visible dynamic CRM Conversation context panel. CRM context includes ordered context-field presentation configuration, an authorized CRM record context query, standard object and field permission enforcement, INCONNECT Record Access on the final CRM `SELECT`, safe normalized field DTOs, management APIs for context-field configuration, live authorized context reads for the selected Conversation, a desktop third-pane experience, and a narrow/mobile fullscreen context experience. The visible panel is read-only: it does not add CRM editing, linking, matching, related lists, CRM realtime, or a Settings UI for context configuration. The composer provides a file picker, secure outbound upload UX, honest selection/upload/finalization states, retry and remove, local previews, capability-driven captions, and media send through opaque `outboundUploadIds`. The native inbox also provides server-backed `ALL | UNREAD | FAVORITES | PENDING` views, unread visual treatment, personal Favorite controls, shared Pending controls, manual Mark Read/Mark Unread, and conservative automatic read through a server-derived snapshot target.

Conversation work state is implemented end to end: personal Favorite, personal derived Unread, shared manual Pending, `ConversationMemberState`, a PostgreSQL-owned unread rollout baseline, authorized SQL filtering, visible inbox controls, work-state mutations, and the durable shared-Pending `CONVERSATION_UPDATED` hint. Immediate personal Favorite/read cross-device realtime is not implemented; personal state in other tabs or devices converges through normal refetch or reconnect. This feature branch is a development checkpoint, not a stable product release. Live Git state remains authority; older dated evidence below is historical, and local validation never implies that a migration or command ran in production.

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

INCONNECT Messaging is a provider-neutral native Twenty feature with durable inbound processing, secure rich-media ingestion, authorized reads and file access, secure realtime, a secure outbound media backend, a secure dynamic CRM Conversation context backend, and a functional Messaging frontend. The native inbox supports inbound and outbound Messaging, text free-form, templates, attachments/media, a secure composer, server-backed All/Unread/Favorites/Pending views, personal Favorite and Unread, shared Pending, manual Read/Unread, safe automatic read, and a visible dynamic CRM Conversation context experience that consumes the secure context backend. The selected Conversation displays context in a desktop third pane or a narrow/mobile fullscreen modal. Immediate personal cross-device realtime is not part of this capability. It is not a Twenty App and must not reuse `modules/messaging` email functionality as the WhatsApp domain. Twilio remains behind the provider port; provider-specific concepts must not become domain authority.

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
- `InconnectMessagingConversationMemberStateEntity` / `core.inconnectMessagingConversationMemberState`
- `InconnectMessagingContextFieldEntity` / `core.inconnectMessagingContextField`

These are core operational or operational-configuration tables, not workspace objects. `ContextField` is ordered presentation configuration: it is not syncable metadata, a Record Access policy, or a copy of CRM data. PostgreSQL is the operational authority: do not introduce dual-write authority. The persistence spine supplies durable-inbox and transactional-outbox records, idempotency keys, leases, `DispatchAttempt` audit, checks, and workspace-isolated composite foreign keys. Twilio webhook receipt processing and inbox recovery, inbound media ingestion and recovery, outbound WhatsApp dispatch, realtime outbox publishing, and their BullMQ workers are implemented. BullMQ is at-least-once transport and must never become authority.

An Attachment has the durable logical identity `Message + ordinal`, a provider-neutral attachment type, and one of the ingestion states `PENDING`, `PROCESSING`, `AVAILABLE`, `FAILED`, or `EXPIRED`. It stores an opaque server-only provider media locator only while needed for ingestion, an optional workspace-isolated `FileEntity` reference, lease and attempt data, and safe presentation metadata. Composite foreign keys prevent its Message, workspace, and Provider Connection from diverging and require a referenced File to belong to the same workspace. A File cannot be deleted while an Attachment references it; Message deletion cascades its Attachments.

An Outbound Upload is actor/workspace-scoped staging with states `CREATING`, `PENDING`, `AVAILABLE`, and `CONSUMED`. It persists workspace, uploading Workspace Member, actor-scoped `clientUploadId`, provider-neutral media type, safe filename, size, workspace-local `FileEntity`, detected MIME, durable content fingerprint, expiration, and optional consumed Message/timestamp. Idempotency is unique by workspace + actor + `clientUploadId`; composite references keep File and consumed Message in the same workspace. PostgreSQL remains staging and consumption authority.

`MessagingConfiguration` selects the anchor through a real workspace-local `ObjectMetadata` reference. A `Conversation` references the CRM record with:

    workspaceId
    linkedRecordObjectMetadataId
    linkedRecordId

The linked tuple is either fully null or fully present, and a composite FK requires its ObjectMetadata to match the configured workspace anchor. Runtime authority must not come from physical names, schema names, a hardcoded `lead`, an owner column, or a universal identifier. Dynamic table and owner details come from live metadata.

`Message.providerConnectionId` is persisted because provider message identity is connection-scoped. Its composite FK `(conversationId, providerConnectionId, workspaceId)` to `Conversation` prevents the Message connection or workspace from diverging from its Conversation. Retry lineage is also connection/workspace constrained.

`MessagingConfiguration` is a singleton per workspace. Its real identity is `workspaceId`; it has no independent `id`. `ContextField` must never introduce or persist an artificial `messagingConfigurationId`. Its persisted fields are `id`, `workspaceId`, `objectMetadataId`, `fieldMetadataId`, `ordinal`, `createdAt`, and `updatedAt`, and the workspace singleton is the logical configuration identity.

The physical configuration/anchor FK is `(ContextField.workspaceId, ContextField.objectMetadataId) -> (MessagingConfiguration.workspaceId, MessagingConfiguration.anchorObjectMetadataId)`. It guarantees that every configured field belongs to the same workspace and the exact configured Messaging anchor; another object in the same workspace is not valid. The physical metadata FK is `(ContextField.fieldMetadataId, ContextField.objectMetadataId, ContextField.workspaceId) -> (FieldMetadata.id, FieldMetadata.objectMetadataId, FieldMetadata.workspaceId)`, so a configured Field must belong to that exact object and workspace. Uniqueness is `(workspaceId, fieldMetadataId)` and `(workspaceId, ordinal)`, with `ordinal >= 0`; ordering is deterministic. The application maximum is 20 configured fields and is intentionally not a PostgreSQL maximum check.

`ContextField` cascades from Workspace, the MessagingConfiguration anchor relation, and FieldMetadata. Presentation rows cannot remain as cross-workspace or cross-object orphans. Removing presentation configuration never deletes or rewrites CRM record data.

### Implemented Dynamic CRM Conversation Context

The secure runtime flow is:

    conversationId
    -> authorize Conversation
    -> derive configured anchor
    -> linkedRecordObjectMetadataId + linkedRecordId
    -> live metadata
    -> Twenty standard object and field permissions
    -> INCONNECT Record Access
    -> configured readable fields
    -> safe normalized context DTO

The context system is generic and anchor-driven. Never hardcode Lead, Folio ISO, phone, email, stage, phase, owner, or physical schema/table/column names. Lead and Folio ISO may be locally configured objects, but they are never product authority.

The public query is `inconnectMessagingConversationContext(conversationId)`. The client supplies only `conversationId`; workspace, record ID, ObjectMetadata, FieldMetadata, schema, table, and physical columns are derived server-side. Unauthorized or cross-workspace Conversation IDs retain the existing non-disclosing null/not-found behavior. A linked Conversation also returns that safe behavior if current Conversation authorization fails, Record Access is revoked, the anchor record disappears, or the final scoped query returns no row; never disclose that a forbidden record exists.

Public context states are `UNASSIGNED` and `LINKED`. An authorized `UNASSIGNED` Conversation has both linked-record fields null and returns null object/record data with an empty field list. It performs no CRM query, matching, auto-link, or record creation.

Runtime context requires an authenticated Workspace, a valid human Workspace Member, `INCONNECT_MESSAGING`, current Conversation authorization, Twenty standard object read permission, current Twenty field read permission, and INCONNECT Record Access. `ContextField` is only a presentation allowlist and never grants record or field access. Configured fields are filtered for the current actor on every request; unreadable fields are neither selected nor returned and have no revealing placeholder. Actor-specific readable fields are never persisted in ContextField.

Authorization is retained on the actual dynamic CRM record query through `applyReadScopeToQueryBuilder`; a prior Conversation check is not a substitute. The workspace schema is derived server-side, the table comes from validated ObjectMetadata through Twenty helpers, columns come from live configured and readable FieldMetadata, and the record UUID is parameterized. Client-controlled strings never become SQL identifiers. One record-value query retrieves all readable configured values; there is no per-field value query.

`recordLabel` uses only `ObjectMetadata.labelIdentifierFieldMetadataId` when that Field is supported and readable by the current actor. It may be selected for this purpose even when it is not configured as a ContextField. If it is absent, unsupported, or unreadable, `recordLabel` is null; there is no fallback to another text field, phone, email, record ID, or arbitrary configured Field.

Safe runtime field DTOs expose only `fieldMetadataId`, label, `valueKind`, `displayValue`, and ordinal. The context summary may expose state, `objectMetadataId`, a safe object label, `recordId`, and `recordLabel`. It never exposes a raw entity or record JSON, physical schema/table/column identifiers, Record Access decisions or owner scopes, provider metadata, or private metadata internals.

Supported mappings are centralized:

- `TEXT`, `UUID`, `FULL_NAME` -> `TEXT`
- `NUMBER`, `NUMERIC` -> `NUMBER`
- `BOOLEAN` -> `BOOLEAN`
- `DATE` -> `DATE`
- `DATE_TIME` -> `DATE_TIME`
- `EMAILS` -> `EMAIL`
- `PHONES` -> `PHONE`
- `LINKS` -> `URL`
- `SELECT`, `RATING` -> `SELECT`
- `MULTI_SELECT` -> `MULTI_SELECT`

Normalization uses Twenty's actual composite shapes. `FULL_NAME` becomes deterministic safe text and never `String(object)`; EMAILS exposes only the primary safe email; PHONES only the primary calling code plus number; LINKS only the primary URL; SELECT and RATING use safe configured option labels; MULTI_SELECT uses deterministic ordered labels. Null and empty inputs have safe null behavior, and HTML is never presentation authority.

`RELATION` and `MORPH_RELATION` are unsupported ContextFields. They are absent from candidates, rejected by replacement validation, never dynamically joined, and never expose related IDs. There is not yet a generic OSS relation resolver that preserves standard permissions, target-object Record Access, and workspace isolation simultaneously; owner relations are not special-cased. Related Folio ISO or child lists, Activities, Tasks, and arbitrary relations are not implemented, and no Lead-specific related query exists.

Context values are live reads. Messaging stores neither a CRM value snapshot nor actor-specific field-access results. PostgreSQL CRM records, live metadata, and current permissions remain authority. Fase 10A is read-only for CRM records: editing fields, owner/stage/phase changes, link/unlink, matching, auto-link, and record creation are not implemented. Configuration mutations change presentation configuration only. No generic CRM-object realtime/SSE was introduced; existing Messaging realtime is unchanged, and live CRM-context realtime requires separate design.

Context configuration management exposes `inconnectMessagingContextConfiguration` and `replaceInconnectMessagingContextConfiguration(fieldMetadataIds)`. The management query returns the current ordered configuration, safe supported candidates, and a minimal safe anchor summary, never CRM values or physical metadata. Candidates belong to the same workspace and exact configured anchor, use a supported type, and have deterministic ordering without product-specific priority.

Replacement input is only an ordered list of FieldMetadata IDs. The server derives workspace, object, ordinal, and physical identity; an empty list is valid and no default fields are auto-selected. Management requires an authenticated Workspace, a valid human Workspace Member, `MANAGE_INCONNECT_MESSAGING`, the existing settings/permission guard, and service-level revalidation. Manage permission does not imply Conversation access, send, or CRM record read.

Replacement locks the workspace-singleton MessagingConfiguration with `pessimistic_write`, validates the complete input before persistence, then deletes and inserts transactionally with server-generated ordinals. Concurrent valid writers serialize on the singleton row; the last valid serialized replacement wins. This is not optimistic revision control.

### Implemented Conversation Work State

`ConversationMemberState` is durable personal state with `id`, `workspaceId`, `conversationId`, `workspaceMemberId`, `favorite`, the tuple `lastReadMessageCreatedAt + lastReadMessageId`, `manualUnread`, `createdAt`, and `updatedAt`. Its logical identity is unique by workspace + Conversation + Workspace Member. Favorite and Unread are personal; they are never global Conversation fields. `Conversation.pendingAt` is shared Conversation state: null means not pending and non-null means pending.

Pending is currently manual. It is not activated automatically by inbound activity, cleared automatically by a reply, or derived from unread, owner, Record Access, or Commercial Teams. `setInconnectMessagingConversationPending(conversationId, pending)` locks and updates the Conversation and, only for a real state transition, persists `CONVERSATION_PENDING_CHANGED` in the durable Outbox in the same transaction. Publication is requested after commit. A same-value mutation is a no-op, and changing Pending does not require `SEND_INCONNECT_MESSAGING`.

`MessagingConfiguration.workStateTrackingBaselineAt` is a PostgreSQL/server-owned rollout timestamp. When a Workspace Member has no personal read cursor, it is the effective read baseline: historical inbound before the baseline is read by default, while inbound persisted after the baseline is unread. There is no Conversation × Workspace Member backfill, and listing Conversations never creates `ConversationMemberState` rows.

Unread is derived, not a persisted simple boolean:

    isUnread = manualUnread
      OR EXISTS INBOUND Message newer than the effective arrival cursor/baseline

Only `INBOUND` Messages participate. `OUTBOUND` Messages never create unread, PostgreSQL Message history remains authority, and new inbound processing does not fan out writes to a personal-state row for every possible recipient. This avoids NxM writes, stale authorization snapshots, and coupling inbound persistence to personal-state fanout.

The normal new-inbound path is `persist inbound Message -> existing MESSAGE_CREATED hint -> authorized client refetch -> server compares the current member's arrival cursor/baseline -> isUnread may become true`. The realtime hint triggers a safe refetch; it is not personal-state authority.

Message display chronology and personal unread arrival order are deliberately independent:

- Message history/display uses `COALESCE(effectiveInboundAt, createdAt), id` to represent the effective/provider-facing chat chronology.
- Read/unread uses the server-owned arrival tuple `Message.createdAt, Message.id` to represent when the Message reached and was persisted by this server.

Never unify these orders. A delayed inbound may have `createdAt` after the current read cursor but an older `effectiveInboundAt`, so it may appear earlier in visual history while still becoming unread. For example, after reading through M10, a later-arriving M11 with `M11.createdAt > M10.createdAt` and `M11.effectiveInboundAt < M10.effectiveInboundAt` is unread; mark-all-read then advances to M11 by arrival order. This is intentional behavior.

The durable personal cursor is `(lastReadMessageCreatedAt, lastReadMessageId)` and represents exactly `(Message.createdAt, Message.id)`. The UUID is only a deterministic tie-break when two Messages have equal `createdAt`; it carries no chronological meaning. Cursor advancement is monotonic, so a stale Mark Read cannot move it backward.

PostgreSQL `timestamptz` preserves microseconds while JavaScript `Date` preserves only milliseconds. The read cursor must therefore never perform `SELECT Message.createdAt -> JavaScript Date -> persist timestamp`. Mark Read selects and persists the exact `Message.createdAt + Message.id` tuple directly inside PostgreSQL. JavaScript does not transport the cursor timestamp, preventing an already-read Message from remaining newer than its own truncated cursor.

`markInconnectMessagingConversationRead(conversationId, throughMessageId?)` has two modes:

- With `throughMessageId`, the Message must belong to the same workspace and Conversation and be `INBOUND`; PostgreSQL supplies its exact arrival tuple, and the cursor can only advance.
- Without `throughMessageId`, it means “mark all currently existing inbound Messages as read”; PostgreSQL selects `ORDER BY Message.createdAt DESC, Message.id DESC LIMIT 1` and persists that tuple exactly. If no inbound exists, it clears `manualUnread` without fabricating a cursor.

`markInconnectMessagingConversationUnread(conversationId)` sets `manualUnread = true` without rewinding either cursor component. Mark Read advances the cursor monotonically and clears `manualUnread`. Thus a manual-unread cursor at M10 remains unread through a later M11, and Mark Read through M11 produces cursor M11 with `manualUnread = false`, read unless a newer inbound exists.

Favorite is exclusively personal. Without `ConversationMemberState`, `isFavorite` is false. `setInconnectMessagingConversationFavorite` operates only on the authenticated Workspace Member; clients never submit `workspaceMemberId`, there is no global Favorite or admin override, and APIs never expose who else favorited a Conversation.

Favorite, Mark Read, Mark Unread, and Pending require an authenticated human Workspace Member, `INCONNECT_MESSAGING`, and current Conversation authorization. The existing `TRIAGE_INCONNECT_MESSAGING` contract applies to unassigned Conversations. These work-state operations do not require `SEND_INCONNECT_MESSAGING`; personal identity always comes from the auth context, and system context is not a human shortcut.

Physically, `ConversationMemberState` has a Workspace FK and a composite Conversation + workspace FK. It intentionally has no physical FK to Workspace Member because Workspace Members live in dynamic per-workspace schemas. Workspace Member validity is a runtime-only invariant enforced through centralized authorization. A removed member may leave an orphan personal-state row; it cannot become another member's state, block the Conversation, or be read through another actor. Explicit orphan-state GC may be added later.

Conversation queries resolve authorization, current-member state, search, and the `ALL | UNREAD | FAVORITES | PENDING` predicate in SQL before count, ordering, and pagination. Favorite and Unread always use only the authenticated Workspace Member; filters accept no member ID. Never fetch a page and post-filter work state in memory or the frontend. The physical model supports this with unique workspace + Conversation + member identity, a current-member Favorite lookup index, a Message unread index on workspace + Conversation + direction + createdAt + id, and the direct `Conversation.pendingAt` predicate; there is no per-Conversation N+1 personal-state query.

The authorized Message connection exposes nullable `readThroughMessageId` for conservative automatic read. It is an opaque, read-only, server-derived Message UUID scoped by the authorized workspace and Conversation. The server selects only `INBOUND` Messages using arrival order `Message.createdAt DESC, Message.id DESC`; it never exposes the cursor timestamp, `manualUnread`, `ConversationMemberState`, Workspace Member identity, or a provider/effective timestamp as read authority.

`readThroughMessageId` is snapshot-safe: the latest relevant arrival inbound is returned only when that Message is part of the slice actually returned by the current authorized Message page. A row fetched only as the pagination lookahead for `hasNextPage` is not presented and cannot become the target. If the newest arrival inbound is outside the current visual page, the field is null, the Conversation remains unread, and automatic read must not run. If a delayed inbound is present in the returned slice, it may be the target even when provider/effective display chronology places it behind visually newer Messages; clients must never choose `edges[0]` as a substitute for arrival semantics.

The Fast Instance Command `2-32-instance-command-fast-1790006024000-add-inconnect-messaging-conversation-work-state.ts` adds the `ConversationMemberState` table, `Conversation.pendingAt`, `MessagingConfiguration.workStateTrackingBaselineAt`, and their work-state indexes and constraints. Real disposable-PostgreSQL validation established PRE-9 compatibility, rollout-baseline behavior, no NxM state backfill, entity/schema parity, Favorite uniqueness, workspace/Conversation FK enforcement, the read-cursor tuple check, Pending state, successful real `up` and `down`, valid PRE-9 restoration, and no required Slow Command. This does not assert execution in production.

Architecturally, `down` removes `ConversationMemberState`, Pending schema, the work-state baseline, and only the Fase 9 indexes, while Messages and Conversations remain. Loss of Favorite, Unread, and Pending state on downgrade is intentional. Persisted `CONVERSATION_PENDING_CHANGED` Outbox rows may remain valid because Outbox `eventType` has no physical allowlist constraint; no downgrade migration defect was found.

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

The metadata GraphQL schema exposes `inconnectMessagingConversation(id)`, `inconnectMessagingConversations(search, workState, paging)`, and `inconnectMessagingMessages(conversationId, paging)`. Conversation work-state filtering supports `ALL`, `UNREAD`, `FAVORITES`, and `PENDING`. The authorized list provides edges, total count, search, and cursor pagination; Message history has deterministic newest-first cursor pagination. Responses use safe DTOs, never TypeORM entities or provider metadata.

`InconnectMessagingAuthorizationService` remains the authority. Linked Conversations require Twenty standard permission on the configured CRM anchor **and** INCONNECT Record Access. Unassigned Conversations require `INCONNECT_MESSAGING` **and** `TRIAGE_INCONNECT_MESSAGING`. Direct unauthorized Conversation lookup returns null/not found without existence disclosure, and Message access first authorizes its Conversation. Backend SQL applies authorization, current-member state, search, and work-state predicates before count, ordering, and pagination; the frontend does not reconstruct record access or post-filter results.

Conversation DTOs expose `isFavorite` and `isUnread` for the current actor and shared `isPending`. They never expose raw `ConversationMemberState`, `workspaceMemberId`, `manualUnread`, the read cursor, the tracking baseline, or favorited-by/read-by lists.

Authorized Message pagination additionally exposes nullable `readThroughMessageId`. It is returned only when the latest relevant inbound by server arrival order is actually included in the returned slice; null means that snapshot has no safe automatic-read target. It is an opaque target for the existing Mark Read mutation, not a personal read cursor or a replacement for backend unread authority.

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

The dedicated metadata GraphQL subscription is `onInconnectMessagingEvent` on `INCONNECT_MESSAGING:{workspaceId}:{workspaceMemberId}`. Inbound, outbound, media-readiness, and shared Conversation activity use the provider-neutral `MESSAGE_CREATED`, `MESSAGE_STATUS_CHANGED`, `MESSAGE_UPDATED`, and `CONVERSATION_UPDATED` hints with `eventId`, `eventType`, `conversationId`, optional `messageId`, and `occurredAt`; `MESSAGE_UPDATED` covers changes such as media ingestion completion or failure.

Shared Pending follows `Conversation.pendingAt transition -> CONVERSATION_PENDING_CHANGED OutboxEvent -> durable outbox -> current authorized recipients -> member-scoped Redis channel -> CONVERSATION_UPDATED -> authorized refetch`. Its hint identifies the event and Conversation, with `messageId` null or absent. It never contains Workspace Member identity, Favorite, `manualUnread`, or a read cursor. There is no workspace-wide publication or parallel outbound/file realtime channel. Hints contain no body, template details, address, location, file URL, bytes, MIME details, provider locator, CRM data, provider metadata, credentials, or raw webhook payload. The server enumerates candidate members and reauthorizes each recipient against current Conversation access before publishing; clients cannot choose workspace/member IDs and there is no system bypass. Revocation before publication prevents delivery.

PostgreSQL and the authorized Read API remain authority. Redis realtime is not a data store; duplicate hints are harmless, and reconnect triggers authorized API refetch rather than client-side historical replay. Never use generic object SSE or a workspace-wide stream as a Messaging authorization shortcut.

The inbox treats realtime as list-membership invalidation, not state authority. `MESSAGE_CREATED` refetches the current authorized Conversation list and, for the selected Conversation, its current detail/Messages; this allows a previously absent row to enter `UNREAD` only after the backend derives it. `CONVERSATION_UPDATED` refetches the current list and selected detail so shared Pending membership can change. `MESSAGE_STATUS_CHANGED` and `MESSAGE_UPDATED` retain their localized selected-detail/Message refresh behavior. Reconnect refetches the current authorized list and selected detail. All list refetches preserve active search and `workState`; they must not fall back to `ALL` or an empty search.

Immediate cross-tab/device synchronization for personal Favorite and direct read/unread mutations is not implemented. This is distinct from a new inbound `MESSAGE_CREATED` hint causing an authorized refetch whose server-derived result may become unread. Never invent a shared personal-state broadcast.

### Implemented Dynamic CRM Conversation Context Panel

The selected Conversation has a visible, read-only dynamic CRM context experience. The frontend consumes exclusively `inconnectMessagingConversationContext(conversationId)` and supplies only `conversationId`. It does not issue a second generic CRM-record query or reconstruct workspace, record authorization, ObjectMetadata, FieldMetadata, permissions, Record Access, or context-field selection. The secure Fase 10A backend remains the sole context authority.

The panel is generic and renders only the safe context DTO. It has no knowledge of Lead, Folio ISO, phone/celular, email/correo, stage/etapa, phase/fase, owner, API field names, or physical schema/table/column names. Never branch on an object identity, Field name, or product-specific Field label in this frontend path.

On viewports wider than 1100 px, context renders as a third pane with responsive width `clamp(280px, 26vw, 360px)`, its own header area, and independently scrolling content; the Conversation list and chat remain usable. The pane is fixed/responsive, not resizable. At 1100 px or narrower, the UI does not attempt to show all three panes simultaneously. The selected Conversation header exposes the accessible `Show CRM context` action, which opens the context in Twenty's existing fullscreen modal. Closing it returns to the same selected chat; the Conversation and composer remain mounted, preserving draft and composer state.

Context is queried only for the currently selected Conversation: one request per selected-Conversation load or authorized refetch. There is no per-row query, list prefetch, per-field query, or second generic CRM read. With no selected Conversation, there is no context query or stale context display.

Conversation-switch privacy is a permanent invariant. Request state is bound to `conversationId + refreshNonce`; when selection changes from A to B, A's label and values disappear synchronously and B shows its loading state. A late response for A is ignored and cannot populate B. Apollo uses `fetchPolicy: network-only` and `nextFetchPolicy: network-only`, does not render `previousData`, and returns loading with null context whenever request identity is stale or mismatched. Re-entering a Conversation performs a new authorized network read; Apollo cache is not context authority because CRM context is authorization-sensitive live data.

An SSE reconnect visually invalidates the current context, increments the context refresh nonce, and refetches only the currently selected Conversation with the same `conversationId`. Messaging realtime is not CRM realtime: `MESSAGE_CREATED`, `MESSAGE_UPDATED`, `MESSAGE_STATUS_CHANGED`, and `CONVERSATION_UPDATED` do not invalidate CRM context merely because they occurred. There is no CRM polling, generic-object SSE, CRM-field subscription, or workspace-wide CRM realtime. Current context refresh occurs through selection, re-entry, or reconnect; a Pending change is not CRM invalidation.

For `LINKED`, the panel renders the safe object label, canonical `recordLabel` when available, and configured fields in server-returned order. The raw `recordId` is not the primary visible identity. A null `recordLabel` displays the localized `Unlabeled record`; it never falls back to the record ID, first configured Field, phone, email, or object label. For `UNASSIGNED`, the panel displays the localized `No CRM record linked.` and performs no search, create, matching, auto-link, linking action, or additional CRM lookup. `LINKED` with an empty `fields` list is valid: the object/record summary remains and the panel displays `No context fields configured.` without fetching arbitrary fields or inferring defaults.

Each field renders its safe label and backend `displayValue` in backend order; ordinal/server order remains authority and the frontend does not alphabetize or prioritize fields. A null display value renders `—` with accessible `No value` semantics. Unauthorized fields are omitted by the backend and are not represented as null placeholders. Current safe value kinds are `TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `DATE_TIME`, `EMAIL`, `PHONE`, `URL`, `SELECT`, and `MULTI_SELECT`. `valueKind` remains safe metadata while `displayValue` is presentation authority. The frontend never recreates normalization for `FULL_NAME`, `EMAILS`, `PHONES`, `LINKS`, SELECT options, or MULTI_SELECT.

All context values render as plain text. The context path adds no `dangerouslySetInnerHTML`, Markdown or arbitrary HTML rendering, `mailto:` behavior, `tel:` behavior, URL navigation, or open-record navigation. EMAIL, PHONE, and URL values remain safe text.

Context loading has a dedicated skeleton announced with accessible status semantics and never leaves values from a previous Conversation visible. It is distinct from `UNASSIGNED`, zero configured fields, error, and unavailable states. An ordinary safe failure displays only the localized `CRM context is unavailable.` without backend or security detail. `NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, and a safe null/unavailable result clear all context values and reuse the existing unavailable-Conversation flow as applicable. Losing selected-Conversation authorization clears the record label and every field value and closes an open narrow/mobile context modal without disclosing whether a CRM record exists.

Selected detail remains independent from active list membership. If an authorized selected Conversation leaves `UNREAD`, `FAVORITES`, or `PENDING`, or disappears from the current search result, its context remains attached to the open detail. Search or work-state changes alone do not clear context or reinsert a frontend-only row. Loading or showing context does not mutate `isUnread`, `readThroughMessageId`, manual Read/Unread, Favorite, Pending, or automatic-read behavior.

Opening or closing context does not reset draft text, template selection, upload/attachment state, or send intention. Accessibility uses a context region with an associated heading, accessible `Show CRM context` and `Close CRM context` actions, the existing fullscreen modal focus/Escape/close behavior, `dl`/`dt`/`dd` field semantics, an accessible null placeholder, and `role=status` for loading. New visible copy uses Lingui.

### Implemented Native Messaging Frontend

Twenty has a native Messaging navigation entry and route. Navigation visibility uses `INCONNECT_MESSAGING`, while backend authorization still decides which Conversations and Messages are returned. The inbox has a Conversation list, backend-authorized search, cursor pagination, selection, and Message history with older-message loading. It renders inbound and outbound bubbles, text, structured locations, authorized lazy image previews, visual stickers, authorized audio and supported video playback, document filename/type/size with authorized open/download, and safe vCard/contact presentation with download. `PENDING` media shows processing state; `FAILED`, `EXPIRED`, unavailable, and legacy media without an Attachment show a safe unavailable state. It also renders persisted outbound states and durable template audit details, handles desktop and narrow screens, loading/empty/error states, and lost access by clearing previously visible Conversation content. `MESSAGE_UPDATED` and other realtime hints, plus reconnect, cause localized authorized refetches.

The selected Conversation includes the dynamic CRM context UI described above: a desktop third pane on viewports wider than 1100 px and Twenty's fullscreen context modal on narrower/mobile layouts. Both forms use the same selected-Conversation-only secure query and keep the chat/composer lifecycle independent from context visibility.

The inbox exposes visible server-backed `ALL`, `UNREAD`, `FAVORITES`, and `PENDING` views. The frontend sends `workState` to `inconnectMessagingConversations`; search and work state compose in the authorized backend query. Changing work state starts the first page of the new filter instead of reusing another filter's cursor. Search preserves the active work state, `fetchMore` preserves search plus work state, and realtime/reconnect refetches reuse the active variables. Authorization, search, work-state predicates, count, ordering, and pagination execute in backend SQL. The frontend must never implement these views with `allConversations.filter(...)` or locally reorder Conversations by Favorite, Unread, or Pending.

Conversation rows use only backend-derived work state. `isUnread` drives non-color-only emphasis and an unread indicator and is never reconstructed from loaded Messages. `isFavorite` is personal and drives the visible favorite/star state. `isPending` is shared and drives the visible Pending badge/state; it is never inferred from unread, message direction, ownership, inbound activity, outbound activity, or replies. Dedicated empty states exist for each work-state view and for search-plus-filter with no matches; loading, error, and empty remain distinct. The accessible tab-like filter can scroll horizontally on narrow layouts rather than breaking the page. Work-state text uses Lingui, action labels reflect their current state, and pending mutations expose disabled/busy behavior.

The selected Conversation header exposes Add/Remove Favorite through `setInconnectMessagingConversationFavorite`, Mark/Clear Pending through `setInconnectMessagingConversationPending`, and manual Mark Read/Mark Unread. Favorite and read mutations never accept a Workspace Member ID. Pending remains shared and manual; no inbound, outbound, read, or reply rule sets or clears it automatically. Manual Mark Read calls `markInconnectMessagingConversationRead(conversationId)` without `throughMessageId`, meaning “mark all currently existing inbound Messages as read” on the server. Manual Mark Unread calls `markInconnectMessagingConversationUnread(conversationId)` without a cursor and relies on the durable backend `manualUnread` semantics. Mutations refetch authorized state rather than making frontend work state authoritative.

Automatic read is deliberately narrower than manual Mark Read. When an unread Conversation is selected, the frontend may call Mark Read only with the current server-derived `readThroughMessageId`; it never uses the no-argument mark-all mode, sends a timestamp, constructs an arrival tuple, or round-trips a PostgreSQL cursor through JavaScript. A `MESSAGE_CREATED` `messageId` is only a realtime hint and must never be passed directly as `throughMessageId`. The flow is `MESSAGE_CREATED -> authorized Conversation/Message refetch -> current Messages render -> server-provided readThroughMessageId -> optional automatic read`.

Automatic read runs only while `document.visibilityState === 'visible'` and the matching Conversation remains selected. A hidden tab may receive realtime and refetch, but new inbound remains unread and no automatic Mark Read starts. When visibility returns, the frontend evaluates the current authorized target rather than reusing a stale target captured before hiding. There is intentionally no global presence system.

Manual Mark Unread activates a Conversation-scoped, frontend-only suppression so an open Conversation is not immediately auto-read again. The suppression is not persisted in PostgreSQL or localStorage; it survives rerenders, Message refetches, realtime-style refreshes, list refetches, and changes to `readThroughMessageId`. It ends only after explicit manual Mark Read or after leaving/unmounting and later re-entering the Conversation. Backend `manualUnread` remains durable authority. Auto-read mutation lifecycle and identity guards are also Conversation-scoped: a late completion from Conversation A must not change Conversation B's guards, suppression, refetch context, or visible work state.

Message `fetchMore` merges visual edges and read-target metadata with different rules. Edges retain their cursor order and are deduplicated. If the accumulated connection has no safe target and an older visual page first presents the delayed relevant inbound, it may adopt that page's target. Once an accumulated safe `readThroughMessageId` exists, older-page metadata cannot replace it with null or an older arrival target. Message connection merging must preserve the newest/safest accumulated target rather than blindly adopting all metadata from the older page; this invariant is regression-tested.

Filtered list membership and selected detail are independent. After auto-read in `UNREAD`, unfavorite in `FAVORITES`, or Clear Pending in `PENDING`, the row may disappear following the authorized list refetch while the still-authorized selected detail remains open. The frontend must neither close the detail merely because filter membership changed nor reinsert a frontend-only row to keep it visible.

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
- `inconnectMessagingConversations` with `ALL | UNREAD | FAVORITES | PENDING` work-state filtering
- `inconnectMessagingMessages`
- `inconnectMessagingTemplates`
- `inconnectMessagingSendCapabilities`
- `inconnectMessagingConversationContext`
- `inconnectMessagingContextConfiguration`

Conversation read/list DTOs expose `isFavorite`, `isUnread`, and `isPending`. The first two are personal to the current actor; Pending is shared. The Message connection additionally exposes nullable `readThroughMessageId`, an opaque, server-derived, snapshot-safe automatic-read target.

Mutations are:

- `createInconnectMessagingOutboundUpload`
- `completeInconnectMessagingOutboundUpload`
- `sendInconnectMessagingMessage`
- `setInconnectMessagingConversationFavorite`
- `markInconnectMessagingConversationRead`
- `markInconnectMessagingConversationUnread`
- `setInconnectMessagingConversationPending`
- `replaceInconnectMessagingContextConfiguration`

`sendInconnectMessagingMessage` accepts opaque `outboundUploadIds`. Public GraphQL does not expose or accept `FileEntity` IDs, storage paths, provider URLs/tokens, sender, Provider Connection, authoritative MIME, raw personal-state rows, member IDs for work-state operations, `manualUnread`, read cursors, or the tracking baseline. The subscription remains `onInconnectMessagingEvent`. Fase 9B metadata GraphQL codegen, including the work-state operations, DTO fields, and snapshot-safe `readThroughMessageId`, was regenerated and validated successfully, and the frontend continues to consume generated metadata types rather than a parallel handwritten contract.

Context GraphQL DTOs expose only safe presentation concepts: state, ObjectMetadata ID and safe label, record ID and canonical readable label, and ordered fields containing FieldMetadata ID, label, value kind, and display value. They expose no physical schema/table/column names, raw CRM JSON, Record Access decisions, owner scopes, provider data, or private metadata internals. Context management exposes safe candidate metadata and no CRM record values. Fase 10A metadata GraphQL codegen completed successfully.

Fase 10B adds only frontend metadata-operation consumption of `inconnectMessagingConversationContext(conversationId)` and uses the generated metadata types/document. Frontend metadata codegen was regenerated successfully. Fase 10B did not add or change the backend GraphQL contract.

Send capabilities expose the safe provider-neutral media fields `canSendMedia`, `maxMediaItems`, `mediaTypes`, `mimeTypes`, `maxBytes`, and `captionSupported`. The final capabilities/catalog separation introduced no new GraphQL contract; 8B2 metadata codegen was regenerated successfully.

### Messaging Instance Command Registration

The required Messaging upgrade chain is registered and discoverable by the normal upgrade runner, not merely present in the filesystem. Registered Fast commands are:

- Transport Spine — `1788982508902`
- Webhook Projection — `1789040000000`
- Template Intent — `1789473600000`
- Inbound Attachments — `1789682400000`
- Outbound Uploads — `1789768800000`
- Conversation Work State — `1790006024000`
- CRM Context Fields — `1790010000000`

The registered Slow command is Webhook Backfill — `1789040000001`. Normal runner validation found seven Fast Instance Commands, the one existing Slow Instance Command, and one Workspace Command. The real upgrade mechanism groups and orders all Fast commands in the Fast sequence, then all Slow commands in the Slow sequence, then workspace commands; Slow is not interleaved globally with Fast by timestamp. The missing registrations previously identified for Webhook Projection Fast, Webhook Backfill Slow, and Outbound Upload Fast were corrected before this checkpoint. Permanent rule: every new Messaging Instance Command must be registered so that the normal upgrade runner can discover it.

The CRM Context Fields command is `2-32-instance-command-fast-1790010000000-add-inconnect-messaging-context-fields.ts`. It adds `core.inconnectMessagingContextField` with seven columns, a UUID primary key, Workspace FK, configuration/anchor composite FK, FieldMetadata/object/workspace composite FK, unique workspace + field, unique workspace + ordinal, `ordinal >= 0`, and cascading presentation-row lifecycle. It has no `messagingConfigurationId` column and requires no Slow Command. Its `down` removes only the ContextField table and its owned constraints/indexes; MessagingConfiguration, Conversations, Messages, ConversationMemberState, ObjectMetadata, FieldMetadata, and CRM record data remain. Loss of presentation configuration on downgrade is acceptable.

### Validation Checkpoint

The current Messaging checkpoint has green composer tests and complete frontend Messaging regression coverage, green backend send-capabilities/template-catalog tests, and focused generic upload-transport regression coverage. Direct frontend TypeScript typecheck, touched-file typed lint, diff lint, format, metadata codegen, and diff checks passed. Validation covers stale remove/replace and Conversation-switch upload completions, object URL cleanup, and alignment of safe MIME, size, and caption hints with backend policy. Send capabilities no longer call `provider.listTemplates()` or depend on Twilio Content API; remote template catalog access remains isolated to template-specific flows. No database change was required for the attachment composer, and validation made no real Twilio, WhatsApp, provider catalog, storage, or upload calls.

Outbound upload/media tests and core `FileUploadService` regression tests are green. Read, subscription, human file-access, and provider-media paths preserve their authorization boundaries, including non-disclosing attachment access. Metadata codegen confirmed the upload mutations and opaque send references without exposing file/storage/provider authority. Review found no provider JWT token-type confusion; the provider endpoint is exact Attachment/workspace scoped, and the core `FileUploadService` coupling to INCONNECT was removed.

The inbound-attachment Fast Instance Command was exercised against real disposable PostgreSQL. Entity/schema parity, PRE-8A compatibility, `up`/`down` behavior with `STICKER`, `CONTACT`, and Attachments, physical workspace/File isolation, and download authorization/security were confirmed; the disposable database was removed. This does not assert that the command ran in production.

The outbound-staging Fast Instance Command is `2-32-instance-command-fast-1789768800000-add-inconnect-messaging-outbound-uploads.ts`. Its real `up` was executed against disposable PostgreSQL and accepted PRE-outbound-staging data. Validation confirmed physical parity with `InconnectMessagingOutboundUploadEntity`, actor-scoped uniqueness, workspace-isolated File and consumed-Message references, and no need for a Slow Command. Its real `down` succeeded with `CREATING`, `PENDING`, `AVAILABLE`, and `CONSUMED` rows: the staging table was removed while Message, Attachment, and File rows remained. The disposable database was removed. This does not assert that the command ran in production.

Conversation work-state validation established a green full Messaging backend regression plus server typecheck, typed lint, format, diff checks, and successful metadata GraphQL codegen. The real Fase 9A Fast Command completed `up` and `down` against disposable PostgreSQL, restored a valid PRE-9 schema, and physically verified the historical baseline, new inbound unread without MemberState fanout, outbound-not-unread behavior, Favorite member isolation, shared Pending + Outbox, SQL `ALL | UNREAD | FAVORITES | PENDING` filtering, monotonic cursor advancement, and deterministic UUID tie-breaking for equal `createdAt`. The disposable database was removed; this does not assert execution in production.

The PostgreSQL microsecond regression used a Message `createdAt` ending in `.123456`, which JavaScript `Date` cannot represent exactly. After the real Mark Read path, the persisted cursor equaled the exact PostgreSQL Message timestamp and `isUnread` was false, confirming the permanent direct-SQL propagation invariant. Physical delayed-inbound validation also proved that an M11 arriving after M10 becomes unread even when its effective/provider timestamp places it earlier in visual history; mark-all-read then clears it using the latest arrival cursor. The Messaging Instance Command chain was audited against actual provider discovery and upgrade-runner sequencing.

The current Conversation work-state inbox UX has green focused frontend coverage and green backend `readThroughMessageId` coverage. Frontend and backend typechecks, touched-file typed lint, project diff lint, format, diff checks, and metadata GraphQL codegen passed. Validation covers server-backed All/Unread/Favorites/Pending views, search plus work state, pagination reset and variable preservation, unread/favorite/pending row state, Favorite/Pending actions, manual Mark Read/Mark Unread, manual-unread suppression, hidden-tab behavior, realtime list membership, selected-detail preservation, delayed inbound outside and inside the returned page, realtime hints never acting as read authority, Conversation-switch races, and safe accumulated targets across Message `fetchMore`. The inbox UX and `readThroughMessageId` required no database change or migration, and validation made no real Twilio, WhatsApp, provider, upload, or storage call.

Fase 10A has green focused coverage: nine suites and 97 tests. The Messaging backend regression passed 32 suites and 329 tests, with the existing omissions still omitted. Server tsgo/typecheck, touched-file typed lint, `lint:diff-with-main twenty-server`, `git diff --check`, and metadata GraphQL codegen were green. Validation made no real Twilio, WhatsApp, provider, FileStorage, or external CRM calls.

The real CRM Context Fields Fast Command was validated `up` and `down` against an isolated disposable PostgreSQL database after applying the real PRE-10A Messaging command chain. The normal database remained `default` and was not migrated or modified. `up` succeeded; existing MessagingConfigurations remained valid with zero ContextField rows and no backfill or CRM scan. The physical seven-column schema matched the entity and `messagingConfigurationId` was absent. The configuration/anchor FK rejected wrong-anchor and cross-workspace rows with SQLSTATE `23503`; the FieldMetadata composite FK rejected wrong-object and wrong-workspace rows with `23503`; duplicate workspace + field and workspace + ordinal rows were rejected with `23505`; ordinal `-1` was rejected with `23514`; and delete cascades were verified. Real `down` succeeded with POST-10A data, removed only the ContextField table and its owned artifacts, and restored the relevant PRE-10A schema without touching CRM or Messaging authority data. The disposable database was removed. This local validation does not assert execution in production.

Fase 10A intentionally has no Slow Command. Zero ContextField rows is valid, so there is no backfill, CRM scan, NxM operation, or network operation; existing installations remain valid immediately after Fast `up`.

Fase 10B frontend validation is green: the complete Messaging frontend run passed 8 suites and 103 tests. `twenty-front` typecheck passed; typed lint reported 0 errors and 0 warnings; `lint:diff-with-main twenty-front`, format, `git diff --check`, and metadata GraphQL codegen passed. Existing Messaging frontend regression coverage also passed. Fase 10B consumed the existing Fase 10A contract and required no backend change, entity change, Instance Command, migration, or database write.

The Fase 10B cases cover `LINKED`, `UNASSIGNED`, zero fields, null `recordLabel`, every current safe `valueKind`, server field order, null display values, no query without selection, the A-to-B late-response race, re-entry without stale-cache display, selected-context reconnect refetch, access loss, generic errors, selection persistence across work-state/filter membership changes, no ordinary Messaging-event CRM invalidation, responsive open/close behavior, composer preservation, and accessibility basics. A focused audit found no new context-rendering logic specific to Lead, Folio, stage, phase, owner, or physical field names, and found no `dangerouslySetInnerHTML`, `mailto:`, or `tel:` behavior in that path. Runtime query shape remains one context query per selected-Conversation load/refetch, with no per-list-row, per-field, bulk-prefetch, or second generic CRM query.

Manual smoke was not executed because no already-prepared authenticated frontend session with valid Fase 10A context configuration was available. No data, migration, or configuration was created merely to force smoke testing; this remains an explicit QA follow-up, not a claimed manual-smoke success. Local validation does not imply production deployment.

### Planned Boundaries

The complete Conversation work-state backend and visible inbox UX **ARE IMPLEMENTED**: durable `ConversationMemberState`, personal Favorite, personal derived Unread, shared manual Pending, rollout baseline, authorized SQL work-state filters, GraphQL work-state mutations, the shared Pending `CONVERSATION_UPDATED` hint, server-backed All/Unread/Favorites/Pending views, row indicators, visible Favorite/Pending/Read/Unread actions, manual-unread suppression, and snapshot-safe automatic read.

The outbound media backend **IS IMPLEMENTED**: secure actor/workspace-scoped staging, upload completion and validation, deterministic `FileStorage`/`FileEntity` preparation, transactional outbound Message + Attachment consumption, Twilio free-form media dispatch, and provider-media capability delivery.

The user-facing outbound attachment composer **IS IMPLEMENTED**: attachment button, accessible file picker, indeterminate upload/finalization state UX, Retry, Remove, local previews, and send-media UX for one capability-supported attachment. Replacement is explicit Remove plus a new selection; there is no separate multi-file replacement workflow.

The secure dynamic CRM Conversation context backend and visible runtime panel **ARE IMPLEMENTED END TO END**: ContextField persistence, ordered configuration management, an authorized context query, safe normalized values, standard object/field permission enforcement, a Record Access-scoped final CRM `SELECT`, selected-Conversation-only live reads, a desktop third pane, a narrow/mobile fullscreen modal, safe generic field rendering, stale-context protection, and selected-context reconnect refresh. Messaging realtime remains intentionally separate from CRM realtime.

Still **NOT IMPLEMENTED**: Context configuration Settings UI; CRM field editing; owner, stage, or phase changes; linking or unlinking; matching; auto-link; automatic record creation; related lists or Folio ISO context; `RELATION`/`MORPH_RELATION` context rendering; generic CRM realtime; open-record navigation; immediate cross-device realtime for personal Favorite/read mutations; automatic Pending business rules; per-filter numeric counts; drag/drop; clipboard image paste; microphone/voice recording; outbound `LOCATION`; rich/media templates; multi-attachment composer UX; reactions; historical media backfill; automatic `FileEntity`/FileStorage garbage collection or reconciliation; orphan personal-state GC; a dedicated provider-media TTL; template administration/editor; or creating, editing, or approving Twilio templates inside Twenty. The current picker only consumes supported provider-existing templates. No next product phase is selected by this checkpoint.

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
- Favorite and Unread are personal to the authenticated Workspace Member; Pending is shared Conversation state. Never accept a client-selected Workspace Member for Favorite/read state or expose another member's personal state.
- Unread uses server arrival order `(Message.createdAt, Message.id)` while display chronology independently uses effective/provider time. Never unify those orders, and never round-trip a read-cursor `timestamptz` through JavaScript `Date`.
- Read cursor advancement is monotonic. Manual Unread sets `manualUnread` without rewinding the cursor, and Mark Read clears it while advancing only to an equal-or-newer arrival tuple.
- Historical inbound before `workStateTrackingBaselineAt` is read by default. New inbound derives unread from PostgreSQL without fanout-writing MemberState rows; outbound Messages never create unread.
- Work-state predicates must execute with authorization and current-member identity in SQL before count, ordering, and pagination; never post-filter them in memory or the frontend.
- Work-state views must remain server-backed. The frontend must preserve active search and `workState` across pagination, realtime refetch, and reconnect, must not reorder work state locally, and must use only backend `isUnread` for unread presentation.
- Automatic read may use only the server-derived `readThroughMessageId` for an inbound actually present in the authorized returned Message slice. Never reconstruct the PostgreSQL arrival cursor, use display timestamps or `edges[0]` as authority, or use a realtime `messageId` directly as a read target.
- Hidden tabs must not automatically mark new inbound read. Manual Mark Unread suppression is Conversation-scoped and ephemeral, must survive ordinary rerenders/refetches, and must not be immediately undone by automatic read.
- Fetching older Message pages must never replace an accumulated safe `readThroughMessageId` with null or an older target. Selected authorized detail may remain open after its row leaves the active work-state filter; never reinsert a frontend-only row merely to preserve detail.
- Shared Pending realtime may publish only the shared Conversation hint and must never include Workspace Member identity, Favorite, manual-unread, or cursor data.
- Personal Favorite/read state must never be broadcast through shared `CONVERSATION_UPDATED`; other tabs or devices converge through normal authorized refetch or reconnect.
- Every Messaging Instance Command must be registered and discoverable by the normal upgrade runner; a command existing only in the filesystem is not part of the upgrade chain.
- CRM context is derived from the Conversation's configured dynamic anchor; never hardcode Lead or another CRM object as context authority.
- `MessagingConfiguration` is workspace-singleton by `workspaceId`; never invent a second configuration identity or persist `messagingConfigurationId` on ContextField.
- ContextField stores only workspace/object/field/ordinal presentation configuration, never CRM values. Configuration is a presentation allowlist and grants no record or field access.
- Runtime context must apply current Twenty object permission, current field permission, and INCONNECT Record Access. The final CRM record `SELECT` must retain `applyReadScopeToQueryBuilder`; prior Conversation authorization alone is insufficient.
- Runtime context clients supply only `conversationId`. Object, record, schema, table, and selected columns must derive server-side from validated live metadata, and only readable configured fields may be selected or returned.
- Canonical `recordLabel` uses only readable `labelIdentifierFieldMetadataId`; never fall back to an arbitrary field or record ID.
- `RELATION` and `MORPH_RELATION` remain unsupported until a generic resolver can preserve target-object standard permissions, Record Access, and workspace isolation.
- An `UNASSIGNED` Conversation performs no CRM lookup, matching, auto-link, or record creation.
- Context values are live read-only CRM reads. Never duplicate/cache record values or durable actor-specific readable fields in Messaging, and never introduce CRM writes silently.
- The visible CRM context frontend must consume only `inconnectMessagingConversationContext(conversationId)` and supply only `conversationId`; never add a second generic CRM-record query or reconstruct backend context authority.
- Query visible CRM context only for the selected Conversation. Never query per list row or configured Field, bulk-prefetch list context, or add a second CRM read.
- Keep context rendering generic. Never branch on Lead, another object identity, a Field API name, or product-specific labels or semantics.
- A Conversation switch must synchronously clear the prior context. Bind results to the requested Conversation identity, and never allow a late response to populate another Conversation.
- Context uses `network-only` and `nextFetchPolicy: network-only`; do not render Apollo `previousData` or any stale authorization-sensitive context while a new request is pending. Apollo cache is not context authority.
- Treat `UNASSIGNED` as a neutral display state and never trigger matching, linking, creation, or another CRM lookup. Zero configured fields is valid and must never cause arbitrary fallback-field selection.
- Render backend `displayValue` in server-returned Field order. Do not recreate CRM value normalization, alphabetize configured fields, or represent omitted unauthorized fields as null placeholders.
- Messaging Message/Conversation realtime hints are not CRM-record invalidation. Do not add CRM polling or subscriptions; reconnect may invalidate and refetch only the currently selected context.
- Keep context tied to the selected authorized detail even when its row leaves a work-state/search result. Losing authorization must immediately clear every visible context value and close any context overlay.
- Opening, loading, or closing context must not mutate work state, auto-read behavior, draft, template, upload/attachment state, or send intention.
- The runtime context panel is read-only. CRM writes and context-configuration Settings controls do not belong to it.
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
