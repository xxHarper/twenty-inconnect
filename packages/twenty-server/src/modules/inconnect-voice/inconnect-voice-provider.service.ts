import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { type Request } from 'express';
import Twilio from 'twilio';

import {
  InconnectVoiceCallStore,
  type VoiceProviderTarget,
} from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import {
  getVoiceInboundConfig,
  type VoiceInboundConfig,
  INCONNECT_VOICE_PATH,
  type InconnectVoiceConfig,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { normalizeVoiceDialNumber } from 'src/modules/inconnect-voice/inconnect-voice-dial-number';
import {
  isTwilioCallSid,
  readTwilioProgress,
} from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

import { InconnectVoiceInboundStore } from 'src/modules/inconnect-voice/inconnect-voice-inbound.store';

const callbackPath = `/${INCONNECT_VOICE_PATH}/call-progress`;
const forbidden = () => new ForbiddenException('Voice callback is unavailable');
type WebhookRequest = Request & { rawBody?: Buffer };

export const voiceProgressUrl = (
  config: InconnectVoiceConfig,
  id: string,
  source: 'number' | 'dial',
) => new URL(`${callbackPath}?id=${id}&source=${source}`, config.voiceUrl).href;

export const readSignedVoiceWebhook = (
  request: WebhookRequest,
  config: InconnectVoiceConfig,
  url: string,
) => {
  const signature = request.headers['x-twilio-signature'];
  const rawBody = request.rawBody;
  const { pathname, search } = new URL(url);

  if (
    request.originalUrl !== pathname + search ||
    typeof signature !== 'string' ||
    !/^[a-zA-Z0-9+/]{27}=$/.test(signature) ||
    !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers['content-type'] ?? '',
    ) ||
    !rawBody?.length ||
    rawBody.length > 16_384
  )
    throw forbidden();

  const entries = [...new URLSearchParams(rawBody.toString('utf8'))];
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw forbidden();

  const params = Object.fromEntries(entries);
  if (
    !Twilio.validateRequest(config.authToken, signature, url, params) ||
    params.AccountSid !== config.accountSid
  ) {
    throw forbidden();
  }

  return params;
};

@Injectable()
export class InconnectVoiceProviderService {
  private readonly logger = new Logger(InconnectVoiceProviderService.name);

  constructor(
    private readonly calls: InconnectVoiceCallStore,
    @Optional() private readonly inbound?: InconnectVoiceInboundStore,
  ) {}

  async callback(request: WebhookRequest, config: InconnectVoiceConfig) {
    const match =
      /\?id=([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})&source=(number|dial)$/.exec(
        request.originalUrl,
      );
    const id = match?.[1];
    const source = match?.[2];
    if (!id || (source !== 'number' && source !== 'dial')) throw forbidden();

    const params = readSignedVoiceWebhook(
      request,
      config,
      voiceProgressUrl(config, id, source),
    );
    const isNumber = source === 'number';
    const parentSid = isNumber ? params.ParentCallSid : params.CallSid;
    const childSid = isNumber ? params.CallSid : params.DialCallSid || null;
    const progress = readTwilioProgress({
      status: (isNumber ? params.CallStatus : params.DialCallStatus) ?? '',
      eventTime: isNumber ? params.Timestamp : undefined,
      // Duration from the Number event belongs to this exact destination leg.
      duration: isNumber ? params.CallDuration : undefined,
    });

    if (
      !isTwilioCallSid(parentSid) ||
      !progress ||
      (childSid !== null &&
        (!isTwilioCallSid(childSid) || childSid === parentSid)) ||
      (isNumber &&
        (params.CallbackSource !== 'call-progress-events' || !childSid)) ||
      (!isNumber &&
        (progress.status !== 'finished' ||
          (!childSid && progress.result === 'answered')))
    )
      throw forbidden();

    await this.calls.recordProgress(
      config,
      { id, parentSid, childSid },
      progress,
    );
    // The same endpoint can finish a synchronous Dial action and acknowledge a Number event.
    return new Twilio.twiml.VoiceResponse().toString();
  }

  async hasActiveInboundCaller(config: VoiceInboundConfig, sid: string) {
    try {
      const client = Twilio(config.apiKeySid, config.apiKeySecret, {
        accountSid: config.accountSid,
        autoRetry: false,
        timeout: 5_000,
      });
      const call = await client.calls(sid).fetch();
      return (
        call.sid === sid &&
        call.accountSid === config.accountSid &&
        call.direction === 'inbound' &&
        !call.parentCallSid &&
        call.to === config.receiver &&
        normalizeVoiceDialNumber(call.from, config).number === config.source &&
        (call.status === 'in-progress' || call.status === 'ringing')
      );
    } catch {
      return false;
    }
  }

  async reconcile(config: InconnectVoiceConfig, target: VoiceProviderTarget) {
    try {
      const client = Twilio(config.apiKeySid, config.apiKeySecret, {
        accountSid: config.accountSid,
        autoRetry: false,
        timeout: 5_000,
      });
      if (target.direction === 'inbound') {
        const inboundConfig = getVoiceInboundConfig();
        if (
          !this.inbound ||
          !inboundConfig ||
          inboundConfig.workspaceId !== config.workspaceId ||
          inboundConfig.accountSid !== config.accountSid
        )
          return;
        const parent = await client.calls(target.parentSid).fetch();
        if (
          parent.sid !== target.parentSid ||
          parent.accountSid !== config.accountSid ||
          parent.direction !== 'inbound' ||
          parent.parentCallSid ||
          parent.to !== inboundConfig.receiver ||
          normalizeVoiceDialNumber(parent.from, inboundConfig).number !==
            inboundConfig.source
        )
          return;
        const progress = readTwilioProgress({
          status: parent.status,
          eventTime: parent.endTime,
        });
        if (progress?.status !== 'finished') return;

        const parentEvidence = { ...progress };
        let childSid: string | null = null;
        if (target.childSid) {
          try {
            const child = await client.calls(target.childSid).fetch();
            if (
              child.sid === target.childSid &&
              child.accountSid === config.accountSid &&
              child.parentCallSid === parent.sid &&
              child.direction === 'outbound-dial'
            ) {
              const terminal = readTwilioProgress({
                status: child.status,
                duration: child.duration,
              });
              if (terminal?.status === 'finished') {
                childSid = child.sid;
                if (
                  progress.result === 'answered' &&
                  terminal.result === 'answered'
                )
                  progress.durationSeconds = terminal.durationSeconds;
                if (
                  progress.result === 'no-answer' &&
                  terminal.result === 'canceled'
                )
                  progress.result = 'canceled';
              }
            }
          } catch {
            // Parent termination remains evidence even if the child cannot be read.
          }
        }
        await this.inbound.settle(
          inboundConfig,
          { ...target, id: target.offerId ?? target.id, childSid },
          progress,
          false,
        );
        if (target.offerId) {
          // Parent termination still applies if the fetched child belonged to an older offer.
          await this.inbound.settle(
            inboundConfig,
            { id: null, parentSid: parent.sid, childSid: null },
            parentEvidence,
            false,
          );
        }
        return;
      }
      const candidates = target.childSid
        ? [await client.calls(target.childSid).fetch()]
        : await client.calls.list({
            parentCallSid: target.parentSid,
            limit: 2,
            pageSize: 2,
          });
      const call = candidates.length === 1 ? candidates[0] : undefined;
      if (
        !call ||
        call.accountSid !== config.accountSid ||
        call.parentCallSid !== target.parentSid ||
        call.direction !== 'outbound-dial' ||
        !isTwilioCallSid(call.sid) ||
        (target.childSid && target.childSid !== call.sid)
      )
        return;

      const evidence = readTwilioProgress({
        status: call.status,
        eventTime: call.status === 'in-progress' ? undefined : call.endTime,
        duration: call.duration,
      });
      if (evidence)
        await this.calls.recordProgress(
          config,
          { ...target, childSid: call.sid },
          evidence,
        );
    } catch {
      // A timeout, ambiguous provider response or database error leaves the durable call eligible for recovery.
      this.logger.warn(
        'Voice reconciliation did not persist provider evidence',
      );
    }
  }
}
