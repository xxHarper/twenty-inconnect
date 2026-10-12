import { randomUUID } from 'crypto';

import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, type EntityManager } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
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
const FIELD_A_SECONDARY_ID = '15151515-5555-4555-8555-555555555556';
const FIELD_B_ID = '15151515-6666-4666-8666-666666666666';
const CONVERSATION_ID = '15151515-7777-4777-8777-777777777777';
const MESSAGE_ID = '15151515-8888-4888-8888-888888888888';
const RECORD_A_ID = '15151515-9999-4999-8999-999999999999';
const RECORD_A_DUPLICATE_ID = '15151515-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORD_B_ID = '15151515-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HUMAN_RECORD_ID = '15151515-cccc-4ccc-8ccc-cccccccccccc';
const OWNER_WORKSPACE_MEMBER_ID = '15151515-eeee-4eee-8eee-eeeeeeeeeeee';
const AUTOMATION_WORKSPACE_MEMBER_ID = '15151515-ffff-4fff-8fff-ffffffffffff';
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
    };
    let coreQueryBuilderService: {
      createCoreQueryBuilder: (input: {
        queryRunner: { manager: EntityManager; query: EntityManager['query'] };
        target: unknown;
      }) => unknown;
    };
    let globalWorkspaceOrmManager: {
      getGlobalWorkspaceDataSource: () => Promise<DataSource>;
    };
    const unusedAutoCreateAuthorityService = {
      issueAuthority: jest.fn(() => {
        throw new Error('Auto-create authority must remain disabled');
      }),
      resolveCreatePlan: jest.fn(),
    };
    const unusedAutomationRecordCreateService = {
      execute: jest.fn(() => {
        throw new Error('Auto-create executor must remain disabled');
      }),
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
          {
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            fieldMetadataId: FIELD_A_SECONDARY_ID,
            role: 'MATCH_ONLY',
            ordinal: 1,
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
          {
            id: FIELD_A_SECONDARY_ID,
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            name: 'alternatePhone',
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

    const createCoreQueryBuilderFacade = ({
      queryRunner,
      target,
    }: {
      queryRunner: { manager: EntityManager; query: EntityManager['query'] };
      target: unknown;
    }) => {
      const repository = createManagerAdapter(
        queryRunner.manager,
      ).getRepository(target) as {
        findOne?: (input: unknown) => Promise<unknown>;
        find?: (input: unknown) => Promise<unknown[]>;
        insert?: (input: unknown) => Promise<unknown>;
      };
      let lock: unknown;
      let mode: 'select' | 'update' | 'insert' = 'select';
      let writeValues: Record<string, unknown> = {};
      const parameters: Record<string, unknown> = {};
      const builder = {
        select: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockImplementation((nextLock: string) => {
          lock = { mode: nextLock };

          return builder;
        }),
        where: jest.fn().mockImplementation((_sql: string, next = {}) => {
          Object.assign(parameters, next);

          return builder;
        }),
        andWhere: jest.fn().mockImplementation((_sql: string, next = {}) => {
          Object.assign(parameters, next);

          return builder;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        update: jest.fn().mockImplementation(() => {
          mode = 'update';

          return builder;
        }),
        set: jest.fn().mockImplementation((nextValues) => {
          writeValues = nextValues;

          return builder;
        }),
        insert: jest.fn().mockImplementation(() => {
          mode = 'insert';

          return builder;
        }),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockImplementation((nextValues) => {
          writeValues = nextValues;

          return builder;
        }),
        updateEntity: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => {
          if (target === InconnectMessagingConversationEntity) {
            return repository.findOne?.({
              where: {
                id: parameters.conversationId,
                workspaceId: parameters.workspaceId,
              },
              lock,
            });
          }
          if (target === InconnectMessagingConfigurationEntity) {
            return repository.findOne?.({
              where: { workspaceId: parameters.workspaceId },
              lock,
            });
          }
          if (target === ObjectMetadataEntity) {
            return repository.findOne?.({
              where: {
                id: parameters.objectMetadataId,
                workspaceId: parameters.workspaceId,
              },
            });
          }
          if (target === WorkspaceEntity) {
            return repository.findOne?.({
              where: { id: parameters.workspaceId },
            });
          }

          throw new Error('Unexpected Core getOne target');
        }),
        getMany: jest.fn(async () => {
          if (
            target === InconnectMessagingPhoneIdentityFieldEntity ||
            target === FieldMetadataEntity
          ) {
            return repository.find?.({
              where: { workspaceId: parameters.workspaceId },
            });
          }

          throw new Error('Unexpected Core getMany target');
        }),
        execute: jest.fn(async () => {
          if (
            mode === 'update' &&
            target === InconnectMessagingConversationEntity
          ) {
            const result = (await queryRunner.query(
              `UPDATE "core"."inconnectMessagingConversation" SET "linkedRecordObjectMetadataId" = $1, "linkedRecordId" = $2 WHERE "id" = $3 AND "workspaceId" = $4 AND "linkedRecordObjectMetadataId" IS NULL AND "linkedRecordId" IS NULL RETURNING "id"`,
              [
                writeValues.linkedRecordObjectMetadataId,
                writeValues.linkedRecordId,
                parameters.conversationId,
                parameters.workspaceId,
              ],
            )) as unknown[];
            const affected =
              typeof result[1] === 'number'
                ? result[1]
                : Array.isArray(result[0])
                  ? result[0].length
                  : result.length;

            return { affected };
          }
          if (
            mode === 'insert' &&
            target === InconnectMessagingOutboxEventEntity
          ) {
            await repository.insert?.(writeValues);

            return { identifiers: [{ id: writeValues.id }] };
          }

          throw new Error('Unexpected Core write target');
        }),
      };

      return builder;
    };

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
            "mobilePhonePrimaryPhoneNumber" character varying,
            "alternatePhonePrimaryPhoneCountryCode" character varying,
            "alternatePhonePrimaryPhoneCallingCode" character varying,
            "alternatePhonePrimaryPhoneNumber" character varying,
            "ownerId" uuid,
            "createdByWorkspaceMemberId" uuid,
            "updatedByWorkspaceMemberId" uuid,
            CONSTRAINT "UQ_CONTACT_CANONICAL_PHONE" UNIQUE (
              "mobilePhonePrimaryPhoneCountryCode",
              "mobilePhonePrimaryPhoneCallingCode",
              "mobilePhonePrimaryPhoneNumber"
            ),
            CONSTRAINT "UQ_CONTACT_CANONICAL_ALTERNATE_PHONE" UNIQUE (
              "alternatePhonePrimaryPhoneCountryCode",
              "alternatePhonePrimaryPhoneCallingCode",
              "alternatePhonePrimaryPhoneNumber"
            )
          )
        `);
      }
      await physicalDataSource.query(`
        CREATE TABLE "core"."inconnectMessagingConfiguration" (
          "workspaceId" uuid PRIMARY KEY,
          "anchorObjectMetadataId" uuid NOT NULL,
          "autoCreateEnabled" boolean NOT NULL DEFAULT false
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
        );
        CREATE TABLE "core"."inconnectMessagingCrmCreateEvent" (
          "id" uuid PRIMARY KEY,
          "workspaceId" uuid NOT NULL,
          "recordId" uuid NOT NULL,
          "eventType" varchar NOT NULL
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
      };
      coreQueryBuilderService = {
        createCoreQueryBuilder: createCoreQueryBuilderFacade,
      };
      globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: async () => physicalDataSource,
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
          coreQueryBuilderService as never,
        );
      autoLinkService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        globalWorkspaceOrmManager as never,
        coreQueryBuilderService as never,
        backgroundResolver,
        unusedAutoCreateAuthorityService as never,
        unusedAutomationRecordCreateService as never,
      );
    });

    afterAll(async () => {
      if (physicalDataSource.isInitialized) {
        await physicalDataSource.destroy();
      }
    });

    beforeEach(async () => {
      await physicalDataSource.query(`
        TRUNCATE "core"."inconnectMessagingCrmCreateEvent", "core"."inconnectMessagingOutboxEvent", "core"."inconnectMessagingMessage", "core"."inconnectMessagingConversation", "${WORKSPACE_A_SCHEMA}"."_contact", "${WORKSPACE_B_SCHEMA}"."_contact"
      `);
      await physicalDataSource.query(
        `UPDATE "core"."inconnectMessagingConfiguration" SET "autoCreateEnabled" = false`,
      );
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
      identityField = 'mobilePhone',
    }: {
      schema?: string;
      recordId: string;
      identityField?: 'mobilePhone' | 'alternatePhone';
    }) => {
      await physicalDataSource.query(
        `INSERT INTO "${schema}"."_contact" ("id", "deletedAt", "${identityField}PrimaryPhoneCountryCode", "${identityField}PrimaryPhoneCallingCode", "${identityField}PrimaryPhoneNumber") VALUES ($1, NULL, 'MX', '+52', '5514552571')`,
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

    const enableAutoCreate = async () => {
      await physicalDataSource.query(
        `UPDATE "core"."inconnectMessagingConfiguration" SET "autoCreateEnabled" = true WHERE "workspaceId" = $1`,
        [WORKSPACE_A_ID],
      );
    };

    type PhysicalCreateQueryRunner = {
      query: (statement: string, parameters?: unknown[]) => Promise<unknown>;
    };

    const createPhysicalAutoCreateHarness = ({
      beforeInsert,
    }: {
      beforeInsert?: () => Promise<void>;
    } = {}) => {
      const authority = Object.freeze({ source: 'physical-test-authority' });
      const authorityService = {
        issueAuthority: jest.fn().mockResolvedValue(authority),
        resolveCreatePlan: jest.fn().mockResolvedValue({
          objectMetadataId: OBJECT_A_ID,
        }),
      };
      const createService = {
        execute: jest.fn(
          async ({
            canonicalPhoneIdentity,
            queryRunner,
          }: {
            canonicalPhoneIdentity: string;
            queryRunner: PhysicalCreateQueryRunner;
          }) => {
            expect(canonicalPhoneIdentity).toBe(PHONE_INPUT);
            await beforeInsert?.();

            const recordId = randomUUID();

            await queryRunner.query(
              `INSERT INTO "${WORKSPACE_A_SCHEMA}"."_contact" ("id", "deletedAt", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode", "mobilePhonePrimaryPhoneNumber", "ownerId", "createdByWorkspaceMemberId", "updatedByWorkspaceMemberId") VALUES ($1, NULL, 'MX', '+52', '5514552571', $2, $3, $3)`,
              [
                recordId,
                OWNER_WORKSPACE_MEMBER_ID,
                AUTOMATION_WORKSPACE_MEMBER_ID,
              ],
            );
            await queryRunner.query(
              `INSERT INTO "core"."inconnectMessagingCrmCreateEvent" ("id", "workspaceId", "recordId", "eventType") VALUES ($1, $2, $3, 'CREATED'), ($4, $2, $3, 'UPSERTED')`,
              [randomUUID(), WORKSPACE_A_ID, recordId, randomUUID()],
            );

            return { objectMetadataId: OBJECT_A_ID, recordId };
          },
        ),
      };
      const service = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        globalWorkspaceOrmManager as never,
        coreQueryBuilderService as never,
        backgroundResolver,
        authorityService as never,
        createService as never,
      );

      return { authorityService, createService, service };
    };

    const insertSecondInboundConversation = async () => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      await physicalDataSource.query(
        `INSERT INTO "core"."inconnectMessagingConversation" ("id", "workspaceId", "externalAddressNormalized", "linkedRecordObjectMetadataId", "linkedRecordId", "lastInboundAt", "pendingAt") VALUES ($1, $2, $3, NULL, NULL, now(), now())`,
        [conversationId, WORKSPACE_A_ID, PHONE_INPUT],
      );
      await physicalDataSource.query(
        `INSERT INTO "core"."inconnectMessagingMessage" VALUES ($1, $2, $3, 'INBOUND')`,
        [messageId, WORKSPACE_A_ID, conversationId],
      );

      return { conversationId, messageId };
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
      ).resolves.toMatchObject({ state: 'LINKED_EXISTING' });

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
      const concurrentService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        globalWorkspaceOrmManager as never,
        coreQueryBuilderService as never,
        backgroundResolver,
        unusedAutoCreateAuthorityService as never,
        unusedAutomationRecordCreateService as never,
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
        'LINKED_EXISTING',
      ]);
      expect((await getLinkState()).events).toHaveLength(1);
    });

    it('preserves a human link that commits before the system lock', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      const humanWinningGlobalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: async () => {
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

          return physicalDataSource;
        },
      };
      const humanRaceService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        humanWinningGlobalWorkspaceOrmManager as never,
        coreQueryBuilderService as never,
        backgroundResolver,
        unusedAutoCreateAuthorityService as never,
        unusedAutomationRecordCreateService as never,
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
    });

    it('rejects a stale target whose phone changes before final revalidation', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      const staleGlobalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: async () => {
          await physicalDataSource.query(
            `UPDATE "${WORKSPACE_A_SCHEMA}"."_contact" SET "mobilePhonePrimaryPhoneNumber" = '5514559999' WHERE "id" = $1`,
            [RECORD_A_ID],
          );

          return physicalDataSource;
        },
      };
      const staleService = new InconnectMessagingInboundAutoLinkService(
        serviceDataSource as never,
        staleGlobalWorkspaceOrmManager as never,
        coreQueryBuilderService as never,
        backgroundResolver,
        unusedAutoCreateAuthorityService as never,
        unusedAutomationRecordCreateService as never,
      );

      await expect(
        staleService.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({
        state: 'NO_MATCH_AUTO_CREATE_DISABLED',
        publicationRequest: null,
      });

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
          const queryRunner = manager.queryRunner;

          if (queryRunner === undefined) {
            throw new Error('Transaction QueryRunner is unavailable');
          }
          const resolution =
            await backgroundResolver.resolvePhoneIdentityForLink({
              queryRunner: queryRunner as WorkspaceQueryRunner,
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
      ).resolves.toEqual({
        state: 'NO_MATCH_AUTO_CREATE_DISABLED',
        publicationRequest: null,
      });
      expect((await getLinkState()).conversation.linkedRecordId).toBeNull();
    });

    it('creates and links one CRM record with owner, provenance, CRM events, and Messaging outbox in one transaction', async () => {
      await enableAutoCreate();
      const { createService, service } = createPhysicalAutoCreateHarness();

      await expect(
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toMatchObject({ state: 'CREATED_AND_LINKED' });

      const [record] = await physicalDataSource.query(
        `SELECT "id", "ownerId", "createdByWorkspaceMemberId", "updatedByWorkspaceMemberId" FROM "${WORKSPACE_A_SCHEMA}"."_contact"`,
      );
      const crmEvents = await physicalDataSource.query(
        `SELECT "recordId", "eventType" FROM "core"."inconnectMessagingCrmCreateEvent" ORDER BY "eventType"`,
      );
      const { conversation, events } = await getLinkState();

      expect(createService.execute).toHaveBeenCalledTimes(1);
      expect(record).toMatchObject({
        ownerId: OWNER_WORKSPACE_MEMBER_ID,
        createdByWorkspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
        updatedByWorkspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
      });
      expect(conversation).toMatchObject({
        linkedRecordObjectMetadataId: OBJECT_A_ID,
        linkedRecordId: record.id,
      });
      expect(crmEvents).toEqual([
        { recordId: record.id, eventType: 'CREATED' },
        { recordId: record.id, eventType: 'UPSERTED' },
      ]);
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

    it('serializes two Conversations with the same identity into one created CRM record', async () => {
      await enableAutoCreate();
      const secondInbound = await insertSecondInboundConversation();
      const { createService, service } = createPhysicalAutoCreateHarness();

      const results = await Promise.all([
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: secondInbound.messageId,
        }),
      ]);
      const records = await physicalDataSource.query(
        `SELECT "id" FROM "${WORKSPACE_A_SCHEMA}"."_contact"`,
      );
      const conversations = await physicalDataSource.query(
        `SELECT "id", "linkedRecordId" FROM "core"."inconnectMessagingConversation" ORDER BY "id"`,
      );
      const linkEvents = await physicalDataSource.query(
        `SELECT "aggregateId" FROM "core"."inconnectMessagingOutboxEvent" WHERE "eventType" = 'CONVERSATION_LINKED' ORDER BY "aggregateId"`,
      );

      expect(results.map(({ state }) => state).sort()).toEqual([
        'CREATED_AND_LINKED',
        'LINKED_EXISTING',
      ]);
      expect(createService.execute).toHaveBeenCalledTimes(1);
      expect(records).toHaveLength(1);
      expect(conversations).toHaveLength(2);
      expect(
        conversations.every(
          ({ linkedRecordId }: { linkedRecordId: string }) =>
            linkedRecordId === records[0].id,
        ),
      ).toBe(true);
      expect(linkEvents).toHaveLength(2);
    });

    it('serializes duplicate delivery for one Conversation into one create and one link event', async () => {
      await enableAutoCreate();
      const { createService, service } = createPhysicalAutoCreateHarness();

      const results = await Promise.all([
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ]);
      const records = await physicalDataSource.query(
        `SELECT "id" FROM "${WORKSPACE_A_SCHEMA}"."_contact"`,
      );

      expect(results.map(({ state }) => state).sort()).toEqual([
        'ALREADY_LINKED',
        'CREATED_AND_LINKED',
      ]);
      expect(createService.execute).toHaveBeenCalledTimes(1);
      expect(records).toHaveLength(1);
      expect((await getLinkState()).events).toHaveLength(1);
    });

    it('recovers one physical unique race in a fresh transaction and links the human-created record', async () => {
      await enableAutoCreate();
      let signalInsertReached: (() => void) | undefined;
      const insertReached = new Promise<void>((resolve) => {
        signalInsertReached = resolve;
      });
      let releaseInsert: (() => void) | undefined;
      const waitForHumanInsert = new Promise<void>((resolve) => {
        releaseInsert = resolve;
      });
      const { createService, service } = createPhysicalAutoCreateHarness({
        beforeInsert: async () => {
          signalInsertReached?.();
          await waitForHumanInsert;
        },
      });
      const attempt = service.attemptForInboundMessage({
        workspaceId: WORKSPACE_A_ID,
        messageId: MESSAGE_ID,
      });

      await insertReached;
      await insertPhoneRecord({ recordId: HUMAN_RECORD_ID });
      releaseInsert?.();

      await expect(attempt).resolves.toMatchObject({
        state: 'LINKED_EXISTING',
      });

      const { conversation, events } = await getLinkState();
      const crmEvents = await physicalDataSource.query(
        `SELECT "id" FROM "core"."inconnectMessagingCrmCreateEvent"`,
      );

      expect(createService.execute).toHaveBeenCalledTimes(1);
      expect(conversation.linkedRecordId).toBe(HUMAN_RECORD_ID);
      expect(events).toHaveLength(1);
      expect(crmEvents).toHaveLength(0);
    });

    it('stops unassigned after one unique recovery when only a soft-deleted record owns the identity', async () => {
      await enableAutoCreate();
      await physicalDataSource.query(
        `INSERT INTO "${WORKSPACE_A_SCHEMA}"."_contact" ("id", "deletedAt", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode", "mobilePhonePrimaryPhoneNumber") VALUES ($1, now(), 'MX', '+52', '5514552571')`,
        [RECORD_A_ID],
      );
      const { createService, service } = createPhysicalAutoCreateHarness();

      await expect(
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_A_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({
        state: 'SOFT_DELETED_UNIQUE_CONFLICT',
        publicationRequest: null,
      });

      expect(createService.execute).toHaveBeenCalledTimes(1);
      expect((await getLinkState()).conversation.linkedRecordId).toBeNull();
      expect((await getLinkState()).events).toHaveLength(0);
    });

    it('rolls back the CRM record and its events when the link outbox insert fails', async () => {
      await enableAutoCreate();
      await physicalDataSource.query(
        `ALTER TABLE "core"."inconnectMessagingOutboxEvent" ADD CONSTRAINT "CHK_REJECT_PHYSICAL_LINK_EVENT" CHECK ("eventType" <> 'CONVERSATION_LINKED')`,
      );
      const { service } = createPhysicalAutoCreateHarness();

      try {
        await expect(
          service.attemptForInboundMessage({
            workspaceId: WORKSPACE_A_ID,
            messageId: MESSAGE_ID,
          }),
        ).rejects.toThrow();
      } finally {
        await physicalDataSource.query(
          `ALTER TABLE "core"."inconnectMessagingOutboxEvent" DROP CONSTRAINT "CHK_REJECT_PHYSICAL_LINK_EVENT"`,
        );
      }

      const records = await physicalDataSource.query(
        `SELECT "id" FROM "${WORKSPACE_A_SCHEMA}"."_contact"`,
      );
      const crmEvents = await physicalDataSource.query(
        `SELECT "id" FROM "core"."inconnectMessagingCrmCreateEvent"`,
      );

      expect(records).toHaveLength(0);
      expect(crmEvents).toHaveLength(0);
      expect((await getLinkState()).conversation.linkedRecordId).toBeNull();
      expect((await getLinkState()).events).toHaveLength(0);
    });

    it('leaves ambiguous records unassigned without arbitrary selection', async () => {
      await insertPhoneRecord({ recordId: RECORD_A_ID });
      await insertPhoneRecord({
        recordId: RECORD_A_DUPLICATE_ID,
        identityField: 'alternatePhone',
      });

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
