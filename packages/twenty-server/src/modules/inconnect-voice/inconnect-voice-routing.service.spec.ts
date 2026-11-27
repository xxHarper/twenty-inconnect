import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';
import { type InconnectVoiceInboundSessionService } from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';
import { InconnectVoiceRoutingService } from 'src/modules/inconnect-voice/inconnect-voice-routing.service';

const owner = '16aa8aaf-8ae2-469b-9e75-a02d90f5843b';
const colleague = 'f9bdcf83-5c5c-4f8a-8bd6-67dfbd01cf55';
const outside = 'fd0bb9c6-7ad5-473e-a016-fb421fc564e1';
const team = '539edee2-2c40-449e-913b-34bc6221da4f';
const otherTeam = '3ea2f621-da7a-4405-a714-34484ed5ef7a';
const workspaceId = '9157492d-d054-40fb-9971-dc6cee694906';
const recordId = 'd30bd40f-b0ad-4989-95ea-31885db6995e';
const match = {
  kind: 'match',
  recordId,
  ownerId: owner,
  routeScope: { sql: 'TRUE', parameters: {} },
};
const distribution = {
  receiveUserWorkspaceIds: [owner, colleague, outside],
  roundRobinUserWorkspaceIds: [colleague, outside],
  ringSeconds: 20,
  distributionSeconds: 55,
  maxAttempts: 2,
  retryUnanswered: false,
  fallbackUnavailable: false,
};

const config = {
  workspaceId,
  source: '+525514552571',
  defaultCountry: 'MX',
  distribution,
} as VoiceInboundConfig;

const membership = (teamId: string) => ({
  teamId,
  membershipType: 'EXECUTIVE',
  isWorkspaceMemberAssignable: true,
});

describe('Voice inbound distribution plan', () => {
  const classifyInbound = jest.fn();
  const activeReservation = jest.fn();
  const candidate = jest.fn();
  const getOrRecompute = jest.fn();
  const router = new InconnectVoiceRoutingService(
    { classifyInbound } as unknown as InconnectVoiceDirectoryService,
    { candidate } as unknown as InconnectVoiceInboundSessionService,
    { activeReservation } as unknown as InconnectVoiceCallStore,
    { getOrRecompute } as unknown as WorkspaceCacheService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    classifyInbound.mockResolvedValue(match);
    candidate.mockImplementation(async (_config, id) => ({
      actor: {
        workspaceMemberId: id,
        userWorkspaceId: id,
        user: { firstName: 'Agent' },
      },
      sessionId: id,
    }));
    activeReservation.mockResolvedValue(null);
    getOrRecompute.mockResolvedValue({
      inconnectTeamAccessMaps: {
        status: 'valid',
        version: 1,
        membershipByWorkspaceMemberId: {
          [owner]: membership(team),
          [colleague]: membership(team),
          [outside]: membership(otherTeam),
        },
        memberWorkspaceMemberIdsByTeamId: {
          [team]: [owner, colleague],
          [otherTeam]: [outside],
        },
        assignableMemberWorkspaceMemberIdsByTeamId: {
          [team]: [owner, colleague],
          [otherTeam]: [outside],
        },
      },
    });
  });

  it('offers the exact Lead owner first and builds a pool within the same team', async () => {
    const plan = await router.plan(config);
    expect(plan).toMatchObject({
      recordId,
      owner: { actorMemberId: owner },
      pool: { key: `team:${team}`, candidates: [{ actorMemberId: colleague }] },
    });
  });

  it('uses the same team when the owner is busy and has no registration', async () => {
    candidate.mockImplementationOnce(async () => null);
    activeReservation.mockResolvedValue('busy');
    expect(await router.plan(config)).toMatchObject({
      reason: 'owner-or-team',
      pool: { candidates: [{ actorMemberId: colleague }] },
    });
  });

  it('keeps offline-owner fallback off by default and allows it only explicitly', async () => {
    candidate.mockImplementationOnce(async () => null);
    expect(await router.plan(config)).toEqual({ reason: 'owner-unavailable' });
    candidate.mockImplementationOnce(async () => null);
    expect(
      await router.plan({
        ...config,
        distribution: { ...distribution, fallbackUnavailable: true },
      }),
    ).toMatchObject({ pool: { key: `team:${team}` } });
  });

  it('uses the general pool only on an authoritative no-match', async () => {
    classifyInbound.mockResolvedValue({
      kind: 'no-match',
      routeScope: match.routeScope,
    });
    candidate.mockImplementationOnce(async () => null);
    expect(await router.plan(config)).toMatchObject({
      reason: 'no-match-pool',
      recordId: null,
      pool: {
        key: 'general',
        candidates: [{ actorMemberId: colleague }, { actorMemberId: outside }],
      },
    });
    expect(getOrRecompute).not.toHaveBeenCalled();
  });

  it.each(['ambiguous', 'configuration-incomplete'])(
    'stops on %s before reading agents',
    async (kind) => {
      classifyInbound.mockResolvedValue({ kind });
      expect(await router.plan(config)).toEqual({ reason: kind });
      expect(candidate).not.toHaveBeenCalled();
    },
  );

  it('preserves a resolution error', async () => {
    classifyInbound.mockRejectedValue(new Error('resolution failed'));
    await expect(router.plan(config)).rejects.toThrow('resolution failed');
    expect(candidate).not.toHaveBeenCalled();
  });
});
