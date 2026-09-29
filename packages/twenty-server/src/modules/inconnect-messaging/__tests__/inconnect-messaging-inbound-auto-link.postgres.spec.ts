import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, type EntityManager } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingInboundAutoLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-inbound-auto-link.service';
import { InconnectMessagingBackgroundPhoneIdentityResolverService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';
import { INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const WORKSPACE_A_ID = '15151515-1111-4111-8111-111111111111';
const WORKSPACE_B_ID = '15151515-2222-4222-8222-222222222222';
const OBJECT_A_ID = '15151515-3333-4333-8333-333333333333';
const OBJECT_B_ID = '15151515-4444-4444-8444-444444444444';
const FIELD_A_ID = '15151515-5555-4555-8555-555555555555';
const FIELD_B_ID = '15151515-6666-4666-8666-666666666666';
const CONVERSATION_ID = '15151515-7777-4777-8777-777777777777';
const MESSAGE_ID = '15151515-8888-4888-8888-888888888888';
const RECORD_A_ID = '15151515-9999-4999-8999-999999999999';
const RECORD_A_DUPLICATE_ID = '15151515-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORD_B_ID = '15151515-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HUMAN_RECORD_ID = '15151515-cccc-4ccc-8ccc-cccccccccccc';
const WORKSPACE_A_SCHEMA = 'workspace_f13b2b_a';
const WORKSPACE_B_SCHEMA = 'workspace_f13b2b_b';
const PHONE_INPUT = '+525514552571';

const disposableDatabaseName =
  process.env.INCONNECT_MESSAGING_AUTO_LINK_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres =
  disposableDatabaseName === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith('inconnect_f13b2b_validation_')
  ) {
    throw new Error(
      'A named INCONNECT Fase 13B.2B disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

type SqlExecutor = Pick<EntityManager, 'createQueryBuilder' | 'query'>;

describeWithDisposablePostgres(
  'inbound automatic CRM link PostgreSQL boundary',
  () => {
    let physicalDataSource: DataSource;
    let serviceDataSource: {
      manager: unknown;
      createQueryBuilder: DataSource['createQueryBuilder'];
      getRepository: (entity: unknown) => unknown;
      transaction: (
        callback: (manager: EntityManager) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    let backgroundResolver: InconnectMessagingBackgroundPhoneIdentityResolverService;
    let autoLinkService: InconnectMessagingInboundAutoLinkService;

    const configuredFieldsByWorkspace = new Map([
      [
        WORKSPACE_A_ID,
        [
          {
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            fieldMetadataId: FIELD_A_ID,
            role: 'PRIMARY',
            ordinal: 0,
          },
        ],
      ],
      [
        WORKSPACE_B_ID,
        [
          {
            workspaceId: WORKSPACE_B_ID,
            objectMetadataId: OBJECT_B_ID,
            fieldMetadataId: FIELD_B_ID,
            role: 'PRIMARY',
            ordinal: 0,
          },
        ],
      ],
    ]);
    const objectMetadataByWorkspace = new Map([
      [WORKSPACE_A_ID, { id: OBJECT_A_ID, workspaceId: WORKSPACE_A_ID }],
      [WORKSPACE_B_ID, { id: OBJECT_B_ID, workspaceId: WORKSPACE_B_ID }],
    ]);
    const workspaceById = new Map([
      [
        WORKSPACE_A_ID,
        { id: WORKSPACE_A_ID, databaseSchema: WORKSPACE_A_SCHEMA },
      ],
      [
        WORKSPACE_B_ID,
        { id: WORKSPACE_B_ID, databaseSchema: WORKSPACE_B_SCHEMA },
      ],
    ]);
    const fieldMetadataByWorkspace = new Map([
      [
        WORKSPACE_A_ID,
        [
          {
            id: FIELD_A_ID,
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            name: 'mobilePhone',
            type: FieldMetadataType.PHONES,
            isActive: true,
          },
        ],
      ],
      [
        WORKSPACE_B_ID,
        [
          {
            id: FIELD_B_ID,
            workspaceId: WORKSPACE_B_ID,
            objectMetadataId: OBJECT_B_ID,
            name: 'mobilePhone',
            type: FieldMetadataType.PHONES,
            isActive: true,
          },
        ],
      ],
    ]);

    const createManagerAdapter = (executor: SqlExecutor) => ({
      createQueryBuilder: executor.createQueryBuilder.bind(executor),
      getRepository: (entity: unknown) => {
        if (entity === InconnectMessagingMessageEntity) {
          return {
            findOne: async ({
              where,
            }: {
              where: { id: string; workspaceId: string };
            }) => {
              const rows = await executor.query(
                `SELECT "conversationId" FROM "core"."inconnectMessagingMessage" WHERE "id" = $1 AND "workspaceId" = $2 AND "direction" = 'INBOUND'`,
                [where.id, where.workspaceId],
              );

              return rows[0] ?? null;
            },
          };
        }

        if (entity === InconnectMessagingConversationEntity) {
          return {
            findOne: async ({
              where,
              lock,
            }: {
              where: { id: string; workspaceId: string };
              lock?: unknown;
            }) => {
              const rows = await executor.query(
                `SELECT * FROM "core"."inconnectMessagingConversation" WHERE "id" = $1 AND "workspaceId" = $2${lock === undefined ? '' : ' FOR UPDATE'}`,
                [where.id, where.workspaceId],
              );

              return rows[0] ?? null;
            },
            save: async (
              conversation: InconnectMessagingConversationEntity,
            ) => {
              await executor.query(
                `UPDATE "core"."inconnectMessagingConversation" SET "linkedRecordObjectMetadataId" = $1, "linkedRecordId" = $2 WHERE "id" = $3 AND "workspaceId" = $4`,
                [
                  conversation.linkedRecordObjectMetadataId,
                  conversation.linkedRecordId,
                  conversation.id,
                  conversation.workspaceId,
                ],
              );

              return conversation;
            },
          };
        }

        if (entity === InconnectMessagingOutboxEventEntity) {
          return {
            insert: async (event: Record<string, unknown>) => {
              await executor.query(
                `INSERT INTO "core"."inconnectMessagingOutboxEvent" ("id", "workspaceId", "aggregateType", "aggregateId", "eventType", "immutablePayload", "deduplicationKey") VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
                [
                  event.id,
                  event.workspaceId,
                  event.aggregateType,
                  event.aggregateId,
                  event.eventType,
                  JSON.stringify(event.immutablePayload),
                  event.deduplicationKey,
                ],
              );
            },
          };
        }

        if (entity === InconnectMessagingConfigurationEntity) {
          return {
            findOne: async ({
              where,
              lock,
            }: {
              where: { workspaceId: string };
              lock?: unknown;
            }) => {
              const rows = await executor.query(
                `SELECT * FROM "core"."inconnectMessagingConfiguration" WHERE "workspaceId" = $1${lock === undefined ? '' : ' FOR SHARE'}`,
                [where.workspaceId],
              );

              return rows[0] ?? null;
            },
          };
        }

        if (entity === InconnectMessagingPhoneIdentityFieldEntity) {
          return {
            find: async ({ where }: { where: { workspaceId: string } }) =>
              configuredFieldsByWorkspace.get(where.workspaceId) ?? [],
          };
        }

        if (entity === ObjectMetadataEntity) {
          return {
            findOne: async ({
              where,
            }: {
              where: { id: string; workspaceId: string };
            }) => {
              const objectMetadata = objectMetadataByWorkspace.get(
                where.workspaceId,
              );

              return objectMetadata?.id === where.id ? objectMetadata : null;
            },
          };
        }

        if (entity === FieldMetadataEntity) {
          return {
            find: async ({ where }: { where: { workspaceId: string } }) =>
              fieldMetadataByWorkspace.get(where.workspaceId) ?? [],
          };
        }

        if (entity === WorkspaceEntity) {
          return {
            findOne: async ({ where }: { where: { id: string } }) =>
              workspaceById.get(where.id) ?? null,
          };
        }

        throw new Error('Unexpected repository');
      },
    });

    beforeAll(async () => {
      physicalDataSource = new DataSource({
        type: 'postgres',
        url: getDisposableDatabaseUrl(),
      });
      await physicalDataSource.initialize();

      const [{ currentDatabase }] = await physicalDataSource.query<
        Array<{ currentDatabase: string }>
      >('SELECT current_database() AS "currentDatabase"');

      expect(currentDatabase).toBe(disposableDatabaseName);
      expect(currentDatabase).not.toBe('default');

      await physicalDataSource.query('CREATE SCHEMA "core"');
      for (const schema of [WORKSPACE_A_SCHEMA, WORKSPACE_B_SCHEMA]) {
        await physicalDataSource.query(`CREATE SCHEMA "${schema}"`);
        await physicalDataSource.query(`
          CREATE TABLE "${schema}"."_contact" (
            "id" uuid PRIMARY KEY,
            "deletedAt" TIMESTAMP WITH TIME ZONE,
            "mobilePhonePrimaryPhoneCountryCode" character varying,
            "mobilePhonePrimaryPhoneCallingCode" character varying,
            "mobilePhonePrimaryPhoneNumber" character varying
          )
        `);
      }
      await physicalDataSource.query(`
        CREATE TABLE "core"."inconnectMessagingConfiguration" (
          "workspaceId" uuid PRIMARY KEY,
          "anchorObjectMetadataId" uuid NOT NULL
        );
        CREATE TABLE "core"."inconnectMessagingConversation" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "externalAddressNormalized" text NOT NULL,
          "linkedRecordObjectMetadataId" uuid,
          "linkedRecordId" uuid,
          "lastInboundAt" TIMESTAMP WITH TIME ZONE,
          "pendingAt" TIMESTAMP WITH TIME ZONE
        );
        CREATE TABLE "core"."inconnectMessagingMessage" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "conversationId" uuid NOT NULL,
          "direction" varchar NOT NULL
        );
        CREATE TABLE "core"."inconnectMessagingOutboxEvent" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "aggregateType" varchar NOT NULL,
          "aggregateId" uuid NOT NULL,
          "eventType" varchar NOT NULL,
          "immutablePayload" jsonb NOT NULL,
          "deduplicationKey" text NOT NULL UNIQUE
        )
      `);
      await physicalDataSource.query(
        `INSERT INTO "core"."inconnectMessagingConfiguration" VALUES ($1, $2), ($3, $4)`,
        [WORKSPACE_A_ID, OBJECT_A_ID, WORKSPACE_B_ID, OBJECT_B_ID],
      );

      const rootManager = createManagerAdapter(physicalDataSource);
      serviceDataSource = {
        manager: rootManager,
        createQueryBuilder:
          physicalDataSource.createQueryBuilder.bind(physicalDataSource),
        getRepository: rootManager.getRepository,
        transaction: (callback: (manager: EntityManager) => Promise<unknown>) =>
          physicalDataSource.transaction((manager) =>
            callback(createManagerAdapter(manager) as never),
          ),
      };
      const workspaceCacheService = {
        getOrRecompute: jest.fn(async (workspaceId: string) => {
          const objectMetadata = objectMetadataByWorkspace.get(workspaceId);

          if (objectMetadata === undefined) {
            return { flatObjectMetadataMaps: {} };
          }

          const universalIdentifier = `object-${objectMetadata.id}`;

          return {
            flatObjectMetadataMaps: {
              universalIdentifierById: {
                [objectMetadata.id]: universalIdentifier,
              },
              byUniversalIdentifier: {
                [universalIdentifier]: {
                  ...objectMetadata,
                  nameSingular: 'contact',
                  applicationUniversalIdentifier: 'custom-application',
                },
              },
            },
          };
        }),
      };

      backgroundResolver =
        new InconnectMessagingBackgroundPhoneIdentityResolverService(
          serviceDataSource as never,
          workspaceCacheService as never,
        );
      autoLinkService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        backgroundResolver,
      );
    });

    afterAll(async () => {
      if (physicalDataSource.isInitialized) {
        await physicalDataSource.destroy();
      }
    });

    beforeEach(async () => {
      await physicalDataSource.query(`
        TRUNCATE "core"."inconnectMessagingOutboxEvent", "core"."inconnectMessagingMessage", "core"."inconnectMessagingConversation", "${WORKSPACE_A_SCHEMA}"."_contact", "${WORKSPACE_B_SCHEMA}"."_contact"
      `);
      await physicalDataSource.query(
        `INSERT INTO "core"."inconnectMessagingConversation" ("id", "workspaceId", "externalAddressNormalized", "linkedRecordObjectMetadataId", "linkedRecordId", "lastInboundAt", "pendingAt") VALUES ($1, $2, $3, NULL, NULL, now(), now())`,
        [CONVERSATION_ID, WORKSPACE_A_ID, PHONE_INPUT],
      );
      await physicalDataSource.query(
        `INSERT INTO "core"."inconnectMessagingMessage" VALUES ($1, $2, $3, 'INBOUND')`,
        [MESSAGE_ID, WORKSPACE_A_ID, CONVERSATION_ID],
      );
    });

    const insertPhoneRecord = async ({
      schema = WORKSPACE_A_SCHEMA,
      recordId,
    }: {
      schema?: string;
      recordId: string;
    }) => {
      await physicalDataSource.query(
        `INSERT INTO "${schema}"."_contact" VALUES ($1, NULL, 'MX', '+52', '5514552571')`,
        [recordId],
      );
    };

    const getLinkState = async () => {
      const [conversation] = await physicalDataSource.query(
        `SELECT "linkedRecordObjectMetadataId", "linkedRecordId", "pendingAt", "lastInboundAt" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const events = await physicalDataSource.query(
        `SELECT "eventType", "immutablePayload" FROM "core"."inconnectMessagingOutboxEvent" ORDER BY "eventType"`,
      );

      return { conversation, events };
    };

    it('links one exact workspace match with one system-attributed event', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      await insertPhoneRecord({
        schema: WORKSPACE_B_SCHEMA,
        recordId: RECORD_B_ID,
      });

      await expect(
        autoLinkService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toMatchObject({ state: 'LINKED' });

      const { conversation, events } = await getLinkState();

      expect(conversation).toMatchObject({
        linkedRecordObjectMetadataId: OBJECT_A_ID,
        linkedRecordId: RECORD_A_ID,
      });
      expect(events).toEqual([
        {
          eventType: 'CONVERSATION_LINKED',
          immutablePayload: {
            conversationId: CONVERSATION_ID,
            actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
          },
        },
      ]);
    });

    it('serializes two inbound attempts into one effective link and event', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      let initialResolutionCount = 0;
      let releaseInitialResolutions: (() => void) | undefined;
      const bothInitialResolutionsReady = new Promise<void>((resolve) => {
        releaseInitialResolutions = resolve;
      });
      const concurrentResolver = {
        resolvePhoneIdentity: async (input: {
          workspaceId: string;
          input: string;
        }) => {
          const result = await backgroundResolver.resolvePhoneIdentity(input);

          initialResolutionCount += 1;
          if (initialResolutionCount === 2) {
            releaseInitialResolutions?.();
          }
          await bothInitialResolutionsReady;

          return result;
        },
        resolvePhoneIdentityForLink:
          backgroundResolver.resolvePhoneIdentityForLink.bind(
            backgroundResolver,
          ),
      };
      const concurrentService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        concurrentResolver as never,
      );

      const results = await Promise.all([
        concurrentService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
        concurrentService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ]);

      expect(results.map(({ state }) => state).sort()).toEqual([
        'ALREADY_LINKED',
        'LINKED',
      ]);
      expect((await getLinkState()).events).toHaveLength(1);
    });

    it('preserves a human link that commits after initial resolution', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      const humanWinningResolver = {
        resolvePhoneIdentity: async (input: {
          workspaceId: string;
          input: string;
        }) => {
          const result = await backgroundResolver.resolvePhoneIdentity(input);

          await physicalDataSource.transaction(async (manager) => {
            await manager.query(
              `UPDATE "core"."inconnectMessagingConversation" SET "linkedRecordObjectMetadataId" = $1, "linkedRecordId" = $2 WHERE "id" = $3`,
              [OBJECT_A_ID, HUMAN_RECORD_ID, CONVERSATION_ID],
            );
            await manager.query(
              `INSERT INTO "core"."inconnectMessagingOutboxEvent" VALUES ($1, $2, 'CONVERSATION', $3, 'CONVERSATION_LINKED', $4::jsonb, $5)`,
              [
                '15151515-dddd-4ddd-8ddd-dddddddddddd',
                WORKSPACE_A_ID,
                CONVERSATION_ID,
                JSON.stringify({
                  conversationId: CONVERSATION_ID,
                  actor: 'HUMAN_TEST_FIXTURE',
                }),
                'human-link-test-fixture',
              ],
            );
          });

          return result;
        },
        resolvePhoneIdentityForLink: jest.fn(),
      };
      const humanRaceService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        humanWinningResolver as never,
      );

      await expect(
        humanRaceService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({
        state: 'ALREADY_LINKED',
        publicationRequest: null,
      });

      const { conversation, events } = await getLinkState();

      expect(conversation.linkedRecordId).toBe(HUMAN_RECORD_ID);
      expect(events).toHaveLength(1);
      expect(
        humanWinningResolver.resolvePhoneIdentityForLink,
      ).not.toHaveBeenCalled();
    });

    it('rejects a stale target whose phone changes before final revalidation', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      const staleResolver = {
        resolvePhoneIdentity: async (input: {
          workspaceId: string;
          input: string;
        }) => {
          const result = await backgroundResolver.resolvePhoneIdentity(input);

          await physicalDataSource.query(
            `UPDATE "${WORKSPACE_A_SCHEMA}"."_contact" SET "mobilePhonePrimaryPhoneNumber" = '5514559999' WHERE "id" = $1`,
            [RECORD_A_ID],
          );

          return result;
        },
        resolvePhoneIdentityForLink:
          backgroundResolver.resolvePhoneIdentityForLink.bind(
            backgroundResolver,
          ),
      };
      const staleService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        staleResolver as never,
      );

      await expect(
        staleService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({ state: 'NO_MATCH', publicationRequest: null });

      const { conversation, events } = await getLinkState();

      expect(conversation.linkedRecordId).toBeNull();
      expect(events).toHaveLength(0);
    });

    it('holds a target FOR SHARE lock through the link transaction boundary', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      let releaseResolverTransaction: (() => void) | undefined;
      const holdTransaction = new Promise<void>((resolve) => {
        releaseResolverTransaction = resolve;
      });
      let targetLocked: (() => void) | undefined;
      const targetLockAcquired = new Promise<void>((resolve) => {
        targetLocked = resolve;
      });
      const resolverTransaction = physicalDataSource.transaction(
        async (manager) => {
          const managerAdapter = createManagerAdapter(manager);
          const resolution =
            await backgroundResolver.resolvePhoneIdentityForLink({
              manager: managerAdapter as never,
              workspaceId: WORKSPACE_A_ID,
              input: PHONE_INPUT,
            });

          expect(resolution.state).toBe('UNIQUE');
          targetLocked?.();
          await holdTransaction;
        },
      );

      await targetLockAcquired;
      let competingUpdateCompleted = false;
      const competingUpdate = physicalDataSource
        .query(
          `UPDATE "${WORKSPACE_A_SCHEMA}"."_contact" SET "mobilePhonePrimaryPhoneNumber" = '5514559999' WHERE "id" = $1`,
          [RECORD_A_ID],
        )
        .then(() => {
          competingUpdateCompleted = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(competingUpdateCompleted).toBe(false);
      releaseResolverTransaction?.();
      await resolverTransaction;
      await competingUpdate;
      expect(competingUpdateCompleted).toBe(true);
    });

    it('does not cross-link a phone that exists only in another workspace', async () => {
      await insertPhoneRecord({
        schema: WORKSPACE_B_SCHEMA,
        recordId: RECORD_B_ID,
      });

      await expect(
        autoLinkService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({ state: 'NO_MATCH', publicationRequest: null });
      expect((await getLinkState()).conversation.linkedRecordId).toBeNull();
    });

    it('leaves ambiguous records unassigned without arbitrary selection', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      await insertPhoneRecord({ recordId: RECORD_A_DUPLICATE_ID });

      await expect(
        autoLinkService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({ state: 'AMBIGUOUS', publicationRequest: null });
      expect((await getLinkState()).events).toHaveLength(0);
    });
  },
);
