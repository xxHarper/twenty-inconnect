# F13C.3B1-M2 — verified Instance Command writer contract

Result: **PARTIAL; execution and physical validation BLOCKED**. This revision is
code and unit/static tests only. No database connection, DDL, mutation, instance
command execution, backup, restore, principal provisioning, application startup,
worker, queue processing, commit or push was performed during this correction.

The F13C.3B1-R findings supplied in the corrective task are the acceptance
baseline. In particular, a released inspection connection does not establish
writer identity, `/proc` does not establish maintenance isolation, and arbitrary
files or `restoreVerified: true` do not establish a successful restore.

## Execution is disabled

`requireExecutionSafety()` unconditionally rejects execution as UNKNOWN. The
operational CLI calls it immediately after selector parsing, before environment,
Git, source inspection, backup handling or network startup. The standalone
`executeRegistered()` adapter independently calls the same gate. There is no
force option, target override, manifest approval field or environment toggle.

The unsafe manual DI graph, temporary QueryRunner verification and Redis/pool
preparation were removed. The adapter has no runtime import of TypeORM, Redis,
Nest, command providers, tracking services or application modules. The
`runSelectedCommand()` seam selects an unchanged registered command and now
requires a complete pinned expected session identity, supplying the explicit
connection-verification option. It is not connected to the blocked operational
entrypoint. The dispatcher/orchestration tests use mocked safety and
execution dependencies to test ordering and error propagation. They are not
physical writer verification or authorization to run DDL.

Do not remove the blocker until the core writer API, enforced maintenance
contract, independent backup review and disposable physical proof are reviewed.
These are independent gates: implementing a runner callback alone is insufficient.

## Bootstrap DDL correction

The installed TypeORM `DataSource.initialize()` calls driver `connect()`, builds
metadata and calls `PostgresDriver.afterConnect()` before checking
`synchronize`, `migrationsRun` or `dropSchema`. `afterConnect()` defaults
`installExtensions` to true and can call `CREATE EXTENSION` for metadata types.

`reviewedDataSourceOptions()` is the closed option factory for a future adapter:

- `installExtensions: false`, `synchronize: false`, `migrationsRun: false`,
  `dropSchema: false`;
- empty migrations/subscribers, disabled query-result cache and logging;
- explicit entity classes only, no globs, alternate EntitySchema mappings,
  replicas or arbitrary caller-provided options;
- explicit local connection credentials, SSL disabled, timeout limits and
  `default_transaction_read_only=on` at connection startup.

No production initialization is currently reachable. Network-intercepted tests
run the installed TypeORM initialization, metadata building, pool startup and
`afterConnect()` against real Workspace/UpgradeMigration entity metadata. All
startup statements with the reviewed options must be SELECT. A regression
control enables automatic installation in the intercepted driver and captures
and rejects its attempted CREATE EXTENSION. No SQL reaches PostgreSQL. The
interceptor implements both node-postgres promise and callback query forms;
TypeORM catches installation errors, so an error alone is not the proof.

Preview checks `pg_extension` with SELECT and requires `uuid-ossp`, which the
reviewed UUID option/entity graph requires. No extension installation or repair
is available. A future execution adapter must additionally derive and check all
extensions required by its final real metadata graph (citext, hstore, geometry,
cube, ltree, vector, exclusions if present) before enabling any writes. That
future adapter and metadata-wide physical verification remain blocked.

The launcher installs its source compiler only when invoked directly and
restores it afterward. Removing the execution dependency graph also removes
its need for the Lingui/decorator compiler plugin. Preview never loads the broad
migration runner or starts AppModule, Nest lifecycle, workers, queues or cron.

## Implemented M2 writer contract and actual write ownership

Preflight: `feature/inconnect-messaging`, HEAD
`bf18fcaff1872c3375a5eb29c0fa42aedc597de0`, 29 expected pre-existing untracked
tooling files, no tracked or unrelated modifications. AGENTS.md was read in full.
No command `up()`/`down()`, entity, permission, runtime, GraphQL or frontend source
was changed. No tracking-service change or duplicate tracking implementation was
needed.

Audited call graph (source paths relative to `packages/twenty-server/src`):

```text
InstanceCommandRunnerService.runFastInstanceCommand
  UpgradeMigrationService.isLastAttemptCompleted
    injected Repository.findOne -> implicit SELECT runner (read only)
  DataSource.createQueryRunner -> PostgresQueryRunner.connect -> pg pool client A
  [guarded] pin client A + verify actual session A, before BEGIN
  startTransaction -> START TRANSACTION, on client A
  [guarded] verify session A again, inside transaction
  registered command.up(queryRunner) -> supplied runner.query -> client A
    5698: literal ALTER TABLE statements only, no other connection acquisition
    5700: literal ALTER TABLE statements only, no other connection acquisition
  [guarded] reverify A + require active runner-owned transaction
  WorkspaceVersionService.getProvisionedWorkspaceIds({queryRunner})
    runner.manager.getRepository(WorkspaceEntity).find -> SELECT on A
  [guarded] reverify A
  UpgradeMigrationService.recordUpgradeMigration({queryRunner, completed})
    runner.manager.getRepository(UpgradeMigrationEntity)
    count -> SELECT on A
    save(instance + workspace rows in batches of 1000) -> EntityPersistExecutor
      supplied manager.queryRunner -> A, existing transaction retained
  [guarded] reverify A
  commitTransaction -> COMMIT on A

  on execution/tracking error:
    rollbackTransaction on A only while physical-client continuity is intact
    ordinary caller:
      WorkspaceVersionService without runner -> implicit SELECT connection
      tracking injected repository.count -> implicit SELECT connection
      tracking injected repository.save(batch) -> new implicit runner per batch
        EntityPersistExecutor starts/commits its own transaction
    guarded caller, only after acknowledged rollback with trusted continuity:
      DataSource.createQueryRunner -> separate retained client B
      pin B + independently verify complete intended identity B
      workspace SELECT explicitly bound to B
      reverify B before tracking
      existing recordUpgradeMigration({queryRunner: B, failed})
        count + every save batch use B
        existing per-save transaction boundaries retained; no whole-set transaction added
      release B; no injected-repository write fallback
  finally:
    release A -> pg client release (no SQL write)
    safeInvalidateUpgradeStatusCache
      UpgradeStatusService -> UpgradeStatusCacheService.invalidate
      CacheStorageService.del for four keys (cache only, no PostgreSQL write)
```

The installed TypeORM 0.3.31 source was inspected in full for these paths:
`driver/postgres/PostgresQueryRunner.js` connect/release/query/start/commit/rollback,
`repository/Repository.js` save, `entity-manager/EntityManager.js` save/getRepository,
and `persistence/EntityPersistExecutor.js` supplied-runner selection and transaction
ownership. `connect()` returns the retained pg client. Its error listener releases
the broken runner; `query()` rejects a released runner, without pool reacquisition.
Repository saves through the runner's manager do not acquire or release another
runner. Saves without a runner do. No pool-reuse assumption or monkeypatch is used.

Generic API:

```ts
runFastInstanceCommand({
  command,
  name,
  connectionVerification: {
    verifyConnection: async (actualQueryRunner) => { /* read-only verification */ },
  },
});
```

This optional contract applies to trusted internal Fast commands whose protected
writes exclusively use the supplied runner. It is not a sandbox for arbitrary
command code, arbitrary SQL, or dependencies that acquire their own repositories.
The two literal F13C commands meet this requirement by source audit. Other commands
must be audited before requesting this option. Commands/verifiers must not change
roles, release/reconnect the runner, or own its transaction lifecycle. PostgreSQL
without replication, subscribers or query-result cache is required. SELECT query
result caching can implicitly write cache tables; it is rejected before the
injected precheck repository is used. Subscriber callbacks can perform
unrelated writes even during BEGIN and are rejected before runner acquisition.
A direct PostgreSQL session is required: connection proxies, transaction pooling,
custom reconnecting clients, malicious server administrators, and external session
manipulation are outside this contract and require separate assurance.

The pin checks the physical client returned by the supported `connect()` API,
release state and manager binding around verification. The concrete F13C verifier
uses one read-only SELECT for current_database, current_user, session_user, server
address/port, server_version, data_directory, pg_control_system system_identifier,
client loopback address, backend PID and backend_start. Expected identity is strictly
decoded, copied and frozen; each runner retains its own identity in a WeakMap.
Missing/inaccessible evidence, extra/missing rows, role/target drift and PID/start
replacement reject. The verifier neither reads configured URLs as actual identity
nor supplies credential fallback, grants, repair, or mutation SQL.

Success retains registered up, workspace selection, COMPLETED tracking and COMMIT
on A. Failure tracking retains the existing service's attempt numbering, instance
and provisioned-workspace rows, formatted original error and per-batch save meaning,
but all batches now use verified B. A FAILED tracking error may leave partially
committed batches; its result is conservatively unknown. No new tracking schema or
framework was introduced. Ordinary callers omit the option and retain their
original transaction, tracking, exception and cleanup behavior, including Slow
commands delegating to the unchanged ordinary Fast path.

`InstanceCommandConnectionError` distinguishes phase (verification, execution,
rollback, commit, tracking or cleanup), original `operationError`, secondary error,
operation outcome (not-started, rolled-back, unknown or committed), and failure
tracking outcome (not-written or unknown). A rejected initial verification never
calls up or writes FAILED. Failure-session verification rejection preserves the
original error and acknowledged rollback while reporting FAILED as not-written.
Rollback failure, lost/replaced execution session, command-owned transaction end,
and attempted COMMIT with failed acknowledgement cannot be called a definitive
rollback/failure. They produce no FAILED write. A later successful ROLLBACK after
an uncertain COMMIT does not resolve that uncertainty. Release failure preserves
the operation outcome and cache invalidation is still attempted; ordinary cleanup
semantics remain unchanged. No automatic retry is introduced.

The exact selector seam now requires a pinned ExpectedIdentity and always requests
guarded execution. Literal allowlist, runtime registration checks, execute
confirmation and backup requirement remain. The operational CLI and
`executeRegistered()` still reject before initialization: maintenance isolation,
independent restore review, final execution dependency/extension graph review and
disposable physical acceptance remain unresolved. Git/snapshot/backup guards and
5698-before-5700 orchestration remain intact. Unit evidence is not physical acceptance.

All four bootstrap DDL settings remain false. No runtime bootstrap dependency was
added: the operational adapter still imports the runner as a type only and does
not prepare TypeORM, Redis, Nest, workers or cron. Tests use controlled runners and
supported pg driver injection to intercept all network calls.

## Environment and target contract

Supported launcher: Linux/WSL, Linux Node 24 and this repository's installed Linux
dependencies. No Windows-native dependencies, NODE_PATH or NODE_OPTIONS preload
configuration. Process variables take precedence, including explicit empty
values. Undefined values alone fall back to the server-root `.env.test` for
`NODE_ENV=test`, otherwise `.env`. Supported NODE_ENV is absent, development or
test; production and other values are rejected. No dotenv loader mutates the
process environment and no application datasource configuration is imported.

The operational target remains fixed to TCP `127.0.0.1:5432/default`; a URL may
spell localhost, but the pg client receives pinned explicit parameters. URL
query/hash overrides and replicas are forbidden. Username and nonempty password
must be explicit; no PGUSER, PGPASSWORD, operating-system user or pgpass fallback.
Ambient node-postgres/libpq connection overrides are rejected, including role,
host, port, database, options, SSL, service, replication and encoding overrides.
No passwords, tokens or connection URLs appear in reports.

The actual read session must report the intended URL role as **both** current_user
and session_user, server `127.0.0.1/32:5432`, version
`18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)`, and data_directory
`/var/lib/postgresql/18/main`. Preview observes cluster identity; the backup
manifest must bind the same stable system identifier, effective role, server
version and snapshot. A second identity read detects inspection-session
replacement. The snapshot hash excludes ephemeral PID/start fields while binding
schema, indexes, tracking, configuration rows, provisioned workspaces, extensions
and relation catalog. It is not a hash of all CRM/application data.

## Maintenance isolation: external gate still UNKNOWN

`requireHostQuiescence()` now always rejects UNKNOWN. No host-process scan is
represented as proof. An empty pg_stat_activity observation is only a snapshot.
An advisory lock only excludes cooperating tools. Neither excludes future or
noncooperating writers, PostgreSQL jobs or startup/recovery activity.

Before a future execution approval, an independent operator must establish and
review an enforceable maintenance perimeter covering:

| Domain | Evidence and fresh verification required |
| --- | --- |
| Linux/WSL processes | Host and namespace inventory; stop-state observation alone cannot exclude restart |
| Windows launchers | Windows services, scheduled tasks, IDE processes and WSL launch authorities |
| Docker/containers | All hosts/containers, compose services, orchestrators and restart policies |
| PostgreSQL clients | Complete active-session visibility and enforceable exclusion of new application writers, including other databases with access to core tables |
| PostgreSQL background work | Extension workers, cron jobs and recovery/maintenance tasks that can write |
| Redis/BullMQ | Repeatable/recovery jobs, consumers and mechanisms that can restore consumers |
| Supervisors | systemd, PM2, cron, container and external restart authorities |
| Other applications | External clients, shared credentials and privileged roles capable of bypassing fencing |

A credible future mechanism needs external fencing (for example an independently
administered connection/privilege perimeter that admits only the reviewed
migration session and excludes noncooperating application writers), fresh DB
verification with sufficient visibility, and evidence bound to cluster, database,
role, reviewed commit and maintenance interval. PostgreSQL internal writers and
privileged operators require separate review. A user-supplied boolean or signed
report from an arbitrary user-supplied key is insufficient. No such trusted
maintenance authority exists in this revision. No processes, sessions, Redis
jobs or PostgreSQL permissions were changed here.

## Backup and restore evidence contract

No backup or restore is performed. `validate-backup` cannot establish independent
provenance and therefore never returns an execution approval. Candidate evidence
must use `backupSchema` and `restoreEvidenceSchema` in the source; unknown keys
are rejected. The prior true-valued confirmation fields remain legacy claims
only and do not open any gate.

The manifest requires the exact command, reviewed commit, default target,
cluster identity, effective role, server version, relevant snapshot hash,
archive SHA-256, archive path, creation time, restore verification time/operator,
evidence path and evidence SHA-256. Creation must precede restore verification;
both must be in the past and the archive less than 24 hours old.

All three paths must be absolute, canonical, outside the repository, regular
nonempty files without symlinks (including intermediate components) or hard
links. Open O_NOFOLLOW descriptors are retained for parsing/hashing/listing;
inode/device/size/nanosecond timestamps and named-path identity are checked
again to reject replacement or modification. Manifest/evidence size is limited.
`pg_restore --list` consumes the held archive descriptor through an inherited
fd, never a reopened arbitrary archive pathname, and does not restore/connect.
The archive inventory must cover configuration/tracking and cataloged relations
and table data. Listing is not a restore proof.

Structured evidence links to the **exact archive hash**, source cluster,
snapshot and commit, records an isolated restore target with a different port,
database, data_directory and system identifier, and identifies the operator,
restore time and restore/verification log hashes. Arbitrary nonempty files,
incorrect hashes, wrong source/archive linkage and default restore targets fail.
An entirely forged but consistent record still fails the independent-review
gate. Hashes protect linkage/integrity; they do not prove that a restore happened.

Independent operator review must inspect the original archive/creation record,
actual restore command and complete successful log, independently queried target
identity, relevant schema/tracking/data verification, original log hash matches,
backup completeness/freshness and maintenance chronology. A future trust
mechanism must pin the independent authority outside caller-controlled manifests
and require fresh review binding; none is configured now. Same-user/root file
mutation, dishonest operators and forgeable logs remain outside file-integrity
checks. No self-attested file, signer identity or true checkbox is approval.

## Exact selection, read-only preview and ordering

The literal allowlist is unchanged:

```text
2.32.0_AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand_1790793305698
2.32.0_AddInconnectMessagingAutomationPrincipalFastInstanceCommand_1790793305700
```

Exactly one selector is mandatory; aliases, ranges, wildcards, arbitrary commands,
unknown flags and targets are rejected. Static AST inspection validates actual
named imports, command decorators and module registration arrays; comments or
unused imports no longer prove workspace provider registration. No broad
registry/sequence lifecycle executes. The real decorator identity is checked in
the isolated selection tests. No registered command was edited.

Git must match feature/inconnect-messaging, an independently reviewed full SHA
and a clean tree including untracked files. Preparation intentionally leaves
files untracked because committing was prohibited; preview will stop on this
state. No bypass or automatic SHA substitution is available.

Preview uses an explicit pg client with default_transaction_read_only=on and
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; all catalog/data statements are
SELECT and it ends with ROLLBACK/connection close. It does not call any tracking
service, initialize TypeORM or Redis, import registered command implementations
or invoke any up(). Unit tests enforce this SQL boundary and role/reconnect
failures. The complete CLI was not run in this task, including preview.

5698 requires exact PRE shape and tracking; 5700 requires completed 5698,
consistent provisioned-workspace tracking and the exact post-5698 shape. Failed,
partial, duplicate, gapped, orphaned or unexpected tracking is rejected. PRE/POST
column, FK, CHECK, index, default and disabled/null checks remain. Each command
has its own transaction and backup prerequisite; no combined transaction or
automatic second command exists. A post-commit verification failure must report
failure/uncertainty, never imply rollback. Unit orchestration tests explicitly
exercise that case and rollback/tracking rejection without a success report.

## Disposable physical validation: design prepared, entrypoint BLOCKED

`test-only-contract.ts` is a pure test-only contract validator, **not a runnable
physical harness**. It has no connection or application imports, dotenv fallback
or command behavior. It accepts only explicit loopback targets with a distinct
port, `inconnect_disposable_*` database, different data_directory/system identity
and explicit intended role. Observed sessions use the same identity primitive.
Local default and remote endpoints are rejected; even a valid candidate cannot
pass `requirePhysicalHarnessSafety()`.

A future separately reviewed harness must use the corrected real adapter/core
writer API, real TypeORM metadata, real InstanceCommandRunnerService and
UpgradeMigrationService, and the unchanged two registered commands. It must not
copy their behavior or weaken the operational target. Required prerequisites:

1. Independently provision/authorize a disposable PostgreSQL cluster with no
   route or credentials to local default; network fencing must exclude port 5432
   even if a connection is replaced. Independently verify database, port,
   directory, stable system identity, role and server version.
2. Restore an independently reviewed eligible baseline with required extensions,
   real metadata, strict tracking and exact 5698 PRE schema under separate approval.
3. Use separately isolated Redis only if real cache invalidation requires it;
   never connect the harness to operational Redis or start consumers.
4. Independently review and physically accept the implemented generic writer API;
   reuse the same closed startup options and identity checks in both adapters,
   without introducing an operational CLI target flag.
5. Physically test 5698 success/POST, then 5700 success/POST, failure tracking,
   rollback/tracking faults, session loss/replacement and post-commit uncertainty.
   Confirm no hidden DDL, broad discovery, queues or application bootstrap.

No cluster/database was created, no harness connected and neither up() ran here.

## Review disposition

Safe to commit **for further review only**, subject to the user's later commit
authorization and passing quality checks. **Not safe to execute against default**.
Remaining blockers: physical acceptance of the writer API and execution dependency
graph, independently enforced maintenance, independent restore provenance/review,
and separately authorized physical proof.
No current API guarantee was substituted with a heuristic or UNKNOWN-as-PASS.

## Historical F13C.3B1-FIX validation and inventory (2026-10-13)

Original baseline: 7 suites, 65 tests passed before edits. Final focused run:
12 suites, 117 tests passed. Existing selection/schema/tracking/preview cases
remain; the old unsafe adapter-success expectation was corrected to require
BLOCKED before initialization. Five new focused suites cover startup, identities,
environment, artifact/evidence handling and source registration. Original CLI
orchestration tests explicitly mock the execution-safety gate and real execution
adapter; separate tests use the actual unmocked blocker. No physical test ran.

Commands/results (Linux Node 24.16.0 on PATH):

- `node node_modules/jest/bin/jest.js --config packages/twenty-server/jest.config.mjs --runInBand packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__`: 117 passed.
- `NX_DAEMON=false npx nx typecheck twenty-server --excludeTaskDependencies`: PASS; avoids unrelated dependency builds.
- `NX_DAEMON=false npx nx lint:diff-with-main twenty-server --excludeTaskDependencies`: PASS, committed branch scope (368 linted files); this command excludes untracked tooling.
- From twenty-server: `npx oxlint --type-aware -c .oxlintrc.json src/database/scripts/inconnect-exact-upgrade`: PASS, zero warnings/errors across all tooling TypeScript files.
- `npx oxfmt --check` on the tooling directory and launcher: PASS.
- `node --check packages/twenty-server/scripts/inconnect-exact-upgrade.cjs`: PASS; syntax check only, no CLI execution.
- `git diff --check` plus individual `git diff --no-index --check /dev/null <untracked-file>`: PASS.

Preflight and final Git identity: feature/inconnect-messaging,
`bf18fcaff1872c3375a5eb29c0fa42aedc597de0`. No unrelated modifications. All files
remain untracked: 17 expected at preflight, now 29 (12 additions). Tracked
`git diff --stat` is empty because this tooling has never been staged/committed.
An unstaged comparison with the captured pre-edit files was reviewed separately.

Changed original files (13):

```text
packages/twenty-server/docs/INCONNECT_EXACT_INSTANCE_COMMAND_RUNNER.md
packages/twenty-server/scripts/inconnect-exact-upgrade.cjs
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/cli.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/guards.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/inspection.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/operator-files.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/registered-execution.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/source-audit.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__/cli.spec.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__/guards.spec.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__/inspection.spec.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__/operator-files.spec.ts
packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/__tests__/registered-execution.spec.ts
```

Added files (12), all under
`packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/`:

```text
artifact.ts
connection-identity.ts
datasource-options.ts
environment.ts
execution-safety.ts
restore-evidence.ts
test-only-contract.ts
__tests__/artifact-evidence.spec.ts
__tests__/connection-identity.spec.ts
__tests__/datasource-options.spec.ts
__tests__/environment.spec.ts
__tests__/source-audit.spec.ts
```

Four expected untracked files are unchanged: `schema.ts`, `selected-command.ts`,
`__tests__/schema.spec.ts`, `__tests__/selected-command.spec.ts`. This accounts for
all 29 files. No shared core, registered migration, application, frontend,
Record Access, GraphQL, Outbox or AGENTS.md file changed.

Final short status:

```text
?? packages/twenty-server/docs/INCONNECT_EXACT_INSTANCE_COMMAND_RUNNER.md
?? packages/twenty-server/scripts/inconnect-exact-upgrade.cjs
?? packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/
```


## M2 validation and exact changed-file inventory (2026-10-13)

Result: **PARTIAL overall; code contract PASS; operational execution BLOCKED**.

- Tooling plus all upgrade unit regressions: **25 suites, 274 tests, 20 snapshots PASS**.
  This includes the existing 117 tooling tests, controlled real runner/tracking/
  workspace service paths, two installed-TypeORM client-retention tests with all
  network calls intercepted, and existing upgrade/status/sequence regressions.
- Server typecheck: **PASS** via the real Nx `twenty-server:typecheck` target with
  `--excludeTaskDependencies --skip-nx-cache`; existing dependency builds were not rerun.
- Required `lint:diff-with-main twenty-server`: **PASS**, 368 committed-branch files.
  Its configured `main...HEAD` comparison excludes worktree/untracked edits.
- Separate touched/untracked typed lint: **PASS**, 31 TypeScript files, zero warnings/errors.
- Separate format check: **PASS**, 32 TypeScript/launcher files.
- Launcher `node --check`: **PASS**, syntax only; no CLI invocation.
- Tracked and every untracked file's `git diff --check`: **PASS**.

Negative coverage includes full database/cluster/role mismatch, unavailable identity
evidence, backend/client replacement, released client, pre-up rejection, command
transaction ownership violation, separately verified FAILED session and mismatch,
multiple FAILED save batches on one manager, rollback error, uncertain COMMIT with
both transaction-active states, successful/failed tracking, cleanup/cache faults,
ordinary caller success/failure/exception compatibility, subscriber/query-cache
rejection and unchanged operational/physical-harness blocking gates.

Changed or added in M2 (11 files; paths relative to `packages/twenty-server`):

```text
src/engine/core-modules/upgrade/services/instance-command-runner.service.ts
src/engine/core-modules/upgrade/types/instance-command-connection-verification.ts (new)
src/engine/core-modules/upgrade/services/__tests__/instance-command-runner.service.spec.ts (new)
src/database/scripts/inconnect-exact-upgrade/connection-identity.ts
src/database/scripts/inconnect-exact-upgrade/selected-command.ts
src/database/scripts/inconnect-exact-upgrade/registered-execution.ts
src/database/scripts/inconnect-exact-upgrade/execution-safety.ts
src/database/scripts/inconnect-exact-upgrade/test-only-contract.ts
src/database/scripts/inconnect-exact-upgrade/__tests__/selected-command.spec.ts
src/database/scripts/inconnect-exact-upgrade/__tests__/writer-session-pinning.spec.ts (new)
docs/INCONNECT_EXACT_INSTANCE_COMMAND_RUNNER.md
```

All other pre-existing tooling is preserved. Git branch/HEAD are unchanged. Final
status is one modified tracked runner plus 32 untracked files (29 existing + 3 new).
Tracked diff: 210 insertions, 4 deletions; untracked additions are inspected separately
and are not represented by `git diff --stat`. Nothing is staged or committed.

Database mutations: **NONE**. No PostgreSQL connection, DDL, real registered
command execution, provisioning, activation, Redis connection, Outbox processing,
server/worker/cron startup, commit or push occurred. The unit tests do not constitute
physical acceptance. Safe to commit for independent code review after separate user
authorization: **YES**. Safe to execute against default: **NO**.

Future physical work requires separate explicit approval, an independently verified
disposable PostgreSQL cluster, network fencing denying default:5432, isolated
dependencies, audited real metadata and the real registered commands/runner/tracking.
After any guarded failure, the isolated execution datasource must be disposed and
no next command attempted; rollback errors must not leave a pooled session available
to another migration attempt. No operational guard or test target may be weakened.
