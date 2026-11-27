import { randomUUID } from 'crypto';
import { type DataSource, type EntityManager } from 'typeorm';

import { orderVoicePool } from 'src/modules/inconnect-voice/inconnect-voice-availability';
import {
  lockVoiceReservations,
  type VoiceProviderTarget,
  type VoiceRecordCondition,
} from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type VoiceProgress } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

export const VOICE_INBOUND_OFFER_TABLE = 'core."inconnectVoiceInboundOffer"';
const OFFER = VOICE_INBOUND_OFFER_TABLE;
const CURSOR = 'core."inconnectVoicePhoneCursor"';
const CALL = 'core."inconnectVoiceCall"';
const LEG = 'core."inconnectVoiceCallLeg"';

export type VoiceInboundCandidate = {
  actorMemberId: string;
  actorLabel: string;
  sessionId: string;
  userWorkspaceId: string;
};

export type VoiceInboundPlan = {
  reason:
    | 'resolution-error'
    | 'configuration-incomplete'
    | 'ambiguous'
    | 'owner-unavailable'
    | 'team-authority-unavailable'
    | 'no-match-pool'
    | 'owner-or-team';
  recordId?: string | null;
  routeScope?: VoiceRecordCondition;
  ownerId?: string;
  owner?: VoiceInboundCandidate;
  pool?: { key: string; candidates: VoiceInboundCandidate[] };
};

export type VoiceInboundEvent = {
  id: string | null;
  parentSid: string;
  childSid: string | null;
};

export type LockedVoiceInbound = {
  id: string;
  sessionId: string | null;
  offerId?: string | null;
  ordinal?: number;
  pool?: string | null;
  recordId?: string | null;
  status?: string;
  decision?: string | null;
  screened?: boolean;
  dialSettled?: boolean;
};

export type SelectedVoiceOffer = VoiceInboundCandidate & {
  offerId: string;
  ringSeconds?: number;
};

const teamMembershipCondition = (
  teamParam: string,
  ownerParam: string,
  candidateParam: string,
  workspaceParam: string,
) => `EXISTS (
    SELECT FROM core."inconnectCommercialTeam" team
    JOIN core."inconnectCommercialTeamMembership" owner
      ON owner."workspaceId"=team."workspaceId" AND owner."teamId"=team.id
    JOIN core."inconnectCommercialTeamMembership" candidate
      ON candidate."workspaceId"=team."workspaceId" AND candidate."teamId"=team.id
    WHERE team."workspaceId"=${workspaceParam} AND team.id=${teamParam} AND team."deletedAt" IS NULL
      AND owner."workspaceMemberId"=${ownerParam} AND owner."deletedAt" IS NULL
      AND candidate."workspaceMemberId"=${candidateParam} AND candidate."deletedAt" IS NULL
      AND candidate."membershipType"='EXECUTIVE'
  )`;

const bindScope = (
  driver: DataSource['driver'],
  sql: string,
  scope: VoiceRecordCondition,
  values: unknown[],
) => driver.escapeQueryWithParameters(sql, scope.parameters, { ...values });

export async function reserveVoiceInboundOffer(
  manager: EntityManager,
  driver: DataSource['driver'],
  config: VoiceInboundConfig,
  id: string,
  parentSid: string,
  plan: VoiceInboundPlan,
  stillAvailable: (candidate: VoiceInboundCandidate) => Promise<boolean>,
) {
  await manager.query("SET LOCAL lock_timeout = '2500ms'");
  await lockVoiceReservations(manager, config.workspaceId);
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${config.accountSid}:${parentSid}`,
  ]);
  const [prior] = await manager.query(
    `SELECT 1 FROM ${LEG} WHERE "accountSid" = $1 AND "providerCallSid" = $2`,
    [config.accountSid, parentSid],
  );
  if (prior) return null;

  const configValues = [
    id,
    config.workspaceId,
    config.accountSid,
    config.applicationSid,
    config.source,
    config.receiver,
  ];
  const columns = `id, "workspaceId", direction, "accountSid", "applicationSid", "callerId", destination,
      "expiresAt", status, result, "actorLabel", "distributionReason"`;
  const base = "$1, $2, 'inbound', $3, $4, $5, $6";
  const scope = plan.routeScope;

  const reserve = async (
    candidate: VoiceInboundCandidate,
    poolKey?: string,
  ) => {
    if (!scope || !(await stillAvailable(candidate))) return false;
    await manager.query(
      `UPDATE ${CALL} SET status = 'finished', result = 'canceled', "technicalError" = 'reservation-expired'
          WHERE "workspaceId" = $1 AND "actorMemberId" = $2 AND direction = 'outbound'
            AND status = 'reserved' AND "expiresAt" <= clock_timestamp()`,
      [config.workspaceId, candidate.actorMemberId],
    );

    // Team fallback is conditional on a current reservation and current team membership.
    const team = poolKey?.startsWith('team:') ? poolKey.slice(5) : null;
    const [row] = await manager.query(
      ...bindScope(
        driver,
        `INSERT INTO ${CALL} (${columns}, "objectMetadataId", "recordId", "actorMemberId",
          "inboundSessionId", "startedAt", "nextReconcileAt")
         SELECT ${base}, clock_timestamp() + make_interval(secs => $13::int + 12),
           'ringing', NULL, $10, $12, CASE WHEN $8::uuid IS NULL THEN NULL ELSE $7::uuid END,
           $8, $9, $11, clock_timestamp(), clock_timestamp()
         WHERE (${scope.sql}) AND ($14::uuid IS NULL OR (
           ($16::boolean OR EXISTS (SELECT FROM ${CALL} busy WHERE busy."workspaceId"=$2 AND busy."actorMemberId"=$15
             AND busy.status <> 'finished' AND NOT (busy.status='reserved' AND busy."expiresAt"<=clock_timestamp())))
           AND ${teamMembershipCondition('$14', '$15', '$9', '$2')}
         ))
         ON CONFLICT ("workspaceId", "actorMemberId") WHERE status <> 'finished' DO NOTHING
         RETURNING id`,
        scope,
        [
          ...configValues,
          config.objectId,
          plan.recordId ?? null,
          candidate.actorMemberId,
          candidate.actorLabel,
          candidate.sessionId,
          team
            ? 'team-round-robin'
            : poolKey
              ? 'general-round-robin'
              : 'lead-owner',
          config.distribution?.ringSeconds ?? 20,
          team,
          plan.ownerId ?? null,
          config.distribution?.fallbackUnavailable === true,
        ],
      ),
    );
    return Boolean(row);
  };

  let poolUsed: string | null = null;
  let chosen = plan.owner && (await reserve(plan.owner)) ? plan.owner : null;
  if (!chosen && plan.pool?.candidates.length) {
    const { key, candidates } = plan.pool;
    await manager.query(
      `INSERT INTO ${CURSOR} ("workspaceId", pool) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [config.workspaceId, key],
    );
    const [cursor]: { last: string | null }[] = await manager.query(
      `SELECT "lastMemberId" AS last FROM ${CURSOR} WHERE "workspaceId"=$1 AND pool=$2 FOR UPDATE`,
      [config.workspaceId, key],
    );
    for (const candidate of orderVoicePool(candidates, cursor.last)) {
      if (!(await reserve(candidate, key))) continue;
      chosen = candidate;
      poolUsed = key;
      await manager.query(
        `UPDATE ${CURSOR} SET "lastMemberId"=$3 WHERE "workspaceId"=$1 AND pool=$2`,
        [config.workspaceId, key, candidate.actorMemberId],
      );
      break;
    }
  }
  // The existing active-actor index is also the exclusion authority for Outbound.
  if (!chosen) {
    const failed = [
      'configuration-incomplete',
      'resolution-error',
      'team-authority-unavailable',
    ].includes(plan.reason);
    await manager.query(
      `INSERT INTO ${CALL} (${columns}, "endedAt", "technicalError")
           VALUES (${base}, clock_timestamp(), 'finished', $7, '', $8, clock_timestamp(), 'routing-denied')`,
      [
        ...configValues,
        failed ? 'failed' : 'no-answer',
        plan.reason === 'owner-or-team'
          ? 'team-no-agent'
          : plan.reason === 'no-match-pool'
            ? 'pool-no-agent'
            : plan.reason,
      ],
    );
  }

  await manager.query(
    `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", kind)
         VALUES ($1, $2, $3, 'caller')`,
    [id, config.accountSid, parentSid],
  );
  if (!chosen) return null;
  const offerId = randomUUID();
  await manager.query(
    `INSERT INTO ${OFFER} (id, "callId", ordinal, "actorMemberId", "sessionId", pool)
         VALUES ($1, $2, 1, $3, $4, $5)`,
    [
      offerId,
      id,
      chosen.actorMemberId,
      chosen.sessionId,
      poolUsed ?? plan.pool?.key ?? null,
    ],
  );
  return { ...chosen, offerId };
}

export async function persistVoiceInboundRootTermination(
  manager: EntityManager,
  config: VoiceInboundConfig,
  parentSid: string,
  progress: VoiceProgress,
) {
  // A fast caller hangup may reach the status webhook before routing commits.
  // Persist the signed terminal root so its initial webhook cannot start a later offer.
  const [existing] = await manager.query(
    `SELECT 1 FROM ${LEG} WHERE "accountSid"=$1 AND "providerCallSid"=$2`,
    [config.accountSid, parentSid],
  );
  if (existing) return;
  const id = randomUUID();
  await manager.query(
    `INSERT INTO ${CALL} (id, "workspaceId", direction, "accountSid", "applicationSid",
     "callerId", destination, "expiresAt", status, result, "actorLabel", "endedAt", "distributionReason")
   VALUES ($1, $2, 'inbound', $3, $4, $5, $6, clock_timestamp(), 'finished',
     $7, '', COALESCE($8::timestamptz, clock_timestamp()), 'caller-ended-before-routing')`,
    [
      id,
      config.workspaceId,
      config.accountSid,
      config.applicationSid,
      config.source,
      config.receiver,
      progress.result === 'answered' ? 'canceled' : progress.result,
      progress.endedAt,
    ],
  );
  await manager.query(
    `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", kind) VALUES ($1,$2,$3,'caller')`,
    [id, config.accountSid, parentSid],
  );
}

export async function finalizeVoiceInboundOffer(
  manager: EntityManager,
  config: VoiceInboundConfig,
  event: VoiceInboundEvent,
  row: LockedVoiceInbound,
  progress: VoiceProgress,
  dial: boolean,
): Promise<VoiceProviderTarget | null> {
  const [incomplete]: { childSid: string }[] = await manager.query(
    `WITH verdict AS (
         SELECT id, CASE
           ${
             config.distribution
               ? `WHEN status='finished' AND result='canceled'
             AND ($3::text <> 'answered' OR "inboundScreenedAt" IS NULL) THEN 'canceled'`
               : ''
           }
           WHEN "inboundDecision" = 'decline' THEN 'declined'
           WHEN status = 'finished' AND ("inboundDialSettled"
             OR (NOT $2::boolean AND NOT (result = 'no-answer' AND $3::text = 'canceled'))) THEN result
           WHEN $3::text = 'answered' AND "inboundScreenedAt" IS NOT NULL THEN 'answered'
           WHEN $3::text = 'answered' OR "inboundScreenedAt" IS NOT NULL THEN 'failed'
           ELSE $3::text END AS result
         FROM ${CALL} WHERE id = $1
       ), next AS (
         SELECT c.id, verdict.result, c."inboundDialSettled" OR $2::boolean AS dial,
           CASE WHEN verdict.result = 'answered' THEN c."actorMemberId" END AS member,
           COALESCE(c."endedAt", $4::timestamptz${row.offerId ? ', clock_timestamp()' : ''}) AS ended,
           CASE WHEN verdict.result = 'answered' THEN CASE
             WHEN $3::text = 'answered' AND $2::boolean AND NOT c."inboundDialSettled"
               THEN COALESCE($5::integer, c."durationSeconds")
             WHEN $3::text = 'answered' THEN COALESCE(c."durationSeconds", $5::integer)
             ELSE c."durationSeconds" END END AS duration
         FROM ${CALL} c JOIN verdict USING (id)
       ), updated AS (
         UPDATE ${CALL} c SET status = 'finished', result = next.result, "inboundDialSettled" = next.dial,
           "answeredMemberId" = next.member, "endedAt" = next.ended, "durationSeconds" = next.duration
         FROM next WHERE c.id = next.id AND
           (c.status, c.result, c."inboundDialSettled", c."answeredMemberId", c."endedAt", c."durationSeconds")
           IS DISTINCT FROM ('finished'::text, next.result, next.dial, next.member, next.ended, next.duration)
         RETURNING c.id, c.result, c."durationSeconds", c."inboundDialSettled"
       )
       SELECT leg."providerCallSid" AS "childSid"
       FROM updated JOIN ${LEG} leg ON leg."callId" = updated.id AND leg.kind = 'browser-inbound'
       WHERE ((updated.result = 'answered' AND updated."durationSeconds" IS NULL)
          OR (updated.result = 'no-answer' AND NOT updated."inboundDialSettled"))
         ${config.distribution ? 'AND leg."inboundOfferId" IS NOT DISTINCT FROM $6::uuid' : ''}`,
    [
      row.id,
      dial,
      progress.result,
      progress.endedAt,
      progress.durationSeconds,
      ...(config.distribution ? [row.offerId ?? null] : []),
    ],
  );
  if (config.distribution) {
    await manager.query(
      `UPDATE ${OFFER} offer SET "endedAt"=call."endedAt", result=call.result,
            "durationSeconds"=call."durationSeconds"
          FROM ${CALL} call WHERE offer."callId"=call.id AND call.id=$1
            AND offer."sessionId"=call."inboundSessionId" AND call.status='finished'
            AND (offer."endedAt", offer.result, offer."durationSeconds") IS DISTINCT FROM
              (call."endedAt", call.result, call."durationSeconds")`,
      [row.id],
    );
  }
  return incomplete
    ? {
        id: row.id,
        parentSid: event.parentSid,
        childSid: incomplete.childSid,
        ...(row.offerId ? { offerId: row.offerId } : {}),
        direction: 'inbound',
      }
    : null;
}

export async function reserveNextVoiceInboundOffer(
  manager: EntityManager,
  driver: DataSource['driver'],
  config: VoiceInboundConfig,
  row: LockedVoiceInbound,
  progress: VoiceProgress,
  pool: NonNullable<VoiceInboundPlan['pool']>,
  scope: VoiceRecordCondition,
  ownerId: string | undefined,
  ringSeconds: number,
  stillAvailable: (candidate: VoiceInboundCandidate) => Promise<boolean>,
): Promise<SelectedVoiceOffer | null> {
  const distribution = config.distribution;
  if (!distribution) return null;
  const [cursor]: { last: string | null }[] = await manager.query(
    `SELECT "lastMemberId" AS last FROM ${CURSOR} WHERE "workspaceId"=$1 AND pool=$2 FOR UPDATE`,
    [config.workspaceId, pool.key],
  );
  for (const candidate of orderVoicePool(
    pool.candidates,
    cursor?.last ?? null,
  )) {
    if (!(await stillAvailable(candidate))) continue;
    const teamId = pool.key.startsWith('team:') ? pool.key.slice(5) : null;
    const [selected]: { id: string; ringSeconds: number }[] =
      await manager.query(
        ...bindScope(
          driver,
          `WITH budget AS MATERIALIZED (
         SELECT LEAST($6::int, floor(extract(epoch FROM ("createdAt" +
           make_interval(secs => $10::int) - clock_timestamp())))::int - 5) AS "ringSeconds"
         FROM ${CALL} WHERE id=$1
       ), changed AS (
         UPDATE ${CALL} SET "actorMemberId"=$3, "actorLabel"=$4, "inboundSessionId"=$5,
           "inboundDecision"=NULL, "expiresAt"=clock_timestamp()+make_interval(secs => budget."ringSeconds" + 12),
           "distributionReason"=$9, "nextReconcileAt"=clock_timestamp(), "reconcileAttempts"=0
         FROM budget WHERE id=$1 AND "workspaceId"=$2 AND budget."ringSeconds">=8 AND (${scope.sql}) AND
            ($7::uuid IS NULL OR ${teamMembershipCondition('$7', '$8', '$3', '$2')}) AND
            NOT EXISTS (SELECT FROM ${OFFER} previous WHERE previous."callId"=$1 AND previous."actorMemberId"=$3) AND
            NOT EXISTS (SELECT FROM ${CALL} busy WHERE busy."workspaceId"=$2 AND busy."actorMemberId"=$3 AND busy.status <> 'finished')
         RETURNING id, budget."ringSeconds"
       ) SELECT id, "ringSeconds" FROM changed`,
          scope,
          [
            row.id,
            config.workspaceId,
            candidate.actorMemberId,
            candidate.actorLabel,
            candidate.sessionId,
            ringSeconds,
            teamId,
            ownerId ?? null,
            teamId ? 'team-round-robin' : 'general-round-robin',
            distribution.distributionSeconds,
          ],
        ),
      );
    if (!selected) continue;
    const offerId = randomUUID();
    await manager.query(
      `UPDATE ${OFFER} SET "endedAt"=COALESCE($2::timestamptz,clock_timestamp()), result=$3 WHERE id=$1 AND result IS NULL`,
      [
        row.offerId,
        progress.endedAt,
        row.decision === 'decline' ? 'declined' : progress.result,
      ],
    );
    await manager.query(
      `INSERT INTO ${OFFER} (id, "callId", ordinal, "actorMemberId", "sessionId", pool)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        offerId,
        row.id,
        (row.ordinal ?? 0) + 1,
        candidate.actorMemberId,
        candidate.sessionId,
        pool.key,
      ],
    );
    await manager.query(
      `INSERT INTO ${CURSOR} ("workspaceId", pool, "lastMemberId") VALUES ($1, $2, $3)
        ON CONFLICT ("workspaceId", pool) DO UPDATE SET "lastMemberId"=EXCLUDED."lastMemberId"`,
      [config.workspaceId, pool.key, candidate.actorMemberId],
    );
    return { ...candidate, offerId, ringSeconds: selected.ringSeconds };
  }
  return null;
}
