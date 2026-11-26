import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type EntityManager } from 'typeorm';

import {
  type VoiceProviderTarget,
  type VoiceRecordCondition,
} from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type VoiceProgress } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

const CALL = 'core."inconnectVoiceCall"';
const LEG = 'core."inconnectVoiceCallLeg"';

export type InboundRoute = {
  actorMemberId: string;
  actorLabel: string;
  recordId: string;
  sessionId: string;
  scope: VoiceRecordCondition;
};

type Event = {
  id: string | null;
  parentSid: string;
  childSid: string | null;
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

  private async lock(
    manager: EntityManager,
    config: VoiceInboundConfig,
    event: Event,
  ) {
    const [row]: { id: string; sessionId: string | null }[] =
      await manager.query(
        `SELECT call.id, call."inboundSessionId" AS "sessionId"
       FROM ${CALL} call JOIN ${LEG} parent ON parent."callId" = call.id AND parent.kind = 'caller'
       WHERE call.direction = 'inbound' AND call."workspaceId" = $1 AND call."accountSid" = $2
         AND parent."providerCallSid" = $3 AND ($4::uuid IS NULL OR call.id = $4)
         AND call."callerId" = $5 AND call.destination = $6
       FOR UPDATE OF call`,
        [
          config.workspaceId,
          config.accountSid,
          event.parentSid,
          event.id,
          config.source,
          config.receiver,
        ],
      );
    if (!row) {
      if (event.id === null) return null;
      throw unavailableInbound();
    }
    if (event.childSid) {
      if (!row.sessionId) throw unavailableInbound();
      const [child]: { providerCallSid: string }[] = await manager.query(
        `SELECT "providerCallSid" FROM ${LEG} WHERE "callId" = $1 AND kind = 'browser-inbound'`,
        [row.id],
      );
      if (child && child.providerCallSid !== event.childSid)
        throw unavailableInbound();
      if (!child) {
        const [inserted] = await manager.query(
          `INSERT INTO ${LEG} ("callId", "accountSid", "providerCallSid", "parentCallSid", kind)
           VALUES ($1, $2, $3, $4, 'browser-inbound') ON CONFLICT DO NOTHING RETURNING "callId"`,
          [row.id, config.accountSid, event.childSid, event.parentSid],
        );
        if (!inserted) throw unavailableInbound();
      }
    }
    return row;
  }

  private actorCondition = `call.id = $1 AND call."workspaceId" = $2 AND call."accountSid" = $3
    AND call."actorMemberId" = $4 AND call."inboundSessionId" = $5
    AND call."callerId" = $6 AND call.destination = $7 AND call."objectMetadataId" = $8
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
    scope: VoiceRecordCondition & { name: string },
  ) {
    const [row]: (VoiceProgress & {
      id: string;
      recordId: string;
      name: string | null;
      number: string;
    })[] = await this.dataSource.query(
      ...this.withCondition(
        `SELECT call.id, call."recordId", call."callerId" AS number, ${scope.name} AS name,
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
    event: Event,
    memberId: string,
    sessionId: string,
    scope: VoiceRecordCondition,
  ) {
    return this.dataSource.transaction(async (manager) => {
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
    event: Event,
    terminal: boolean,
  ): Promise<VoiceProviderTarget | null> {
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, config, event);
      return row?.sessionId && terminal
        ? { ...event, id: row.id, direction: 'inbound' }
        : null;
    });
  }

  async settle(
    config: VoiceInboundConfig,
    event: Event,
    progress: VoiceProgress,
    dial: boolean,
  ): Promise<VoiceProviderTarget | null> {
    if (progress.status !== 'finished' || !progress.result) return null;
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, config, event);
      if (!row?.sessionId) return null;

      const [incomplete]: { childSid: string }[] = await manager.query(
        `WITH verdict AS (
           SELECT id, CASE
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
             COALESCE(c."endedAt", $4::timestamptz) AS ended,
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
         WHERE (updated.result = 'answered' AND updated."durationSeconds" IS NULL)
            OR (updated.result = 'no-answer' AND NOT updated."inboundDialSettled")`,
        [
          row.id,
          dial,
          progress.result,
          progress.endedAt,
          progress.durationSeconds,
        ],
      );
      return incomplete
        ? {
            id: row.id,
            parentSid: event.parentSid,
            childSid: incomplete.childSid,
            direction: 'inbound',
          }
        : null;
    });
  }
}
