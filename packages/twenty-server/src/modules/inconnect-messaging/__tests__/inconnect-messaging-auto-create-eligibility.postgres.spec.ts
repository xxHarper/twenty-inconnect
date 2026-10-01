import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingAutoCreatePrimaryStatusDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import {
  INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON,
  InconnectMessagingAutoCreateEligibilityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { type PrimaryPhoneIdentityEvaluation } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const ANCHOR_ID = '33333333-3333-4333-8333-333333333333';
const PRIMARY_FIELD_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_FIELD_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_MEMBER_OBJECT_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_ROLE_ID = '77777777-7777-4777-8777-777777777777';
const DATABASE_SCHEMA = 'workspace_f13c1b_physical';

const disposableDatabaseName =
  process.env.INCONNECT_MESSAGING_AUTO_CREATE_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres =
  disposableDatabaseName === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith('inconnect_f13c1b_validation_')
  ) {
    throw new Error(
      'A named INCONNECT F13C.1B disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

const configuration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: ANCHOR_ID,
  autoCreateEnabled: true,
  autoCreateAnchorObjectMetadataId: ANCHOR_ID,
  autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
  autoCreateOwnerRoleId: OWNER_ROLE_ID,
  autoCreateLabelPolicy: 'OMIT',
} as InconnectMessagingConfigurationEntity;

const anchorObject = {
  id: ANCHOR_ID,
  workspaceId: WORKSPACE_ID,
  isActive: true,
  isRemote: false,
} as ObjectMetadataEntity;

const primaryPhoneIdentity: PrimaryPhoneIdentityEvaluation = {
  summary: {
    status: InconnectMessagingAutoCreatePrimaryStatusDTO.VALID,
    fieldMetadataId: PRIMARY_FIELD_ID,
    label: 'Mobile phone',
    type: FieldMetadataType.PHONES,
    isActive: true,
  },
  issue: null,
};

const field = (
  values: Partial<FieldMetadataEntity> &
    Pick<FieldMetadataEntity, 'id' | 'name' | 'type'>,
): FieldMetadataEntity =>
  ({
    workspaceId: WORKSPACE_ID,
    objectMetadataId: ANCHOR_ID,
    label: values.name,
    isActive: true,
    isNullable: true,
    isSystem: false,
    isSystemSideEffect: false,
    defaultValue: null,
    settings: null,
    relationTargetObjectMetadataId: null,
    ...values,
  }) as FieldMetadataEntity;

const baseFields = [
  field({
    id: '88888888-8888-4888-8888-888888888888',
    name: 'id',
    type: FieldMetadataType.UUID,
    isNullable: false,
    isSystem: true,
    isSystemSideEffect: true,
  }),
  field({
    id: PRIMARY_FIELD_ID,
    name: 'mobilePhone',
    type: FieldMetadataType.PHONES,
  }),
  field({
    id: OWNER_FIELD_ID,
    name: 'owner',
    type: FieldMetadataType.RELATION,
    relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
    settings: { relationType: RelationType.MANY_TO_ONE },
  }),
  field({
    id: '99999999-9999-4999-8999-999999999999',
    name: 'notes',
    type: FieldMetadataType.TEXT,
  }),
  field({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'stage',
    type: FieldMetadataType.SELECT,
    isNullable: false,
    defaultValue: "'NEW'",
  }),
];

describeWithDisposablePostgres(
  'auto-create eligibility PostgreSQL physical boundary',
  () => {
    let physicalDataSource: DataSource;
    let fields = baseFields;
    let service: InconnectMessagingAutoCreateEligibilityService;

    const evaluate = (currentAnchor = anchorObject) =>
      service.evaluate({
        manager: {
          getRepository: jest.fn((entity) => {
            if (entity === WorkspaceEntity) {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: WORKSPACE_ID,
                  databaseSchema: DATABASE_SCHEMA,
                }),
              };
            }
            if (entity === FieldMetadataEntity) {
              return { find: jest.fn().mockResolvedValue(fields) };
            }
            if (entity === ObjectMetadataEntity) {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: WORKSPACE_MEMBER_OBJECT_ID,
                  workspaceId: WORKSPACE_ID,
                }),
              };
            }
            throw new Error(`Unexpected repository ${entity.name}`);
          }),
          query: physicalDataSource.query.bind(physicalDataSource),
        } as never,
        configuration,
        anchorObject: currentAnchor,
        ownerRoleIsValid: true,
        primaryPhoneIdentity,
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

      service = new InconnectMessagingAutoCreateEligibilityService({
        getOrRecompute: jest.fn().mockResolvedValue({
          flatObjectMetadataMaps: {
            universalIdentifierById: { [ANCHOR_ID]: 'anchor-universal-id' },
            byUniversalIdentifier: {
              'anchor-universal-id': {
                id: ANCHOR_ID,
                workspaceId: WORKSPACE_ID,
                nameSingular: 'contact',
                applicationUniversalIdentifier: 'custom-application',
              },
            },
          },
        }),
      } as never);
    });

    beforeEach(async () => {
      fields = baseFields;
      await physicalDataSource.query(
        `DROP SCHEMA IF EXISTS "${DATABASE_SCHEMA}" CASCADE`,
      );
      await physicalDataSource.query(`CREATE SCHEMA "${DATABASE_SCHEMA}"`);
      await physicalDataSource.query(`
        CREATE TABLE "${DATABASE_SCHEMA}"."_contact" (
          "id" uuid NOT NULL,
          "deletedAt" timestamptz,
          "mobilePhonePrimaryPhoneNumber" text,
          "mobilePhonePrimaryPhoneCountryCode" text,
          "mobilePhonePrimaryPhoneCallingCode" text,
          "mobilePhoneAdditionalPhones" jsonb,
          "ownerId" uuid,
          "notes" text,
          "stage" text NOT NULL DEFAULT 'NEW',
          "unrelatedOne" text,
          "unrelatedTwo" text,
          "unrelatedThree" text
        )
      `);
    });

    afterAll(async () => {
      if (physicalDataSource.isInitialized) {
        await physicalDataSource.destroy();
      }
    });

    it('accepts an exact unconditional UNIQUE phone composite', async () => {
      await physicalDataSource.query(`
        CREATE UNIQUE INDEX "unique_phone"
        ON "${DATABASE_SCHEMA}"."_contact" (
          "mobilePhonePrimaryPhoneNumber",
          "mobilePhonePrimaryPhoneCountryCode",
          "mobilePhonePrimaryPhoneCallingCode"
        )
      `);

      await expect(evaluate()).resolves.toEqual({
        status: 'ELIGIBLE',
        reason: null,
        phoneUniquenessScope: 'ALL_ROWS',
      });
    });

    it.each([
      [
        'non-unique exact columns',
        `CREATE INDEX "phone_index" ON "${DATABASE_SCHEMA}"."_contact" ("mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode")`,
      ],
      [
        'incomplete unique columns',
        `CREATE UNIQUE INDEX "phone_index" ON "${DATABASE_SCHEMA}"."_contact" ("mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode")`,
      ],
      [
        'unrelated unique columns',
        `CREATE UNIQUE INDEX "phone_index" ON "${DATABASE_SCHEMA}"."_contact" ("unrelatedOne", "unrelatedTwo", "unrelatedThree")`,
      ],
    ])('rejects %s', async (_, indexDdl) => {
      await physicalDataSource.query(indexDdl);

      const result = await evaluate();

      expect(result.reason).toBe(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PHONE_UNIQUENESS_NOT_GUARANTEED,
      );
    });

    it('rejects a required unsupported field without a default', async () => {
      await physicalDataSource.query(
        `ALTER TABLE "${DATABASE_SCHEMA}"."_contact" ADD COLUMN "requiredRelationId" uuid NOT NULL`,
      );
      await physicalDataSource.query(`
        CREATE UNIQUE INDEX "unique_phone"
        ON "${DATABASE_SCHEMA}"."_contact" ("mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode")
      `);
      fields = [
        ...baseFields,
        field({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'requiredRelation',
          type: FieldMetadataType.RELATION,
          isNullable: false,
          relationTargetObjectMetadataId: ANCHOR_ID,
          settings: { relationType: RelationType.MANY_TO_ONE },
        }),
      ];

      const result = await evaluate();

      expect(result.reason).toBe(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_REQUIRED_FIELD,
      );
    });

    it('keeps nullable and defaulted additional fields eligible', async () => {
      await physicalDataSource.query(`
        CREATE UNIQUE INDEX "unique_phone"
        ON "${DATABASE_SCHEMA}"."_contact" ("mobilePhonePrimaryPhoneCallingCode", "mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode")
      `);

      expect((await evaluate()).status).toBe('ELIGIBLE');
    });

    it('recognizes soft-delete-inclusive uniqueness and PostgreSQL blocks a deleted duplicate', async () => {
      await physicalDataSource.query(`
        CREATE UNIQUE INDEX "unique_phone_all_rows"
        ON "${DATABASE_SCHEMA}"."_contact" ("mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode")
      `);
      await physicalDataSource.query(
        `INSERT INTO "${DATABASE_SCHEMA}"."_contact" ("id", "deletedAt", "mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode") VALUES ($1, now(), '5512345678', 'MX', '+52')`,
        ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      );

      const eligibility = await evaluate();

      expect(eligibility).toEqual({
        status: 'ELIGIBLE',
        reason: null,
        phoneUniquenessScope: 'ALL_ROWS',
      });
      await expect(
        physicalDataSource.query(
          `INSERT INTO "${DATABASE_SCHEMA}"."_contact" ("id", "mobilePhonePrimaryPhoneNumber", "mobilePhonePrimaryPhoneCountryCode", "mobilePhonePrimaryPhoneCallingCode") VALUES ($1, '5512345678', 'MX', '+52')`,
          ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it.each([
      ['wrong workspace', { ...anchorObject, workspaceId: OTHER_WORKSPACE_ID }],
      [
        'wrong object',
        { ...anchorObject, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      ],
    ])('fails closed for %s metadata', async (_, invalidAnchor) => {
      const result = await evaluate(invalidAnchor as ObjectMetadataEntity);

      expect(result.reason).toBe(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_ANCHOR,
      );
    });
  },
);
