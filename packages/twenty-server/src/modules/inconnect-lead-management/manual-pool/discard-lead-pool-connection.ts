import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';

import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';

// TypeORM 0.3.31 exposes this method at runtime (private in its .d.ts).
// It removes the runner, detaches its listener and calls pg-pool release(error).
// pg-pool 3.6.2 removes/ends that client instead of putting it on the idle list.
// Keep this compatibility boundary tested against the installed driver and pool.
export const discardLeadPoolConnection = async (
  runner: WorkspaceQueryRunner,
): Promise<void> => {
  if (!(runner instanceof PostgresQueryRunner))
    throw new Error('Unsupported Lead Pool connection disposal contract');
  const postgresRunner = runner as unknown as {
    releasePostgresConnection: (error: Error) => Promise<void>;
  };
  await postgresRunner.releasePostgresConnection(
    new Error('Lead Pool transaction completion is uncertain'),
  );
};
