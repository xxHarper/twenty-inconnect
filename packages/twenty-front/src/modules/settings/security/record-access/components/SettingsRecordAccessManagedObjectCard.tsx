import { styled } from '@linaria/react';
import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { SettingsRecordAccessManagedObjectHeader } from '@/settings/security/record-access/components/SettingsRecordAccessManagedObjectHeader';
import { SettingsRecordAccessPolicyCard } from '@/settings/security/record-access/components/SettingsRecordAccessPolicyCard';
import {
  createDefaultInconnectRecordAccessPolicyDraft,
  type InconnectRecordAccessManagedObjectDraft,
} from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import { Select } from '@/ui/input/components/Select';
import {
  InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessSettingsObjectCandidate,
  type InconnectRecordAccessSettingsRoleCandidate,
} from '~/generated-metadata/graphql';
import { Callout } from 'twenty-ui/feedback';
import { IconAlertTriangle, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  width: 100%;
`;

const StyledObjectCardContent = styled(CardContent)`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[4]};
`;

const StyledObjectFields = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const StyledPolicies = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledPoliciesHeader = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding-top: ${themeCssVariables.spacing[1]};
`;

const StyledAddPolicy = styled.div`
  align-items: flex-end;
  display: flex;
  gap: 8px;
`;

const StyledSelectContainer = styled.div`
  flex: 1;
`;

type SettingsRecordAccessManagedObjectCardProps = {
  managedObject: InconnectRecordAccessManagedObjectDraft;
  objectMetadata: InconnectRecordAccessSettingsObjectCandidate;
  roles: InconnectRecordAccessSettingsRoleCandidate[];
  onChange: (managedObject: InconnectRecordAccessManagedObjectDraft) => void;
  onRequestRemove: () => void;
};

export const SettingsRecordAccessManagedObjectCard = ({
  managedObject,
  objectMetadata,
  roles,
  onChange,
  onRequestRemove,
}: SettingsRecordAccessManagedObjectCardProps) => {
  const { t } = useLingui();
  const [isExpanded, setIsExpanded] = useState(true);
  const [roleToAddId, setRoleToAddId] = useState('');

  const usedRoleIds = new Set(
    managedObject.policies.map((policy) => policy.roleId),
  );
  const availableRoles = roles.filter((role) => !usedRoleIds.has(role.roleId));
  const availableRoleIds = new Set(availableRoles.map((role) => role.roleId));
  const ownerFieldLabel = objectMetadata.ownerFields.find(
    (field) => field.fieldMetadataId === managedObject.ownerFieldMetadataId,
  )?.label;

  const handleAddPolicy = () => {
    if (roleToAddId.length === 0 || usedRoleIds.has(roleToAddId)) {
      return;
    }

    onChange({
      ...managedObject,
      policies: [
        ...managedObject.policies,
        createDefaultInconnectRecordAccessPolicyDraft({
          objectMetadataId: managedObject.objectMetadataId,
          roleId: roleToAddId,
        }),
      ],
    });
    setRoleToAddId('');
  };

  return (
    <StyledContainer>
      <Card rounded fullWidth>
        <SettingsRecordAccessManagedObjectHeader
          isExpanded={isExpanded}
          objectLabel={objectMetadata.labelSingular}
          ownerFieldLabel={ownerFieldLabel}
          policyCount={managedObject.policies.length}
          onToggle={() => setIsExpanded((currentValue) => !currentValue)}
          onRequestRemove={onRequestRemove}
        />

        <AnimatedExpandableContainer
          isExpanded={isExpanded}
          dimension="height"
          mode="scroll-height"
        >
          <StyledObjectCardContent>
            <StyledObjectFields>
              <Select
                dropdownId={`record-access-owner-field-${managedObject.draftId}`}
                fullWidth
                label={t`Owner field`}
                value={managedObject.ownerFieldMetadataId}
                options={objectMetadata.ownerFields.map((field) => ({
                  label: field.label,
                  value: field.fieldMetadataId,
                }))}
                onChange={(ownerFieldMetadataId) =>
                  onChange({ ...managedObject, ownerFieldMetadataId })
                }
              />
              <Select
                dropdownId={`record-access-owner-requirement-${managedObject.draftId}`}
                fullWidth
                label={t`Owner requirement`}
                value={managedObject.ownerRequirement}
                options={[
                  {
                    label: t`Required owner`,
                    value: InconnectRecordAccessOwnerRequirement.required,
                  },
                  {
                    label: t`Optional owner`,
                    value: InconnectRecordAccessOwnerRequirement.optional,
                  },
                ]}
                onChange={(ownerRequirement) =>
                  onChange({ ...managedObject, ownerRequirement })
                }
              />
            </StyledObjectFields>

            <StyledPolicies>
              <StyledPoliciesHeader>
                {t`Role policies`} ({managedObject.policies.length})
              </StyledPoliciesHeader>
              {managedObject.policies.length === 0 && (
                <Callout
                  variant="warning"
                  Icon={IconAlertTriangle}
                  title={t`No role policies`}
                  description={t`No roles currently have access to this object.`}
                />
              )}
              {managedObject.policies.map((policy) => (
                <SettingsRecordAccessPolicyCard
                  key={policy.draftId}
                  policy={policy}
                  roles={roles}
                  availableRoleIds={availableRoleIds}
                  onChange={(nextPolicy) =>
                    onChange({
                      ...managedObject,
                      policies: managedObject.policies.map((currentPolicy) =>
                        currentPolicy.draftId === policy.draftId
                          ? nextPolicy
                          : currentPolicy,
                      ),
                    })
                  }
                  onRemove={() =>
                    onChange({
                      ...managedObject,
                      policies: managedObject.policies.filter(
                        (currentPolicy) =>
                          currentPolicy.draftId !== policy.draftId,
                      ),
                    })
                  }
                />
              ))}

              {availableRoles.length > 0 && (
                <StyledAddPolicy>
                  <StyledSelectContainer>
                    <Select
                      dropdownId={`record-access-add-role-${managedObject.draftId}`}
                      fullWidth
                      label={t`Add role policy`}
                      value={roleToAddId}
                      emptyOption={{ label: t`Select a role`, value: '' }}
                      options={availableRoles.map((role) => ({
                        label: role.label,
                        value: role.roleId,
                      }))}
                      onChange={setRoleToAddId}
                    />
                  </StyledSelectContainer>
                  <Button
                    title={t`Add`}
                    Icon={IconPlus}
                    variant="secondary"
                    disabled={roleToAddId.length === 0}
                    onClick={handleAddPolicy}
                  />
                </StyledAddPolicy>
              )}
            </StyledPolicies>
          </StyledObjectCardContent>
        </AnimatedExpandableContainer>
      </Card>
    </StyledContainer>
  );
};
