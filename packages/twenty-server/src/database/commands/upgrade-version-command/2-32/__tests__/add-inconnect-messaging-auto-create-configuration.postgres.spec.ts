import { DataSource, type QueryRunner } from 'typeorm';

import { AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration';

const postgresUrl = process.env.INCONNECT_F13C_POSTGRES_URL;
const describeWithPostgres =
  postgresUrl === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

const WORKSPACE_A_ID = '10101010-1111-4111-8111-111111111111';
const WORKSPACE_B_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_A_ID = '20202020-2222-4222-8222-222222222222';
const OBJECT_B_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_A_ID = '30303030-3333-4333-8333-333333333333';
const ROLE_B_ID = '33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = '40404040-4444-4444-8444-444444444444';
const CRM_RECORD_ID = '50505050-5555-4555-8555-555555555555';

const expectPostgresErrorCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ code });
};

describeWithPostgres(
  'AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand PostgreSQL',
  () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: postgresUrl,
      });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();

      await queryRunner.query('CREATE SCHEMA "core"');
      await queryRunner.query('CREATE SCHEMA "workspace_fixture"');
      await queryRunner.query(`
        CREATE TABLE "core"."workspace" (
          "id" uuid PRIMARY KEY
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "core"."objectMetadata" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          CONSTRAINT "UQ_OBJECT_WORKSPACE" UNIQUE ("id", "workspaceId"),
          CONSTRAINT "FK_OBJECT_WORKSPACE" FOREIGN KEY ("workspaceId")
            REFERENCES "core"."workspace"("id")
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "core"."role" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          CONSTRAINT "UQ_ROLE_WORKSPACE" UNIQUE ("id", "workspaceId"),
          CONSTRAINT "FK_ROLE_WORKSPACE" FOREIGN KEY ("workspaceId")
            REFERENCES "core"."workspace"("id")
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "core"."inconnectMessagingConfiguration" (
          "workspaceId" uuid PRIMARY KEY,
          "anchorObjectMetadataId" uuid NOT NULL,
          "revision" bigint NOT NULL DEFAULT 0,
          "workStateTrackingBaselineAt" timestamptz NOT NULL DEFAULT now(),
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "UQ_MSG_CONFIG_ANCHOR" UNIQUE (
            "workspaceId",
            "anchorObjectMetadataId"
          ),
          CONSTRAINT "FK_MSG_CONFIG_WORKSPACE" FOREIGN KEY ("workspaceId")
            REFERENCES "core"."workspace"("id"),
          CONSTRAINT "FK_MSG_CONFIG_ANCHOR" FOREIGN KEY (
            "anchorObjectMetadataId",
            "workspaceId"
          ) REFERENCES "core"."objectMetadata"("id", "workspaceId")
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "core"."inconnectMessagingConversation" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "linkedRecordId" uuid
        )
      `);
      await queryRunner.query(`
        CREATE TABLE "workspace_fixture"."contact" (
          "id" uuid PRIMARY KEY,
          "name" text NOT NULL
        )
      `);
      await queryRunner.query(
        'INSERT INTO "core"."workspace" ("id") VALUES ($1), ($2)',
        [WORKSPACE_A_ID, WORKSPACE_B_ID],
      );
      await queryRunner.query(
        'INSERT INTO "core"."objectMetadata" ("id", "workspaceId") VALUES ($1, $2), ($3, $4)',
        [OBJECT_A_ID, WORKSPACE_A_ID, OBJECT_B_ID, WORKSPACE_B_ID],
      );
      await queryRunner.query(
        'INSERT INTO "core"."role" ("id", "workspaceId") VALUES ($1, $2), ($3, $4)',
        [ROLE_A_ID, WORKSPACE_A_ID, ROLE_B_ID, WORKSPACE_B_ID],
      );
      await queryRunner.query(
        'INSERT INTO "core"."inconnectMessagingConfiguration" ("workspaceId", "anchorObjectMetadataId") VALUES ($1, $2)',
        [WORKSPACE_A_ID, OBJECT_A_ID],
      );
      await queryRunner.query(
        'INSERT INTO "core"."inconnectMessagingConversation" ("id", "workspaceId") VALUES ($1, $2)',
        [CONVERSATION_ID, WORKSPACE_A_ID],
      );
      await queryRunner.query(
        'INSERT INTO "workspace_fixture"."contact" ("id", "name") VALUES ($1, $2)',
        [CRM_RECORD_ID, 'Preserved record'],
      );
    }, 30_000);

    afterAll(async () => {
      if (queryRunner !== undefined) {
        await queryRunner.release();
      }
      if (dataSource?.isInitialized === true) {
        await dataSource.destroy();
      }
    });

    it('executes real up/down with disabled defaults and isolated foreign keys', async () => {
      const command =
        new AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand();

      await command.up(queryRunner);

      const [postUpgradeConfiguration] = await queryRunner.query(
        `SELECT
          "autoCreateEnabled",
          "autoCreateAnchorObjectMetadataId",
          "autoCreateOwnerStrategy",
          "autoCreateOwnerRoleId",
          "autoCreateLabelPolicy"
        FROM "core"."inconnectMessagingConfiguration"
        WHERE "workspaceId" = $1`,
        [WORKSPACE_A_ID],
      );

      expect(postUpgradeConfiguration).toEqual({
        autoCreateEnabled: false,
        autoCreateAnchorObjectMetadataId: null,
        autoCreateOwnerStrategy: null,
        autoCreateOwnerRoleId: null,
        autoCreateLabelPolicy: null,
      });

      await expectPostgresErrorCode(
        queryRunner.query(
          `UPDATE "core"."inconnectMessagingConfiguration"
          SET
            "autoCreateAnchorObjectMetadataId" = $2,
            "autoCreateOwnerStrategy" = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
            "autoCreateOwnerRoleId" = $3,
            "autoCreateLabelPolicy" = 'OMIT'
          WHERE "workspaceId" = $1`,
          [WORKSPACE_A_ID, OBJECT_A_ID, ROLE_B_ID],
        ),
        '23503',
      );
      await expectPostgresErrorCode(
        queryRunner.query(
          `UPDATE "core"."inconnectMessagingConfiguration"
          SET
            "autoCreateAnchorObjectMetadataId" = $2,
            "autoCreateOwnerStrategy" = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
            "autoCreateOwnerRoleId" = $3,
            "autoCreateLabelPolicy" = 'OMIT'
          WHERE "workspaceId" = $1`,
          [WORKSPACE_A_ID, OBJECT_B_ID, ROLE_A_ID],
        ),
        '23503',
      );
      await expectPostgresErrorCode(
        queryRunner.query(
          `UPDATE "core"."inconnectMessagingConfiguration"
          SET "autoCreateEnabled" = true
          WHERE "workspaceId" = $1`,
          [WORKSPACE_A_ID],
        ),
        '23514',
      );

      await queryRunner.query(
        `UPDATE "core"."inconnectMessagingConfiguration"
        SET
          "autoCreateEnabled" = true,
          "autoCreateAnchorObjectMetadataId" = $2,
          "autoCreateOwnerStrategy" = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
          "autoCreateOwnerRoleId" = $3,
          "autoCreateLabelPolicy" = 'OMIT'
        WHERE "workspaceId" = $1`,
        [WORKSPACE_A_ID, OBJECT_A_ID, ROLE_A_ID],
      );

      expect(
        await queryRunner.query(
          'SELECT "id", "workspaceId", "linkedRecordId" FROM "core"."inconnectMessagingConversation"',
        ),
      ).toEqual([
        {
          id: CONVERSATION_ID,
          workspaceId: WORKSPACE_A_ID,
          linkedRecordId: null,
        },
      ]);
      expect(
        await queryRunner.query(
          'SELECT "id", "name" FROM "workspace_fixture"."contact"',
        ),
      ).toEqual([{ id: CRM_RECORD_ID, name: 'Preserved record' }]);

      await command.down(queryRunner);

      const autoCreateColumns = await queryRunner.query(`
        SELECT "column_name"
        FROM "information_schema"."columns"
        WHERE "table_schema" = 'core'
          AND "table_name" = 'inconnectMessagingConfiguration'
          AND "column_name" LIKE 'autoCreate%'
      `);

      expect(autoCreateColumns).toEqual([]);
      expect(
        await queryRunner.query(
          'SELECT "workspaceId", "anchorObjectMetadataId" FROM "core"."inconnectMessagingConfiguration"',
        ),
      ).toEqual([
        {
          workspaceId: WORKSPACE_A_ID,
          anchorObjectMetadataId: OBJECT_A_ID,
        },
      ]);
      expect(
        await queryRunner.query(
          'SELECT "id", "workspaceId", "linkedRecordId" FROM "core"."inconnectMessagingConversation"',
        ),
      ).toEqual([
        {
          id: CONVERSATION_ID,
          workspaceId: WORKSPACE_A_ID,
          linkedRecordId: null,
        },
      ]);
      expect(
        await queryRunner.query(
          'SELECT "id", "name" FROM "workspace_fixture"."contact"',
        ),
      ).toEqual([{ id: CRM_RECORD_ID, name: 'Preserved record' }]);
    });
  },
);
