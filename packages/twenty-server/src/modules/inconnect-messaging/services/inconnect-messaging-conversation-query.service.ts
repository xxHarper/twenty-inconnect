import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type SelectQueryBuilder } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

export type InconnectMessagingConversationPage = {
  items: InconnectMessagingConversationEntity[];
  total: number;
};

@Injectable()
export class InconnectMessagingConversationQueryService {
  constructor(
    @InjectWorkspaceScopedRepository(InconnectMessagingConversationEntity)
    private readonly conversationRepository: WorkspaceScopedRepository<InconnectMessagingConversationEntity>,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  async listAuthorizedConversations({
    authContext,
    offset = 0,
    limit = 50,
  }: {
    authContext: WorkspaceAuthContext;
    offset?: number;
    limit?: number;
  }): Promise<InconnectMessagingConversationPage> {
    return this.executeScopedPage({ authContext, offset, limit });
  }

  async searchAuthorizedConversations({
    authContext,
    search,
    offset = 0,
    limit = 50,
  }: {
    authContext: WorkspaceAuthContext;
    search: string;
    offset?: number;
    limit?: number;
  }): Promise<InconnectMessagingConversationPage> {
    return this.executeScopedPage({
      authContext,
      search,
      offset,
      limit,
    });
  }

  async countAuthorizedConversations({
    authContext,
    search,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
  }): Promise<number> {
    const queryBuilder = await this.buildScopedQuery({ authContext, search });

    return queryBuilder.getCount();
  }

  private async executeScopedPage({
    authContext,
    search,
    offset,
    limit,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    offset: number;
    limit: number;
  }): Promise<InconnectMessagingConversationPage> {
    const queryBuilder = await this.buildScopedQuery({ authContext, search });
    const total = await queryBuilder.clone().getCount();
    const items = await queryBuilder
      .orderBy('conversation.updatedAt', 'DESC')
      .addOrderBy('conversation.id', 'DESC')
      .skip(Math.max(0, offset))
      .take(Math.min(100, Math.max(1, limit)))
      .getMany();

    return { items, total };
  }

  private async buildScopedQuery({
    authContext,
    search,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
  }): Promise<SelectQueryBuilder<InconnectMessagingConversationEntity>> {
    const queryBuilder =
      this.conversationRepository.createQueryBuilder('conversation');

    await this.authorizationService.applyConversationReadScope({
      authContext,
      queryBuilder,
      conversationAlias: 'conversation',
    });

    if (isNonEmptyString(search)) {
      queryBuilder.andWhere(
        'conversation.externalAddressNormalized ILIKE :inconnectMessagingSearch',
        { inconnectMessagingSearch: `%${search}%` },
      );
    }

    return queryBuilder;
  }
}
