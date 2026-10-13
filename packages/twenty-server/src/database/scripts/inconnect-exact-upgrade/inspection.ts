import { createHash } from 'node:crypto';

import { Client } from 'pg';
import { PROVISIONED_WORKSPACE_ACTIVATION_STATUSES } from 'twenty-shared/workspace';

import {
  APPROVED_COMMANDS,
  type Request,
  type Snapshot,
  type TrackingRow,
  EXPECTED_DATA_DIRECTORY,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { configuredConnection } from 'src/database/scripts/inconnect-exact-upgrade/environment';
import {
  requireExtensions,
  SESSION_IDENTITY_SQL,
  verifySessionIdentity,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import {
  type Column,
  type Constraint,
  type PhysicalIndex,
  validateIndexes,
  validateSchema,
} from 'src/database/scripts/inconnect-exact-upgrade/schema';

export const inspectReadOnly = async (
  connectionString: string,
  request: Request,
  ownBackendPid?: number,
): Promise<Snapshot> => {
  const connection = configuredConnection(connectionString);
  const client = new Client({
    ...connection,
    application_name: 'inconnect-exact-upgrade-inspection',
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const connected = (await client.query(SESSION_IDENTITY_SQL)).rows[0];
    const verified = verifySessionIdentity(connected, {
      database: 'default',
      host: '127.0.0.1/32',
      port: 5432,
      version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
      dataDirectory: EXPECTED_DATA_DIRECTORY,
      // Cluster identity is observed in preview, then bound by the archive manifest.
      systemIdentifier: connected?.systemIdentifier,
      currentUser: connection.user,
      sessionUser: connection.user,
      clientAddress: '127.0.0.1/32',
    });
    const {
      backendPid: _backendPid,
      backendStart: _backendStart,
      ...identity
    } = verified;
    const extensions = requireExtensions(
      (
        await client.query(
          'SELECT extname AS name FROM pg_extension ORDER BY extname',
        )
      ).rows,
      ['uuid-ossp'],
    );
    const columns = (
      await client.query<Column>(`
      SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable,
        column_default AS "default"
      FROM information_schema.columns
      WHERE table_schema = 'core' AND table_name = 'inconnectMessagingConfiguration'
      ORDER BY ordinal_position
    `)
    ).rows;
    const constraints = (
      await client.query<Constraint>(`
      SELECT conname AS name, contype AS kind, pg_get_constraintdef(oid) AS definition,
        convalidated AS validated, condeferrable AS deferrable
      FROM pg_constraint WHERE conrelid = 'core."inconnectMessagingConfiguration"'::regclass
      ORDER BY conname
    `)
    ).rows;
    const tracking = (
      await client.query<TrackingRow>(`
      SELECT name, status, attempt, "workspaceId", "isInitial"
      FROM core."upgradeMigration" ORDER BY name, "workspaceId" NULLS FIRST, attempt
    `)
    ).rows;
    const legacyNames = (
      await client.query<{ name: string }>(`
      SELECT name FROM core._typeorm_migrations ORDER BY name
    `)
    ).rows.map(({ name }) => name);
    const workspaceIds = (
      await client.query<{ id: string }>(
        `
      SELECT id FROM core.workspace WHERE "activationStatus" = ANY($1) ORDER BY id
    `,
        [PROVISIONED_WORKSPACE_ACTIVATION_STATUSES],
      )
    ).rows.map(({ id }) => id);
    const otherSessions = Number(
      (
        await client.query<{ count: string }>(
          `
      SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND ($1::integer IS NULL OR pid <> $1)
    `,
          [ownBackendPid ?? null],
        )
      ).rows[0].count,
    );
    const shapeExtras = (
      await client.query<{ valid: boolean }>(`
      SELECT
        NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'core."inconnectMessagingConfiguration"'::regclass AND NOT tgisinternal)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'core."inconnectMessagingConfiguration"'::regclass AND attnum > 0 AND attisdropped)
        AND NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'core."inconnectMessagingConfiguration"'::regclass AND (relrowsecurity OR relforcerowsecurity OR relkind <> 'r'))
        AS valid
    `)
    ).rows[0].valid;
    const indexes = (
      await client.query<PhysicalIndex>(`
      SELECT relation.relname AS table, index_relation.relname AS name,
        (SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
          FROM unnest(index.indkey) WITH ORDINALITY AS key(number, ordinality)
          JOIN pg_attribute attribute ON attribute.attrelid = index.indrelid AND attribute.attnum = key.number) AS columns,
        index.indisunique AS unique, index.indisvalid AS valid, index.indisready AS ready,
        index.indisprimary AS primary, index.indimmediate AS immediate,
        index.indexprs IS NOT NULL AS expression, index.indpred IS NOT NULL AS partial,
        index.indnatts <> index.indnkeyatts AS includes
      FROM pg_index index JOIN pg_class relation ON relation.oid = index.indrelid
        JOIN pg_class index_relation ON index_relation.oid = index.indexrelid
      WHERE index.indrelid IN ('core."inconnectMessagingConfiguration"'::regclass,
        'core."objectMetadata"'::regclass, 'core.role'::regclass, 'core."userWorkspace"'::regclass)
      ORDER BY relation.relname, index_relation.relname
    `)
    ).rows;
    const completed = request.mode === 'verify-completed';
    const stage =
      request.command === APPROVED_COMMANDS[0]
        ? completed
          ? 1
          : 0
        : completed
          ? 2
          : 1;
    let defaultsValid = true;

    if (stage > 0) {
      defaultsValid = (
        await client.query<{ valid: boolean }>(`
        SELECT NOT EXISTS (SELECT 1 FROM core."inconnectMessagingConfiguration"
          WHERE "autoCreateEnabled" IS DISTINCT FROM false
          OR "autoCreateAnchorObjectMetadataId" IS NOT NULL OR "autoCreateOwnerStrategy" IS NOT NULL
          OR "autoCreateOwnerRoleId" IS NOT NULL OR "autoCreateLabelPolicy" IS NOT NULL
          ${stage === 2 ? 'OR "automationUserWorkspaceId" IS NOT NULL' : ''}) AS valid
      `)
      ).rows[0].valid;
    }
    const configurationRows = (
      await client.query(
        `SELECT * FROM core."inconnectMessagingConfiguration" ORDER BY "workspaceId"`,
      )
    ).rows;
    const backupRelations = (
      await client.query<{ schema: string; name: string; kind: string }>(`
      SELECT namespace.nspname AS schema, relation.relname AS name, relation.relkind AS kind
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT LIKE 'pg_%' AND namespace.nspname <> 'information_schema'
        AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      ORDER BY namespace.nspname, relation.relname
    `)
    ).rows;
    const stateHash = createHash('sha256')
      .update(
        JSON.stringify({
          identity,
          extensions,
          columns,
          constraints,
          indexes,
          tracking,
          legacyNames,
          workspaceIds,
          configurationRows,
          backupRelations,
        }),
      )
      .digest('hex');

    verifySessionIdentity(
      (await client.query(SESSION_IDENTITY_SQL)).rows[0],
      identity,
      verified,
    );
    await client.query('ROLLBACK');
    return {
      ...identity,
      extensions,
      schemaValid:
        validateSchema(columns, constraints, stage) &&
        validateIndexes(indexes) &&
        shapeExtras &&
        defaultsValid,
      tracking,
      legacyNames,
      workspaceIds,
      otherSessions,
      stateHash,
      backupRelations,
    };
  } finally {
    // Closing the connection also rolls back an unsuccessful inspection.
    await client.end();
  }
};
