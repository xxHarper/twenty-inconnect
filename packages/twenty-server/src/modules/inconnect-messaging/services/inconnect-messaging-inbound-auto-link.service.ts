import { Injectable } from '@nestjs/common';

import { normalizePhoneIdentity } from 'twenty-shared/utils';
import { DataSource, QueryFailedError } from 'typeorm';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { type InternalCreateWriteReceipt } from 'src/engine/api/common/types/internal-create-write-receipt.type';
import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { TwentyORMExceptionCode } from 'src/engine/twenty-orm/exceptions/twenty-orm.exception';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingAutoCreateAuthorityException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import {
  type InconnectMessagingAutoCreateAuthority,
  InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { InconnectMessagingAutomationRecordCreateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-create.service';
import { persistInconnectMessagingConversationLinkTransition } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-link-transition.util';
import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { InconnectMessagingBackgroundPhoneIdentityResolverService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';
import { INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const INCONNECT_MESSAGING_IDENTITY_ADVISORY_LOCK_STATEMENT =
  'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

type InconnectMessagingInboundAutoLinkState =
  | 'ALREADY_LINKED'
  | 'DISABLED'
  | 'INVALID'
  | 'AMBIGUOUS'
  | 'LINKED_EXISTING'
  | 'CREATED_AND_LINKED'
  | 'NO_MATCH_AUTO_CREATE_DISABLED'
  | 'NO_MATCH_NOT_READY'
  | 'SOFT_DELETED_UNIQUE_CONFLICT';

export type InconnectMessagingInboundAutoLinkResult = {
  state: InconnectMessagingInboundAutoLinkState;
  publicationRequest: InconnectMessagingOutboxPublicationRequest | null;
};

type AutoLinkAttemptMode = 'CREATE_ON_NO_MATCH' | 'RESOLVE_AFTER_UNIQUE_RACE';

class InconnectMessagingAutoCreateUniqueRaceError extends Error {
  constructor() {
    super('Messaging auto-create encountered a physical uniqueness race');
    this.name = 'InconnectMessagingAutoCreateUniqueRaceError';
  }
}

const isPhysicalUniqueViolation = (error: unknown): boolean => {
  if (error instanceof QueryFailedError) {
    return (
      (error.driverError as { code?: string } | undefined)?.code ===
        POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION ||
      (error as QueryFailedError & { code?: string }).code ===
        POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION
    );
  }

  return (
    error instanceof Error &&
    'code' in error &&
    ((error as Error & { code?: string }).code ===
      POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION ||
      (error as Error & { code?: string }).code ===
        TwentyORMExceptionCode.DUPLICATE_ENTRY_DETECTED)
  );
};

const hasCompleteLinkedTuple = (
  conversation: Pick<
    InconnectMessagingConversationEntity,
    'linkedRecordObjectMetadataId' | 'linkedRecordId'
  >,
): boolean =>
  conversation.linkedRecordObjectMetadataId !== null &&
  conversation.linkedRecordId !== null;

const hasPartialLinkedTuple = (
  conversation: Pick<
    InconnectMessagingConversationEntity,
    'linkedRecordObjectMetadataId' | 'linkedRecordId'
  >,
): boolean =>
  (conversation.linkedRecordObjectMetadataId === null) !==
  (conversation.linkedRecordId === null);

@Injectable()
export class InconnectMessagingInboundAutoLinkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly coreQueryBuilderService: WorkspaceQueryRunnerCoreQueryBuilderService,
    private readonly backgroundPhoneIdentityResolverService: InconnectMessagingBackgroundPhoneIdentityResolverService,
    private readonly autoCreateAuthorityService: InconnectMessagingAutoCreateAuthorityService,
    private readonly automationRecordCreateService: InconnectMessagingAutomationRecordCreateService,
  ) {}

  async attemptForInboundMessage({
    workspaceId,
    messageId,
  }: {
    workspaceId: string;
    messageId: string;
  }): Promise<InconnectMessagingInboundAutoLinkResult> {
    const message = await this.dataSource
      .getRepository(InconnectMessagingMessageEntity)
      .findOne({
        select: { conversationId: true },
        where: {
          id: messageId,
          workspaceId,
          direction: 'INBOUND',
        },
      });

    if (message === null) {
      return { state: 'INVALID', publicationRequest: null };
    }

    const conversation = await this.dataSource
      .getRepository(InconnectMessagingConversationEntity)
      .findOne({
        select: {
          id: true,
          workspaceId: true,
          externalAddressNormalized: true,
          linkedRecordObjectMetadataId: true,
          linkedRecordId: true,
        },
        where: { id: message.conversationId, workspaceId },
      });

    if (conversation === null) {
      return { state: 'INVALID', publicationRequest: null };
    }

    this.assertValidLinkedTuple(conversation);

    if (hasCompleteLinkedTuple(conversation)) {
      return { state: 'ALREADY_LINKED', publicationRequest: null };
    }

    const canonicalPhoneIdentity = normalizePhoneIdentity(
      conversation.externalAddressNormalized,
    );

    if (canonicalPhoneIdentity === null) {
      return { state: 'INVALID', publicationRequest: null };
    }

    const configuration = await this.dataSource
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({
        select: { anchorObjectMetadataId: true },
        where: { workspaceId },
      });

    if (configuration === null) {
      return { state: 'DISABLED', publicationRequest: null };
    }

    const attemptInput = {
      workspaceId,
      conversationId: conversation.id,
      canonicalPhoneIdentity,
      advisoryAnchorObjectMetadataId: configuration.anchorObjectMetadataId,
    };

    try {
      return await this.executeTransactionalAttempt({
        ...attemptInput,
        mode: 'CREATE_ON_NO_MATCH',
      });
    } catch (error) {
      if (!(error instanceof InconnectMessagingAutoCreateUniqueRaceError)) {
        throw error;
      }

      return this.executeTransactionalAttempt({
        ...attemptInput,
        mode: 'RESOLVE_AFTER_UNIQUE_RACE',
      });
    }
  }

  private async executeTransactionalAttempt({
    workspaceId,
    conversationId,
    canonicalPhoneIdentity,
    advisoryAnchorObjectMetadataId,
    mode,
  }: {
    workspaceId: string;
    conversationId: string;
    canonicalPhoneIdentity: string;
    advisoryAnchorObjectMetadataId: string;
    mode: AutoLinkAttemptMode;
  }): Promise<InconnectMessagingInboundAutoLinkResult> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
    const queryRunner = workspaceDataSource.createQueryRunner();
    const originalManager = queryRunner.manager;

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await this.executeWithinTransaction({
        queryRunner,
        workspaceId,
        conversationId,
        canonicalPhoneIdentity,
        advisoryAnchorObjectMetadataId,
        mode,
      });

      if (queryRunner.manager !== originalManager) {
        throw new Error(
          'Messaging inbound auto-link replaced the original WorkspaceEntityManager',
        );
      }

      await queryRunner.commitTransaction();

      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async executeWithinTransaction({
    queryRunner,
    workspaceId,
    conversationId,
    canonicalPhoneIdentity,
    advisoryAnchorObjectMetadataId,
    mode,
  }: {
    queryRunner: WorkspaceQueryRunner;
    workspaceId: string;
    conversationId: string;
    canonicalPhoneIdentity: string;
    advisoryAnchorObjectMetadataId: string;
    mode: AutoLinkAttemptMode;
  }): Promise<InconnectMessagingInboundAutoLinkResult> {
    await queryRunner.query(
      INCONNECT_MESSAGING_IDENTITY_ADVISORY_LOCK_STATEMENT,
      [
        JSON.stringify([
          workspaceId,
          advisoryAnchorObjectMetadataId,
          canonicalPhoneIdentity,
        ]),
      ],
    );

    const lockedConversation = await this.coreQueryBuilderService
      .createCoreQueryBuilder({
        queryRunner,
        target: InconnectMessagingConversationEntity,
        alias: 'conversation',
      })
      .setLock('pessimistic_write')
      .where('conversation.id = :conversationId', { conversationId })
      .andWhere('conversation.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    if (lockedConversation === null) {
      return { state: 'INVALID', publicationRequest: null };
    }

    this.assertValidLinkedTuple(lockedConversation);

    if (hasCompleteLinkedTuple(lockedConversation)) {
      return { state: 'ALREADY_LINKED', publicationRequest: null };
    }

    const lockedCanonicalPhoneIdentity = normalizePhoneIdentity(
      lockedConversation.externalAddressNormalized,
    );

    if (lockedCanonicalPhoneIdentity === null) {
      return { state: 'INVALID', publicationRequest: null };
    }

    if (lockedCanonicalPhoneIdentity !== canonicalPhoneIdentity) {
      return { state: 'NO_MATCH_NOT_READY', publicationRequest: null };
    }

    const currentConfiguration = await this.coreQueryBuilderService
      .createCoreQueryBuilder({
        queryRunner,
        target: InconnectMessagingConfigurationEntity,
        alias: 'configuration',
      })
      .setLock('pessimistic_read')
      .where('configuration.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    if (currentConfiguration === null) {
      return { state: 'DISABLED', publicationRequest: null };
    }

    if (
      currentConfiguration.anchorObjectMetadataId !==
      advisoryAnchorObjectMetadataId
    ) {
      return { state: 'NO_MATCH_NOT_READY', publicationRequest: null };
    }

    const resolution =
      await this.backgroundPhoneIdentityResolverService.resolvePhoneIdentityForLink(
        {
          queryRunner,
          workspaceId,
          input: lockedConversation.externalAddressNormalized,
        },
      );

    if (resolution.state === 'UNIQUE') {
      const publicationRequest =
        await persistInconnectMessagingConversationLinkTransition({
          queryRunner,
          coreQueryBuilderService: this.coreQueryBuilderService,
          conversation: lockedConversation,
          objectMetadataId: resolution.objectMetadataId,
          recordId: resolution.recordId,
          actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        });

      return { state: 'LINKED_EXISTING', publicationRequest };
    }

    if (resolution.state !== 'NO_MATCH') {
      return { state: resolution.state, publicationRequest: null };
    }

    if (currentConfiguration.autoCreateEnabled !== true) {
      return {
        state: 'NO_MATCH_AUTO_CREATE_DISABLED',
        publicationRequest: null,
      };
    }

    let authority: InconnectMessagingAutoCreateAuthority;

    try {
      authority = await this.autoCreateAuthorityService.issueAuthority({
        workspaceId,
        queryRunner,
      });
    } catch (error) {
      if (
        error instanceof InconnectMessagingAutoCreateAuthorityException ||
        (error instanceof InconnectRecordAccessException &&
          error.code === InconnectRecordAccessExceptionCode.ACCESS_DENIED)
      ) {
        return { state: 'NO_MATCH_NOT_READY', publicationRequest: null };
      }

      throw error;
    }

    const plan = await this.autoCreateAuthorityService.resolveCreatePlan({
      authority,
      queryRunner,
      workspaceId,
    });

    if (plan.objectMetadataId !== currentConfiguration.anchorObjectMetadataId) {
      return { state: 'NO_MATCH_NOT_READY', publicationRequest: null };
    }

    if (mode === 'RESOLVE_AFTER_UNIQUE_RACE') {
      return {
        state: 'SOFT_DELETED_UNIQUE_CONFLICT',
        publicationRequest: null,
      };
    }

    let receipt: InternalCreateWriteReceipt;

    try {
      receipt = await this.automationRecordCreateService.execute({
        workspaceId,
        canonicalPhoneIdentity,
        authority,
        queryRunner,
      });
    } catch (error) {
      if (isPhysicalUniqueViolation(error)) {
        throw new InconnectMessagingAutoCreateUniqueRaceError();
      }

      if (
        error instanceof InconnectMessagingAutoCreateAuthorityException ||
        (error instanceof InconnectRecordAccessException &&
          error.code === InconnectRecordAccessExceptionCode.ACCESS_DENIED)
      ) {
        return { state: 'NO_MATCH_NOT_READY', publicationRequest: null };
      }

      throw error;
    }

    if (receipt.objectMetadataId !== plan.objectMetadataId) {
      throw new Error(
        'Messaging automation create receipt does not match the current anchor',
      );
    }

    const publicationRequest =
      await persistInconnectMessagingConversationLinkTransition({
        queryRunner,
        coreQueryBuilderService: this.coreQueryBuilderService,
        conversation: lockedConversation,
        objectMetadataId: receipt.objectMetadataId,
        recordId: receipt.recordId,
        actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
      });

    return { state: 'CREATED_AND_LINKED', publicationRequest };
  }

  private assertValidLinkedTuple(
    conversation: Pick<
      InconnectMessagingConversationEntity,
      'linkedRecordObjectMetadataId' | 'linkedRecordId'
    >,
  ): void {
    if (hasPartialLinkedTuple(conversation)) {
      throw new Error('Messaging Conversation linked tuple is incomplete');
    }
  }
}
