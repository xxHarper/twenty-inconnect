import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type InconnectRecordAccessPolicyDraft } from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import {
  normalizePolicyAfterCreatePolicyChange,
  normalizePolicyAfterMissingOwnerPolicyChange,
} from '@/settings/security/record-access/utils/inconnectRecordAccessDraftUtils';
import { Select } from '@/ui/input/components/Select';
import {
  InconnectRecordAccessCreatePolicy,
  InconnectRecordAccessMissingOwnerPolicy,
  InconnectRecordAccessOwnerTransferPolicy,
  InconnectRecordAccessRecordEffect,
  type InconnectRecordAccessSettingsRoleCandidate,
} from '~/generated-metadata/graphql';
import { IconTrash } from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { Card, CardContent } from 'twenty-ui/surfaces';

const StyledCardContent = styled(CardContent)`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledTitle = styled.div`
  font-weight: 600;
`;

const StyledFields = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const StyledHelpText = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: 12px;
`;

type SettingsRecordAccessPolicyCardProps = {
  policy: InconnectRecordAccessPolicyDraft;
  roles: InconnectRecordAccessSettingsRoleCandidate[];
  availableRoleIds: Set<string>;
  onChange: (policy: InconnectRecordAccessPolicyDraft) => void;
  onRemove: () => void;
};

export const SettingsRecordAccessPolicyCard = ({
  policy,
  roles,
  availableRoleIds,
  onChange,
  onRemove,
}: SettingsRecordAccessPolicyCardProps) => {
  const { t } = useLingui();

  const roleOptions = roles
    .filter(
      (role) =>
        role.roleId === policy.roleId || availableRoleIds.has(role.roleId),
    )
    .map((role) => ({ label: role.label, value: role.roleId }));

  const recordEffectOptions = [
    {
      label: t`Own records`,
      value: InconnectRecordAccessRecordEffect.ownRecords,
    },
    {
      label: t`Own and team records`,
      value: InconnectRecordAccessRecordEffect.ownAndTeamRecords,
    },
    {
      label: t`All records`,
      value: InconnectRecordAccessRecordEffect.allRecords,
    },
  ];

  const createPolicyOptions = [
    {
      label: t`Denied`,
      value: InconnectRecordAccessCreatePolicy.denied,
    },
    {
      label: t`Default owner`,
      value: InconnectRecordAccessCreatePolicy.defaultOwner,
    },
    {
      label: t`Assignable owners`,
      value: InconnectRecordAccessCreatePolicy.assignableOwners,
    },
    {
      label: t`Standard Twenty permissions`,
      value: InconnectRecordAccessCreatePolicy.standardPermissionsOnly,
    },
  ];

  const ownerTransferPolicyOptions = [
    {
      label: t`Denied`,
      value: InconnectRecordAccessOwnerTransferPolicy.denied,
    },
    {
      label: t`Assignable owners`,
      value: InconnectRecordAccessOwnerTransferPolicy.assignableOwners,
    },
    {
      label: t`Standard Twenty permissions`,
      value: InconnectRecordAccessOwnerTransferPolicy.standardPermissionsOnly,
    },
  ];

  const missingOwnerPolicyOptions =
    policy.createPolicy === InconnectRecordAccessCreatePolicy.denied
      ? [
          {
            label: t`Require explicit owner`,
            value: InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
          },
        ]
      : policy.createPolicy ===
            InconnectRecordAccessCreatePolicy.defaultOwner ||
          policy.createPolicy ===
            InconnectRecordAccessCreatePolicy.assignableOwners
        ? [
            {
              label: t`Current member`,
              value: InconnectRecordAccessMissingOwnerPolicy.self,
            },
          ]
        : [
            {
              label: t`Current member`,
              value: InconnectRecordAccessMissingOwnerPolicy.self,
            },
            {
              label: t`Require explicit owner`,
              value: InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
            },
            {
              label: t`Single active member of role`,
              value:
                InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole,
            },
            {
              label: t`Standard behavior`,
              value: InconnectRecordAccessMissingOwnerPolicy.standard,
            },
          ];

  return (
    <Card
      rounded
      fullWidth
      backgroundColor={themeCssVariables.background.secondary}
    >
      <StyledCardContent>
        <StyledHeader>
          <StyledTitle>
            {roles.find((role) => role.roleId === policy.roleId)?.label ??
              t`Role policy`}
          </StyledTitle>
          <LightIconButton
            Icon={IconTrash}
            accent="tertiary"
            onClick={onRemove}
            aria-label={t`Remove role policy`}
          />
        </StyledHeader>

        <StyledFields>
          <Select
            dropdownId={`record-access-role-${policy.draftId}`}
            fullWidth
            label={t`Role`}
            value={policy.roleId}
            options={roleOptions}
            onChange={(roleId) => onChange({ ...policy, roleId })}
          />
          <Select
            dropdownId={`record-access-effect-${policy.draftId}`}
            fullWidth
            label={t`Records`}
            value={policy.recordEffect}
            options={recordEffectOptions}
            onChange={(recordEffect) => onChange({ ...policy, recordEffect })}
          />
          <Select
            dropdownId={`record-access-create-${policy.draftId}`}
            fullWidth
            label={t`Create`}
            value={policy.createPolicy}
            options={createPolicyOptions}
            onChange={(createPolicy) =>
              onChange(
                normalizePolicyAfterCreatePolicyChange({
                  policy,
                  createPolicy,
                }),
              )
            }
          />
          <Select
            dropdownId={`record-access-transfer-${policy.draftId}`}
            fullWidth
            label={t`Change owner`}
            value={policy.ownerTransferPolicy}
            options={ownerTransferPolicyOptions}
            onChange={(ownerTransferPolicy) =>
              onChange({ ...policy, ownerTransferPolicy })
            }
          />
          <Select
            dropdownId={`record-access-missing-owner-${policy.draftId}`}
            fullWidth
            label={t`Missing owner`}
            value={policy.missingOwnerPolicy}
            options={missingOwnerPolicyOptions}
            onChange={(missingOwnerPolicy) =>
              onChange(
                normalizePolicyAfterMissingOwnerPolicyChange({
                  policy,
                  missingOwnerPolicy,
                }),
              )
            }
          />
          {policy.missingOwnerPolicy ===
            InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole && (
            <Select
              dropdownId={`record-access-default-role-${policy.draftId}`}
              fullWidth
              label={t`Default owner role`}
              value={policy.defaultOwnerRoleId ?? ''}
              emptyOption={{ label: t`Select a role`, value: '' }}
              options={roles.map((role) => ({
                label: role.label,
                value: role.roleId,
              }))}
              onChange={(defaultOwnerRoleId) =>
                onChange({
                  ...policy,
                  defaultOwnerRoleId:
                    defaultOwnerRoleId.length > 0 ? defaultOwnerRoleId : null,
                })
              }
            />
          )}
        </StyledFields>

        {policy.recordEffect ===
          InconnectRecordAccessRecordEffect.ownAndTeamRecords && (
          <StyledHelpText>
            {t`Team membership is managed separately.`}
          </StyledHelpText>
        )}
      </StyledCardContent>
    </Card>
  );
};
