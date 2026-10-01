import { FieldMetadataType } from 'twenty-shared/types';

import {
  InconnectMessagingAutoCreateLabelPolicyDTO,
  InconnectMessagingAutoCreateOwnerStrategyDTO,
  InconnectMessagingAutoCreatePrimaryStatusDTO,
  InconnectMessagingAutoCreateReadinessDTO,
  InconnectMessagingAutoCreateValidationIssueDTO,
  type InconnectMessagingAutoCreateConfigurationInput,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingAutoCreateConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-configuration.service';
import {
  INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON,
  type InconnectMessagingAutoCreateEligibilityResult,
  InconnectMessagingAutoCreateEligibilityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '10101010-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ANCHOR_ID = '20202020-2222-4222-8222-222222222222';
const OTHER_ANCHOR_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_FIELD_ID = '30303030-3333-4333-8333-333333333333';
const OWNER_ROLE_ID = '40404040-4444-4444-8444-444444444444';
const authContext = { workspace: { id: WORKSPACE_ID } } as never;

const autoCreateInput = (
  overrides: Partial<InconnectMessagingAutoCreateConfigurationInput> = {},
): InconnectMessagingAutoCreateConfigurationInput => ({
  enabled: true,
  ownerStrategy:
    InconnectMessagingAutoCreateOwnerStrategyDTO.UNIQUE_ACTIVE_MEMBER_OF_ROLE,
  ownerRoleId: OWNER_ROLE_ID,
  labelPolicy: InconnectMessagingAutoCreateLabelPolicyDTO.OMIT,
  ...overrides,
});

const baseConfiguration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: ANCHOR_ID,
  autoCreateEnabled: false,
  autoCreateAnchorObjectMetadataId: null,
  autoCreateOwnerStrategy: null,
  autoCreateOwnerRoleId: null,
  autoCreateLabelPolicy: null,
};
const anchorObject = {
  id: ANCHOR_ID,
  workspaceId: WORKSPACE_ID,
  labelSingular: 'Contact',
  isActive: true,
};
const ownerRole = {
  id: OWNER_ROLE_ID,
  workspaceId: WORKSPACE_ID,
  label: 'Sales owner',
  canBeAssignedToUsers: true,
};
const primaryRow = {
  id: '50505050-5555-4555-8555-555555555555',
  workspaceId: WORKSPACE_ID,
  objectMetadataId: ANCHOR_ID,
  fieldMetadataId: PRIMARY_FIELD_ID,
  role: 'PRIMARY',
  ordinal: 0,
};
const primaryField = {
  id: PRIMARY_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: ANCHOR_ID,
  label: 'Mobile phone',
  type: FieldMetadataType.PHONES,
  isActive: true,
};

const buildService = ({
  canManage = true,
  configuration = baseConfiguration,
  anchor = anchorObject,
  roles = [ownerRole],
  roleForInput = ownerRole,
  primaryRows = [primaryRow],
  field = primaryField,
  eligibilityResult = {
    status: 'ELIGIBLE',
    reason: null,
    phoneUniquenessScope: 'ALL_ROWS',
  },
}: {
  canManage?: boolean;
  configuration?: Record<string, unknown>;
  anchor?: Record<string, unknown> | null;
  roles?: Array<Record<string, unknown>>;
  roleForInput?: Record<string, unknown> | null;
  primaryRows?: Array<Record<string, unknown>>;
  field?: Record<string, unknown> | null;
  eligibilityResult?: InconnectMessagingAutoCreateEligibilityResult;
} = {}) => {
  let storedConfiguration = { ...configuration };
  const configurationRepository = {
    findOne: jest.fn(async () => storedConfiguration),
    update: jest.fn(async (_criteria, update) => {
      storedConfiguration = { ...storedConfiguration, ...update };

      return { affected: 1 };
    }),
  };
  const objectRepository = {
    findOne: jest.fn().mockResolvedValue(anchor),
  };
  const roleRepository = {
    find: jest.fn().mockResolvedValue(roles),
    findOne: jest.fn().mockResolvedValue(roleForInput),
  };
  const phoneIdentityRepository = {
    find: jest.fn().mockResolvedValue(primaryRows),
  };
  const fieldRepository = {
    findOne: jest.fn().mockResolvedValue(field),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity.name === 'InconnectMessagingConfigurationEntity') {
        return configurationRepository;
      }
      if (entity.name === 'ObjectMetadataEntity') {
        return objectRepository;
      }
      if (entity.name === 'RoleEntity') {
        return roleRepository;
      }
      if (entity.name === 'InconnectMessagingPhoneIdentityFieldEntity') {
        return phoneIdentityRepository;
      }
      if (entity.name === 'FieldMetadataEntity') {
        return fieldRepository;
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
  const eligibilityService = new InconnectMessagingAutoCreateEligibilityService(
    {} as never,
  );
  const primaryValidatorService =
    new InconnectMessagingAutoCreatePrimaryValidatorService();

  jest
    .spyOn(eligibilityService, 'evaluate')
    .mockResolvedValue(eligibilityResult);

  return {
    service: new InconnectMessagingAutoCreateConfigurationService(
      dataSource as never,
      authorizationService as never,
      eligibilityService,
      primaryValidatorService,
    ),
    configurationRepository,
    dataSource,
  };
};

describe('InconnectMessagingAutoCreateConfigurationService', () => {
  it('treats the post-upgrade absent configuration as disabled', async () => {
    const { service } = buildService();

    const result = await service.getConfiguration({ authContext });

    expect(result.configuration).toBeNull();
    expect(result.readiness).toBe(
      InconnectMessagingAutoCreateReadinessDTO.DISABLED,
    );
    expect(result.validationIssues).toEqual([]);
    expect(result.effectiveEnabled).toBe(false);
  });

  it('reports future runtime readiness for an eligible configuration while keeping runtime disabled', async () => {
    const { service, configurationRepository } = buildService();

    const result = await service.replaceConfiguration({
      authContext,
      input: autoCreateInput(),
    });

    expect(configurationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(configurationRepository.update).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID },
      expect.objectContaining({
        autoCreateEnabled: true,
        autoCreateAnchorObjectMetadataId: ANCHOR_ID,
        autoCreateOwnerRoleId: OWNER_ROLE_ID,
      }),
    );
    expect(result.configuration).toEqual(
      expect.objectContaining({
        enabled: true,
        ownerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
        ownerRoleId: OWNER_ROLE_ID,
        labelPolicy: 'OMIT',
      }),
    );
    expect(result.readiness).toBe(
      InconnectMessagingAutoCreateReadinessDTO.READY_FOR_RUNTIME,
    );
    expect(result.validationIssues).toEqual([
      InconnectMessagingAutoCreateValidationIssueDTO.RUNTIME_NOT_IMPLEMENTED,
    ]);
    expect(result.effectiveEnabled).toBe(false);
  });

  it('requires human Messaging management authority', async () => {
    const { service, dataSource } = buildService({ canManage: false });

    await expect(
      service.replaceConfiguration({
        authContext,
        input: autoCreateInput(),
      }),
    ).rejects.toThrow('Messaging management permission is required');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'owner strategy',
      autoCreateInput({ ownerStrategy: 'FIRST_MEMBER' as never }),
      'owner strategy is invalid',
    ],
    [
      'label policy',
      autoCreateInput({ labelPolicy: 'PHONE' as never }),
      'label policy is invalid',
    ],
  ])(
    'rejects an unsupported %s before opening a transaction',
    async (_, input, message) => {
      const { service, dataSource } = buildService();

      await expect(
        service.replaceConfiguration({ authContext, input }),
      ).rejects.toThrow(message);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing owner Role without changing the prior configuration', async () => {
    const { service, configurationRepository } = buildService({
      roleForInput: null,
    });

    await expect(
      service.replaceConfiguration({
        authContext,
        input: autoCreateInput(),
      }),
    ).rejects.toThrow('owner Role does not exist');
    expect(configurationRepository.update).not.toHaveBeenCalled();
  });

  it('rejects an owner Role from another workspace', async () => {
    const { service, configurationRepository } = buildService({
      roleForInput: { ...ownerRole, workspaceId: OTHER_WORKSPACE_ID },
    });

    await expect(
      service.replaceConfiguration({
        authContext,
        input: autoCreateInput(),
      }),
    ).rejects.toThrow('must be assignable to users in the current workspace');
    expect(configurationRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    ['missing PRIMARY', [], primaryField],
    [
      'multiple PRIMARY rows',
      [primaryRow, { ...primaryRow, id: 'other' }],
      primaryField,
    ],
    [
      'PRIMARY from another workspace',
      [{ ...primaryRow, workspaceId: OTHER_WORKSPACE_ID }],
      primaryField,
    ],
    [
      'PRIMARY metadata from another workspace',
      [primaryRow],
      { ...primaryField, workspaceId: OTHER_WORKSPACE_ID },
    ],
    [
      'PRIMARY from another anchor',
      [{ ...primaryRow, objectMetadataId: OTHER_ANCHOR_ID }],
      primaryField,
    ],
    [
      'PRIMARY metadata from another anchor',
      [primaryRow],
      { ...primaryField, objectMetadataId: OTHER_ANCHOR_ID },
    ],
    ['PRIMARY with missing metadata', [primaryRow], null],
    ['inactive PRIMARY', [primaryRow], { ...primaryField, isActive: false }],
    [
      'PRIMARY with a non-PHONES type',
      [primaryRow],
      { ...primaryField, type: FieldMetadataType.TEXT },
    ],
  ])('fails closed when enabled with %s', async (_, primaryRows, field) => {
    const { service, configurationRepository } = buildService({
      primaryRows,
      field,
    });

    await expect(
      service.replaceConfiguration({
        authContext,
        input: autoCreateInput(),
      }),
    ).rejects.toThrow('exactly one active PRIMARY PHONES field');
    expect(configurationRepository.update).not.toHaveBeenCalled();
  });

  it('rejects enablement when the current Messaging anchor is invalid', async () => {
    const { service, configurationRepository } = buildService({ anchor: null });

    await expect(
      service.replaceConfiguration({
        authContext,
        input: autoCreateInput(),
      }),
    ).rejects.toThrow('current Messaging anchor is invalid');
    expect(configurationRepository.update).not.toHaveBeenCalled();
  });

  it('reports a changed anchor as invalid and effectively disabled', async () => {
    const { service } = buildService({
      configuration: {
        ...baseConfiguration,
        autoCreateEnabled: true,
        autoCreateAnchorObjectMetadataId: OTHER_ANCHOR_ID,
        autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
        autoCreateOwnerRoleId: OWNER_ROLE_ID,
        autoCreateLabelPolicy: 'OMIT',
      },
    });

    const result = await service.getConfiguration({ authContext });

    expect(result.readiness).toBe(
      InconnectMessagingAutoCreateReadinessDTO.INVALID,
    );
    expect(result.validationIssues).toContain(
      InconnectMessagingAutoCreateValidationIssueDTO.CONFIGURED_ANCHOR_MISMATCH,
    );
    expect(result.effectiveEnabled).toBe(false);
  });

  it('reports an eligibility failure as not ready while keeping runtime disabled', async () => {
    const { service } = buildService({
      configuration: {
        ...baseConfiguration,
        autoCreateEnabled: true,
        autoCreateAnchorObjectMetadataId: ANCHOR_ID,
        autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
        autoCreateOwnerRoleId: OWNER_ROLE_ID,
        autoCreateLabelPolicy: 'OMIT',
      },
      eligibilityResult: {
        status: 'INELIGIBLE',
        reason:
          INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PHONE_UNIQUENESS_NOT_GUARANTEED,
        phoneUniquenessScope: null,
      },
    });

    const result = await service.getConfiguration({ authContext });

    expect(result.readiness).toBe(
      InconnectMessagingAutoCreateReadinessDTO.NOT_READY,
    );
    expect(result.validationIssues).toEqual([
      InconnectMessagingAutoCreateValidationIssueDTO.PHONE_UNIQUENESS_NOT_GUARANTEED,
      InconnectMessagingAutoCreateValidationIssueDTO.RUNTIME_NOT_IMPLEMENTED,
    ]);
    expect(result.effectiveEnabled).toBe(false);
  });

  it('exposes corrupt duplicate PRIMARY state without selecting one', async () => {
    const { service } = buildService({
      primaryRows: [primaryRow, { ...primaryRow, id: 'other' }],
    });

    const result = await service.getConfiguration({ authContext });

    expect(result.primaryPhoneIdentity).toEqual({
      status: InconnectMessagingAutoCreatePrimaryStatusDTO.MULTIPLE,
      fieldMetadataId: null,
      label: null,
      type: null,
      isActive: null,
    });
  });

  it('serializes replacement on the singleton before validation and update', async () => {
    const { service, configurationRepository } = buildService();

    await service.replaceConfiguration({
      authContext,
      input: autoCreateInput({ enabled: false }),
    });

    expect(
      configurationRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(configurationRepository.update.mock.invocationCallOrder[0]);
    expect(configurationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
});
