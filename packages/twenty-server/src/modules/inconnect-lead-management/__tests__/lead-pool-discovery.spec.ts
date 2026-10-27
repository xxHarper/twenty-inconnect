import { MODULE_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';
import { NestContainer } from '@nestjs/core/injector/container';
import { GraphInspector } from '@nestjs/core/inspector/graph-inspector';
import { DependenciesScanner } from '@nestjs/core/scanner';
import { BaseExplorerService } from '@nestjs/graphql/dist/services/base-explorer.service.js';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { Test } from '@nestjs/testing';

import { readFileSync, writeFileSync } from 'fs';
import { parse, printSchema, validate } from 'graphql';

import { MetadataGraphQLApiModule } from 'src/engine/api/graphql/metadata-graphql-api.module';
import { CoreGraphQLApiModule } from 'src/engine/api/graphql/core-graphql-api.module';
import { RESOLVER_SCHEMA_SCOPE_KEY } from 'src/engine/api/graphql/graphql-config/constants/resolver-schema-scope-key.constant';
import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { InconnectRecordAccessSettingsResolver } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-settings.resolver';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { LeadManagementModule } from 'src/modules/inconnect-lead-management/lead-management.module';
import { LeadManagementResolver } from 'src/modules/inconnect-lead-management/lead-management.resolver';
import { InconnectMessagingModule } from 'src/modules/inconnect-messaging/inconnect-messaging.module';

// Only scan dependencies: no instance loader, onModuleInit, HTTP or external I/O.
jest.mock('src/engine/core-modules/dpa/pdf/render-dpa-to-pdf.util', () => ({
  renderDpaToPdf: jest.fn(),
}));

it('discovers metadata imports/providers with the real Nest scanner and BaseExplorer before building the frontend schema', async () => {
  const container = new NestContainer();
  const scanner = new DependenciesScanner(
    container,
    new MetadataScanner(),
    new GraphInspector(container),
  );
  await scanner.scan(MetadataGraphQLApiModule);
  const explorer = new BaseExplorerService();
  const discovered = explorer.getModules(container.getModules(), [
    MetadataGraphQLApiModule,
  ]);
  const leadModules = discovered.filter(
    (module) => module.metatype === LeadManagementModule,
  );
  expect(leadModules).toHaveLength(1);
  expect(
    discovered.some((module) => module.metatype === InconnectMessagingModule),
  ).toBe(true);
  expect(
    discovered.some(
      (module) => module.metatype === InconnectRecordAccessModule,
    ),
  ).toBe(true);
  const providers = discovered.flatMap((module) => [
    ...module.providers.values(),
  ]);
  expect(
    providers.filter(
      (provider) => provider.metatype === LeadManagementResolver,
    ),
  ).toHaveLength(1);
  expect(
    providers.filter(
      (provider) => provider.metatype === InconnectWorkspaceMemberService,
    ),
  ).toHaveLength(1);
  expect(
    providers.some(
      (provider) => provider.metatype === InconnectRecordAccessSettingsResolver,
    ),
  ).toBe(true);
  const leadResolvers = providers
    .map((provider) => provider.metatype)
    .filter(
      (resolver): resolver is typeof LeadManagementResolver =>
        resolver === LeadManagementResolver &&
        Reflect.getMetadata(RESOLVER_SCHEMA_SCOPE_KEY, resolver) === 'metadata',
    );
  expect(leadResolvers).toEqual([LeadManagementResolver]);
  expect(Reflect.getMetadata(GUARDS_METADATA, LeadManagementResolver)).toEqual([
    WorkspaceAuthGuard,
    UserAuthGuard,
    CustomPermissionGuard,
  ]);
  expect(
    Reflect.getMetadata(MODULE_METADATA.EXPORTS, InconnectRecordAccessModule),
  ).toContain(InconnectWorkspaceMemberService);
  const lead = leadModules[0];
  // A newly added back-edge to metadata would make discovery cyclic at this boundary.
  expect(
    [...lead.imports].some(
      (module) => module.metatype === MetadataGraphQLApiModule,
    ),
  ).toBe(false);
  const metadataImports = new Map(
    [...container.getModules()].map(([key, module]) => [key, module]),
  );
  await scanner.scan(CoreGraphQLApiModule);
  const core = explorer.getModules(container.getModules(), [
    CoreGraphQLApiModule,
  ]);
  // Core uses workspace-generated operations; the metadata resolver scope stays explicit.
  expect(
    Reflect.getMetadata(RESOLVER_SCHEMA_SCOPE_KEY, LeadManagementResolver),
  ).not.toBe('core');
  expect(core.some((module) => module.metatype === CoreGraphQLApiModule)).toBe(
    true,
  );
  expect(
    explorer.getModules(metadataImports as never, [MetadataGraphQLApiModule]),
  ).toContain(lead);
  const builder = await Test.createTestingModule({
    imports: [GraphQLSchemaBuilderModule],
  }).compile();
  try {
    // The resolver list is the result of discovery, never an injected bypass.
    const schema = await builder
      .get(GraphQLSchemaFactory)
      .create(leadResolvers, { skipCheck: true });
    expect(Object.keys(schema.getQueryType()!.getFields())).toHaveLength(3);
    expect(Object.keys(schema.getMutationType()!.getFields())).toHaveLength(3);
    const source = readFileSync(
      'packages/twenty-front/src/modules/inconnect-lead-management/graphql/leadPoolOperations.ts',
      'utf8',
    );
    const documents = [...source.matchAll(/gql`([\s\S]*?)`/g)];
    expect(documents).toHaveLength(6);
    for (const document of documents)
      expect(validate(schema, parse(document[1]))).toEqual([]);
    writeFileSync(
      '/tmp/lead-management-discovered-schema.graphql',
      printSchema(schema),
    );
  } finally {
    await builder.close();
  }
});
