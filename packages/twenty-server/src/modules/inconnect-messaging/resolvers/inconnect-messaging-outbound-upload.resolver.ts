import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  CreateInconnectMessagingOutboundUploadInput,
  InconnectMessagingOutboundUploadDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-outbound-upload.dto';
import { InconnectMessagingOutboundUploadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbound-upload.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingOutboundUploadResolver {
  constructor(
    private readonly outboundUploadService: InconnectMessagingOutboundUploadService,
  ) {}

  @Mutation(() => InconnectMessagingOutboundUploadDTO)
  async createInconnectMessagingOutboundUpload(
    @Args('input', {
      type: () => CreateInconnectMessagingOutboundUploadInput,
    })
    input: CreateInconnectMessagingOutboundUploadInput,
  ): Promise<InconnectMessagingOutboundUploadDTO> {
    return this.outboundUploadService.createUpload({
      authContext: getWorkspaceAuthContext(),
      clientUploadId: input.clientUploadId,
      filename: input.filename,
      size: input.size,
      type: input.type,
    });
  }

  @Mutation(() => InconnectMessagingOutboundUploadDTO)
  async completeInconnectMessagingOutboundUpload(
    @Args('uploadId', { type: () => UUIDScalarType }) uploadId: string,
  ): Promise<InconnectMessagingOutboundUploadDTO> {
    return this.outboundUploadService.completeUpload({
      authContext: getWorkspaceAuthContext(),
      uploadId,
    });
  }
}
