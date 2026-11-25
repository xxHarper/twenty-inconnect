import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { type Request } from 'express';
import request from 'supertest';
import { FieldMetadataType } from 'twenty-shared/types';
import Twilio from 'twilio';

import { CommonFindOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-one-query-runner.service';
import {
  type CommonInput,
  type FindOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { GraphqlQuerySelectedFieldsParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query-selected-fields/graphql-selected-fields.parser';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { InconnectVoiceDestinationService } from 'src/modules/inconnect-voice/inconnect-voice-destination.service';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { InconnectVoiceController } from 'src/modules/inconnect-voice/inconnect-voice.controller';
import { InconnectVoiceProviderService } from 'src/modules/inconnect-voice/inconnect-voice-provider.service';
import { InconnectVoiceService } from 'src/modules/inconnect-voice/inconnect-voice.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const operatorId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000003';
const objectId = '00000000-0000-4000-8000-000000000004';
const fieldId = '00000000-0000-4000-8000-000000000005';
const recordId = '00000000-0000-4000-8000-000000000006';
const accountSid = `AC${'a'.repeat(32)}`;
const signingSecret = 'synthetic-webhook-secret';
const callerId = '+12015550124';
const destination = '+12015550123';
const url = 'https://voice.example.test/auth/inconnect-voice/twiml';
const base = '/auth/inconnect-voice';
const bearer = 'Bearer crm-test';
const identity = `inc_${workspaceId.replace(/-/g, '')}_${operatorId.replace(/-/g, '')}`;

const mapOf = <T extends { id: string }>(entry: T) => ({
  universalIdentifierById: { [entry.id]: 'universal' },
  byUniversalIdentifier: { universal: entry },
});

describe('INCONNECT Voice REST boundary', () => {
  let app: INestApplication;
  const validateTokenByRequest = jest.fn();
  const readLead = jest.fn();
  const readScope = jest.fn();
  const recordCondition = jest.fn();
  const reserve = jest.fn();
  const claim = jest.fn();
  const recordProgress = jest.fn();
  const history = jest.fn();
  const intents = new Map<string, string>();
  const envelopes = new Map<string, string>();
  const storeIntent = jest.fn(async (key: string, value: string) => {
    intents.set(key, value);
    return 'OK';
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InconnectVoiceController],
      providers: [
        InconnectVoiceService,
        InconnectVoiceDestinationService,
        InconnectVoiceProviderService,
        {
          provide: InconnectVoiceCallStore,
          useValue: {
            reserve,
            claim,
            recordProgress,
            history,
            denyRouting: jest.fn().mockResolvedValue(undefined),
            leaseReconciliation: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: AccessTokenService, useValue: { validateTokenByRequest } },
        {
          provide: CommonFindOneQueryRunnerService,
          useValue: { execute: readLead },
        },
        {
          provide: WorkspaceCacheStorageService,
          useValue: { getMetadataVersion: jest.fn().mockResolvedValue(1) },
        },
        {
          provide: InconnectRecordAccessAuthorizationService,
          useValue: {
            resolveReadScope: readScope,
            buildAuthorizedRecordExistsCondition: recordCondition,
            isAuthenticatedWorkspaceMemberValid: jest
              .fn()
              .mockResolvedValue(true),
          },
        },
        {
          provide: WorkspaceCacheService,
          useValue: {
            getOrRecompute: jest.fn().mockResolvedValue({
              flatObjectMetadataMaps: mapOf({
                id: objectId,
                workspaceId,
                isActive: true,
                nameSingular: 'lead',
                fieldIds: [fieldId],
              }),
              flatFieldMetadataMaps: mapOf({
                id: fieldId,
                workspaceId,
                objectMetadataId: objectId,
                isActive: true,
                name: 'phone',
                type: FieldMetadataType.PHONES,
              }),
            }),
          },
        },
        {
          provide: SecretEncryptionService,
          useValue: {
            encryptVersioned: (value: string) => {
              const key = `sealed-${envelopes.size}`;
              envelopes.set(key, value);
              return key;
            },
            decryptVersionedOrThrow: (key: string) => envelopes.get(key),
          },
        },
        {
          provide: RedisClientService,
          useValue: {
            getClient: () => ({
              set: storeIntent,
              eval: (_script: string, _keys: number, key: string) => {
                const value = intents.get(key);
                intents.delete(key);
                return value ?? null;
              },
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(() => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('INCONNECT_VOICE_'),
      ),
    );
    jest.replaceProperty(process, 'env', {
      ...environment,
      INCONNECT_VOICE_ENABLE_OUTBOUND: 'true',
      INCONNECT_VOICE_WORKSPACE_ID: workspaceId,
      INCONNECT_VOICE_USER_WORKSPACE_ID: operatorId,
      INCONNECT_VOICE_LEAD_OBJECT_ID: objectId,
      INCONNECT_VOICE_PHONE_FIELD_ID: fieldId,
      INCONNECT_VOICE_ACCOUNT_SID: accountSid,
      INCONNECT_VOICE_API_KEY_SID: `SK${'b'.repeat(32)}`,
      INCONNECT_VOICE_API_KEY_SECRET: 'synthetic-key-secret',
      INCONNECT_VOICE_AUTH_TOKEN: signingSecret,
      INCONNECT_VOICE_TWIML_APP_SID: `AP${'c'.repeat(32)}`,
      INCONNECT_VOICE_URL: url,
      INCONNECT_VOICE_CALLER_ID: callerId,
      INCONNECT_VOICE_ALLOWED_DESTINATION: destination,
    });
    intents.clear();
    storeIntent.mockClear();
    envelopes.clear();
    recordCondition.mockReset().mockResolvedValue({
      scope: { kind: 'owner-scoped' },
      sql: 'EXISTS (SELECT 1)',
      parameters: {},
    });
    reserve.mockReset().mockResolvedValue(true);
    claim.mockReset().mockResolvedValue(true);
    recordProgress.mockReset().mockResolvedValue(undefined);
    history.mockReset().mockResolvedValue({
      attempts: 0,
      answered: 0,
      durationSeconds: '0',
      rows: [],
    });
    validateTokenByRequest
      .mockReset()
      .mockImplementation(async (req: Request) => {
        if (req.headers.authorization !== bearer)
          throw new Error('Unauthenticated');
        return {
          workspace: { id: workspaceId },
          user: { id: 'user' },
          workspaceMember: { id: memberId, userId: 'user' },
          workspaceMemberId: memberId,
          userWorkspaceId: operatorId,
          tokenType: JwtTokenTypeEnum.ACCESS,
        };
      });
    readLead
      .mockReset()
      .mockImplementation(
        (
          { selectedFields }: CommonInput<FindOneQueryArgs>,
          {
            flatObjectMetadata,
            flatObjectMetadataMaps,
            flatFieldMetadataMaps,
          }: CommonBaseQueryRunnerContext,
        ) => {
          const parser = new GraphqlQuerySelectedFieldsParser(
            flatObjectMetadataMaps,
            flatFieldMetadataMaps,
          );
          const { select } = parser.parse(selectedFields, flatObjectMetadata);

          return {
            results: {
              id: recordId,
              phone: {
                primaryPhoneNumber: select.phonePrimaryPhoneNumber
                  ? '2015550123'
                  : undefined,
                primaryPhoneCallingCode: select.phonePrimaryPhoneCallingCode
                  ? '+1'
                  : undefined,
                primaryPhoneCountryCode: select.phonePrimaryPhoneCountryCode
                  ? 'US'
                  : undefined,
              },
            },
          };
        },
      );
    readScope.mockReset().mockResolvedValue({ kind: 'owner-scoped' });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  const issue = (body: unknown) =>
    request(app.getHttpServer())
      .post(`${base}/session`)
      .set('Authorization', bearer)
      .send(body as object);

  const callback = (intentId: string, validSignature = true) => {
    const form = {
      intentId,
      From: `client:${identity}`,
      AccountSid: accountSid,
      CallSid: `CA${'d'.repeat(32)}`,
      CallerId: '+12015550199',
      To: '+12015550198',
    };
    return request(app.getHttpServer())
      .post(`${base}/twiml`)
      .type('form')
      .set(
        'X-Twilio-Signature',
        Twilio.getExpectedTwilioSignature(
          validSignature ? signingSecret : 'different',
          url,
          form,
        ),
      )
      .send(form);
  };

  it('protects the endpoint and keeps a missing configuration closed', async () => {
    await request(app.getHttpServer())
      .post(`${base}/session`)
      .send({ recordId })
      .expect(403);
    delete process.env.INCONNECT_VOICE_AUTH_TOKEN;
    await request(app.getHttpServer())
      .get(`${base}/status`)
      .set('Authorization', bearer)
      .expect(200, { status: 'not-configured' });
    await issue({ recordId }).expect(503);
    expect(readLead).not.toHaveBeenCalled();
  });

  it('rejects an application token, an unapproved operator and browser-supplied routing', async () => {
    await issue({ recordId, destination, callerId }).expect(400);
    const authenticated = await validateTokenByRequest({
      headers: { authorization: bearer },
    });
    validateTokenByRequest.mockResolvedValueOnce({
      ...authenticated,
      application: { id: 'app' },
    });
    await issue({ recordId }).expect(403);
    validateTokenByRequest.mockResolvedValueOnce({
      ...authenticated,
      userWorkspaceId: memberId,
    });
    await issue({ recordId }).expect(403);
    expect(readLead).not.toHaveBeenCalled();
  });

  it('denies Record Access and any destination outside the configured test number', async () => {
    readScope.mockResolvedValueOnce({ kind: 'denied' });
    await issue({ recordId }).expect(403);
    expect(readLead).not.toHaveBeenCalled();
    readLead.mockResolvedValueOnce({
      results: { id: recordId, phone: { primaryPhoneNumber: '+12015550129' } },
    });
    await issue({ recordId }).expect(403);
    expect(intents.size).toBe(0);
  });

  it('keeps the 503 generic and logs only the stage and safe reason for a Redis ACL denial', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    storeIntent.mockRejectedValueOnce(
      new Error('NOPERM synthetic Redis message with a sensitive key'),
    );

    const { body } = await issue({ recordId }).expect(503);

    expect(body.message).toBe('Outbound Voice is unavailable');
    expect(body.token).toBeUndefined();
    expect(body.intentId).toBeUndefined();
    expect(intents.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'voice-session-unavailable',
      stage: 'store-intent',
      reason: 'redis-acl-denied',
    });
  });

  it('requires the signed callback, uses current server routing and consumes the intent once', async () => {
    const { body } = await issue({ recordId })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(body.destination).toBe(destination);
    expect(body.token.split('.')).toHaveLength(3);
    expect([...intents.values()]).toEqual(['sealed-0']);
    await callback(body.intentId, false).expect(403);
    const { text } = await callback(body.intentId).expect(200);
    expect(text).toContain(`>${destination}</Number>`);
    expect(text).toContain(
      'statusCallbackEvent="initiated ringing answered completed"',
    );
    expect(text).toContain(`callerId="${callerId}"`);
    expect(text).toContain('record="do-not-record"');
    expect(text).not.toContain('+12015550198');
    await callback(body.intentId).expect(403);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('revalidates the original authorization and persisted phone before returning TwiML', async () => {
    const revoked = await issue({ recordId }).expect(200);
    validateTokenByRequest.mockRejectedValueOnce(new Error('Revoked'));
    await callback(revoked.body.intentId).expect(403);
    const changed = await issue({ recordId }).expect(200);
    readLead.mockRejectedValueOnce(new Error('Field permission denied'));
    await callback(changed.body.intentId).expect(403);
  });

  it('returns conflict before handing a second session or token to another tab', async () => {
    reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const responses = await Promise.all([
      issue({ recordId }),
      issue({ recordId }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      responses.find(({ status }) => status === 409)?.body.token,
    ).toBeUndefined();
  });

  it('accepts only exact, signed destination progress and waits for durable persistence while outbound is disabled', async () => {
    const { body } = await issue({ recordId }).expect(200);
    await callback(body.intentId).expect(200);
    process.env.INCONNECT_VOICE_ENABLE_OUTBOUND = 'false';
    const path = `${base}/call-progress?id=${body.intentId}&source=number`;
    const form = {
      AccountSid: accountSid,
      CallSid: `CA${'e'.repeat(32)}`,
      ParentCallSid: `CA${'d'.repeat(32)}`,
      CallStatus: 'busy',
      CallbackSource: 'call-progress-events',
      SequenceNumber: '2',
      Timestamp: 'Tue, 24 Nov 2026 18:56:39 +0000',
    };
    const send = (key: string, params = form) =>
      request(app.getHttpServer())
        .post(path)
        .type('form')
        .set(
          'X-Twilio-Signature',
          Twilio.getExpectedTwilioSignature(
            key,
            `https://voice.example.test${path}`,
            params,
          ),
        )
        .send(params);

    await send('incorrect').expect(403);
    await send(signingSecret, {
      ...form,
      AccountSid: `AC${'b'.repeat(32)}`,
    }).expect(403);
    expect(recordProgress).not.toHaveBeenCalled();
    recordProgress.mockRejectedValueOnce(new Error('Database unavailable'));
    await send(signingSecret).expect(503);
    await send(signingSecret).expect(200);
    expect(recordProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId }),
      {
        id: body.intentId,
        parentSid: form.ParentCallSid,
        childSid: form.CallSid,
      },
      expect.objectContaining({
        status: 'finished',
        result: 'busy',
        durationSeconds: null,
      }),
    );
  });

  it('requires Voice authority, current CRM permissions and an authorized SQL predicate for history', async () => {
    const getHistory = () =>
      request(app.getHttpServer())
        .get(`${base}/history/${recordId}`)
        .set('Authorization', bearer);
    const actor = await validateTokenByRequest({
      headers: { authorization: bearer },
    });
    validateTokenByRequest.mockResolvedValueOnce({
      ...actor,
      workspace: { id: fieldId },
    });
    await getHistory().expect(403);
    readScope.mockResolvedValueOnce({ kind: 'denied' });
    await getHistory().expect(403);
    readLead.mockRejectedValueOnce(new Error('Object read denied'));
    await getHistory().expect(403);
    recordCondition.mockResolvedValueOnce({ scope: { kind: 'not-managed' } });
    await getHistory().expect(403);
    expect(history).not.toHaveBeenCalled();
    await getHistory().expect(200, {
      attempts: 0,
      answered: 0,
      durationSeconds: '0',
      rows: [],
      next: null,
    });
    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId }),
      recordId,
      expect.objectContaining({ sql: 'EXISTS (SELECT 1)' }),
      memberId,
      undefined,
    );
  });
});
