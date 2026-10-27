import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { GraphQLJSONObject } from 'graphql-type-json';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';

// JSON inputs are strictly decoded by the service, including rejection of extra keys.
// CustomPermissionGuard documents the dynamic checks implemented by LeadPoolAuthorityService.
// Response contracts are shared with Twenty's frontend through twenty-shared/types.
@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
export class LeadManagementResolver {
  constructor(private readonly pool: LeadPoolService) {}

  @Query(() => GraphQLJSONObject)
  inconnectLeadPoolCatalog() {
    return this.pool.catalog(getWorkspaceAuthContext());
  }

  @Query(() => GraphQLJSONObject)
  inconnectLeadPoolRecords(
    @Args('input', { type: () => GraphQLJSONObject }) input: unknown,
  ) {
    return this.pool.list(getWorkspaceAuthContext(), input);
  }

  @Query(() => GraphQLJSONObject)
  inconnectLeadPoolOperation(
    @Args('input', { type: () => GraphQLJSONObject }) input: unknown,
  ) {
    return this.pool.result(getWorkspaceAuthContext(), input);
  }

  @Mutation(() => GraphQLJSONObject)
  previewInconnectLeadPool(
    @Args('input', { type: () => GraphQLJSONObject }) input: unknown,
  ) {
    return this.pool.preview(getWorkspaceAuthContext(), input);
  }

  @Mutation(() => GraphQLJSONObject)
  executeInconnectLeadPool(
    @Args('input', { type: () => GraphQLJSONObject }) input: unknown,
  ) {
    return this.pool.execute(getWorkspaceAuthContext(), input);
  }

  @Mutation(() => GraphQLJSONObject)
  cancelInconnectLeadPool(
    @Args('input', { type: () => GraphQLJSONObject }) input: unknown,
  ) {
    return this.pool.cancel(getWorkspaceAuthContext(), input);
  }
}
