import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type EntityManager } from 'typeorm';

import {
  lockVoiceReservations,
  type VoiceProviderTarget,
  type VoiceRecordCondition,
} from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type VoiceProgress } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

import {
  finalizeVoiceInboundOffer,
  persistVoiceInboundRootTermination,
  reserveNextVoiceInboundOffer,
  reserveVoiceInboundOffer,
  VOICE_INBOUND_OFFER_TABLE,
  type LockedVoiceInbound,
  type SelectedVoiceOffer,
  type VoiceInboundCandidate,
  type VoiceInboundEvent,
  type VoiceInboundPlan,
} from 'src/modules/inconnect-voice/inconnect-voice-distribution.store';

const OFFER = VOICE_INBOUND_OFFER_TABLE;
const CALL = 'core."inconnectVoiceCall"';
const LEG = 'core."inconnectVoiceCallLeg"';

export type InboundRoute = {
  actorMemberId: string;
  actorLabel: string;
  recordId: string;
  sessionId: string;
  scope: VoiceRecordCondition;
};

export const unavailableInbound = () =>
  new ForbiddenException('Inbound Voice is unavailable');

@Injectable()
export class InconnectVoiceInboundStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private withCondition(
    sql: string,
    scope: VoiceRecordCondition,
    values: unknown[],
  ) {
    return this.dataSource.driver.escapeQueryWithParameters(
      sql,
      scope.parameters,
      { ...values },
    );
  }

  async create(
    config: VoiceInboundConfig,
    id: string,
    parentSid: string,
    route: InboundRoute | null,
    failure: boolean,
  ) {
    return this.dataSource.transaction(async (manager) => {
      // The SID is global to this Twilio account, including both Voice directions.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${config.accountSid}:${parentSid}`],
      );
      const [existing] = await manager.query(
        `SELECT 1 FROM ${LEG} WHERE "accountSid" = $1 AND "providerCallSid" = $2`,
        [config.accountSid, parentSid],
      );
      if (existing) return false;

      if (route)
        await manager.query(
          `UPDATE ${CALL} SET status = 'finished', result = 'canceled', "technicalError" = 'reservation-expired'
          WHERE "workspaceId" = $1 AND "actorMemberId" = $2 AND direction = 'outbound'
            AND status = 'reserved' AND "expiresAt" <= clock_timestamp()`,
          [config.workspaceId, route.actorMemberId],
        );

      const common = [
        id,
        config.workspaceId,
        config.accountSid,
        config.applicationSid,
        config.source,
        config.receiver,
      ];
      const values = route
        ? [
            ...common,
            config.objectId,
            route.recordId,
            route.actorMemberId,
            route.actorLabel,
            route.sessionId,
          ]
        : [];
      const busyValues = values.slice(0, 10);
      const selectable = `FROM (SELECT $8::uuid AS "recordId") call WHERE (${route?.scope.sql ?? 'FALSE'})`;
      const columns = `id, "workspaceId", direction, "accountSid", "applicationSid", "callerId", destination, "expiresAt", status, result`;
      const base = `$1, $2, 'inbound', $3, $4, $5, $6, clock_timestamp() + interval '35 seconds'`;
      const linkColumns = `"objectMetadataId", "recordId", "actorMemberId", "actorLabel"`;
      const [active] = route
        ? await manager.query(
            ...this.withCondition(
              `INSERT INTO ${CALL} (${columns}, ${linkColumns}, "inboundSessionId", "startedAt", "nextReconcileAt")
             SELECT ${base}, 'ringing', NULL, $7, $8, $9, $10, $11, clock_timestamp(), clock_timestamp()
             ${selectable}
             ON CONFLICT ("workspaceId", "actorMemberId") WHERE status <> 'finished' DO NOTHING
             RETURNING id`,
              route.scope,
              values,
            ),
          )
        : [];
      if (!active) {
        const [busy] = route
          ? await manager.query(
              ...this.withCondition(
                `INSERT INTO ${CALL} (${columns}, ${linkColumns}, "endedAt")
               SELECT ${base}, 'finished', 'busy', $7, $8, $9, $10, clock_timestamp()
               ${selectable} RETURNING id`,
                route.scope,
                busyValues,
              ),
            )
          : [];
        if (!busy)
          await manager.query(
            `INSERT INTO ${CALL} (${columns}, "actorLabel", "endedAt", "technicalError")
           VALUES (${base}, 'finished', $7, '', clock_timestamp(), 'routing-denied')`,
            [...common, failure ? 'failed' : 'no-answer'],
          );
      }

      await manager.query(
        `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", kind) VALUES ($1, $2, $3, 'caller')`,
        [id, config.accountSid, parentSid],
      );
      return Boolean(active);
    });
  }

  distribute(
    config: VoiceInboundConfig,
    id: string,
    parentSid: string,
    plan: VoiceInboundPlan,
    stillAvailable: (candidate: VoiceInboundCandidate) => Promise<boolean>,
  ) {
    return this.dataSource.transaction((manager) =>
      reserveVoiceInboundOffer(
        manager,
        this.dataSource.driver,
        config,
        id,
        parentSid,
        plan,
        stillAvailable,
      ),
    );
  }

  private async lock(
    manager: EntityManager,
    config: VoiceInboundConfig,
    event: VoiceInboundEvent,
  ) {
    const multi = Boolean(config.distribution);
    const [call]: LockedVoiceInbound[] = await manager.query(
      `SELECT call.id, call."inboundSessionId" AS "sessionId"${
        multi
          ? `,
          call."recordId", call.status, call."inboundDecision" AS decision,
          call."inboundScreenedAt" IS NOT NULL AS screened, call."inboundDialSettled" AS "dialSettled"`
          : ''
      }
       FROM ${CALL} call JOIN ${LEG} parent ON parent."callId"=call.id AND parent.kind='caller'
       WHERE call.direction='inbound' AND call."workspaceId"=$2 AND call."accountSid"=$3
         AND parent."providerCallSid"=$1 AND ($4::uuid IS NULL OR call.id=$4)
         AND call."callerId"=$5 AND call.destination=$6
       FOR UPDATE OF call`,
      [
        event.parentSid,
        config.workspaceId,
        config.accountSid,
        multi ? null : event.id,
        config.source,
        config.receiver,
      ],
    );
    if (!call) {
      if (event.id === null || multi) return null;
      throw unavailableInbound();
    }
    const [offer]: Pick<LockedVoiceInbound, 'offerId' | 'ordinal' | 'pool'>[] =
      multi && call.sessionId
        ? await manager.query(
            `SELECT id AS "offerId", ordinal, pool FROM ${OFFER} WHERE "callId"=$1 AND "sessionId"=$2`,
            [call.id, call.sessionId],
          )
        : [];
    // The offer is read after taking the root lock. A callback waiting for the
    // previous offer can never attach its leg or terminal result to the next one.
    if (
      multi &&
      event.id !== null &&
      event.id !== call.id &&
      event.id !== offer?.offerId
    )
      return null;
    const row = { ...call, ...offer };
    if (event.childSid) {
      if (!row.sessionId) throw unavailableInbound();
      const [child]: { providerCallSid: string }[] = await manager.query(
        `SELECT "providerCallSid" FROM ${LEG} WHERE "callId" = $1 AND kind = 'browser-inbound'
          ${multi ? 'AND "inboundOfferId" IS NOT DISTINCT FROM $2::uuid' : ''}`,
        multi ? [row.id, row.offerId ?? null] : [row.id],
      );
      if (child && child.providerCallSid !== event.childSid)
        throw unavailableInbound();
      if (!child) {
        const [inserted] = await manager.query(
          `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", "parentCallSid", kind${multi ? ', "inboundOfferId"' : ''})
           VALUES ($1, $2, $3, $4, 'browser-inbound'${multi ? ', $5' : ''}) ON CONFLICT DO NOTHING RETURNING "callId"`,
          [
            row.id,
            config.accountSid,
            event.childSid,
            event.parentSid,
            ...(multi ? [row.offerId ?? null] : []),
          ],
        );
        if (!inserted) throw unavailableInbound();
      }
    }
    return row;
  }

  private actorCondition = `call.id = $1 AND call."workspaceId" = $2 AND call."accountSid" = $3
    AND call."actorMemberId" = $4 AND call."inboundSessionId" = $5
    AND call."callerId" = $6 AND call.destination = $7
    AND (call."objectMetadataId" = $8 OR (call."objectMetadataId" IS NULL AND call."recordId" IS NULL))
    AND call.direction = 'inbound'`;

  private actorValues(
    config: VoiceInboundConfig,
    id: string,
    memberId: string,
    sessionId: string,
  ) {
    return [
      id,
      config.workspaceId,
      config.accountSid,
      memberId,
      sessionId,
      config.source,
      config.receiver,
      config.objectId,
    ];
  }

  async read(
    config: VoiceInboundConfig,
    id: string,
    memberId: string,
    sessionId: string,
    scope: VoiceRecordCondition & { name: string; visibleRecordId?: string },
  ) {
    const [row]: (VoiceProgress & {
      id: string;
      recordId: string | null;
      name: string | null;
      number: string;
    })[] = await this.dataSource.query(
      ...this.withCondition(
        `SELECT call.id, ${scope.visibleRecordId ?? 'call."recordId"'} AS "recordId", call."callerId" AS number, ${scope.name} AS name,
          call.status, call.result, call."answeredAt", call."endedAt", call."durationSeconds"
         FROM ${CALL} call WHERE ${this.actorCondition} AND (${scope.sql})`,
        scope,
        this.actorValues(config, id, memberId, sessionId),
      ),
    );
    if (!row) throw unavailableInbound();
    return row;
  }

  async decide(
    config: VoiceInboundConfig,
    id: string,
    memberId: string,
    sessionId: string,
    scope: VoiceRecordCondition,
    decision: 'accept' | 'decline',
  ) {
    const [row] = await this.dataSource.query(
      ...this.withCondition(
        `WITH decided AS (
          UPDATE ${CALL} call SET "inboundDecision" = $9
          WHERE ${this.actorCondition} AND (${scope.sql}) AND status = 'ringing'
            AND "expiresAt" > clock_timestamp()
            AND ("inboundDecision" IS NULL OR "inboundDecision" = $9)
          RETURNING id
        ) SELECT id FROM decided`,
        scope,
        [...this.actorValues(config, id, memberId, sessionId), decision],
      ),
    );
    if (!row) throw unavailableInbound();
  }

  async screen(
    config: VoiceInboundConfig,
    event: VoiceInboundEvent,
    memberId: string,
    sessionId: string,
    scope: VoiceRecordCondition,
    mayBridge?: () => Promise<boolean>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      if (mayBridge) {
        await lockVoiceReservations(manager, config.workspaceId);
        if (!(await mayBridge())) return false;
      }
      const row = await this.lock(manager, config, event);
      if (!row || row.sessionId !== sessionId) return false;
      const [screened] = await manager.query(
        ...this.withCondition(
          `WITH screened AS (
            UPDATE ${CALL} call SET "inboundScreenedAt" = COALESCE("inboundScreenedAt", clock_timestamp()),
              status = 'answered', "answeredAt" = COALESCE("answeredAt", clock_timestamp())
            WHERE ${this.actorCondition} AND (${scope.sql}) AND "inboundDecision" = 'accept'
              AND status IN ('ringing', 'answered') AND "expiresAt" > clock_timestamp()
            RETURNING id
          ) SELECT id FROM screened`,
          scope,
          this.actorValues(config, row.id, memberId, sessionId),
        ),
      );
      return Boolean(screened);
    });
  }

  async progress(
    config: VoiceInboundConfig,
    event: VoiceInboundEvent,
    terminal: boolean,
  ): Promise<VoiceProviderTarget | null> {
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, config, event);
      return row?.sessionId && terminal
        ? {
            ...event,
            id: row.id,
            direction: 'inbound',
            ...(row.offerId ? { offerId: row.offerId } : {}),
          }
        : null;
    });
  }

  async settle(
    config: VoiceInboundConfig,
    event: VoiceInboundEvent,
    progress: VoiceProgress,
    dial: boolean,
  ): Promise<VoiceProviderTarget | null> {
    if (progress.status !== 'finished' || !progress.result) return null;
    return this.dataSource.transaction(async (manager) => {
      const rootTerminal = config.distribution && event.id === null && !dial;
      if (rootTerminal)
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${config.accountSid}:${event.parentSid}`],
        );
      const row = await this.lock(manager, config, event);
      if (!row && rootTerminal) {
        await persistVoiceInboundRootTermination(
          manager,
          config,
          event.parentSid,
          progress,
        );
      }
      if (!row?.sessionId) return null;
      return finalizeVoiceInboundOffer(
        manager,
        config,
        event,
        row,
        progress,
        dial,
      );
    });
  }

  async completeDistribution(
    config: VoiceInboundConfig,
    event: VoiceInboundEvent,
    progress: VoiceProgress,
    plan: VoiceInboundPlan | null,
    stillAvailable: (candidate: VoiceInboundCandidate) => Promise<boolean>,
  ): Promise<
    | { kind: 'duplicate' | 'terminal' }
    | { kind: 'next'; callId: string; selected: SelectedVoiceOffer }
  > {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SET LOCAL lock_timeout = '2500ms'");
      await lockVoiceReservations(manager, config.workspaceId);
      const row = await this.lock(manager, config, event);
      if (!row?.sessionId || row.dialSettled) return { kind: 'duplicate' };
      const pool = plan?.pool;
      const scope = plan?.routeScope;
      const distribution = config.distribution;
      if (
        row.offerId &&
        row.ordinal &&
        row.status === 'ringing' &&
        !row.screened &&
        row.decision !== 'accept' &&
        (row.decision === 'decline' ||
          progress.result === 'no-answer' ||
          progress.result === 'busy') &&
        progress.result !== 'canceled' &&
        distribution &&
        row.ordinal < distribution.maxAttempts &&
        pool &&
        pool.key === row.pool &&
        scope &&
        row.recordId === plan.recordId
      ) {
        const [remaining]: { seconds: number }[] = await manager.query(
          `SELECT floor(extract(epoch FROM ("createdAt" + make_interval(secs => $2::int) - clock_timestamp())))::int AS seconds
            FROM ${CALL} WHERE id=$1`,
          [row.id, distribution.distributionSeconds],
        );
        // Twilio can add a small margin to its configured Dial timeout.
        const ringSeconds = Math.min(
          distribution.ringSeconds,
          remaining.seconds - 5,
        );
        if (ringSeconds >= 8) {
          const next = await reserveNextVoiceInboundOffer(
            manager,
            this.dataSource.driver,
            config,
            row,
            progress,
            pool,
            scope,
            plan.ownerId,
            ringSeconds,
            stillAvailable,
          );
          if (next) return { kind: 'next', callId: row.id, selected: next };
        }
      }

      await finalizeVoiceInboundOffer(
        manager,
        config,
        event,
        row,
        progress,
        true,
      );
      return { kind: 'terminal' };
    });
  }
}
