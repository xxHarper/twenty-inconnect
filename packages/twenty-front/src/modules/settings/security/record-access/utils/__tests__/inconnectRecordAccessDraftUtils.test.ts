import {
  availableMetadataFixture,
  managedConfigurationFixture,
  OBJECT_IDS,
  ROLE_IDS,
} from '@/settings/security/record-access/__tests__/fixtures/inconnectRecordAccessSettingsFixtures';
import {
  createDefaultInconnectRecordAccessPolicyDraft,
  createEmptyInconnectRecordAccessDraft,
} from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import {
  configurationToInconnectRecordAccessDraft,
  getInconnectRecordAccessDraftSignature,
  inconnectRecordAccessDraftToInput,
  isInconnectRecordAccessDraftCompatibleWithMetadata,
  isInconnectRecordAccessDraftValid,
  normalizePolicyAfterCreatePolicyChange,
  normalizePolicyAfterMissingOwnerPolicyChange,
} from '@/settings/security/record-access/utils/inconnectRecordAccessDraftUtils';
import {
  InconnectRecordAccessCreatePolicy,
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessMissingOwnerPolicy,
  InconnectRecordAccessOwnerRequirement,
} from '~/generated-metadata/graphql';

describe('INCONNECT Record Access draft utilities', () => {
  const persisted =
    managedConfigurationFixture.getInconnectRecordAccessConfiguration;
  const metadata =
    availableMetadataFixture.getInconnectRecordAccessAvailableMetadata;

  it('preserves all eight policies when normalizing and serializing', () => {
    const draft = configurationToInconnectRecordAccessDraft(persisted);

    expect(draft).not.toBeNull();
    const input = inconnectRecordAccessDraftToInput({
      draft: draft!,
      expectedRevision: '1',
    });

    expect(input.expectedRevision).toBe('1');
    expect(input.managedObjects).toHaveLength(2);
    expect(input.policies).toHaveLength(8);
    expect(
      input.policies.filter(
        (policy) =>
          policy.missingOwnerPolicy ===
          InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultOwnerRoleId: ROLE_IDS.supervisor,
        }),
        expect.objectContaining({
          defaultOwnerRoleId: ROLE_IDS.supervisor,
        }),
      ]),
    );
  });

  it('keeps a managed object with zero policies valid', () => {
    const draft = createEmptyInconnectRecordAccessDraft();

    draft.managedObjects.push({
      draftId: 'lead',
      objectMetadataId: OBJECT_IDS.lead,
      ownerFieldMetadataId: metadata.objects[0].ownerFields[0].fieldMetadataId,
      ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
      policies: [],
    });

    expect(isInconnectRecordAccessDraftValid(draft)).toBe(true);
  });

  it('rejects managed empty and duplicate role policies', () => {
    const draft = createEmptyInconnectRecordAccessDraft();

    expect(isInconnectRecordAccessDraftValid(draft)).toBe(false);

    const policy = createDefaultInconnectRecordAccessPolicyDraft({
      objectMetadataId: OBJECT_IDS.lead,
      roleId: ROLE_IDS.executive,
    });

    draft.managedObjects.push({
      draftId: 'lead',
      objectMetadataId: OBJECT_IDS.lead,
      ownerFieldMetadataId: metadata.objects[0].ownerFields[0].fieldMetadataId,
      ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
      policies: [policy, { ...policy, draftId: 'duplicate' }],
    });

    expect(isInconnectRecordAccessDraftValid(draft)).toBe(false);
  });

  it('serializes unmanaged without child rows', () => {
    const draft = configurationToInconnectRecordAccessDraft(persisted)!;

    draft.enforcementMode = InconnectRecordAccessEnforcementMode.UNMANAGED;

    expect(isInconnectRecordAccessDraftValid(draft)).toBe(true);
    expect(
      inconnectRecordAccessDraftToInput({
        draft,
        expectedRevision: '1',
      }),
    ).toEqual({
      expectedRevision: '1',
      enforcementMode: InconnectRecordAccessEnforcementMode.UNMANAGED,
      managedObjects: [],
      policies: [],
    });
  });

  it('enforces stable create and missing-owner combinations', () => {
    const policy = createDefaultInconnectRecordAccessPolicyDraft({
      objectMetadataId: OBJECT_IDS.lead,
      roleId: ROLE_IDS.admin,
    });

    const standardPolicy = normalizePolicyAfterCreatePolicyChange({
      policy,
      createPolicy: InconnectRecordAccessCreatePolicy.standardPermissionsOnly,
    });
    const roleDefaultPolicy = normalizePolicyAfterMissingOwnerPolicyChange({
      policy: {
        ...standardPolicy,
        defaultOwnerRoleId: ROLE_IDS.supervisor,
      },
      missingOwnerPolicy:
        InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole,
    });

    expect(roleDefaultPolicy.defaultOwnerRoleId).toBe(ROLE_IDS.supervisor);

    const selfPolicy = normalizePolicyAfterMissingOwnerPolicyChange({
      policy: roleDefaultPolicy,
      missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.self,
    });

    expect(selfPolicy.defaultOwnerRoleId).toBeNull();

    const deniedPolicy = normalizePolicyAfterCreatePolicyChange({
      policy: roleDefaultPolicy,
      createPolicy: InconnectRecordAccessCreatePolicy.denied,
    });

    expect(deniedPolicy.missingOwnerPolicy).toBe(
      InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
    );
    expect(deniedPolicy.defaultOwnerRoleId).toBeNull();
  });

  it('rejects draft references missing from available metadata', () => {
    const draft = configurationToInconnectRecordAccessDraft(persisted)!;

    expect(
      isInconnectRecordAccessDraftCompatibleWithMetadata({
        draft,
        metadata,
      }),
    ).toBe(true);

    draft.managedObjects[0].ownerFieldMetadataId =
      '90000000-0000-4000-8000-000000000001';

    expect(
      isInconnectRecordAccessDraftCompatibleWithMetadata({
        draft,
        metadata,
      }),
    ).toBe(false);
  });

  it('uses an input-based signature for dirty state', () => {
    const draft = configurationToInconnectRecordAccessDraft(persisted)!;
    const changed = {
      ...draft,
      enforcementMode: InconnectRecordAccessEnforcementMode.UNMANAGED,
    };

    expect(getInconnectRecordAccessDraftSignature(draft)).not.toBe(
      getInconnectRecordAccessDraftSignature(changed),
    );
  });
});
