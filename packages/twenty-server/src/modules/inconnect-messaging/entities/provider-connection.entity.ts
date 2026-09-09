import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  type InconnectMessagingConnectionHealthStatus,
  type InconnectMessagingConnectionLifecycleStatus,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingProviderConnection', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_CONNECTION_LIFECYCLE',
  `"lifecycleStatus" IN ('ENABLED', 'DISABLED')`,
)
@Check(
  'CHK_INCONNECT_MSG_CONNECTION_HEALTH',
  `"healthStatus" IN ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY')`,
)
@Check(
  'CHK_INCONNECT_MSG_CONNECTION_CREDENTIALS',
  `("encryptedCredentials" IS NULL AND "credentialsVersion" IS NULL) OR ("encryptedCredentials" LIKE 'enc:v2:%' AND "credentialsVersion" >= 1)`,
)
@Check('CHK_INCONNECT_MSG_CONNECTION_PROVIDER', `btrim("provider") <> ''`)
@Check('CHK_INCONNECT_MSG_CONNECTION_CHANNEL', `btrim("channel") <> ''`)
@Check(
  'CHK_INCONNECT_MSG_CONNECTION_ROUTING_KEY',
  `btrim("inboundRoutingKey") <> ''`,
)
@Index(
  'IDX_INCONNECT_MSG_CONNECTION_ID_WORKSPACE_UNIQUE',
  ['id', 'workspaceId'],
  {
    unique: true,
  },
)
@Index(
  'IDX_INCONNECT_MSG_CONNECTION_ROUTING_UNIQUE',
  ['provider', 'channel', 'inboundRoutingKey'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_CONNECTION_WORKSPACE', ['workspaceId'])
export class InconnectMessagingProviderConnectionEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_CONNECTION',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONNECTION_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'varchar' })
  provider: string;

  @Column({ nullable: false, type: 'varchar' })
  channel: string;

  @Column({ nullable: false, type: 'text' })
  displayName: string;

  @Column({ nullable: true, type: 'text' })
  externalAccountIdentifier: string | null;

  @Column({ nullable: false, type: 'text' })
  normalizedSenderAddress: string;

  @Column({ nullable: true, type: 'text' })
  providerSenderOrServiceIdentifier: string | null;

  @Column({ nullable: false, type: 'text' })
  inboundRoutingKey: string;

  @Column({ nullable: true, type: 'text' })
  encryptedCredentials: EncryptedString | null;

  @Column({ nullable: true, type: 'integer' })
  credentialsVersion: number | null;

  @Column({ default: 'ENABLED', nullable: false, type: 'varchar' })
  lifecycleStatus: InconnectMessagingConnectionLifecycleStatus;

  @Column({ default: 'UNKNOWN', nullable: false, type: 'varchar' })
  healthStatus: InconnectMessagingConnectionHealthStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
