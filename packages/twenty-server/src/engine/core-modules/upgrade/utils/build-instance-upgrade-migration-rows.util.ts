import { type UpgradeMigrationStatus } from 'src/engine/core-modules/upgrade/upgrade-migration.entity';

export const buildInstanceUpgradeMigrationRows = ({
  name,
  workspaceIds,
  previousAttempts,
  executedByVersion,
  status,
  errorMessage,
}: {
  name: string;
  workspaceIds: string[];
  previousAttempts: number;
  executedByVersion: string;
  status: UpgradeMigrationStatus;
  errorMessage: string | null;
}) =>
  [null, ...workspaceIds].map((workspaceId) => ({
    name,
    status,
    attempt: previousAttempts + 1,
    executedByVersion,
    workspaceId,
    errorMessage,
  }));
