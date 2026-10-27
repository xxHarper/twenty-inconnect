# INCONNECT — F13 Auto-Create y transacciones Common ORM

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

F13A/B y F13C.2B tienen evidencia física histórica de desarrollo, separada de
instalación/activación por entorno. Preparación F13C.3 y exact-upgrade siguen
sujetas a [operaciones y gates](INCONNECT_OPERATIONS_AND_UPGRADES.md).
La unidad F13 comienza después de la durabilidad inbound; la unidad tracked R4
no crea CRM ni mueve F13 dentro de su transacción. El contrato INSERT/QueryRunner
es infraestructura OSS genérica, nunca una excepción de autorización Messaging.

## Contract: F13C Auto-Create and Transactional Inbound Orchestration

F13C.1A through F13C.2B are implemented. The secure CRM-record creation foundation and private executor remain module-private capabilities; F13C.2B now invokes them only from the existing post-persistence inbound Outbox path after current configuration, exact resolution, authority, principal, Owner, and transaction revalidation.

### Persisted Auto-Create Configuration

`InconnectMessagingConfigurationEntity` remains the workspace-scoped Messaging singleton and now also stores:

- `autoCreateEnabled`, which expresses administrative intent only;
- `autoCreateAnchorObjectMetadataId`, the configured snapshot/reference for the current CRM anchor;
- `autoCreateOwnerStrategy`, currently limited to `UNIQUE_ACTIVE_MEMBER_OF_ROLE`;
- `autoCreateOwnerRoleId`;
- `autoCreateLabelPolicy`, currently limited to `OMIT`; and
- `automationUserWorkspaceId`, the server-owned reference to the technical automation principal.

The disabled state requires the auto-create tuple to be absent; an enabled configuration must be complete. The truthful runtime condition is `effectiveEnabled = autoCreateEnabled && readiness === READY_FOR_RUNTIME`. Administrative intent is not automatically enabled on upgrade, and a disabled or not-ready workspace never creates automatically. Disposable validation with `effectiveEnabled = true` does not imply activation in another environment or production.

The public management surface consists only of the metadata GraphQL query `inconnectMessagingAutoCreateConfiguration` and mutation `replaceInconnectMessagingAutoCreateConfiguration`, both protected by `MANAGE_INCONNECT_MESSAGING`. The executor, authority, plan, provisioning, principal resolution, and principal validation services are private backend capabilities and are not GraphQL, REST, or public CRM APIs.

### Fail-Closed Structural Eligibility

Eligibility is structural validation, never authorization. It requires the stored anchor to equal the current active workspace anchor; exactly one active `PRIMARY` `PHONES` Field; a valid Workspace Member Owner relation; compatible live metadata and physical schema; supported required/default Fields; and one ready, live, unconditional physical unique index over the canonical PRIMARY phone component columns. The uniqueness scope is all physical rows, so soft-deleted rows remain authoritative. Missing columns, unknown required physical columns, metadata/schema drift, an expression or partial index, anchor drift, PRIMARY drift, or any other unsupported shape denies readiness.

### Caller-Owned Transaction and Write Receipt

Normal Common Create can run on an already-active caller-owned `WorkspaceQueryRunner`. The caller alone owns begin, commit, rollback, release, and after-commit lifecycle. The operation stays in the normal preprocessing, hooks, permissions, ORM INSERT, and transaction-bound event pipeline; no parallel raw CRM insertion path exists.

`CommonCreateOneQueryRunnerService.executeCreateOnlyForWriteReceiptWithQueryRunner` is an internal create-only primitive. It performs exactly one normal create, requests only identity, skips the ordinary result refetch, and returns only:

```ts
{
  objectMetadataId,
  recordId,
}
```

The authoritative record ID must agree across the actual `InsertResult.identifiers`, `generatedMaps`, and `raw` representations that are present. Malformed or contradictory INSERT output fails closed; caller-supplied input IDs are never a fallback. The receipt is not a general public API, grants no CRM READ authority, and preserves normal transaction-owned event behavior.

### Technical Automation WorkspaceMember

Each configured workspace has a real technical principal conceptually named `INCONNECT Messaging Automation`: a technical User, UserWorkspace, WorkspaceMember, dedicated Role, RoleTarget, least-privilege ObjectPermission, deterministic FieldPermissions, an ordinary INCONNECT Record Access policy, and the server-owned persisted `automationUserWorkspaceId` reference. It has no external login, API, OAuth, or App credentials and is not Admin or Supervisor impersonation, a generic SYSTEM CRM authority, an Application principal, or a client-selectable member. Local deterministic identifiers are implementation details, not architecture constants.

Runtime validation fails closed on stale principal reference; missing, deleted, or disabled identity where modeled; wrong Role or RoleTarget; unexpected object authority; unexpected READ; unexpected writable business Fields; PRIMARY or Owner permission mismatch; canonical position mismatch; Record Access policy mismatch; anchor drift; and PRIMARY drift. Newly introduced Fields cannot silently widen write authority.

The exact persisted automation Record Access policy is:

- `recordEffect = ownRecords`;
- `createPolicy = standardPermissionsOnly`;
- `ownerTransferPolicy = denied`;
- `ownerRequirement = required`;
- `missingOwnerPolicy = requireExplicit`; and
- no default Owner Role on this policy.

F13C create does not use sealed dual-grant authorization, a generic system `AuthContext`, permission or Record Access bypass, Actor override, or Supervisor impersonation. It builds a normal user `WorkspaceAuthContext` for the technical WorkspaceMember and passes existing Role resolution, object and Field permissions, INCONNECT Record Access, Owner integrity, Actor behavior, Common Create, and ORM enforcement.

Keep these identities separate:

- permission principal: Automation WorkspaceMember;
- CRM `createdBy` / `updatedBy`: Automation WorkspaceMember through normal Actor behavior;
- CRM Owner: the independently resolved business WorkspaceMember selected through current `UNIQUE_ACTIVE_MEMBER_OF_ROLE` semantics; and
- automatic Conversation-link provenance: the separate existing background/system identity semantics.

The Automation WorkspaceMember must not become CRM Owner merely because it performs the create.

### CREATE Is Not READ

AUTHORIZED CREATE does not imply CRM READ authority. The validated Role deliberately has `canReadObjectRecords = false` while retaining the minimum valid create authority. When it creates a Supervisor-owned record under `ownRecords`, the Automation WorkspaceMember is not the Owner and gains no ordinary read access to the record. This contrast has been physically validated; normal CRM SELECT remains subject to standard permissions and INCONNECT Record Access.

### Exact Payload and Position Authority

Messaging deliberately supplies only the current PRIMARY `PHONES` value and the Owner relation. Phone input comes from the canonical international identity and current metadata. Owner is expressed through Twenty's canonical relation operation shape, conceptually `connect -> where -> id`, with the actual Field derived from metadata. `MATCH_ONLY` is never written by F13C. The caller cannot choose the object, Owner, Role, principal, Actor, or arbitrary Fields.

Normal Twenty Create additionally injects the canonical system `position` Field. The automation Role therefore has only the minimum normal write authority for the canonical current-anchor `position` Field. `position` is not part of the Messaging deliberate Field allowlist, and this rule must never be generalized to make every `systemSideEffect` Field writable. Readiness and provisioning derive canonical position metadata and fail closed on a mismatch or any unexpected writable business Field.

### Private CRM Create Executor

`InconnectMessagingAutomationRecordCreateService` requires a current transaction-bound F13C authority/plan, revalidates that plan and the current automation principal, builds the normal user `WorkspaceAuthContext`, constructs the exact PRIMARY-plus-Owner input, and invokes the normal Common Create write-receipt primitive. It returns only `objectMetadataId` and `recordId`. It starts no transaction, needs no external credential, and does not link a Conversation itself. F13C.2B is its only implemented inbound caller and owns the surrounding transaction and link orchestration; ordinary CRM Context reads and public clients can never invoke it.

### Generic INSERT Event Snapshot

F13C physical validation exposed a generic ORM correctness issue: post-INSERT event hydration previously used a SELECT, so a valid create could succeed while the creator lacked READ scope over the newly inserted Owner-controlled row. `WorkspaceInsertQueryBuilder` now uses this permanent architecture:

```text
authorized INSERT
-> INSERT ... RETURNING *
-> internal complete normalized event snapshot
-> CREATED
-> UPSERTED
-> transaction buffer
```

The previous post-INSERT event-hydration SELECT is removed. The complete `RETURNING *` rows are internal write-side-effect authority scoped to the same authorized INSERT statement; they are not a generic read primitive and do not grant caller READ. There is no Record Access bypass, `WorkspaceSelectQueryBuilder` exception, arbitrary-ID read, system impersonation, or Messaging-specific branch.

Caller output is a separate representation reconstructed according to the original requested RETURNING projection. A narrow identity caller therefore does not receive additional `raw` or `generatedMaps` columns. Event snapshots are normalized with existing metadata and driver formatting so composites such as `PHONES` and `ACTOR`, relation foreign-key information, timestamps, defaults, generated/stored values, and system Fields retain the normal logical event shape rather than leaking physical component columns.

For CreateMany, canonical returned IDs and complete rows must have exact one-to-one correspondence. Missing, extra, duplicate, or invalid IDs fail closed, and snapshots are reordered by authoritative identifier order rather than PostgreSQL physical RETURNING order. Normal CRM Create continues producing both `CREATED` and `UPSERTED` with complete normalized persisted `after` snapshots. Those internal event snapshots may contain database defaults and system values even when the caller cannot READ them; caller projection remains narrow. Commit publishes the buffered events and rollback discards both rows and events.

PostgreSQL INSERT `RETURNING` reflects defaults, generated values, and BEFORE INSERT trigger changes in the row produced by that statement. It does not claim support for later UPDATE callbacks or postcommit rereads.

The accepted transaction contract is the same QueryRunner, connection, active transaction, and original `WorkspaceEntityManager` object. The feature-neutral `WorkspaceQueryRunnerCoreQueryBuilderService` in `engine/twenty-orm/query-runner`, exported by `GlobalWorkspaceDataSourceModule`, provides transaction-bound Core entity QueryBuilders through TypeORM's supported `coreDataSource.createQueryBuilder(CoreEntity, alias, workspaceQueryRunner)` overload. It requires an explicit active caller-owned runner, validates Core metadata and the primary GlobalWorkspaceDataSource, and preserves both the exact runner and its original manager identity.

This gateway is cross-DataSource transaction plumbing only. It is not an EntityManager, Repository, AuthContext, authorization service, public API, generic CRM bypass, or universal substitute for TypeORM repositories, `save`/cascades, listeners, or subscribers. Never call `createEntityManager(queryRunner)` to access Core metadata inside F13 transaction paths: TypeORM 0.3.31 reassigns `queryRunner.manager` and previously broke Common Create workspace-object metadata resolution. Dynamic CRM record operations remain on `WorkspaceEntityManager` / `WorkspaceRepository` / Common Create. Primitive Core Conversation UPDATE and Outbox INSERT use audited QueryBuilder operations, including `updateEntity(false)` where required to prevent incorrect Core entity hydration through `WorkspaceEntityManager`. Core and CRM operations retain the same runner, original manager identity, backend PID, and transaction ID.

### Contract: F13C.2B Current Inbound Runtime

The signed/provider inbound path durably commits WebhookReceipt, Conversation, Message, and `INBOUND_MESSAGE_RECEIVED` Outbox before CRM orchestration. The existing Outbox entry point invokes the real `InconnectMessagingInboundAutoLinkService`; no provider or Twilio network call belongs inside the CRM transaction.

One caller-owned `WorkspaceQueryRunner` transaction acquires a transaction-scoped advisory lock keyed by workspace, current anchor, and canonical phone, then locks the Conversation `FOR UPDATE`. After the locks it rechecks `UNASSIGNED`, the complete linked tuple, current configuration, anchor, PhoneIdentityFields, and exact background phone resolution. The branches are:

```text
UNIQUE
-> revalidate and lock the usable existing CRM record
-> link without CRM create

NO_MATCH + autoCreateEnabled + READY_FOR_RUNTIME
-> derive and revalidate current authority and real automation principal
-> resolve the exact configured business Owner
-> normal-authorized CRM create with PRIMARY PHONES + Owner
-> receive { objectMetadataId, recordId }
-> link to that exact receipt

AMBIGUOUS / INVALID / DISABLED / not-ready
-> no create and no link; remain UNASSIGNED

already LINKED
-> idempotent no-op; never relink or overwrite
```

Every successful automatic transition remains one-way `UNASSIGNED -> LINKED` and persists exactly one `CONVERSATION_LINKED` Outbox row with `SYSTEM_PHONE_IDENTITY_RESOLUTION` provenance in the same transaction. Same-phone competing Conversations serialize through the participating-worker advisory lock and converge on one CRM record.

The advisory lock does not replace physical uniqueness. PostgreSQL's unconditional canonical PRIMARY phone UNIQUE index is final concurrency authority against human/API creates and non-participating writers. SQLSTATE `23505` aborts and rolls back the entire attempt; code must never continue on that transaction. At most one bounded fresh re-resolution may run in a new transaction. If a usable `UNIQUE` record now exists, the new transaction links it. A conflict owned only by a soft-deleted or otherwise unusable row fails closed: never restore it, create around it, force-link it, or retry indefinitely.

CRM INSERT, complete normalized `CREATED` / `UPSERTED` snapshots from the same authorized `INSERT ... RETURNING *`, the Conversation linked tuple, and `CONVERSATION_LINKED` Outbox share the caller-owned transaction. Commit persists all effects; a failure after INSERT rolls back the CRM row, link, Outbox, and buffered events. There is no post-INSERT hydration SELECT, caller READ expansion, direct Redis publication, or provider call inside the transaction. The caller receives only the narrow write receipt.

## Contract: Phone Identity Resolution and Automatic Existing-Record Linking

F13A provides the shared pure function `normalizePhoneIdentity(input, { defaultCountry })` in `twenty-shared`. It is deterministic and has no database, network, or provider dependency. Its stable contract is:

- canonical Mexico identity is `+52` plus 10 national digits;
- legacy/provider `+521` input is accepted and canonicalized to `+52`, never retained as the canonical CRM identity;
- an explicit international input preserves its country calling code;
- national or bare input requires an explicit `defaultCountry`;
- malformed input returns `null` rather than inventing an identity.

Provider transport identity and canonical CRM phone identity are separate domains. `externalAddressNormalized`, `waId`, `normalizeWhatsappAddress`, provider routing, and dispatch destination retain their transport/correlation meanings. F13 does not redefine them. CRM identity is derived separately through `normalizePhoneIdentity`; the inbound auto-link currently starts from the trusted provider transport identity in `Conversation.externalAddressNormalized`, which Twilio supplies in explicit international form, so it does not hardcode Mexico when a country code is already present. Message body, `waId`, frontend input, labels, text search, and CRM heuristics are not CRM phone authority.

`InconnectMessagingPhoneIdentityFieldEntity` stores ordered workspace/anchor/FieldMetadata configuration in `core.inconnectMessagingPhoneIdentityField`. Roles are `PRIMARY` and `MATCH_ONLY`. Empty configuration means phone resolution is `DISABLED`; every non-empty configuration must contain exactly one `PRIMARY`. Both roles participate equally in matching. `PRIMARY` additionally identifies the authoritative phone destination Field used by the implemented private F13C create executor; `MATCH_ONLY` is never written by F13C. A current inbound `NO_MATCH` may invoke that executor only through the F13C.2B transaction when auto-create is enabled and ready. Matches are deduplicated by CRM record ID. Fields are metadata-driven rather than hardcoded to Lead or `celular`: every configured Field must be an active valid `PHONES` Field belonging to the current workspace and exact current Messaging anchor. `PhoneIdentityField` is identity/resolution configuration; `ContextField` is presentation configuration. Never conflate them.

The management metadata GraphQL API is:

- `inconnectMessagingPhoneIdentityConfiguration()` to read the ordered configuration, safe anchor summary, safe eligible `PHONES` candidates in `availableFields`, and maximum field count;
- `replaceInconnectMessagingPhoneIdentityConfiguration(fields)` to replace the complete ordered set.

Both operations require `MANAGE_INCONNECT_MESSAGING` through the Settings guard and service-level human authorization. Management permission does not imply Conversation read, CRM record read, Send, or Triage. Clients provide only FieldMetadata IDs and roles; workspace, anchor, ordinals, and physical identity derive server-side.

The secure human resolver returns `DISABLED`, `INVALID`, `NO_MATCH`, `UNIQUE { recordId }`, or `AMBIGUOUS`. It applies current Twenty object permission, readable configured `PHONES` Fields, INCONNECT Record Access, workspace isolation, and `deletedAt IS NULL`. Resolution performs exact structured PHONES comparison against metadata-derived physical country-code, calling-code, and national-number columns. SQL identifiers derive from validated metadata and phone values are parameters. All configured Fields are composed into one bounded lookup with `LIMIT 2`, not N queries. Results are deduplicated by record ID. It does not use `searchVector`, fuzzy matching, regex scans, in-memory filtering, `additionalPhones`, ambiguity ranking, or a public general phone-search API.

F13B.2A adds the narrow internal capability `SYSTEM_PHONE_IDENTITY_RESOLUTION` and `InconnectMessagingBackgroundPhoneIdentityResolverService`. This module-private Nest provider has no public GraphQL or REST endpoint and does not impersonate a WorkspaceMember, choose a first Admin, use Jane, call `buildSystemAuthContext`, or set a generic `shouldBypassPermissionChecks`. It performs only workspace-wide exact configured phone-identity classification and returns a record ID only for `UNIQUE`; it does not fetch a full CRM record or accept arbitrary Fields or predicates. It intentionally omits owner/team Record Access filtering because its authority is narrow background identity detection. This does not turn the actor into a generic CRM system actor.

The human and background authorities are intentionally different:

- human resolution requires standard object/Field permissions plus INCONNECT Record Access;
- background resolution is trusted only for workspace-wide exact configured phone detection used by inbound auto-link.

F13B.2B originally introduced CRM resolution and existing-record linking after inbound durability. F13C.2B retains that sequencing and extends the current implemented flow with conditional ready `NO_MATCH` creation:

    signed Twilio
    -> durable WebhookReceipt
    -> Conversation + Message + INBOUND_MESSAGE_RECEIVED Outbox transaction
    -> COMMIT
    -> exact inbound Outbox consumer
    -> caller-owned locked background resolution and eligible link/create-link
    -> current-recipient realtime calculation

If the Conversation is already `LINKED`, the resolver is not invoked and no relink occurs. For `UNASSIGNED`, `UNIQUE` links the usable existing record without create. A fresh `NO_MATCH` may create and link only when current configuration is enabled and `READY_FOR_RUNTIME`; disabled or not-ready `NO_MATCH`, `DISABLED`, `INVALID`, and `AMBIGUOUS` remain `UNASSIGNED`. A CRM-resolution or create failure cannot roll back the already durable inbound Message or Conversation and must not request provider retry. The inbound Outbox event remains durable for retry, and the Conversation remains `UNASSIGNED` unless the link transaction commits. Do not introduce a second queue to describe or implement this flow.

The initial resolver result is not write authority. The transaction first takes the workspace/anchor/canonical-phone advisory lock and Conversation `FOR UPDATE`, rereads its current linked tuple, rereads current configuration and PhoneIdentityFields, and reruns exact resolution. `UNIQUE` locks the matching CRM target `FOR SHARE`; ready `NO_MATCH` derives fresh real Authority and Principal validation before normal Create. Only then may the complete linked tuple plus one `CONVERSATION_LINKED` Outbox event be written. Its durable link payload actor is `SYSTEM_PHONE_IDENTITY_RESOLUTION`, never a fake WorkspaceMember. A stale phone result cannot commit.

Concurrency and retries preserve one-way link authority: a human link may win; system auto-link preserves an existing human target; concurrent inbounds yield one effective transition; replaying the same inbound event emits no duplicate `CONVERSATION_LINKED`; `LINKED A -> LINKED B` and last-write-wins relinking are forbidden. Manual F12 linking remains intact.

Background workspace-wide matching grants no human access. After auto-link, every human Conversation and context read again requires current Messaging authorization, standard CRM permissions, and INCONNECT Record Access. There is no grandfathered access from prior `UNASSIGNED` visibility. Realtime recipients are calculated from current post-link state. `CONVERSATION_LINKED` continues to publish through the existing public `CONVERSATION_UPDATED` hint; no CRM realtime was added. Known architectural follow-up: because auto-link currently runs in the inbound Outbox publication path, a transient CRM-resolution failure may delay the inbound realtime hint even though Message persistence is already durable. This is not a durability or correctness failure, and no second durable event is implemented.

The explicit F12A/F12B candidate flow remains the human fallback for `AMBIGUOUS`, `INVALID`, `DISABLED`, disabled/not-ready `NO_MATCH`, and allowed operational correction within the current one-way model. Manual candidate search is explicit human text search and must never infer or prefill sender identity. It is not the automatic exact-phone resolver and never creates CRM records. A ready enabled `NO_MATCH` is handled only by the separate F13C.2B background transaction.
