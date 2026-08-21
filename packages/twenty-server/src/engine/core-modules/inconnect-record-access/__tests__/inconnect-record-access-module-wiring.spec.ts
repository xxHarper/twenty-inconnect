import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { InconnectRecordAccessSettingsResolver } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-settings.resolver';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

describe('InconnectRecordAccessModule Settings wiring', () => {
  it('imports the OSS module that exports the real Settings guard dependency', () => {
    const moduleImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      InconnectRecordAccessModule,
    ) as unknown[];
    const moduleProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      InconnectRecordAccessModule,
    ) as unknown[];
    const permissionsExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      PermissionsModule,
    ) as unknown[];
    const resolverGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      InconnectRecordAccessSettingsResolver,
    ) as Array<new (...arguments_: never[]) => unknown>;
    const settingsGuardDependencies = Reflect.getMetadata(
      'design:paramtypes',
      resolverGuards[1],
    ) as unknown[];

    expect(moduleImports).toContain(PermissionsModule);
    expect(moduleProviders).toContain(InconnectRecordAccessSettingsResolver);
    expect(permissionsExports).toContain(PermissionsService);
    expect(settingsGuardDependencies).toContain(PermissionsService);
  });
});
