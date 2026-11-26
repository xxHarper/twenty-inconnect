import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import {
  mergeVoiceProgress,
  type VoiceProgress,
} from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

const CALL = 'core."inconnectVoiceCall"';
const LEG = 'core."inconnectVoiceCallLeg"';
const PROJECTION =
  'call.id, call.status, call.result, call."answeredAt", call."endedAt", call."durationSeconds"';
const EXPIRED = `call.status = 'reserved' AND call."expiresAt" <= clock_timestamp()`;
const PUBLIC_PROJECTION = `call.id, CASE WHEN ${EXPIRED} THEN 'finished' ELSE call.status END AS status,
  CASE WHEN ${EXPIRED} THEN 'canceled' ELSE call.result END AS result,
  call."answeredAt", call."endedAt", call."durationSeconds"`;

type VoiceActor = {
  workspaceId: string;
  actorMemberId: string;
};
export type VoiceRecordCondition = {
  sql: string;
  parameters: Record<string, unknown>;
};

type VoiceReservation = VoiceActor & {
  id: string;
  recordId: string | null;
  destination: string;
  expiresAt: number;
};

export type VoiceProviderTarget = {
  id: string;
  parentSid: string;
  childSid: string | null;
  direction?: 'outbound' | 'inbound';
};

@Injectable()
export class InconnectVoiceCallStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private withRecordCondition(
    sql: string,
    scope: VoiceRecordCondition,
    parameters: unknown[],
  ) {
    return this.dataSource.driver.escapeQueryWithParameters(
      sql,
      scope.parameters,
      { ...parameters },
    );
  }

  async reserve(
    config: InconnectVoiceConfig,
    attempt: VoiceReservation,
    actorLabel: string,
    scope: VoiceRecordCondition,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE ${CALL} SET status = 'finished', result = 'canceled',
        "technicalError" = 'reservation-expired'
        WHERE "workspaceId" = $1 AND "actorMemberId" = $2 AND status = 'reserved'
          AND "expiresAt" <= clock_timestamp()`,
        [attempt.workspaceId, attempt.actorMemberId],
      );

      const rows: { id: string }[] = await manager.query(
        ...this.withRecordCondition(
          `INSERT INTO ${CALL} (id, "workspaceId", "objectMetadataId", "recordId", "actorMemberId",
           "actorLabel", direction, "accountSid", "applicationSid", "callerId", destination, "expiresAt")
         SELECT $1, $2, $3, $4, $5, $6, 'outbound', $7, $8, $9, $10, $11
         FROM (SELECT $4::uuid AS "recordId") call
         WHERE $11::timestamptz > clock_timestamp() AND (${scope.sql})
         ON CONFLICT ("workspaceId", "actorMemberId") WHERE status <> 'finished' DO NOTHING
         RETURNING id`,
          scope,
          [
            attempt.id,
            attempt.workspaceId,
            attempt.recordId === null ? null : config.objectId,
            attempt.recordId,
            attempt.actorMemberId,
            actorLabel,
            config.accountSid,
            config.applicationSid,
            config.callerId,
            attempt.destination,
            new Date(attempt.expiresAt),
          ],
        ),
      );

      return rows.length === 1;
    });
  }

  async claim(
    config: InconnectVoiceConfig,
    attempt: VoiceReservation,
    parentSid: string,
    scope: VoiceRecordCondition,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const rows: { id: string }[] = await manager.query(
        ...this.withRecordCondition(
          `WITH claimed AS (
           UPDATE ${CALL} AS call SET status = 'connecting', "startedAt" = clock_timestamp(),
             "nextReconcileAt" = clock_timestamp() + interval '20 seconds'
           WHERE id = $1 AND "workspaceId" = $2 AND "objectMetadataId" IS NOT DISTINCT FROM $3
             AND "recordId" IS NOT DISTINCT FROM $4 AND "actorMemberId" = $5 AND "accountSid" = $6
             AND "applicationSid" = $7 AND "callerId" = $8 AND destination = $9
             AND status = 'reserved' AND "expiresAt" > clock_timestamp() AND (${scope.sql})
           RETURNING id, "accountSid"
         )
         INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", kind)
         SELECT id, "accountSid", $10, 'browser' FROM claimed
         RETURNING "callId" AS id`,
          scope,
          [
            attempt.id,
            attempt.workspaceId,
            attempt.recordId === null ? null : config.objectId,
            attempt.recordId,
            attempt.actorMemberId,
            config.accountSid,
            config.applicationSid,
            config.callerId,
            attempt.destination,
            parentSid,
          ],
        ),
      );

      return rows.length === 1;
    });
  }

  async cancelReservation(
    actor: VoiceActor,
    callId: string,
    expiredOnly: boolean,
    scope: VoiceRecordCondition,
  ) {
    await this.dataSource.query(
      ...this.withRecordCondition(
        `UPDATE ${CALL} AS call SET status = 'finished', result = 'canceled',
        "technicalError" = CASE WHEN "expiresAt" <= clock_timestamp() THEN 'reservation-expired' END
        WHERE id = $1 AND "workspaceId" = $2 AND "actorMemberId" = $3 AND status = 'reserved'
          AND (NOT $4::boolean OR "expiresAt" <= clock_timestamp()) AND (${scope.sql})`,
        scope,
        [callId, actor.workspaceId, actor.actorMemberId, expiredOnly],
      ),
    );
  }

  async denyRouting(config: InconnectVoiceConfig, attempt: VoiceReservation) {
    await this.dataSource.query(
      `UPDATE ${CALL} SET status = 'finished', result = 'failed',
      "technicalError" = 'routing-denied'
      WHERE id = $1 AND "workspaceId" = $2 AND "actorMemberId" = $3 AND "objectMetadataId" IS NOT DISTINCT FROM $4
        AND "recordId" IS NOT DISTINCT FROM $5 AND "accountSid" = $6 AND "applicationSid" = $7
        AND destination = $8 AND status = 'reserved'`,
      [
        attempt.id,
        attempt.workspaceId,
        attempt.actorMemberId,
        attempt.recordId === null ? null : config.objectId,
        attempt.recordId,
        config.accountSid,
        config.applicationSid,
        attempt.destination,
      ],
    );
  }

  async recordProgress(
    config: InconnectVoiceConfig,
    target: VoiceProviderTarget,
    evidence: VoiceProgress,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const [call]: VoiceProgress[] = await manager.query(
        `SELECT ${PROJECTION}
         FROM ${CALL} call
         INNER JOIN ${LEG} browser ON browser."callId" = call.id AND browser.kind = 'browser'
         WHERE call.id = $1 AND call."workspaceId" = $2 AND call."accountSid" = $3
           AND call.direction = 'outbound' AND call."applicationSid" = $4 AND browser."providerCallSid" = $5
         FOR UPDATE OF call`,
        [
          target.id,
          config.workspaceId,
          config.accountSid,
          config.applicationSid,
          target.parentSid,
        ],
      );

      if (!call) {
        throw new ForbiddenException('Voice callback is unavailable');
      }

      // Read the binding after acquiring the call lock, including concurrent first deliveries.
      const [child]: { providerCallSid: string }[] = await manager.query(
        `SELECT "providerCallSid" FROM ${LEG} WHERE "callId" = $1 AND kind = 'destination'`,
        [target.id],
      );
      if (
        target.childSid &&
        child &&
        child.providerCallSid !== target.childSid
      ) {
        throw new ForbiddenException('Voice callback is unavailable');
      }
      if (!target.childSid && child) return;
      if (target.childSid && !child) {
        const bound: { providerCallSid: string }[] = await manager.query(
          `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", "parentCallSid", kind)
           VALUES ($1, $2, $3, $4, 'destination')
           ON CONFLICT DO NOTHING
           RETURNING "providerCallSid"`,
          [target.id, config.accountSid, target.childSid, target.parentSid],
        );
        if (bound.length !== 1)
          throw new ForbiddenException('Voice callback is unavailable');
      }

      const progress = mergeVoiceProgress(call, evidence);
      await manager.query(
        `UPDATE ${CALL} SET status = $2, result = $3, "answeredAt" = $4, "endedAt" = $5,
           "durationSeconds" = $6, "technicalError" = CASE WHEN $3 = 'failed' THEN 'provider-failed' END
         WHERE id = $1 AND (status, result, "answeredAt", "endedAt", "durationSeconds")
           IS DISTINCT FROM ($2::text, $3::text, $4::timestamptz, $5::timestamptz, $6::integer)`,
        [
          target.id,
          progress.status,
          progress.result,
          progress.answeredAt,
          progress.endedAt,
          progress.durationSeconds,
        ],
      );
    });
  }

  async leaseReconciliation(
    config: InconnectVoiceConfig,
    actor: VoiceActor,
    callId?: string,
    scope?: VoiceRecordCondition,
  ) {
    const [target]: VoiceProviderTarget[] = await this.dataSource.query(
      ...this.withRecordCondition(
        `WITH leased AS (
         UPDATE ${CALL} AS call SET "reconcileAttempts" = "reconcileAttempts" + 1,
           "nextReconcileAt" = clock_timestamp() + make_interval(secs => CASE
             WHEN "reconcileAttempts" < 2 THEN 20 WHEN "reconcileAttempts" < 5 THEN 45 ELSE 300 END)
         WHERE "workspaceId" = $1 AND "actorMemberId" = $2 AND "accountSid" = $3 AND "applicationSid" = $4
           AND (($5::uuid IS NULL AND status <> 'finished') OR id = $5)
           AND (status <> 'finished' OR "endedAt" IS NULL OR (result = 'answered' AND "durationSeconds" IS NULL))
           AND "nextReconcileAt" <= clock_timestamp() AND (${scope?.sql ?? 'TRUE'})
         RETURNING id, direction
       )
       SELECT leased.id, leased.direction, browser."providerCallSid" AS "parentSid", child."providerCallSid" AS "childSid"
       FROM leased JOIN ${LEG} browser ON browser."callId" = leased.id AND browser.kind = CASE WHEN leased.direction = 'inbound' THEN 'caller' ELSE 'browser' END
       LEFT JOIN ${LEG} child ON child."callId" = leased.id AND child.kind = CASE WHEN leased.direction = 'inbound' THEN 'browser-inbound' ELSE 'destination' END`,
        scope ?? { sql: 'TRUE', parameters: {} },
        [
          actor.workspaceId,
          actor.actorMemberId,
          config.accountSid,
          config.applicationSid,
          callId ?? null,
        ],
      ),
    );

    return target ?? null;
  }

  private authorizedCalls(
    config: InconnectVoiceConfig,
    recordId: string | null,
    scope: VoiceRecordCondition,
  ) {
    return this.dataSource
      .createQueryBuilder()
      .from('core.inconnectVoiceCall', 'call')
      .where(
        `call."workspaceId" = :voiceWorkspaceId AND ${
          recordId === null
            ? 'call."objectMetadataId" IS NULL AND call."recordId" IS NULL'
            : 'call."objectMetadataId" = :voiceObjectId AND call."recordId" = :voiceRecordId'
        }`,
        {
          voiceWorkspaceId: config.workspaceId,
          voiceObjectId: config.objectId,
          voiceRecordId: recordId,
        },
      )
      .andWhere(scope.sql, scope.parameters);
  }

  callStatus(
    config: InconnectVoiceConfig,
    recordId: string | null,
    scope: VoiceRecordCondition,
    callId: string,
    actorMemberId: string,
  ) {
    return this.authorizedCalls(config, recordId, scope)
      .select(PUBLIC_PROJECTION)
      .andWhere(
        'call.id = :voiceCallId AND call."actorMemberId" = :voiceActorMemberId',
        {
          voiceCallId: callId,
          voiceActorMemberId: actorMemberId,
        },
      )
      .getRawOne<VoiceProgress & { id: string }>();
  }

  async recents(
    actor: VoiceActor,
    visibility: VoiceRecordCondition,
    name: string,
    before?: string,
  ) {
    const authorized = this.dataSource
      .createQueryBuilder()
      .from('core.inconnectVoiceCall', 'call')
      .where(
        'call."workspaceId" = :workspaceId AND call."actorMemberId" = :actorMemberId',
        actor,
      )
      .andWhere(visibility.sql, visibility.parameters);

    const cursor = authorized
      .clone()
      .select('call."createdAt", call.id')
      .andWhere('call.id = :before');

    const page = authorized
      .select(PUBLIC_PROJECTION)
      .addSelect('call."createdAt"::text', 'createdAt')
      .addSelect('call.direction', 'direction')
      .addSelect(
        `CASE WHEN call.direction = 'inbound' THEN call."callerId" ELSE call.destination END`,
        'destination',
      )
      .addSelect(name, 'name')
      .addSelect('call."recordId"', 'recordId')
      .orderBy('call."createdAt"', 'DESC')
      .addOrderBy('call.id', 'DESC')
      .limit(21);

    if (before)
      page.andWhere(`(call."createdAt", call.id) < (${cursor.getQuery()})`, {
        before,
      });

    const rows = await page.getRawMany<
      VoiceProgress & {
        id: string;
        createdAt: string;
        direction: 'outbound' | 'inbound';
        destination: string;
        name: string | null;
        recordId: string | null;
      }
    >();

    return {
      rows: rows.slice(0, 20),
      next: rows.length > 20 ? rows[19].id : null,
    };
  }

  async history(
    config: InconnectVoiceConfig,
    recordId: string,
    scope: VoiceRecordCondition,
    actorMemberId: string,
    before?: string,
  ) {
    const authorized = this.authorizedCalls(config, recordId, scope)
      .select(
        `${PUBLIC_PROJECTION}, call.direction, call."actorLabel", call."createdAt",
        call.direction = 'outbound' AND call."actorMemberId" = :voiceMemberId AS "canReconcile"`,
      )
      .setParameter('voiceMemberId', actorMemberId);

    return this.dataSource
      .createQueryBuilder()
      .addCommonTableExpression(authorized, 'authorized')
      .select('COUNT(*)::int', 'attempts')
      .addSelect(
        `COUNT(*) FILTER (WHERE status = 'answered' OR result = 'answered')::int`,
        'answered',
      )
      .addSelect('COALESCE(SUM("durationSeconds"), 0)::text', 'durationSeconds')
      .addSelect(
        `(
        SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page."createdAt" DESC, page.id DESC), '[]'::jsonb)
        FROM (
          SELECT * FROM authorized
          WHERE :voiceBefore::uuid IS NULL OR ("createdAt", id) <
            (SELECT "createdAt", id FROM authorized WHERE id = :voiceBefore::uuid)
          ORDER BY "createdAt" DESC, id DESC LIMIT 21
        ) page
      )`,
        'rows',
      )
      .from('authorized', 'authorized')
      .setParameter('voiceBefore', before ?? null)
      .getRawOne<{
        attempts: number;
        answered: number;
        durationSeconds: string;
        rows: (VoiceProgress & {
          id: string;
          createdAt: string;
          actorLabel: string;
          direction: 'outbound' | 'inbound';
          canReconcile: boolean;
        })[];
      }>();
  }
}
