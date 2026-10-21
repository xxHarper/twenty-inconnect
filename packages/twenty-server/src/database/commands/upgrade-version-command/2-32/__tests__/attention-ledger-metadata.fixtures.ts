import 'reflect-metadata';

import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { MetadataArgsStorage } from 'typeorm/metadata-args/MetadataArgsStorage';
import { EntityMetadataBuilder } from 'typeorm/metadata-builder/EntityMetadataBuilder';

import { InconnectMessagingAttentionEpochEntity } from 'src/modules/inconnect-messaging/entities/attention-epoch.entity';
import { InconnectMessagingAttentionEffectEntity } from 'src/modules/inconnect-messaging/entities/attention-effect.entity';
import { InconnectMessagingAttentionReceiptEntity } from 'src/modules/inconnect-messaging/entities/attention-receipt.entity';
import { InconnectMessagingAttentionResponseIntentEntity } from 'src/modules/inconnect-messaging/entities/attention-response-intent.entity';
import { InconnectMessagingAttentionTransitionAuditEntity } from 'src/modules/inconnect-messaging/entities/attention-transition-audit.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';

export const attentionEntities = [
  InconnectMessagingAttentionEpochEntity,
  InconnectMessagingAttentionEffectEntity,
  InconnectMessagingAttentionReceiptEntity,
  InconnectMessagingAttentionResponseIntentEntity,
  InconnectMessagingAttentionTransitionAuditEntity,
] as const;

export const attentionExistingEntities = [
  InconnectMessagingConversationEntity,
  InconnectMessagingMessageEntity,
  InconnectMessagingConfigurationEntity,
  InconnectMessagingProviderStatusEventEntity,
  InconnectMessagingOutboxEventEntity,
] as const;

export const attentionStepName =
  '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000';

// Real scalar/FK/index metadata, with unrelated pre-existing relation graphs
// excluded. No DataSource.initialize, QueryRunner, connection or SQL execution.
export const buildAttentionMetadata = () => {
  const entities: Function[] = [
    ...attentionEntities,
    ...attentionExistingEntities,
  ];
  const storage = getMetadataArgsStorage();
  const isolated = new MetadataArgsStorage();

  isolated.tables.push(
    ...storage.tables.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );
  isolated.columns.push(
    ...storage.columns.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );
  isolated.generations.push(
    ...storage.generations.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );
  isolated.indices.push(
    ...storage.indices.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );
  isolated.checks.push(
    ...storage.checks.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );
  isolated.foreignKeys.push(
    ...storage.foreignKeys.filter(({ target }) =>
      entities.includes(target as Function),
    ),
  );

  const dataSource = new DataSource({ type: 'postgres' });
  const metadata = new EntityMetadataBuilder(dataSource, isolated).build(
    entities,
  );

  Object.assign(dataSource, {
    entityMetadatas: metadata,
    entityMetadatasMap: new Map(metadata.map((item) => [item.target, item])),
  });

  return { dataSource, metadata };
};

export const normalizeAttentionSql = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();

export const quotedAttentionColumns = (value: string) =>
  [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

// Balanced parentheses allow nested CHECK functions and JSON operators.
export const attentionCheckExpression = (sql: string, constraint: string) => {
  const start = sql.indexOf(`CONSTRAINT "${constraint}" CHECK (`);
  if (start < 0) throw new Error(`Missing CHECK ${constraint}`);
  const opening = sql.indexOf('(', start);
  let depth = 1;
  let quoted = false;

  for (let index = opening + 1; index < sql.length; index++) {
    const character = sql[index];
    if (character === "'" && quoted && sql[index + 1] === "'") {
      index++;
      continue;
    }
    if (character === "'") quoted = !quoted;
    if (quoted) continue;
    if (character === '(') depth++;
    if (character === ')' && --depth === 0)
      return sql.slice(opening + 1, index);
  }

  throw new Error(`Unbalanced CHECK ${constraint}`);
};
