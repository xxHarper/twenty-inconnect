import { FieldMetadataType } from 'twenty-shared/types';

import {
  InconnectMessagingPhoneIdentityFieldRoleDTO,
  type InconnectMessagingPhoneIdentityFieldInput,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-phone-identity.dto';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingPhoneIdentityConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-configuration.service';

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
};
const fieldA = {
  id: FIELD_A_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.PHONES,
  name: 'mobilePhone',
  label: 'Mobile phone',
  isActive: true,
};
const fieldB = {
  ...fieldA,
  id: FIELD_B_ID,
  name: 'officePhone',
  label: 'Office phone',
};
const primary = (
  fieldMetadataId = FIELD_A_ID,
): InconnectMessagingPhoneIdentityFieldInput => ({
  fieldMetadataId,
  role: InconnectMessagingPhoneIdentityFieldRoleDTO.PRIMARY,
});
const matchOnly = (
  fieldMetadataId = FIELD_B_ID,
): InconnectMessagingPhoneIdentityFieldInput => ({
  fieldMetadataId,
  role: InconnectMessagingPhoneIdentityFieldRoleDTO.MATCH_ONLY,
});

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
  const phoneFieldRepository = {
    delete: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    find: jest
      .fn()
      .mockImplementation(
        async () => phoneFieldRepository.insert.mock.calls[0]?.[0] ?? [],
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
      if (entity === InconnectMessagingPhoneIdentityFieldEntity) {
        return phoneFieldRepository;
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
    service: new InconnectMessagingPhoneIdentityConfigurationService(
      dataSource as never,
      authorizationService as never,
    ),
    configurationRepository,
    phoneFieldRepository,
    dataSource,
  };
};

describe('InconnectMessagingPhoneIdentityConfigurationService', () => {
  it('requires management authority rather than runtime read authority', async () => {
    const { service, dataSource } = buildService({ canManage: false });

    await expect(
      service.replaceConfiguration({ authContext, fields: [] }),
    ).rejects.toThrow('Messaging management permission is required');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts an empty configuration that disables resolution', async () => {
    const { service, phoneFieldRepository } = buildService({
      selectedFields: [],
    });

    const result = await service.replaceConfiguration({
      authContext,
      fields: [],
    });

    expect(phoneFieldRepository.delete).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
    });
    expect(phoneFieldRepository.insert).not.toHaveBeenCalled();
    expect(result.fields).toEqual([]);
  });

  it('persists one PRIMARY plus ordered MATCH_ONLY fields under the locked anchor', async () => {
    const { service, configurationRepository, phoneFieldRepository } =
      buildService();

    const result = await service.replaceConfiguration({
      authContext,
      fields: [primary(), matchOnly()],
    });

    expect(configurationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(phoneFieldRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        fieldMetadataId: FIELD_A_ID,
        role: 'PRIMARY',
        ordinal: 0,
      }),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        fieldMetadataId: FIELD_B_ID,
        role: 'MATCH_ONLY',
        ordinal: 1,
      }),
    ]);
    expect(result.fields.map(({ fieldMetadataId }) => fieldMetadataId)).toEqual(
      [FIELD_A_ID, FIELD_B_ID],
    );
  });

  it.each([
    ['zero PRIMARY fields', [matchOnly()]],
    ['two PRIMARY fields', [primary(), primary(FIELD_B_ID)]],
    ['a duplicate field', [primary(), matchOnly(FIELD_A_ID)]],
  ])('rejects %s before opening a transaction', async (_, fields) => {
    const { service, dataSource } = buildService();

    await expect(
      service.replaceConfiguration({ authContext, fields }),
    ).rejects.toThrow();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['another workspace', { ...fieldA, workspaceId: 'other-workspace' }],
    ['another object', { ...fieldA, objectMetadataId: 'other-object' }],
    ['a non-PHONES field', { ...fieldA, type: FieldMetadataType.TEXT }],
    ['an inactive field', { ...fieldA, isActive: false }],
  ])('rejects %s without deleting the prior set', async (_, badField) => {
    const { service, phoneFieldRepository } = buildService({
      selectedFields: [badField],
    });

    await expect(
      service.replaceConfiguration({ authContext, fields: [primary()] }),
    ).rejects.toThrow('active PHONES fields of the configured anchor');
    expect(phoneFieldRepository.delete).not.toHaveBeenCalled();
  });
});
