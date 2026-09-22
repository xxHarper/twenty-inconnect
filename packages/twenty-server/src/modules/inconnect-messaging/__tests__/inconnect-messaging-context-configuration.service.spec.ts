import { FieldMetadataType } from 'twenty-shared/types';

import { INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import { InconnectMessagingContextFieldEntity } from 'src/modules/inconnect-messaging/entities/context-field.entity';
import { InconnectMessagingContextConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context-configuration.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '10101010-1111-4111-8111-111111111111';
const OBJECT_ID = '20202020-2222-4222-8222-222222222222';
const FIELD_A_ID = '30303030-3333-4333-8333-333333333333';
const FIELD_B_ID = '40404040-4444-4444-8444-444444444444';
const authContext = { workspace: { id: WORKSPACE_ID } } as never;
const configuration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: OBJECT_ID,
};
const anchorObject = {
  id: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  labelSingular: 'Contact',
  labelIdentifierFieldMetadataId: FIELD_A_ID,
};
const fieldA = {
  id: FIELD_A_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.TEXT,
  name: 'name',
  label: 'Name',
  options: null,
  isActive: true,
};
const fieldB = {
  id: FIELD_B_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.DATE,
  name: 'renewalDate',
  label: 'Renewal date',
  options: null,
  isActive: true,
};

const buildService = ({
  canManage = true,
  selectedFields = [fieldA, fieldB],
}: {
  canManage?: boolean;
  selectedFields?: Array<Record<string, unknown>>;
} = {}) => {
  const configurationRepository = {
    findOne: jest.fn().mockResolvedValue(configuration),
  };
  const objectRepository = {
    findOne: jest.fn().mockResolvedValue(anchorObject),
  };
  const fieldRepository = {
    find: jest.fn().mockResolvedValue(selectedFields),
  };
  const contextFieldRepository = {
    delete: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    find: jest
      .fn()
      .mockImplementation(
        async () =>
          contextFieldRepository.insert.mock.calls[0]?.[0]?.map(
            (row: Record<string, unknown>) => row,
          ) ?? [],
      ),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity.name === 'InconnectMessagingConfigurationEntity') {
        return configurationRepository;
      }
      if (entity.name === 'ObjectMetadataEntity') {
        return objectRepository;
      }
      if (entity.name === 'FieldMetadataEntity') {
        return fieldRepository;
      }
      if (entity === InconnectMessagingContextFieldEntity) {
        return contextFieldRepository;
      }

      throw new Error(`Unexpected repository ${entity.name}`);
    }),
  };
  const dataSource = {
    manager,
    transaction: jest.fn(async (callback) => callback(manager)),
  };
  const authorizationService = {
    canManageMessaging: jest.fn().mockResolvedValue(canManage),
  };

  return {
    service: new InconnectMessagingContextConfigurationService(
      dataSource as never,
      authorizationService as never,
    ),
    configurationRepository,
    fieldRepository,
    contextFieldRepository,
    dataSource,
  };
};

describe('InconnectMessagingContextConfigurationService', () => {
  it('requires current MANAGE_INCONNECT_MESSAGING authority', async () => {
    const { service, dataSource } = buildService({ canManage: false });

    await expect(
      service.replaceConfiguration({
        authContext,
        fieldMetadataIds: [],
      }),
    ).rejects.toThrow('Messaging management permission is required');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts an empty configuration', async () => {
    const { service, contextFieldRepository } = buildService({
      selectedFields: [],
    });

    const result = await service.replaceConfiguration({
      authContext,
      fieldMetadataIds: [],
    });

    expect(contextFieldRepository.delete).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
    });
    expect(contextFieldRepository.insert).not.toHaveBeenCalled();
    expect(result.fields).toEqual([]);
  });

  it('atomically replaces an ordered list with server-derived ordinals and authority', async () => {
    const { service, configurationRepository, contextFieldRepository } =
      buildService();

    const result = await service.replaceConfiguration({
      authContext,
      fieldMetadataIds: [FIELD_B_ID, FIELD_A_ID],
    });

    expect(configurationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(contextFieldRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        fieldMetadataId: FIELD_B_ID,
        ordinal: 0,
      }),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        fieldMetadataId: FIELD_A_ID,
        ordinal: 1,
      }),
    ]);
    expect(
      contextFieldRepository.insert.mock.calls[0][0].every(
        (row: Record<string, unknown>) =>
          !Object.prototype.hasOwnProperty.call(
            row,
            'messagingConfigurationId',
          ),
      ),
    ).toBe(true);
    expect(result.fields.map((field) => field.fieldMetadataId)).toEqual([
      FIELD_B_ID,
      FIELD_A_ID,
    ]);
  });

  it('rejects duplicates and an input over the central maximum before mutation', async () => {
    const duplicate = buildService();

    await expect(
      duplicate.service.replaceConfiguration({
        authContext,
        fieldMetadataIds: [FIELD_A_ID, FIELD_A_ID],
      }),
    ).rejects.toThrow('Context fields must be unique');
    expect(duplicate.dataSource.transaction).not.toHaveBeenCalled();

    const tooMany = buildService();

    await expect(
      tooMany.service.replaceConfiguration({
        authContext,
        fieldMetadataIds: Array.from(
          { length: INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS + 1 },
          (_, index) => `${index}`,
        ),
      }),
    ).rejects.toThrow(`At most ${INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS}`);
    expect(tooMany.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts exactly the central maximum of valid fields', async () => {
    const fields = Array.from(
      { length: INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS },
      (_, index) => ({
        ...fieldA,
        id: `30303030-3333-4333-8333-${String(index).padStart(12, '0')}`,
        name: `field${index}`,
        label: `Field ${index}`,
      }),
    );
    const { service, contextFieldRepository } = buildService({
      selectedFields: fields,
    });

    await expect(
      service.replaceConfiguration({
        authContext,
        fieldMetadataIds: fields.map(({ id }) => id),
      }),
    ).resolves.toBeDefined();
    expect(contextFieldRepository.insert.mock.calls[0][0]).toHaveLength(
      INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS,
    );
  });

  it.each([
    ['another workspace', { ...fieldA, workspaceId: 'other-workspace' }],
    ['another object', { ...fieldA, objectMetadataId: 'other-object' }],
    [
      'an unsupported relation',
      { ...fieldA, type: FieldMetadataType.RELATION },
    ],
  ])(
    'rejects %s without deleting the previous configuration',
    async (_, badField) => {
      const { service, contextFieldRepository } = buildService({
        selectedFields: [badField],
      });

      await expect(
        service.replaceConfiguration({
          authContext,
          fieldMetadataIds: [FIELD_A_ID],
        }),
      ).rejects.toThrow('active supported fields of the configured anchor');
      expect(contextFieldRepository.delete).not.toHaveBeenCalled();
      expect(contextFieldRepository.insert).not.toHaveBeenCalled();
    },
  );
});
