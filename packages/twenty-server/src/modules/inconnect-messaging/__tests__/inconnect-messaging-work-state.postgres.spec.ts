import { DataSource } from 'typeorm';

import { InconnectMessagingWorkStateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-work-state.service';

const workspaceId = '91919191-1111-4111-8111-111111111111';
const workspaceMemberId = '91919191-2222-4222-8222-222222222222';
const conversationId = '91919191-3333-4333-8333-333333333333';
const authContext = {
  type: 'user',
  workspace: { id: workspaceId },
  workspaceMemberId,
  workspaceMember: { id: workspaceMemberId },
} as never;

const disposableDatabaseName =
  process.env.INCONNECT_MESSAGING_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres =
  disposableDatabaseName === undefined ? describe.skip : describe;

jest.useRealTimers();

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith('inconnect_f9a_fix_validation_')
  ) {
    throw new Error(
      'A named INCONNECT Fase 9A disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

describeWithDisposablePostgres(
  'InconnectMessagingWorkStateService PostgreSQL arrival cursor',
  () => {
    let dataSource: DataSource;
    let service: InconnectMessagingWorkStateService;

    const getPhysicalWorkState = async () => {
      const [state] = await dataSource.query<
        Array<{ isFavorite: boolean; isPending: boolean; isUnread: boolean }>
      >(
        `
          SELECT
            COALESCE(member_state."favorite", false) AS "isFavorite",
            conversation."pendingAt" IS NOT NULL AS "isPending",
            (
              COALESCE(member_state."manualUnread", false)
              OR EXISTS (
                SELECT 1
                FROM "core"."inconnectMessagingMessage" unread_message
                WHERE unread_message."workspaceId" = conversation."workspaceId"
                  AND unread_message."conversationId" = conversation."id"
                  AND unread_message."direction" = 'INBOUND'
                  AND (
                    (
                      member_state."lastReadMessageCreatedAt" IS NOT NULL
                      AND (
                        unread_message."createdAt" > member_state."lastReadMessageCreatedAt"
                        OR (
                          unread_message."createdAt" = member_state."lastReadMessageCreatedAt"
                          AND unread_message."id" > member_state."lastReadMessageId"
                        )
                      )
                    )
                    OR (
                      member_state."lastReadMessageCreatedAt" IS NULL
                      AND unread_message."createdAt" > configuration."workStateTrackingBaselineAt"
                    )
                  )
              )
            ) AS "isUnread"
          FROM "core"."inconnectMessagingConversation" conversation
          JOIN "core"."inconnectMessagingConfiguration" configuration
            ON configuration."workspaceId" = conversation."workspaceId"
          LEFT JOIN "core"."inconnectMessagingConversationMemberState" member_state
            ON member_state."workspaceId" = conversation."workspaceId"
            AND member_state."conversationId" = conversation."id"
            AND member_state."workspaceMemberId" = $3
          WHERE conversation."workspaceId" = $1
            AND conversation."id" = $2
        `,
        [workspaceId, conversationId, workspaceMemberId],
      );

      return state;
    };

    const insertInbound = async ({
      id,
      createdAt,
      effectiveInboundAt = createdAt,
    }: {
      id: string;
      createdAt: string;
      effectiveInboundAt?: string;
    }): Promise<void> => {
      await dataSource.query(
        `
          INSERT INTO "core"."inconnectMessagingMessage"
            ("id", "workspaceId", "conversationId", "direction", "createdAt", "effectiveInboundAt")
          VALUES ($1, $2, $3, 'INBOUND', $4::timestamptz, $5::timestamptz)
        `,
        [id, workspaceId, conversationId, createdAt, effectiveInboundAt],
      );
    };

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: getDisposableDatabaseUrl(),
      });
      await dataSource.initialize();

      const [{ currentDatabase }] = await dataSource.query<
        Array<{ currentDatabase: string }>
      >('SELECT current_database() AS "currentDatabase"');

      expect(currentDatabase).toBe(disposableDatabaseName);
      expect(currentDatabase).not.toBe('default');

      await dataSource.query('CREATE SCHEMA "core"');
      await dataSource.query(`
        CREATE TABLE "core"."inconnectMessagingConfiguration" (
          "workspaceId" uuid PRIMARY KEY,
          "workStateTrackingBaselineAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);
      await dataSource.query(`
        CREATE TABLE "core"."inconnectMessagingConversation" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "pendingAt" TIMESTAMP WITH TIME ZONE
        )
      `);
      await dataSource.query(`
        CREATE TABLE "core"."inconnectMessagingMessage" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "conversationId" uuid NOT NULL,
          "direction" character varying NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "effectiveInboundAt" TIMESTAMP WITH TIME ZONE
        )
      `);
      await dataSource.query(`
        CREATE TABLE "core"."inconnectMessagingConversationMemberState" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "conversationId" uuid NOT NULL,
          "workspaceMemberId" uuid NOT NULL,
          "favorite" boolean NOT NULL DEFAULT false,
          "lastReadMessageCreatedAt" TIMESTAMP WITH TIME ZONE,
          "lastReadMessageId" uuid,
          "manualUnread" boolean NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "CHK_INCONNECT_MSG_MEMBER_STATE_READ_CURSOR" CHECK (
            ("lastReadMessageCreatedAt" IS NULL AND "lastReadMessageId" IS NULL)
            OR ("lastReadMessageCreatedAt" IS NOT NULL AND "lastReadMessageId" IS NOT NULL)
          ),
          CONSTRAINT "IDX_INCONNECT_MSG_MEMBER_STATE_IDENTITY_UNIQUE" UNIQUE
            ("workspaceId", "conversationId", "workspaceMemberId")
        )
      `);

      const authorizationService = {
        findAuthorizedConversation: jest.fn().mockImplementation(async () => {
          const rows = await dataSource.query<Array<{ id: string }>>(
            `
              SELECT "id"
              FROM "core"."inconnectMessagingConversation"
              WHERE "workspaceId" = $1 AND "id" = $2
            `,
            [workspaceId, conversationId],
          );

          return rows[0] ?? null;
        }),
      };
      const conversationQueryService = {
        getAuthorizedConversation: jest.fn().mockImplementation(async () => {
          const state = await getPhysicalWorkState();

          return state === undefined
            ? null
            : { conversation: { id: conversationId }, ...state };
        }),
      };

      service = new InconnectMessagingWorkStateService(
        dataSource,
        authorizationService as never,
        conversationQueryService as never,
        { requestPublication: jest.fn() } as never,
      );
    });

    beforeEach(async () => {
      await dataSource.query(
        'TRUNCATE "core"."inconnectMessagingConversationMemberState", "core"."inconnectMessagingMessage", "core"."inconnectMessagingConversation", "core"."inconnectMessagingConfiguration"',
      );
      await dataSource.query(
        `
          INSERT INTO "core"."inconnectMessagingConfiguration"
            ("workspaceId", "workStateTrackingBaselineAt")
          VALUES ($1, '2026-09-18 08:00:00.000000+00'::timestamptz)
        `,
        [workspaceId],
      );
      await dataSource.query(
        `
          INSERT INTO "core"."inconnectMessagingConversation"
            ("id", "workspaceId", "pendingAt")
          VALUES ($1, $2, NULL)
        `,
        [conversationId, workspaceId],
      );
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query('DROP SCHEMA "core" CASCADE');
        await dataSource.destroy();
      }
    });

    it('preserves the exact PostgreSQL microsecond timestamp through mark read', async () => {
      const messageId = '91919191-4444-4444-8444-444444444444';

      await insertInbound({
        id: messageId,
        createdAt: '2026-09-18 10:00:00.123456+00',
      });

      const workState = await service.markRead({
        authContext,
        conversationId,
        throughMessageId: messageId,
      });
      const [physicalCursor] = await dataSource.query<
        Array<{
          cursorTimestamp: string;
          exactTimestamp: boolean;
          messageTimestamp: string;
        }>
      >(
        `
          SELECT
            to_char(message."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS "messageTimestamp",
            to_char(member_state."lastReadMessageCreatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS "cursorTimestamp",
            message."createdAt" = member_state."lastReadMessageCreatedAt" AS "exactTimestamp"
          FROM "core"."inconnectMessagingMessage" message
          JOIN "core"."inconnectMessagingConversationMemberState" member_state
            ON member_state."lastReadMessageId" = message."id"
          WHERE message."id" = $1
        `,
        [messageId],
      );

      expect(physicalCursor).toEqual({
        messageTimestamp: '2026-09-18 10:00:00.123456+00',
        cursorTimestamp: '2026-09-18 10:00:00.123456+00',
        exactTimestamp: true,
      });
      expect(workState.isUnread).toBe(false);
    });

    it('keeps the arrival cursor monotonic and uses id for equal timestamps', async () => {
      const message8Id = '91919191-5555-4555-8555-000000000008';
      const message10Id = '91919191-5555-4555-8555-000000000010';
      const message11Id = '91919191-5555-4555-8555-000000000011';
      const tiedHigherId = '91919191-5555-4555-8555-000000000012';

      await insertInbound({
        id: message8Id,
        createdAt: '2026-09-18 10:00:00.123008+00',
      });
      await insertInbound({
        id: message10Id,
        createdAt: '2026-09-18 10:00:00.123010+00',
      });
      await insertInbound({
        id: message11Id,
        createdAt: '2026-09-18 10:00:00.123011+00',
      });
      await insertInbound({
        id: tiedHigherId,
        createdAt: '2026-09-18 10:00:00.123011+00',
      });

      await service.markRead({
        authContext,
        conversationId,
        throughMessageId: message10Id,
      });
      await service.markRead({
        authContext,
        conversationId,
        throughMessageId: message8Id,
      });

      let [cursor] = await dataSource.query<
        Array<{ lastReadMessageId: string }>
      >(
        'SELECT "lastReadMessageId" FROM "core"."inconnectMessagingConversationMemberState"',
      );

      expect(cursor.lastReadMessageId).toBe(message10Id);

      await service.markRead({
        authContext,
        conversationId,
        throughMessageId: message11Id,
      });

      [cursor] = await dataSource.query<Array<{ lastReadMessageId: string }>>(
        'SELECT "lastReadMessageId" FROM "core"."inconnectMessagingConversationMemberState"',
      );
      expect(cursor.lastReadMessageId).toBe(message11Id);

      await service.markRead({ authContext, conversationId });

      [cursor] = await dataSource.query<Array<{ lastReadMessageId: string }>>(
        'SELECT "lastReadMessageId" FROM "core"."inconnectMessagingConversationMemberState"',
      );
      expect(cursor.lastReadMessageId).toBe(tiedHigherId);

      await service.markRead({
        authContext,
        conversationId,
        throughMessageId: message11Id,
      });

      [cursor] = await dataSource.query<Array<{ lastReadMessageId: string }>>(
        'SELECT "lastReadMessageId" FROM "core"."inconnectMessagingConversationMemberState"',
      );
      expect(cursor.lastReadMessageId).toBe(tiedHigherId);
    });

    it('treats a delayed inbound as unread by arrival and mark-all-read consumes it', async () => {
      const message10Id = '91919191-6666-4666-8666-000000000010';
      const delayedMessage11Id = '91919191-6666-4666-8666-000000000011';

      await insertInbound({
        id: message10Id,
        createdAt: '2026-09-18 10:00:00.100010+00',
        effectiveInboundAt: '2026-09-18 10:00:00.000000+00',
      });
      await service.markRead({
        authContext,
        conversationId,
        throughMessageId: message10Id,
      });
      await insertInbound({
        id: delayedMessage11Id,
        createdAt: '2026-09-18 10:05:00.100011+00',
        effectiveInboundAt: '2026-09-18 09:30:00.000000+00',
      });

      const unreadState = await getPhysicalWorkState();
      const historyOrder = await dataSource.query<Array<{ id: string }>>(
        `
          SELECT "id"
          FROM "core"."inconnectMessagingMessage"
          ORDER BY COALESCE("effectiveInboundAt", "createdAt") DESC, "id" DESC
        `,
      );

      expect(unreadState?.isUnread).toBe(true);
      expect(historyOrder.map(({ id }) => id)).toEqual([
        message10Id,
        delayedMessage11Id,
      ]);

      const readState = await service.markRead({ authContext, conversationId });
      const [cursor] = await dataSource.query<
        Array<{ lastReadMessageId: string }>
      >(
        'SELECT "lastReadMessageId" FROM "core"."inconnectMessagingConversationMemberState"',
      );

      expect(cursor.lastReadMessageId).toBe(delayedMessage11Id);
      expect(readState.isUnread).toBe(false);
    });
  },
);
