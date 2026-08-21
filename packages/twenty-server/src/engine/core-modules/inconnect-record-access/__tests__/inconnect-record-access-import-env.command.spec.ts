import { Logger } from '@nestjs/common';

import { InconnectRecordAccessImportEnvCommand } from 'src/engine/core-modules/inconnect-record-access/commands/inconnect-record-access-import-env.command';
import { type InconnectRecordAccessEnvironmentImportService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-environment-import.service';
import { type InconnectRecordAccessEnvironmentImportResult } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-environment-import.type';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const result: InconnectRecordAccessEnvironmentImportResult = {
  plan: {
    workspaceId: WORKSPACE_ID,
    workspaceDisplayName: 'Apple',
    enforcementMode: 'MANAGED',
    currentRevision: null,
    publishRevision: '1',
    managedObjectCount: 0,
    policyCount: 0,
    validationStatus: 'valid',
    managedObjects: [],
    policies: [],
    input: {
      enforcementMode: 'MANAGED',
      managedObjects: [],
      policies: [],
    },
  },
  published: false,
};

describe('InconnectRecordAccessImportEnvCommand', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs dry-run without changing source mode or publishing itself', async () => {
    const importEnvironment = jest.fn().mockResolvedValue(result);
    const command = new InconnectRecordAccessImportEnvCommand({
      importEnvironment,
    } as unknown as InconnectRecordAccessEnvironmentImportService);

    await command.run([], { workspaceId: WORKSPACE_ID, dryRun: true });

    expect(importEnvironment).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
    });
  });

  it('requires an explicit valid workspace UUID', async () => {
    const importEnvironment = jest.fn();
    const command = new InconnectRecordAccessImportEnvCommand({
      importEnvironment,
    } as unknown as InconnectRecordAccessEnvironmentImportService);

    await expect(
      command.run([], { workspaceId: 'apple', dryRun: true }),
    ).rejects.toThrow('--workspace-id must be a valid UUID');
    expect(importEnvironment).not.toHaveBeenCalled();
  });

  it('delegates a non-dry-run import to the safe initial publisher', async () => {
    const importEnvironment = jest.fn().mockResolvedValue({
      ...result,
      published: { revision: '1', cacheStatus: 'recomputed' },
    });
    const command = new InconnectRecordAccessImportEnvCommand({
      importEnvironment,
    } as unknown as InconnectRecordAccessEnvironmentImportService);

    await command.run([], { workspaceId: WORKSPACE_ID });

    expect(importEnvironment).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      dryRun: false,
    });
  });
});
