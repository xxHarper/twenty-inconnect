# F13C.3B1-PG0 — isolated PostgreSQL harness preparation

PG0 implements test infrastructure and non-network checks only. Physical execution
is **BLOCKED**. This document does not authorize PG1. The operational CLI remains
unchanged and blocked. No PostgreSQL/Redis connection, cluster startup, database
creation, fixture installation, registered `up()`/`down()`, real fault injection,
worker, migration, commit or push belongs to PG0.

## Git preflight and scope

Verified in the normal WSL sandbox: `feature/inconnect-messaging`, HEAD
`da8f1ab090805b2f89f5b12f105a24fddadbce59`, clean worktree, readable AGENTS.md.
AGENTS.md was read completely. `ab6845a6489069db6663bc86c274e981e2478929`
contains the guarded runner, verification contract and runner/pool tests (four
files). HEAD contains the exact tooling, launcher, documentation and tests (30
files). Neither commit was fetched or changed.

All PG0 additions are under `src/database/scripts/inconnect-exact-upgrade/physical-harness/`,
plus this document and `scripts/inconnect-exact-upgrade-physical-test.cjs`.
No shared production core, registered command, operational CLI, AGENTS.md,
GraphQL, frontend, F13C runtime, Record Access or Outbox source changes.

## Architecture and entrypoint

`target-contract.ts` validates explicit target/evidence/credential linkage and
environment exclusion. `isolation.ts` compares candidate isolation and cleanup
observations. Neither module collects observations or mutates anything.
`datasource-options.ts` is a pure, closed connection-options factory.
`step-plan.ts` reuses the existing schema/index validators and validates exact
instance/workspace tracking before advancing. `fixtures/pre-5698.sql` is an
unexecuted candidate baseline.

`real-runner.ts` stages construction of the real DataSource, real WorkspaceEntity
and UpgradeMigrationEntity metadata, UpgradeMigrationService,
WorkspaceVersionService and InstanceCommandRunnerService. The config adapter
supplies only APP_VERSION=2.32.0; the cache adapter records mock invalidations.
Tracking repositories are real, never mocked in this staged physical path.
WorkspaceEntity requires its imported relation metadata closure. PG1 must pin
and review the resulting entity graph before enabling initialization. Reading
global metadata storage is not evidence that the final graph has been reviewed.

`registered-step.ts` stages one exact registered command invocation through
`InstanceCommandRunnerService.runFastInstanceCommand()`, with the existing
`createSessionConnectionVerification()` callback. It validates the decorator's
version, kind, class name and timestamp, then validates POST state. The command
implementation supplies all DDL. The harness never copies its DDL, implements
transactions or inserts tracking on its behalf. Success tracking, failed
tracking, attempts, batches, rollback and COMMIT belong to the real services.
An inspection callback is a future integration dependency, not a JSON approval.

Both staged physical adapters unconditionally call
`requirePhysicalExecutionSafety()` before runtime imports, inspection or
connection initialization. There is no flag, environment token, manifest field,
force option or exported unguarded physical runner route. PG1 requires a
separately authorized implementation/review of the missing supervisor and
inspection bindings; removing the blocker alone is insufficient.

The distinct test launcher supports exactly this **static, non-network** command:

```bash
PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH node packages/twenty-server/scripts/inconnect-exact-upgrade-physical-test.cjs --preview --command 2.32.0_AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand_1790793305698
```

The second identity can also be previewed. Preview validates the selector and
prints the PG1 case plan; it reads no target/evidence file and proves no physical
state. `--execute` always rejects. Target overrides, multi-command requests,
aliases and arbitrary commands reject. This launcher is not registered with
Nest or Nx application commands and must never be imported by production code.
Do not use the operational CLI's preview for PG0: it opens a database connection.

## Isolation contract and limits

The normal cluster is forbidden: TCP `127.0.0.1:5432`, database `default`,
data directory `/var/lib/postgresql/18/main`, PostgreSQL 18.6. Another database
on that postmaster is not an isolated target.

The candidate contract requires explicit TCP `127.0.0.1`, port 1024..65535 other
than 5432, disposable database and role names, independent expected identity,
and the exact `/tmp/inconnect-pg-<run UUID>/data` directory. Socket host syntax,
DNS aliases, remote hosts, default role names, unknown keys, missing credentials,
path traversal, default directory and the default cluster identifier reject.
The role must equal both expected current_user and session_user.

Independent setup evidence must bind the run UUID, reviewed commit, baseline
hash, secret hash, offline disposable pg_controldata artifact hash/system
identifier, independently known default system identifier, resource root,
postmaster PID/start ticks, and host/isolated net/mount/PID namespace identities.
Expected identifiers must not originate from the connection being verified.
The disposable and normal cluster identifiers must differ even if other target
parameters differ. Credential hash matching prevents accidentally substituting
normal credentials; hashes and the origin string do not authenticate evidence.
No caller-supplied consistent JSON, boolean or arbitrary signer establishes trust.
Trusted evidence ingestion and fresh kernel observation are PG1 blockers.

For every real writer A and failure-tracking writer B, the existing verifier
reads current_database, current_user, session_user, exact server version,
data_directory, pg_control_system system_identifier, server/client address,
port, backend PID and backend_start. All expected stable fields must match.
Each runner pins its observed PID/start separately. The real core runner also
pins the retained physical client object and manager/QueryRunner binding before
and after verification, transaction start, command, workspace selection,
tracking and COMMIT. A released/replaced connection fails closed. Inaccessible
pg_control_system/data_directory evidence fails; no GRANT or repair is attempted.
The read-only tracking precheck can use an implicit connection, but all writers
are explicitly verified. OS isolation must protect even unverified startup and
inspection connections.

Available tools inspected without invoking them: `/usr/bin/unshare`,
`/usr/bin/bwrap`, PostgreSQL 18 binaries under `/usr/lib/postgresql/18/bin`.
Docker and Podman were not found on the inspected PATH. These observations prove
availability only, not usable user namespaces, root access or enforced fencing.
No namespace capability probe, container or server startup occurred.
`setup-dev-env.sh` targets normal local/compose services and may create databases,
start PostgreSQL/Redis and initialize schema; it is unsuitable for this task.
Existing `.postgres.spec.ts` tests accept process URLs, initialize unguarded
datasources and directly invoke commands. They are not the PG1 driver.

Least invasive proposed PG1 method: an independently reviewed rootless supervisor
using a new user, network, mount and PID namespace, with bwrap/unshare if supported.
The postmaster and tests share the private network namespace; only loopback and
the chosen disposable listener exist. No veth, host network, forwarding, proxies,
host database mounts, Docker socket or route to the host/Windows network exists.
Private `/tmp`, `/run`, `/var/run`, empty HOME, and restricted read-only project/
runtime mounts exclude normal PostgreSQL pathname sockets, pgpass/service files,
application dotenv files and data directories. Abstract sockets are isolated by
the network namespace. PostgreSQL uses `unix_socket_directories=''`; tests use TCP.
The only writable resource root is supervisor-owned. The kernel observation must
confirm the postmaster and harness namespaces, executable/command ownership,
PID/start continuity, interfaces, routes, sockets, listeners and complete database
inventory (only templates, postgres and the disposable test database).

Port 5432 on private loopback has no listener; it cannot address host default.
There is no exported default credential and no reachable normal socket. R/S must
prove this with disposable-supervisor probes that never send packets to the normal
cluster, plus mount/net evidence and supervisor audit logs. PG0 structural guard
tests do not prove that this perimeter exists. If rootless namespaces are denied,
stop. A separately approved network-none container with no published ports/mounts
may be reviewed later if a runtime becomes available; no automatic fallback to a
different database or unenforced localhost setup is allowed.

## Environment precedence and TypeORM startup

Normal Core/Raw datasource factories load .env.test when NODE_ENV=test, otherwise
.env, with process values authoritative (`override:false`). Missing URLs still
fall back to files or node-postgres defaults. They are never imported here.
The harness reads no dotenv file, URL or node-postgres defaults. All host, port,
database, user, password and SSL inputs are explicit. Physical construction
requires NODE_ENV=test and rejects ambient PG*, REDIS*, DATABASE_URL, dotenv,
TS_NODE, NODE_OPTIONS/NODE_PATH and INCONNECT database/execution overrides,
including explicit empty values. It checks actual process.env as well as the
supplied environment. The future supervisor must exec an absolute trusted Linux
Node path with the allowlisted environment from `isolatedChildEnvironment()`;
PATH, HOME, application env and loader/preload hooks are not inherited.

The closed options retain installExtensions=false, synchronize=false,
migrationsRun=false, dropSchema=false; empty migrations/subscribers, no replicas,
cache, logging, globs or arbitrary caller options. One-slot pool is the default;
connection acquisition timeout is 1000ms, statement/lock/idle-transaction timeouts
are bounded. The harness does not race an unbounded connect with a JS timeout.
Real TypeORM startup is unit-tested using supported per-datasource driver
injection: every transport call is intercepted and all startup SQL must be SELECT.
The existing tooling regression also catches hidden CREATE EXTENSION behavior.
UUID defaults require uuid-ossp; PG1 supervisor must explicitly prepare it in
public before applying the fixture, then check pg_extension read-only. Metadata
for unrelated relations does not require physical tables because no bootstrap,
synchronize or arbitrary repository operation is permitted. Final graph review
must check any additional extension dependencies. No AppModule, cron, worker,
application init or queue initialization exists in this harness.

## PRE-5698 fixture strategy and proof boundary

The candidate SQL defines six physical core tables: workspace, objectMetadata,
role, userWorkspace, inconnectMessagingConfiguration and upgradeMigration.
Configuration contains the audited PRE columns/order/defaults, PK, revision CHECK,
Workspace/anchor FKs and composite UNIQUE index. Reference tables supply physical
PKs/workspace composite uniqueness and synthetic rows for FK tests. Tracking has
the real entity's UUID generation, status/attempt/version/error/isInitial/timestamp
columns, workspace cascade FK and partial instance/workspace unique indexes.
It starts EMPTY; no `_typeorm_migrations` table or fictional completed history is
inserted. Real runner persistence must generate all observed command rows.

Workspace contains the exact columns read by getProvisionedWorkspaceIds:
id, activationStatus and deletedAt. The synthetic statuses CREATED, ACTIVE and
SUSPENDED must be tracked; INACTIVE and soft-deleted ACTIVE must be excluded.
The fixture uses varchar plus a status CHECK because the real helper explicitly
casts activationStatus to text. It does not claim production enum/table/entity
parity beyond the exercised projection/filter semantics. Other Core models are
minimal references, not a complete production CRM schema. No customer records,
default dump, live workspace identifiers or copied application data are used.

This avoids the historical `42P07` in SetupMetadataTables1700140427984 without
retrying database:init or editing legacy history. It proposes a minimal physical
integration proof of the two real DDL commands, runner transaction behavior and
actual tracking writes. It does NOT prove fresh supported application initialization,
legacy migration correctness, all production Core constraints, upgrade eligibility
of an existing installation, principal provisioning or F13C runtime activation.
The fixture has only static/unit review in PG0. PG1 must independently review its
hash/source and physically compare PRE catalogs, required indexes/constraints,
tracking defaults and generated repository SQL before running command 5698.
`validatePhysicalStage()` rejects missing/duplicate/initial/unrelated/failed rows,
partial schema and wrong defaults. Strict success scenarios start at attempt 1;
fault scenarios use fresh owned clusters and independent rollback/FAILED checks,
not the successful-chain stage validator. No reset/down/retry follows a fault.

## Redis boundary

The runner's only cache effect is UpgradeStatusService invalidation, which normally
calls UpgradeStatusCacheService and deletes four cache keys. The staged harness
uses an explicit in-memory invalidation adapter. This is mocked cache coverage,
not real Redis E2E; PostgreSQL runner/tracking/workspace services remain real.
No Redis endpoint, queue, worker, consumer or Outbox path is imported/connected.
If future PG1 requires real cache integration, authorize a distinct disposable
Redis process in the sealed namespace, distinct port/data root and per-run
EngineHealth namespace. Pin endpoint/ownership, exercise only those four keys,
close it before disposal, and never flush shared Redis or initialize BullMQ.

## PG1 physical matrix and isolated faults (not executed)

| Case | Required physical observation |
| --- | --- |
| A | Real 5698 commits DDL and real instance/workspace COMPLETED rows |
| B | Exact POST-5698 columns/defaults, tuple/strategy/label CHECKs and anchor/role FKs; disabled existing configs; invalid rows reject with PostgreSQL SQLSTATE |
| C | Real 5700 runs in a separate invocation only after verified B and commits tracking |
| D | Nullable automationUserWorkspaceId and exact restrictive userWorkspace FK; invalid identity/deletion rejects |
| E | One allowlisted decorator identity and one runner call per invocation |
| F | Fail after command DDL, before COMMIT; acknowledged rollback restores PRE catalogs |
| G | No COMPLETED tracking after F; transaction-local successful rows disappear |
| H | Verified B persists real FAILED instance/workspace rows only after acknowledged rollback |
| I | PoolSize=1: release A, acquire/retain/reverify B even when same pg client is reused |
| J | Wrong expected database/role/version/directory/system ID fails before BEGIN/up/writes |
| K | Physical termination/replacement loses continuity, reports uncertainty and stops tracking |
| L | Hold the only pool lease during B acquisition; bounded timeout removes waiter, no late write |
| M | Execution/release/tracking/cache cleanup faults retain original and secondary errors |
| N | Forward COMMIT, discard acknowledgement; UNKNOWN regardless of subsequent rollback response, no FAILED write |
| O | Exact null-workspace instance row plus CREATED/ACTIVE/SUSPENDED rows, excluding deleted/INACTIVE; multi-batch FAILED fixture as separate scenario |
| P | No unrelated command, legacy migration, broad registry or application initialization; before/after catalog/data inventory |
| Q | Captured installed-driver startup contains SELECT only; extension catalog unchanged |
| R | Kernel net/mount/PID fencing excludes host default TCP and every normal socket, even hostile env/reconnect |
| S | All writer PIDs belong to owned cluster; supervisor audit records no writable path/network outside it |

Fault seam proposal: a test-local pg Client subclass injected through a per-test
Pool class using TypeORM's supported driver option. Delegate real transport,
target only explicit statement boundaries and counters, inject a rejection before
completed-tracking persistence for F, or after forwarding COMMIT for N. Observe
backend PID and real transaction state independently. For L retain a lease using
that pool's supported acquisition API, not an unbounded Promise race. For K use
an independently verified disposable control session, never a host/global process
kill. Scope release/cache failures to returned test resource instances. No edits
to registered `up()`/`down()`, global TypeORM monkeypatch, replacement migration
engine, hand-inserted tracking or generic fault flags. This seam remains a plan;
no real fault was injected in PG0.

## Cleanup and interruption

The future supervisor owns the namespace process tree, immutable ownership record,
run UUID, data directory realpath/inode and postmaster PID/start/system identifier.
Use signal handling plus an external watchdog/pidfd or parent-death mechanism:
SIGKILL of the test cannot be handled by its JS finally. Retain a manifest for
interrupted-run recovery. On any guarded failure, close/dispose the datasource
and never advance to the next command. Stop test processes and owned postmaster,
release connections, close isolated Redis if present, and establish zero writers.
Verify fresh ownership and absence of symlinks/bind mounts before filesystem
disposal. `planOwnedCleanup()` only compares candidate evidence and returns the
exact owned root; it never deletes or signals anything. Unknown ownership means
preserve/quarantine resources. Keep redacted statement/outcome/identity logs
outside the disposable directory, excluding credentials and connection URLs.
Preserve the original operation error with cleanup failures as secondary errors.
Never DROP DATABASE default, stop the normal service, remove its directory,
clear shared Redis or queues. No cleanup command is implemented/run in PG0.

## Exact proposed PG1 procedure and remaining blockers

This is a gated procedure, not an executable PG0 command sequence:

1. Obtain separate explicit PG1 authorization naming reviewed source, fixture,
   disposable resources and physical cases. Independently review this PG0 diff.
2. Implement/review the supervisor's rootless namespace enforcement, trusted
   evidence ingestion, watchdog and fresh kernel checks. Validate user-namespace
   capability under that authorization. If unavailable, stop; no isolation bypass.
3. Pin Linux Node/PostgreSQL executable identities and metadata closure. Bind
   reviewed commit/fixture hashes. Supply independently trusted default cluster
   ID evidence without connecting the test to default. Exec the child with a
   sterile environment and empty HOME. No production datasource/dotenv loaders.
4. Inside the sealed perimeter only, provision a new test-owned cluster/data root
   and postmaster at a non-5432 port, disable Unix sockets, generate disposable
   credentials/database, and record offline pg_controldata evidence. Check all
   OS/process/database identities and absence of shared application databases.
5. Explicitly prepare required extensions, apply the reviewed minimal fixture
   once on independently verified disposable fixture sessions, and confirm empty
   tracking, PRE columns/indexes/FKs/defaults and expected synthetic workspaces.
   Do not use database:init, automatic retries or fake production migration history.
6. Implement/review the verified read-only snapshot binding. Start real TypeORM
   with the closed options, compare full session identity and actual startup SQL.
   Only then may a reviewed PG1 implementation replace the unconditional PG0 gate
   with enforced, independently trusted checks. No caller-controlled opt-in alone.
7. Invoke the test-only driver for exact 5698 once. Let the real runner own BEGIN,
   command DDL, workspace selection, tracking and COMMIT. Independently verify B
   and catalogs/tracking before allowing exact 5700 in a new invocation. Verify D.
8. Run E–S in fresh owned scenario clusters as needed; stop on mismatch, rollback,
   cleanup failure or uncertainty, dispose pools, and never retry a poisoned session.
9. Execute ownership-verified shutdown/disposal, check no surviving writers,
   retain redacted evidence and report what was physically proved. Keep the
   operational default CLI blocked: disposable proof does not authorize default.

No runnable PG1 command is supplied because supervisor capability, evidence trust,
physical fixture correctness and inspector binding are unestablished. PG0 leaves
these blockers explicit. It supplies no switch to bypass them.

## Validation and disposition

The PG0 focused suites execute real guard functions, installed TypeORM with a
fully intercepted test driver, static launcher preview, command-order/catalog
guards and the actual unconditional blocking gates. They neither connect nor
invoke registered commands. The existing upgrade regression excludes every
`.postgres.spec.ts` physical suite.

Final checks (Linux Node 24.16.0, normal sandbox, no elevated permissions):

- Focused harness: **5 suites / 118 tests PASS**.
- Exact tooling plus upgrade regression: **31 suites / 426 tests / 20 snapshots PASS**
  (includes the original 26 suites / 308 tests and the five new suites).
- Real `nx typecheck twenty-server --excludeTaskDependencies --skip-nx-cache`:
  **PASS**. Dependency builds were not rerun.
- `nx lint:diff-with-main twenty-server --excludeTaskDependencies --skip-nx-cache`:
  **PASS**, 400 files linted, zero warnings/errors. This target compares
  main...HEAD and excludes the untracked additions.
- Separate touched-file `oxlint --type-aware`: **PASS**, all 13 new TypeScript
  files, zero warnings/errors.
- `oxfmt --check`: **PASS**, 14 TypeScript/launcher files. The SQL fixture is
  reviewed as text, never parsed/executed by PostgreSQL.
- Test launcher `node --check`: **PASS**, syntax only.
- Tracked diff and every untracked file whitespace check: **PASS**.

Inventory: 16 additions (seven harness source files, six test/helper TypeScript
files, one SQL candidate fixture, one CJS launcher, this Markdown guide). No
tracked modifications, staging or commits. Final branch and HEAD remain as at
preflight; short status contains only these three untracked paths:

```text
?? packages/twenty-server/docs/INCONNECT_EXACT_UPGRADE_PHYSICAL_HARNESS.md
?? packages/twenty-server/scripts/inconnect-exact-upgrade-physical-test.cjs
?? packages/twenty-server/src/database/scripts/inconnect-exact-upgrade/physical-harness/
```

Disposition: **PASS for PG0 preparation; PG1 physical execution BLOCKED**. The
staged physical adapters are not yet runnable integration tests. Trusted OS
supervision, evidence provenance, fresh inspector binding and physical fixture
acceptance remain the PG1 dependencies described above.

Safe to commit for independent review after separate commit authorization: **YES**
if the listed quality checks pass. Safe to execute against default: **NO**.
PG1 did not run. Database mutations: **NONE**. Redis mutations: **NONE**.
