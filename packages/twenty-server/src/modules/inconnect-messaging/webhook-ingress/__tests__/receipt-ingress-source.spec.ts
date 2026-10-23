import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { InstanceCommandProviderModule } from 'src/database/commands/upgrade-version-command/instance-command-provider.module';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { MetadataArgsStorage } from 'typeorm/metadata-args/MetadataArgsStorage';
import { EntityMetadataBuilder } from 'typeorm/metadata-builder/EntityMetadataBuilder';

import {
  RECEIPT_INGRESS_UP,
  RECEIPT_INGRESS_DOWN,
  AddInconnectMessagingIngressContractFastInstanceCommand,
} from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1792666800000-add-inconnect-messaging-ingress-contract';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';
import { buildInsertPrefix } from 'src/database/commands/workspace-export/utils/build-insert-prefix.util';
import { formatSqlValue } from 'src/database/commands/workspace-export/utils/format-sql-value.util';
import { getWasIntroducedInUpgradePropertyMetadata } from 'src/engine/core-modules/upgrade/decorators/was-introduced-in-upgrade.decorator';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { ATTENTION_LEDGER_ROW_GUARDS } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-row-guards';
import { ATTENTION_LEDGER_TRIGGERS_UP } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-triggers';
import { prepareProviderConnectionDisable } from 'src/modules/inconnect-messaging/webhook-ingress/prepare-provider-connection-mutation';
import {
  mockRunner,
  sessionRow,
  step,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';

const buildReceiptMetadata = () => {
  const entity = InconnectMessagingWebhookReceiptEntity;
  const all = getMetadataArgsStorage();
  const isolated = new MetadataArgsStorage();
  isolated.tables.push(...all.tables.filter(({ target }) => target === entity));
  isolated.columns.push(
    ...all.columns.filter(({ target }) => target === entity),
  );
  isolated.generations.push(
    ...all.generations.filter(({ target }) => target === entity),
  );
  isolated.indices.push(
    ...all.indices.filter(({ target }) => target === entity),
  );
  isolated.checks.push(...all.checks.filter(({ target }) => target === entity));
  const dataSource = new DataSource({ type: 'postgres' });
  const metadata = new EntityMetadataBuilder(dataSource, isolated).build([
    entity,
  ]);
  Object.assign(dataSource, {
    entityMetadatas: metadata,
    entityMetadatasMap: new Map(metadata.map((item) => [item.target, item])),
  });
  return { dataSource, metadata: metadata[0] };
};
const source = (path: string) =>
  readFileSync(join(process.cwd(), 'src', path), 'utf8');
const guard = RECEIPT_INGRESS_UP.find((sql) =>
  sql.startsWith('CREATE FUNCTION core.im_ingress_receipt_guard'),
)!;

describe('receipt DDL and compatibility source contracts (no PostgreSQL execution)', () => {
  it('has nullable integer mapping without ORM defaults, implicit selection, writes or returning', () => {
    const { dataSource, metadata } = buildReceiptMetadata();
    const version = metadata.columns.find(
      (column) => column.propertyName === 'ingressContractVersion',
    )!;
    expect(version.type).toBe('integer');
    expect(version.isNullable).toBe(true);
    expect(version.default).toBeUndefined();
    expect([version.isSelect, version.isInsert, version.isUpdate]).toEqual([
      false,
      false,
      false,
    ]);
    expect(metadata.getInsertionReturningColumns()).not.toContain(version);
    const select = dataSource
      .createQueryBuilder(InconnectMessagingWebhookReceiptEntity, 'receipt')
      .getSql();
    const insert = dataSource
      .createQueryBuilder()
      .insert()
      .into(InconnectMessagingWebhookReceiptEntity)
      .values({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        ingressContractVersion: 1,
      })
      .getSql();
    const update = dataSource
      .createQueryBuilder()
      .update(InconnectMessagingWebhookReceiptEntity)
      .set({ processingState: 'PROCESSING', ingressContractVersion: 1 })
      .getSql();
    for (const sql of [select, insert, update])
      expect(sql).not.toContain('ingressContractVersion');
    expect(
      getWasIntroducedInUpgradePropertyMetadata(
        InconnectMessagingWebhookReceiptEntity,
      ).ingressContractVersion.upgradeCommandName,
    ).toBe(
      '2.32.0_AddInconnectMessagingIngressContractFastInstanceCommand_1792666800000',
    );
  });

  it('registers the additive command exactly once, without running it', () => {
    expect(
      INSTANCE_COMMANDS.filter(
        (command) =>
          command === AddInconnectMessagingIngressContractFastInstanceCommand,
      ),
    ).toHaveLength(1);
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        InstanceCommandProviderModule,
      ),
    ).toContain(AddInconnectMessagingIngressContractFastInstanceCommand);
    expect(
      getRegisteredInstanceCommandMetadata(
        AddInconnectMessagingIngressContractFastInstanceCommand,
      ),
    ).toEqual({ version: '2.32.0', timestamp: 1792666800000, type: 'fast' });
    expect(
      INSTANCE_COMMANDS.filter(
        (command) =>
          getRegisteredInstanceCommandMetadata(command)?.timestamp ===
          1792666800000,
      ),
    ).toHaveLength(1);
    expect(RECEIPT_INGRESS_UP[0]).toContain(
      'ADD COLUMN "ingressContractVersion" integer NULL',
    );
    expect(RECEIPT_INGRESS_UP[0]).not.toContain('DEFAULT');
    expect(RECEIPT_INGRESS_UP.join('\n')).not.toMatch(
      /UPDATE core|INSERT INTO|BACKFILL/,
    );
    expect(RECEIPT_INGRESS_DOWN.join('\n')).not.toMatch(
      /DROP TABLE|CASCADE|DELETE FROM/,
    );
    expect(RECEIPT_INGRESS_DOWN[5]).toContain(
      'DROP COLUMN "ingressContractVersion"',
    );
  });

  it.each([
    'id',
    'workspaceId',
    'providerConnectionId',
    'eventKind',
    'idempotencyKey',
    'payloadHash',
    'firstReceivedAt',
    'normalizedMetadata',
    'ingressContractVersion',
  ])(
    'compares both OLD and NEW %s on every UPDATE, including NULL promotion',
    (field) => {
      const update = guard.slice(
        guard.indexOf("IF TG_OP = 'UPDATE'"),
        guard.indexOf('IF NEW."ingressContractVersion"'),
      );
      expect(update).toContain(`NEW."${field}"`);
      expect(update).toContain(`OLD."${field}"`);
      expect(update).toContain('IS DISTINCT FROM');
      expect(update).toContain("ERRCODE = '23514'");
    },
  );

  it.each([
    'processingState',
    'leaseToken',
    'leaseExpiresAt',
    'attemptCount',
    'error',
    'processedAt',
    'updatedAt',
  ])('does not freeze legitimate lifecycle field %s', (field) => {
    expect(guard).not.toContain(`"${field}"`);
  });

  it('guards INSERT shape and all DELETE/TRUNCATE paths, with no authentication claim', () => {
    expect(guard).toContain('NEW."eventKind" = \'INBOUND_MESSAGE\'');
    expect(guard).toContain('IS NOT TRUE');
    expect(guard).toContain("IF TG_OP = 'DELETE'");
    const deletion = guard.slice(
      guard.indexOf("IF TG_OP = 'DELETE'"),
      guard.indexOf("IF TG_OP = 'UPDATE'"),
    );
    expect(deletion).toContain("RAISE EXCEPTION 'receipt identity retained'");
    expect(deletion).not.toContain('ingressContractVersion');
    expect(RECEIPT_INGRESS_UP.join('\n')).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE',
    );
    expect(RECEIPT_INGRESS_UP.join('\n')).toContain('BEFORE TRUNCATE');
    expect(RECEIPT_INGRESS_UP[3]).toContain(
      "RAISE EXCEPTION 'receipt identities retained'",
    );
  });

  it('coexists with the earlier callback guard; earlier name sorts first and neither mutates lifecycle', () => {
    expect(ATTENTION_LEDGER_TRIGGERS_UP.join('\n')).toContain(
      '"TR_IM_AT_WEBHOOK_WRITE" BEFORE UPDATE',
    );
    expect(
      ['TR_IM_INGRESS_RECEIPT_WRITE', 'TR_IM_AT_WEBHOOK_WRITE'].sort(),
    ).toEqual(['TR_IM_AT_WEBHOOK_WRITE', 'TR_IM_INGRESS_RECEIPT_WRITE']);
    const earlier = ATTENTION_LEDGER_ROW_GUARDS.find((sql) =>
      sql.includes('FUNCTION core.im_at_webhook_guard'),
    )!;
    expect(earlier).not.toContain('NEW :=');
    expect(earlier).toContain('RETURN NEW');
    expect(guard).not.toMatch(/NEW\.[^\n]*:=/);
  });

  it('preserves the discriminator in backup output using real export formatting; imports remain privileged', () => {
    const statement =
      buildInsertPrefix('core', 'inconnectMessagingWebhookReceipt', [
        'id',
        'ingressContractVersion',
      ]) + `(${formatSqlValue('receipt-id')}, ${formatSqlValue(1)});`;
    expect(statement).toContain('"ingressContractVersion"');
    expect(statement).toContain(', 1)');
    const exporter = source(
      'database/commands/workspace-export/workspace-export.service.ts',
    );
    expect(exporter).toContain('SELECT * FROM');
    expect(exporter).toContain('Object.keys(rows[0])');
    expect(exporter).toContain("SET session_replication_role = 'replica'");
    // This is an audited administrative bypass, not an implemented quarantine.
  });

  it('keeps policy unregistered and attention/reducer/worker unwired', () => {
    const module = source(
      'modules/inconnect-messaging/inconnect-messaging.module.ts',
    );
    expect(module).not.toContain('INBOUND_INGRESS_POLICY');
    for (const path of [
      'services/inconnect-messaging-webhook-processing.service.ts',
      'jobs/inconnect-messaging-webhook-processing.job.ts',
      'attention-adapter/persistence/writer/prepare-attention-write.ts',
    ]) {
      expect(source('modules/inconnect-messaging/' + path)).not.toContain(
        'webhook-ingress/',
      );
    }
    const ingress = source(
      'modules/inconnect-messaging/webhook-ingress/authenticated-inbound.ts',
    );
    expect(ingress).not.toContain('AutoCreateAuthority');
    expect(ingress).not.toContain('.dispatch(');
  });

  it('prepares disable gate-first on the same caller runner without lifecycle ownership', async () => {
    const workspaceId = '00000000-0000-0000-0000-000000000001';
    const connectionId = '00000000-0000-0000-0000-000000000003';
    const gateSql = `SELECT "workspaceId"
    FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = $1::uuid FOR UPDATE`;
    const mutationSql = `WITH changed AS (
    UPDATE core."inconnectMessagingProviderConnection"
    SET "lifecycleStatus" = 'DISABLED', "updatedAt" = now()
    WHERE "workspaceId" = $1::uuid AND "id" = $2::uuid RETURNING "id"
  ) SELECT "id" FROM changed`;
    const fixture = mockRunner([
      step(ATTENTION_SESSION_SQL, [], [sessionRow]),
      step(gateSql, [workspaceId], [{ workspaceId }]),
      step(mutationSql, [workspaceId, connectionId], [{ id: connectionId }]),
      step(ATTENTION_SESSION_SQL, [], [sessionRow]),
    ]);
    await prepareProviderConnectionDisable(
      fixture.queryRunner,
      workspaceId,
      connectionId,
    );
    expect(fixture.calls.map((call) => call.sql)).toEqual([
      ATTENTION_SESSION_SQL,
      gateSql,
      mutationSql,
      ATTENTION_SESSION_SQL,
    ]);
    for (const method of [
      fixture.runner.connect,
      fixture.runner.startTransaction,
      fixture.runner.commitTransaction,
      fixture.runner.rollbackTransaction,
      fixture.runner.release,
    ])
      expect(method).not.toHaveBeenCalled();
  });
});
