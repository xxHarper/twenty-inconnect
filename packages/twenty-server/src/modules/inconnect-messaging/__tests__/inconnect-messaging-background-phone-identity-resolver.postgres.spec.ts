import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  InconnectMessagingBackgroundPhoneIdentityResolverService,
  InconnectMessagingPhoneIdentityResolverService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';

const WORKSPACE_A_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_A_ID = '33333333-3333-4333-8333-333333333333';
const OBJECT_B_ID = '44444444-4444-4444-8444-444444444444';
const FIELD_A_PRIMARY_ID = '55555555-5555-4555-8555-555555555555';
const FIELD_A_MATCH_ONLY_ID = '66666666-6666-4666-8666-666666666666';
const FIELD_B_PRIMARY_ID = '77777777-7777-4777-8777-777777777777';
const RECORD_A_ID = '88888888-8888-4888-8888-888888888888';
const RECORD_A_DUPLICATE_ID = '99999999-9999-4999-8999-999999999999';
const RECORD_B_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_A_SCHEMA = 'workspace_f13b2a_a';
const WORKSPACE_B_SCHEMA = 'workspace_f13b2a_b';
const PHONE_INPUT = '+525514552571';

const disposableDatabaseName =
  process.env.INCONNECT_MESSAGING_PHONE_IDENTITY_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres =
  disposableDatabaseName === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith('inconnect_f13b2a_validation_')
  ) {
    throw new Error(
      'A named INCONNECT Fase 13B.2A disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

const phoneField = ({
  id,
  workspaceId,
  objectMetadataId,
  name,
}: {
  id: string;
  workspaceId: string;
  objectMetadataId: string;
  name: string;
}) => ({
  id,
  workspaceId,
  objectMetadataId,
  name,
  type: FieldMetadataType.PHONES,
  isActive: true,
});

describeWithDisposablePostgres(
  'background phone identity resolution PostgreSQL boundary',
  () => {
    let physicalDataSource: DataSource;
    let backgroundService: InconnectMessagingBackgroundPhoneIdentityResolverService;
    let humanService: InconnectMessagingPhoneIdentityResolverService;

    const primaryFieldA = phoneField({
      id: FIELD_A_PRIMARY_ID,
      workspaceId: WORKSPACE_A_ID,
      objectMetadataId: OBJECT_A_ID,
      name: 'mobilePhone',
    });
    const matchOnlyFieldA = phoneField({
      id: FIELD_A_MATCH_ONLY_ID,
      workspaceId: WORKSPACE_A_ID,
      objectMetadataId: OBJECT_A_ID,
      name: 'officePhone',
    });
    const primaryFieldB = phoneField({
      id: FIELD_B_PRIMARY_ID,
      workspaceId: WORKSPACE_B_ID,
      objectMetadataId: OBJECT_B_ID,
      name: 'mobilePhone',
    });
    const configuredFieldsByWorkspace = new Map([
      [
        WORKSPACE_A_ID,
        [
          {
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            fieldMetadataId: FIELD_A_PRIMARY_ID,
            role: 'PRIMARY',
            ordinal: 0,
          },
          {
            workspaceId: WORKSPACE_A_ID,
            objectMetadataId: OBJECT_A_ID,
            fieldMetadataId: FIELD_A_MATCH_ONLY_ID,
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
            fieldMetadataId: FIELD_B_PRIMARY_ID,
            role: 'PRIMARY',
            ordinal: 0,
          },
        ],
      ],
    ]);
    const fieldMetadataByWorkspace = new Map([
      [WORKSPACE_A_ID, [primaryFieldA, matchOnlyFieldA]],
      [WORKSPACE_B_ID, [primaryFieldB]],
    ]);
    const workspaceById = new Map([
      [
        WORKSPACE_A_ID,
        {
          id: WORKSPACE_A_ID,
          databaseSchema: WORKSPACE_A_SCHEMA,
        },
      ],
      [
        WORKSPACE_B_ID,
        {
          id: WORKSPACE_B_ID,
          databaseSchema: WORKSPACE_B_SCHEMA,
        },
      ],
    ]);
    const objectMetadataByWorkspace = new Map([
      [WORKSPACE_A_ID, { id: OBJECT_A_ID, workspaceId: WORKSPACE_A_ID }],
      [WORKSPACE_B_ID, { id: OBJECT_B_ID, workspaceId: WORKSPACE_B_ID }],
    ]);

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

      for (const schema of [WORKSPACE_A_SCHEMA, WORKSPACE_B_SCHEMA]) {
        await physicalDataSource.query(`CREATE SCHEMA "${schema}"`);
        await physicalDataSource.query(`
          CREATE TABLE "${schema}"."_contact" (
            "id" uuid PRIMARY KEY,
            "deletedAt" TIMESTAMP WITH TIME ZONE,
            "mobilePhonePrimaryPhoneCountryCode" character varying,
            "mobilePhonePrimaryPhoneCallingCode" character varying,
            "mobilePhonePrimaryPhoneNumber" character varying,
            "officePhonePrimaryPhoneCountryCode" character varying,
            "officePhonePrimaryPhoneCallingCode" character varying,
            "officePhonePrimaryPhoneNumber" character varying
          )
        `);
      }

      const configurationRepository = {
        findOne: jest.fn(async ({ where: { workspaceId } }) => {
          const objectMetadata = objectMetadataByWorkspace.get(workspaceId);

          return objectMetadata === undefined
            ? null
            : {
                workspaceId,
                anchorObjectMetadataId: objectMetadata.id,
              };
        }),
      };
      const phoneIdentityFieldRepository = {
        find: jest.fn(
          async ({ where: { workspaceId } }) =>
            configuredFieldsByWorkspace.get(workspaceId) ?? [],
        ),
      };
      const objectMetadataRepository = {
        findOne: jest.fn(async ({ where: { workspaceId, id } }) => {
          const objectMetadata = objectMetadataByWorkspace.get(workspaceId);

          return objectMetadata?.id === id ? objectMetadata : null;
        }),
      };
      const fieldMetadataRepository = {
        find: jest.fn(
          async ({ where: { workspaceId } }) =>
            fieldMetadataByWorkspace.get(workspaceId) ?? [],
        ),
      };
      const workspaceRepository = {
        findOne: jest.fn(
          async ({ where: { id } }) => workspaceById.get(id) ?? null,
        ),
      };
      const repositories = new Map<unknown, unknown>([
        [InconnectMessagingConfigurationEntity, configurationRepository],
        [
          InconnectMessagingPhoneIdentityFieldEntity,
          phoneIdentityFieldRepository,
        ],
        [ObjectMetadataEntity, objectMetadataRepository],
        [FieldMetadataEntity, fieldMetadataRepository],
        [WorkspaceEntity, workspaceRepository],
      ]);
      const serviceDataSource = {
        manager: {
          getRepository: jest.fn((entity) => repositories.get(entity)),
        },
        createQueryBuilder:
          physicalDataSource.createQueryBuilder.bind(physicalDataSource),
      };
      const workspaceCacheService = {
        getOrRecompute: jest.fn(async (workspaceId) => {
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
      const authorizationService = {
        filterReadableFieldMetadataIds: jest
          .fn()
          .mockResolvedValue(
            new Set([FIELD_A_PRIMARY_ID, FIELD_A_MATCH_ONLY_ID]),
          ),
      };
      const recordAccessAuthorizationService = {
        applyReadScopeToQueryBuilder: jest.fn(async ({ queryBuilder }) => {
          queryBuilder.andWhere('1 = 0');

          return { kind: 'denied' };
        }),
      };

      backgroundService =
        new InconnectMessagingBackgroundPhoneIdentityResolverService(
          serviceDataSource as never,
          workspaceCacheService as never,
        );
      humanService = new InconnectMessagingPhoneIdentityResolverService(
        serviceDataSource as never,
        authorizationService as never,
        recordAccessAuthorizationService as never,
        workspaceCacheService as never,
      );
    });

    afterAll(async () => {
      if (physicalDataSource.isInitialized) {
        await physicalDataSource.destroy();
      }
    });

    beforeEach(async () => {
      await physicalDataSource.query(
        `TRUNCATE "${WORKSPACE_A_SCHEMA}"."_contact", "${WORKSPACE_B_SCHEMA}"."_contact"`,
      );
    });

    const insertPhoneRecord = async ({
      schema,
      recordId,
      deleted = false,
      alsoMatchOffice = false,
    }: {
      schema: string;
      recordId: string;
      deleted?: boolean;
      alsoMatchOffice?: boolean;
    }) => {
      await physicalDataSource.query(
        `
          INSERT INTO "${schema}"."_contact" (
            "id",
            "deletedAt",
            "mobilePhonePrimaryPhoneCountryCode",
            "mobilePhonePrimaryPhoneCallingCode",
            "mobilePhonePrimaryPhoneNumber",
            "officePhonePrimaryPhoneCountryCode",
            "officePhonePrimaryPhoneCallingCode",
            "officePhonePrimaryPhoneNumber"
          ) VALUES ($1, $2, 'MX', '+52', '5514552571', $3, $4, $5)
        `,
        [
          recordId,
          deleted ? new Date('2026-09-28T00:00:00.000Z') : null,
          alsoMatchOffice ? 'MX' : null,
          alsoMatchOffice ? '+52' : null,
          alsoMatchOffice ? '5514552571' : null,
        ],
      );
    };

    it('classifies only exact active records in the trusted workspace schema', async () => {
      await insertPhoneRecord({
        schema: WORKSPACE_B_SCHEMA,
        recordId: RECORD_B_ID,
      });

      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_A_ID,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'NO_MATCH' });

      await insertPhoneRecord({
        schema: WORKSPACE_A_SCHEMA,
        recordId: RECORD_A_ID,
        alsoMatchOffice: true,
      });

      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_A_ID,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });

      await insertPhoneRecord({
        schema: WORKSPACE_A_SCHEMA,
        recordId: RECORD_A_DUPLICATE_ID,
      });

      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_A_ID,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'AMBIGUOUS' });
    });

    it('excludes soft-deleted matches', async () => {
      await insertPhoneRecord({
        schema: WORKSPACE_A_SCHEMA,
        recordId: RECORD_A_ID,
        deleted: true,
      });

      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_A_ID,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'NO_MATCH' });
    });

    it('preserves the intentional human versus background authority difference', async () => {
      await insertPhoneRecord({
        schema: WORKSPACE_A_SCHEMA,
        recordId: RECORD_A_ID,
      });

      await expect(
        humanService.resolvePhoneIdentity({
          authContext: {
            type: 'user',
            workspace: {
              id: WORKSPACE_A_ID,
              databaseSchema: WORKSPACE_A_SCHEMA,
            },
          } as never,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'NO_MATCH' });
      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_A_ID,
          input: PHONE_INPUT,
        }),
      ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
    });
  },
);
