import { type QueryRunner } from 'typeorm';

const CALL = 'inconnectVoiceCall';
const LEG = 'inconnectVoiceCallLeg';
const ACTIVE = 'IDX_inconnectVoiceCall_activeActor';
const HISTORY = 'IDX_inconnectVoiceCall_recordHistory';
const ACTOR_HISTORY = 'IDX_inconnectVoiceCall_actorHistory';

export const inboundColumns = [
  'inboundSessionId',
  'inboundDecision',
  'inboundScreenedAt',
  'inboundDialSettled',
  'answeredMemberId',
] as const;

export function requireVoiceInstall(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

export async function readVoiceSchemaState(runner: QueryRunner) {
  const rows: { name: string }[] = await runner.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = ANY($1::text[])`,
    [[CALL, LEG, ACTIVE, HISTORY]],
  );
  requireVoiceInstall(
    rows.length === 0 || rows.length === 4,
    'Partial Voice schema',
  );
  return rows.length === 0 ? 'absent' : 'present';
}

export async function verifyVoiceDependencies(runner: QueryRunner) {
  const indexes: {
    relation: string;
    keys: string[];
    predicate: string | null;
  }[] = await runner.query(
    `SELECT i.indrelid::regclass::text AS relation,
       ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, i.indnkeyatts) n) AS keys,
       pg_get_expr(i.indpred, i.indrelid) AS predicate
     FROM pg_index i
     WHERE i.indrelid = ANY(ARRAY['core.workspace'::regclass, 'core."objectMetadata"'::regclass, 'core."upgradeMigration"'::regclass])
       AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate`,
  );
  for (const [relation, keys, predicate] of [
    ['core.workspace', 'id', null],
    ['core."objectMetadata"', 'id,"workspaceId"', null],
    ['core."upgradeMigration"', 'name,attempt', '("workspaceId" IS NULL)'],
    [
      'core."upgradeMigration"',
      'name,attempt,"workspaceId"',
      '("workspaceId" IS NOT NULL)',
    ],
  ] as const) {
    requireVoiceInstall(
      indexes.some(
        (i) =>
          i.relation === relation &&
          i.keys.join(',') === keys &&
          i.predicate === predicate,
      ),
      `Voice dependency index differs for ${relation}`,
    );
  }
  const [row]: { valid: boolean }[] = await runner.query(
    `SELECT has_schema_privilege(current_user, 'core', 'USAGE')
      AND has_schema_privilege(current_user, 'core', 'CREATE')
      AND has_table_privilege(current_user, 'core."upgradeMigration"', 'SELECT')
      AND has_table_privilege(current_user, 'core."upgradeMigration"', 'INSERT')
      AND has_table_privilege(current_user, 'core.workspace', 'REFERENCES')
      AND has_table_privilege(current_user, 'core."objectMetadata"', 'REFERENCES')
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = 'core."upgradeMigration"'::regclass AND NOT tgisinternal
      )
      AND NOT EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class = 'core."upgradeMigration"'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D')
      AS valid`,
  );
  requireVoiceInstall(
    row?.valid,
    'The dedicated application owner lacks required privileges',
  );
}

const columnsByTable = {
  [CALL]: [
    'id:uuid!',
    'workspaceId:uuid!',
    'objectMetadataId:uuid!',
    'recordId:uuid!',
    'actorMemberId:uuid!',
    'actorLabel:text!',
    'direction:text!',
    'accountSid:text!',
    'applicationSid:text!',
    'callerId:text!',
    'destination:text!',
    'createdAt:timestamptz!=clock_timestamp()',
    'expiresAt:timestamptz!',
    'startedAt:timestamptz',
    'answeredAt:timestamptz',
    'endedAt:timestamptz',
    'durationSeconds:int4',
    "status:text!='reserved'::text",
    'result:text',
    'technicalError:text',
    'nextReconcileAt:timestamptz',
    'reconcileAttempts:int4!=0',
  ],
  [LEG]: [
    'callId:uuid!',
    'accountSid:text!',
    'providerCallSid:text!',
    'parentCallSid:text',
    'kind:text!',
  ],
};

const canonical = (definition: string) =>
  definition
    .replace(
      /'\{([a-z,-]+)\}'::text\[\]/g,
      (_literal, values: string) =>
        `ARRAY[${values
          .split(',')
          .map((value) => `'${value}'`)
          .join(',')}]`,
    )
    .replace(/::text/g, '')
    .replace(/[\s"()[\]]/g, '')
    .replace(/core\./g, '')
    // PostgreSQL deparses IS NOT DISTINCT FROM as a negated DistinctExpr.
    .replace(/NOTresultISDISTINCTFROM/g, 'resultISNOTDISTINCTFROM');

const constraintsByTable = {
  [CALL]: [
    'PRIMARY KEY (id)',
    'UNIQUE (id, "accountSid")',
    'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id)',
    'FOREIGN KEY ("objectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId")',
    "CHECK (direction = 'outbound')",
    'CHECK ("durationSeconds" >= 0)',
    "CHECK (status = ANY (ARRAY['reserved', 'connecting', 'ringing', 'answered', 'finished']))",
    "CHECK (result = ANY (ARRAY['answered', 'no-answer', 'busy', 'canceled', 'failed']))",
    "CHECK (technicalError = ANY (ARRAY['reservation-expired', 'routing-denied', 'provider-failed']))",
    'CHECK ("reconcileAttempts" >= 0)',
    "CHECK ((status = 'finished') = (result IS NOT NULL))",
    'CHECK ("durationSeconds" IS NULL OR result IS NOT DISTINCT FROM \'answered\')',
  ],
  [LEG]: [
    'PRIMARY KEY ("accountSid", "providerCallSid")',
    'UNIQUE ("callId", kind)',
    'UNIQUE ("callId", "accountSid", "providerCallSid")',
    'FOREIGN KEY ("callId", "accountSid") REFERENCES core."inconnectVoiceCall"(id, "accountSid")',
    'FOREIGN KEY ("callId", "accountSid", "parentCallSid") REFERENCES core."inconnectVoiceCallLeg"("callId", "accountSid", "providerCallSid")',
    "CHECK (kind = ANY (ARRAY['browser', 'destination']))",
    'CHECK ((kind = \'browser\') = ("parentCallSid" IS NULL))',
    'CHECK ("providerCallSid" <> "parentCallSid")',
  ],
};

export async function verifyInstalledVoiceSchema(
  runner: QueryRunner,
  version: '1.2' | '1.4' | '2' | '2.1' = '1.2',
) {
  const columns: { name: string; column: string; valid: boolean }[] =
    await runner.query(
      `SELECT c.relname AS name, a.attname || ':' || t.typname ||
            CASE WHEN a.attnotnull THEN '!' ELSE '' END ||
            COALESCE('=' || pg_get_expr(d.adbin, d.adrelid), '') AS "column",
            c.relkind = 'r' AND c.relpersistence = 'p' AND pg_get_userbyid(c.relowner) = current_user
              AND a.attidentity = '' AND a.attgenerated = '' AS valid
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid JOIN pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'core' AND c.relname = ANY($1::text[])
       AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum`,
      [[CALL, LEG]],
    );
  const keys: { name: string; definition: string; valid: boolean }[] =
    await runner.query(
      `SELECT c.relname AS name, pg_get_constraintdef(k.oid, true) AS definition,
            k.convalidated AND NOT k.condeferrable AS valid
     FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = ANY($1::text[]) AND k.contype IN ('p', 'u', 'f', 'c')`,
      [[CALL, LEG]],
    );
  for (const table of [CALL, LEG] as const) {
    const fields = columns.filter(({ name }) => name === table);
    const constraints = keys.filter(({ name }) => name === table);
    const expectedFields: string[] = [...columnsByTable[table]];
    const expectedChecks: string[] = [...constraintsByTable[table]];
    if (table === CALL && version !== '1.2') {
      for (const field of ['objectMetadataId', 'recordId']) {
        expectedFields[expectedFields.indexOf(`${field}:uuid!`)] =
          `${field}:uuid`;
      }
      expectedChecks.push(
        'CHECK (("objectMetadataId" IS NULL) = ("recordId" IS NULL))',
      );
    }
    if ((version === '2' || version === '2.1') && table === CALL) {
      expectedFields[expectedFields.indexOf('actorMemberId:uuid!')] =
        'actorMemberId:uuid';
      expectedFields.push(
        'inboundSessionId:uuid',
        'inboundDecision:text',
        'inboundScreenedAt:timestamptz',
        'inboundDialSettled:bool!=false',
        'answeredMemberId:uuid',
      );
      expectedChecks[4] =
        "CHECK (direction = ANY (ARRAY['outbound', 'inbound']))";
      expectedChecks[7] =
        "CHECK (result = ANY (ARRAY['answered', 'no-answer', 'busy', 'canceled', 'failed', 'declined']))";
      expectedChecks.push(
        "CHECK (\"inboundDecision\" = ANY (ARRAY['accept', 'decline']))",
        "CHECK (\"actorMemberId\" IS NOT NULL OR direction = 'inbound' AND status = 'finished')",
        'CHECK ("inboundSessionId" IS NULL OR direction = \'inbound\' AND "actorMemberId" IS NOT NULL AND "recordId" IS NOT NULL)',
        'CHECK ("answeredMemberId" IS NULL OR direction = \'inbound\' AND result IS NOT DISTINCT FROM \'answered\' AND NOT "answeredMemberId" IS DISTINCT FROM "actorMemberId" AND "inboundScreenedAt" IS NOT NULL)',
      );
    }
    if ((version === '2' || version === '2.1') && table === LEG) {
      expectedChecks[5] =
        "CHECK (kind = ANY (ARRAY['browser', 'destination', 'caller', 'browser-inbound']))";
      expectedChecks[6] =
        "CHECK ((kind = ANY (ARRAY['browser', 'caller'])) = (\"parentCallSid\" IS NULL))";
    }
    if (version === '2.1' && table === CALL) {
      expectedFields.push('distributionReason:text');
      const originalSession = expectedChecks.findIndex((item) =>
        item.startsWith('CHECK ("inboundSessionId"'),
      );
      expectedChecks[originalSession] =
        `CHECK ("inboundSessionId" IS NULL OR direction = 'inbound' AND
        "actorMemberId" IS NOT NULL AND ("recordId" IS NOT NULL OR "distributionReason" IS NOT NULL))`;
      expectedChecks.push(
        `CHECK ("distributionReason" IS NULL OR direction = 'inbound')`,
      );
    }
    if (version === '2.1' && table === LEG) {
      expectedFields.push('inboundOfferId:uuid');
      expectedChecks.splice(1, 1);
      expectedChecks.push(
        `FOREIGN KEY ("callId", "inboundOfferId") REFERENCES core."inconnectVoiceInboundOffer"("callId", id)`,
        `CHECK ("inboundOfferId" IS NULL OR kind = 'browser-inbound')`,
      );
    }
    requireVoiceInstall(
      fields.every(({ valid }) => valid) &&
        fields.map(({ column }) => column).join('\n') ===
          expectedFields.join('\n'),
      `Unexpected columns or owner for ${table}`,
    );
    requireVoiceInstall(
      constraints.every(({ valid }) => valid) &&
        constraints
          .map(({ definition }) => canonical(definition))
          .sort()
          .join('\n') === expectedChecks.map(canonical).sort().join('\n'),
      `Unexpected constraints for ${table}`,
    );
  }

  const indexes: { name: string; definition: string; valid: boolean }[] =
    await runner.query(
      `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
            i.indisvalid AND i.indisready AND i.indislive AS valid
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = ANY(ARRAY['core."inconnectVoiceCall"'::regclass, 'core."inconnectVoiceCallLeg"'::regclass])`,
    );
  const definitions = new Map(
    indexes.map((index) => [index.name, index.definition]),
  );
  requireVoiceInstall(
    indexes.length === (version === '1.2' ? 7 : version === '2.1' ? 9 : 8) &&
      indexes.every(({ valid }) => valid) &&
      (version !== '2.1' ||
        (definitions.get('IDX_inconnectVoiceLeg_legacyKind') ===
          `CREATE UNIQUE INDEX "IDX_inconnectVoiceLeg_legacyKind" ON core."inconnectVoiceCallLeg" USING btree ("callId", kind) WHERE ("inboundOfferId" IS NULL)` &&
          definitions.get('IDX_inconnectVoiceLeg_offer') ===
            `CREATE UNIQUE INDEX "IDX_inconnectVoiceLeg_offer" ON core."inconnectVoiceCallLeg" USING btree ("inboundOfferId") WHERE ("inboundOfferId" IS NOT NULL)`)) &&
      definitions.get(ACTIVE) ===
        `CREATE UNIQUE INDEX "${ACTIVE}" ON core."inconnectVoiceCall" USING btree ("workspaceId", "actorMemberId") WHERE (status <> 'finished'::text)` &&
      definitions.get(HISTORY) ===
        `CREATE INDEX "${HISTORY}" ON core."inconnectVoiceCall" USING btree ("workspaceId", "objectMetadataId", "recordId", "createdAt" DESC, id DESC)` &&
      (version === '1.2' ||
        definitions.get(ACTOR_HISTORY) ===
          `CREATE INDEX "${ACTOR_HISTORY}" ON core."inconnectVoiceCall" USING btree ("workspaceId", "actorMemberId", "createdAt" DESC, id DESC)`),
    'Unexpected or invalid Voice indexes',
  );
}
