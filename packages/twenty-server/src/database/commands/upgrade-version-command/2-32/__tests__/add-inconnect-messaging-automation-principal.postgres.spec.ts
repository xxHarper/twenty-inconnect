import { DataSource, type QueryRunner } from 'typeorm';

import { AddInconnectMessagingAutomationPrincipalFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305700-add-inconnect-messaging-automation-principal';

const postgresUrl = process.env.INCONNECT_F13C2A2_POSTGRES_URL;
const describeWithPostgres =
  postgresUrl === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const USER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';

describeWithPostgres(
  'AddInconnectMessagingAutomationPrincipalFastInstanceCommand PostgreSQL',
  () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;

    beforeAll(async () => {
      dataSource = new DataSource({ type: 'postgres', url: postgresUrl });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();

      const [{ currentDatabase }] = (await queryRunner.query(
        'SELECT current_database() AS "currentDatabase"',
      )) as Array<{ currentDatabase: string }>;

      expect(currentDatabase).toMatch(/^inconnect_f13c2a2_/);
      expect(currentDatabase).not.toBe('default');

      await queryRunner.query('CREATE SCHEMA "core"');
      await queryRunner.query(`
        CREATE TABLE "core"."userWorkspace" (
          "id" uuid PRIMARY KEY,
          "userId" uuid NOT NULL,
          "workspaceId" uuid NOT NULL
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "core"."inconnectMessagingConfiguration" (
          "workspaceId" uuid PRIMARY KEY,
          "autoCreateEnabled" boolean NOT NULL DEFAULT false
        )
      `);
      await queryRunner.query(
        'INSERT INTO "core"."userWorkspace" ("id", "userId", "workspaceId") VALUES ($1, $2, $3)',
        [USER_WORKSPACE_ID, USER_ID, WORKSPACE_ID],
      );
      await queryRunner.query(
        'INSERT INTO "core"."inconnectMessagingConfiguration" ("workspaceId") VALUES ($1), ($2)',
        [WORKSPACE_ID, OTHER_WORKSPACE_ID],
      );
    });

    afterAll(async () => {
      if (queryRunner !== undefined) {
        await queryRunner.release();
      }
      if (dataSource?.isInitialized === true) {
        await dataSource.destroy();
      }
    });

    it('executes real up/down without provisioning or activation', async () => {
      const command =
        new AddInconnectMessagingAutomationPrincipalFastInstanceCommand();

      await command.up(queryRunner);

      expect(
        await queryRunner.query(
          'SELECT "workspaceId", "autoCreateEnabled", "automationUserWorkspaceId" FROM "core"."inconnectMessagingConfiguration" ORDER BY "workspaceId"',
        ),
      ).toEqual([
        {
          workspaceId: WORKSPACE_ID,
          autoCreateEnabled: false,
          automationUserWorkspaceId: null,
        },
        {
          workspaceId: OTHER_WORKSPACE_ID,
          autoCreateEnabled: false,
          automationUserWorkspaceId: null,
        },
      ]);

      await expect(
        queryRunner.query(
          'UPDATE "core"."inconnectMessagingConfiguration" SET "automationUserWorkspaceId" = $2 WHERE "workspaceId" = $1',
          [WORKSPACE_ID, '55555555-5555-4555-8555-555555555555'],
        ),
      ).rejects.toMatchObject({ code: '23503' });

      await queryRunner.query(
        'UPDATE "core"."inconnectMessagingConfiguration" SET "automationUserWorkspaceId" = $2 WHERE "workspaceId" = $1',
        [WORKSPACE_ID, USER_WORKSPACE_ID],
      );

      await command.down(queryRunner);

      expect(
        await queryRunner.query(`
          SELECT "column_name"
          FROM "information_schema"."columns"
          WHERE "table_schema" = 'core'
            AND "table_name" = 'inconnectMessagingConfiguration'
            AND "column_name" = 'automationUserWorkspaceId'
        `),
      ).toEqual([]);
      expect(
        await queryRunner.query(
          'SELECT "workspaceId", "autoCreateEnabled" FROM "core"."inconnectMessagingConfiguration" ORDER BY "workspaceId"',
        ),
      ).toEqual([
        { workspaceId: WORKSPACE_ID, autoCreateEnabled: false },
        { workspaceId: OTHER_WORKSPACE_ID, autoCreateEnabled: false },
      ]);
    });
  },
);
