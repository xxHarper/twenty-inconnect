import { Injectable } from '@nestjs/common';

import { resolveInconnectTeamAccessMapsForAuthorization } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { normalizeVoiceDialNumber } from 'src/modules/inconnect-voice/inconnect-voice-dial-number';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';
import { InconnectVoiceInboundSessionService } from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';
import { type VoiceInboundPlan } from 'src/modules/inconnect-voice/inconnect-voice-distribution.store';

@Injectable()
export class InconnectVoiceRoutingService {
  constructor(
    private readonly directory: InconnectVoiceDirectoryService,
    private readonly sessions: InconnectVoiceInboundSessionService,
    private readonly calls: InconnectVoiceCallStore,
    private readonly cache: WorkspaceCacheService,
  ) {}

  async plan(
    config: VoiceInboundConfig,
    continuing = false,
  ): Promise<VoiceInboundPlan> {
    const distribution = config.distribution;
    if (!distribution) return { reason: 'configuration-incomplete' };
    const exact = await this.directory.classifyInbound(
      config,
      normalizeVoiceDialNumber(config.source, config),
    );
    if (exact.kind === 'ambiguous' || exact.kind === 'configuration-incomplete')
      return { reason: exact.kind };

    const ready = await Promise.all(
      distribution.receiveUserWorkspaceIds.map(async (id) => {
        try {
          return await this.sessions.candidate(config, id);
        } catch {
          // Failed authority only excludes this identity. CRM classification was independent.
          return null;
        }
      }),
    );
    const candidates = ready.flatMap((item) =>
      item
        ? [
            {
              actorMemberId: item.actor.workspaceMemberId,
              actorLabel: [item.actor.user.firstName, item.actor.user.lastName]
                .filter(Boolean)
                .join(' ')
                .trim(),
              userWorkspaceId: item.actor.userWorkspaceId,
              sessionId: item.sessionId,
            },
          ]
        : [],
    );
    const roundRobin = candidates.filter((candidate) =>
      distribution.roundRobinUserWorkspaceIds.includes(
        candidate.userWorkspaceId,
      ),
    );

    if (exact.kind === 'no-match')
      return {
        reason: 'no-match-pool',
        recordId: null,
        routeScope: exact.routeScope,
        pool: { key: 'general', candidates: roundRobin },
      };

    const owner = candidates.find(
      (candidate) => candidate.actorMemberId === exact.ownerId,
    );
    const occupied = await this.calls.activeReservation(
      config.workspaceId,
      exact.ownerId,
    );
    if (!owner && !occupied && !distribution.fallbackUnavailable && !continuing)
      return { reason: 'owner-unavailable' };

    let team: VoiceInboundPlan['pool'];
    try {
      const { inconnectTeamAccessMaps } = await this.cache.getOrRecompute(
        config.workspaceId,
        ['inconnectTeamAccessMaps'],
      );
      const authority = resolveInconnectTeamAccessMapsForAuthorization(
        inconnectTeamAccessMaps,
      );
      if (authority.kind !== 'available')
        throw new Error('Commercial Team authority unavailable');
      const memberships = authority.maps.membershipByWorkspaceMemberId;
      const teamId = memberships[exact.ownerId]?.teamId;
      if (teamId) {
        team = {
          key: `team:${teamId}`,
          candidates: roundRobin.filter(({ actorMemberId }) => {
            const membership = memberships[actorMemberId];
            return (
              actorMemberId !== exact.ownerId &&
              membership?.teamId === teamId &&
              membership.isWorkspaceMemberAssignable &&
              membership.membershipType === 'EXECUTIVE'
            );
          }),
        };
      }
    } catch {
      if (!owner || occupied) return { reason: 'team-authority-unavailable' };
    }

    return {
      reason: 'owner-or-team',
      recordId: exact.recordId,
      routeScope: exact.routeScope,
      ownerId: exact.ownerId,
      owner,
      pool: team,
    };
  }
}
