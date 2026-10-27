import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { Test } from '@nestjs/testing';

import { readFileSync, writeFileSync } from 'fs';
import { graphql, printSchema, type GraphQLSchema } from 'graphql';

import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { LeadManagementModule } from 'src/modules/inconnect-lead-management/lead-management.module';
import { LeadManagementResolver } from 'src/modules/inconnect-lead-management/lead-management.resolver';
import {
  parsePoolInput,
  poolPreviewSchema,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-contract';
import {
  actor,
  makePoolHarness,
  poolId,
  poolInput,
} from './lead-pool.fixtures';

let schema: GraphQLSchema;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [GraphQLSchemaBuilderModule],
  }).compile();
  schema = await module
    .get(GraphQLSchemaFactory)
    .create([LeadManagementResolver], { skipCheck: true });
  writeFileSync('/tmp/lead-management-schema.graphql', printSchema(schema));
  await module.close();
});

describe('Lead Management GraphQL surface, source-only', () => {
  it('exposes the real six resolver operations and workspace/human guards', () => {
    expect(Object.keys(schema.getQueryType()!.getFields()).sort()).toEqual([
      'inconnectLeadPoolCatalog',
      'inconnectLeadPoolOperation',
      'inconnectLeadPoolRecords',
    ]);
    expect(Object.keys(schema.getMutationType()!.getFields()).sort()).toEqual([
      'cancelInconnectLeadPool',
      'executeInconnectLeadPool',
      'previewInconnectLeadPool',
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LeadManagementResolver),
    ).toEqual([WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LeadManagementModule),
    ).toContain(LeadManagementResolver);
    const imports = readFileSync(
      'packages/twenty-server/src/engine/metadata-modules/metadata-engine.module.ts',
      'utf8',
    );
    expect(imports).toContain('    LeadManagementModule,');
  });
  it('runs GraphQL preview, confirmation and result through the real resolver and services', async () => {
    const harness = makePoolHarness(1);
    const resolver = new LeadManagementResolver(harness.service);
    const rootValue = {
      previewInconnectLeadPool: ({ input }: { input: unknown }) =>
        resolver.previewInconnectLeadPool(input),
      executeInconnectLeadPool: ({ input }: { input: unknown }) =>
        resolver.executeInconnectLeadPool(input),
      inconnectLeadPoolOperation: ({ input }: { input: unknown }) =>
        resolver.inconnectLeadPoolOperation(input),
    };
    const response = await withWorkspaceAuthContext(actor, () =>
      graphql({
        schema,
        rootValue,
        source:
          'mutation Preview($input: JSONObject!) { previewInconnectLeadPool(input: $input) }',
        variableValues: { input: poolInput(1) },
      }),
    );
    expect(response.errors).toBeUndefined();
    const preview = response.data!.previewInconnectLeadPool as { id: string };
    const executed = await withWorkspaceAuthContext(actor, () =>
      graphql({
        schema,
        rootValue,
        source:
          'mutation Execute($input: JSONObject!) { executeInconnectLeadPool(input: $input) }',
        variableValues: {
          input: { operationId: preview.id, expectedVersion: 0 },
        },
      }),
    );
    expect(executed.errors).toBeUndefined();
    expect(executed.data!.executeInconnectLeadPool).toMatchObject({
      counts: { CHANGED: 1 },
      status: 'COMPLETED',
    });
  });
  it.each([
    { workspaceId: poolId(999) },
    { category: 'NORMAL' },
    { all: true },
    { plan: { changes: [] } },
    { batchSize: 101 },
    { batchSize: 0 },
    { recordIds: [poolId(100), poolId(100).toUpperCase()] },
    { mode: 'EVEN', balanceBy: 'CATEGORY' },
  ])('rejects unsupported or manipulated input %j', (change) => {
    expect(() =>
      parsePoolInput(poolPreviewSchema, { ...poolInput(1), ...change }),
    ).toThrow();
  });
  it('validates quota completeness, non-negative integers and the available pool', () => {
    for (const quotas of [
      [],
      [{ recipientId: poolId(20), quantity: -1 }],
      [{ recipientId: poolId(20), quantity: 1.5 }],
      [{ recipientId: poolId(20), quantity: 2 }],
      [{ recipientId: poolId(999), quantity: 1 }],
    ]) {
      expect(() =>
        parsePoolInput(poolPreviewSchema, {
          ...poolInput(1),
          mode: 'MANUAL_QUOTAS',
          quotas,
        }),
      ).toThrow();
    }
  });
});
