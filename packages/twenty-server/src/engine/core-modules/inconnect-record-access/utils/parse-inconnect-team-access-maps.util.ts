import { isValidUuid } from 'twenty-shared/utils';

import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import {
  type InconnectTeamAccessMaps,
  type InconnectTeamAccessMapsAuthorizationDecision,
  type InconnectTeamAccessMapsFailureKind,
  type InconnectTeamMembershipMapEntry,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMembershipType = (
  value: unknown,
): value is InconnectCommercialTeamMembershipType =>
  value === InconnectCommercialTeamMembershipType.COORDINATOR ||
  value === InconnectCommercialTeamMembershipType.EXECUTIVE;

const isFailureKind = (
  value: unknown,
): value is InconnectTeamAccessMapsFailureKind =>
  value === 'invalid' ||
  value === 'corrupt' ||
  value === 'recomputation-failed';

const parseMembershipMap = (
  value: unknown,
): Record<string, InconnectTeamMembershipMapEntry> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries: Record<string, InconnectTeamMembershipMapEntry> = {};

  for (const [workspaceMemberId, rawEntry] of Object.entries(value)) {
    if (
      !isValidUuid(workspaceMemberId) ||
      !isRecord(rawEntry) ||
      typeof rawEntry.teamId !== 'string' ||
      !isValidUuid(rawEntry.teamId) ||
      !isMembershipType(rawEntry.membershipType) ||
      typeof rawEntry.isWorkspaceMemberAssignable !== 'boolean'
    ) {
      return undefined;
    }

    entries[workspaceMemberId] = {
      teamId: rawEntry.teamId,
      membershipType: rawEntry.membershipType,
      isWorkspaceMemberAssignable: rawEntry.isWorkspaceMemberAssignable,
    };
  }

  return entries;
};

const parseTeamMemberMap = (
  value: unknown,
): Record<string, string[]> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries: Record<string, string[]> = {};

  for (const [teamId, rawWorkspaceMemberIds] of Object.entries(value)) {
    if (
      !isValidUuid(teamId) ||
      !Array.isArray(rawWorkspaceMemberIds) ||
      !rawWorkspaceMemberIds.every(
        (workspaceMemberId) =>
          typeof workspaceMemberId === 'string' &&
          isValidUuid(workspaceMemberId),
      ) ||
      new Set(rawWorkspaceMemberIds).size !== rawWorkspaceMemberIds.length
    ) {
      return undefined;
    }

    entries[teamId] = rawWorkspaceMemberIds;
  }

  return entries;
};

const areMapsConsistent = ({
  membershipByWorkspaceMemberId,
  memberWorkspaceMemberIdsByTeamId,
  assignableMemberWorkspaceMemberIdsByTeamId,
}: Extract<InconnectTeamAccessMaps, { status: 'valid' }>): boolean => {
  if (
    Object.keys(memberWorkspaceMemberIdsByTeamId).sort().join(',') !==
    Object.keys(assignableMemberWorkspaceMemberIdsByTeamId).sort().join(',')
  ) {
    return false;
  }

  for (const [workspaceMemberId, membership] of Object.entries(
    membershipByWorkspaceMemberId,
  )) {
    const teamMembers =
      memberWorkspaceMemberIdsByTeamId[membership.teamId] ?? [];
    const assignableMembers =
      assignableMemberWorkspaceMemberIdsByTeamId[membership.teamId] ?? [];

    if (
      !teamMembers.includes(workspaceMemberId) ||
      assignableMembers.includes(workspaceMemberId) !==
        membership.isWorkspaceMemberAssignable
    ) {
      return false;
    }
  }

  return Object.entries(memberWorkspaceMemberIdsByTeamId).every(
    ([teamId, workspaceMemberIds]) =>
      workspaceMemberIds.every(
        (workspaceMemberId) =>
          membershipByWorkspaceMemberId[workspaceMemberId]?.teamId === teamId,
      ) &&
      assignableMemberWorkspaceMemberIdsByTeamId[teamId].every(
        (workspaceMemberId) =>
          workspaceMemberIds.includes(workspaceMemberId) &&
          membershipByWorkspaceMemberId[workspaceMemberId]
            ?.isWorkspaceMemberAssignable === true,
      ),
  );
};

export const invalidInconnectTeamAccessMaps = (
  reason: string,
  failureKind: InconnectTeamAccessMapsFailureKind = 'invalid',
): InconnectTeamAccessMaps => ({
  version: 1,
  status: 'invalid',
  reason,
  failureKind,
});

export const parseInconnectTeamAccessMaps = (
  value: unknown,
): InconnectTeamAccessMaps => {
  if (!isRecord(value) || value.version !== 1) {
    return invalidInconnectTeamAccessMaps(
      'INCONNECT team cache has an unsupported or missing version',
      'corrupt',
    );
  }

  if (
    value.status === 'invalid' &&
    typeof value.reason === 'string' &&
    isFailureKind(value.failureKind)
  ) {
    return {
      version: 1,
      status: 'invalid',
      reason: value.reason,
      failureKind: value.failureKind,
    };
  }

  if (value.status !== 'valid') {
    return invalidInconnectTeamAccessMaps(
      'INCONNECT team cache has an invalid status',
      'corrupt',
    );
  }

  const membershipByWorkspaceMemberId = parseMembershipMap(
    value.membershipByWorkspaceMemberId,
  );
  const memberWorkspaceMemberIdsByTeamId = parseTeamMemberMap(
    value.memberWorkspaceMemberIdsByTeamId,
  );
  const assignableMemberWorkspaceMemberIdsByTeamId = parseTeamMemberMap(
    value.assignableMemberWorkspaceMemberIdsByTeamId,
  );

  if (
    !membershipByWorkspaceMemberId ||
    !memberWorkspaceMemberIdsByTeamId ||
    !assignableMemberWorkspaceMemberIdsByTeamId
  ) {
    return invalidInconnectTeamAccessMaps(
      'INCONNECT team cache payload is malformed',
      'corrupt',
    );
  }

  const maps: Extract<InconnectTeamAccessMaps, { status: 'valid' }> = {
    version: 1,
    status: 'valid',
    membershipByWorkspaceMemberId,
    memberWorkspaceMemberIdsByTeamId,
    assignableMemberWorkspaceMemberIdsByTeamId,
  };

  return areMapsConsistent(maps)
    ? maps
    : invalidInconnectTeamAccessMaps(
        'INCONNECT team cache maps are inconsistent',
        'corrupt',
      );
};

export const resolveInconnectTeamAccessMapsForAuthorization = (
  value: unknown,
): InconnectTeamAccessMapsAuthorizationDecision => {
  if (!value) {
    return { kind: 'denied', reason: 'absent' };
  }

  const parsed = parseInconnectTeamAccessMaps(value);

  return parsed.status === 'valid'
    ? { kind: 'available', maps: parsed }
    : { kind: 'denied', reason: parsed.failureKind };
};
