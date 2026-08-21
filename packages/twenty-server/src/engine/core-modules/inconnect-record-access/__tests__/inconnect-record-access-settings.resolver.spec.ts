import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GqlExecutionContext } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { InconnectRecordAccessSettingsResolver } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-settings.resolver';
import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { type InconnectRecordAccessSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-settings.service';
import {
  ConflictError,
  InternalServerError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsException } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const buildResolver = () => {
  const getConfiguration = jest.fn().mockResolvedValue({
    status: 'ABSENT',
    enforcementMode: null,
    revision: null,
    managedObjects: [],
  });
  const getAvailableMetadata = jest.fn().mockResolvedValue({
    objects: [],
    roles: [],
  });
  const replaceConfiguration = jest.fn().mockResolvedValue({
    revision: '2',
    cacheStatus: 'recomputed',
    changedFromManagedToUnmanaged: false,
  });
  const resolver = new InconnectRecordAccessSettingsResolver({
    getConfiguration,
    getAvailableMetadata,
    replaceConfiguration,
  } as unknown as InconnectRecordAccessSettingsService);

  return {
    getAvailableMetadata,
    getConfiguration,
    replaceConfiguration,
    resolver,
  };
};

describe('InconnectRecordAccessSettingsResolver', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives the workspace for both administrative reads from auth context', async () => {
    const harness = buildResolver();
    const workspace = { id: WORKSPACE_ID } as WorkspaceEntity;

    await harness.resolver.getInconnectRecordAccessConfiguration(workspace);
    await harness.resolver.getInconnectRecordAccessAvailableMetadata(workspace);

    expect(harness.getConfiguration).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(harness.getAvailableMetadata).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it('publishes for the authenticated workspace and supports initial null revision', async () => {
    const harness = buildResolver();
    const workspace = { id: WORKSPACE_ID } as WorkspaceEntity;

    harness.replaceConfiguration.mockResolvedValueOnce({
      revision: '1',
      cacheStatus: 'recomputed',
      changedFromManagedToUnmanaged: false,
    });

    const input = {
      expectedRevision: null,
      enforcementMode: 'UNMANAGED' as const,
      managedObjects: [],
      policies: [],
    };

    await expect(
      harness.resolver.replaceInconnectRecordAccessConfiguration(
        input,
        workspace,
      ),
    ).resolves.toEqual({
      revision: '1',
      cacheStatus: 'recomputed',
      changedFromManagedToUnmanaged: false,
    });
    expect(harness.replaceConfiguration).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      input,
    });
  });

  it('returns the committed revision with recomputation-failed instead of pretending rollback', async () => {
    const harness = buildResolver();

    harness.replaceConfiguration.mockResolvedValueOnce({
      revision: '2',
      cacheStatus: 'recomputation-failed',
      changedFromManagedToUnmanaged: false,
    });

    await expect(
      harness.resolver.replaceInconnectRecordAccessConfiguration(
        {
          expectedRevision: '1',
          enforcementMode: 'UNMANAGED',
          managedObjects: [],
          policies: [],
        },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).resolves.toMatchObject({
      revision: '2',
      cacheStatus: 'recomputation-failed',
    });
  });

  it('maps stale revisions to a distinguishable GraphQL conflict', async () => {
    const harness = buildResolver();

    harness.replaceConfiguration.mockRejectedValueOnce(
      new InconnectRecordAccessConfigurationException(
        'internal revision details',
        InconnectRecordAccessConfigurationExceptionCode.REVISION_CONFLICT,
      ),
    );

    await expect(
      harness.resolver.replaceInconnectRecordAccessConfiguration(
        {
          expectedRevision: '1',
          enforcementMode: 'UNMANAGED',
          managedObjects: [],
          policies: [],
        },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).rejects.toMatchObject({
      constructor: ConflictError,
      extensions: {
        code: 'CONFLICT',
        subCode: 'REVISION_CONFLICT',
      },
    });
  });

  it('maps invalid candidates without exposing internal validation details', async () => {
    const harness = buildResolver();

    harness.replaceConfiguration.mockRejectedValueOnce(
      new InconnectRecordAccessConfigurationException(
        'field from another workspace',
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      ),
    );

    await expect(
      harness.resolver.replaceInconnectRecordAccessConfiguration(
        {
          expectedRevision: '1',
          enforcementMode: 'MANAGED',
          managedObjects: [],
          policies: [],
        },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).rejects.toMatchObject({
      constructor: UserInputError,
      message: 'The INCONNECT Record Access configuration is invalid.',
      extensions: {
        code: 'BAD_USER_INPUT',
        subCode: 'INVALID_INPUT',
      },
    });
  });

  it('maps cache revocation failure without claiming that a publish committed', async () => {
    const harness = buildResolver();

    harness.replaceConfiguration.mockRejectedValueOnce(
      new InconnectRecordAccessConfigurationException(
        'Redis connection details',
        InconnectRecordAccessConfigurationExceptionCode.CACHE_REVOCATION_FAILED,
      ),
    );

    await expect(
      harness.resolver.replaceInconnectRecordAccessConfiguration(
        {
          expectedRevision: '1',
          enforcementMode: 'UNMANAGED',
          managedObjects: [],
          policies: [],
        },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).rejects.toMatchObject({
      constructor: InternalServerError,
      extensions: {
        code: 'INTERNAL_SERVER_ERROR',
        subCode: 'CACHE_REVOCATION_FAILED',
      },
    });
  });

  it('is guarded by workspace auth and the standard SECURITY permission', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      InconnectRecordAccessSettingsResolver,
    ) as Array<new (permissionsService: PermissionsService) => CanActivate>;

    expect(guards[0]).toBe(WorkspaceAuthGuard);
    expect(guards).toHaveLength(2);

    const userHasWorkspaceSettingPermission = jest.fn().mockResolvedValue(true);
    const guard = new guards[1]({
      userHasWorkspaceSettingPermission,
    } as unknown as PermissionsService);
    const executionContext = {} as ExecutionContext;

    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({
        req: {
          workspace: {
            id: WORKSPACE_ID,
            activationStatus: WorkspaceActivationStatus.ACTIVE,
          },
          userWorkspaceId: '00000000-0000-4000-8000-000000000002',
          apiKey: null,
          application: null,
        },
      }),
    } as unknown as GqlExecutionContext);

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(userHasWorkspaceSettingPermission).toHaveBeenCalledWith({
      userWorkspaceId: '00000000-0000-4000-8000-000000000002',
      setting: PermissionFlagType.SECURITY,
      workspaceId: WORKSPACE_ID,
      apiKeyId: undefined,
      applicationId: undefined,
    });

    userHasWorkspaceSettingPermission.mockResolvedValueOnce(false);

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(
      PermissionsException,
    );
  });
});
