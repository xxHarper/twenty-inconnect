import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  HttpException,
  UseGuards,
} from '@nestjs/common';

import { type Request } from 'express';
import { z } from 'zod';

import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  getVoiceInboundConfig,
  INCONNECT_VOICE_PATH,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceInboundSessionService } from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';
import {
  InconnectVoiceInboundService,
  runInboundCallback,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound.service';

import { voicePreferences } from 'src/modules/inconnect-voice/inconnect-voice-availability';

const uuid = z.string().uuid();
const sessionUpdate = z
  .object({
    id: uuid,
    state: z.enum(['registered', 'offline', 'stop']),
    refresh: z.boolean().default(false),
  })
  .strict();

const offerInput = z
  .object({
    sessionId: uuid,
    action: z.enum(['accept', 'decline', 'reconcile']).optional(),
  })
  .strict();

const configOrDeny = () => {
  const config = getVoiceInboundConfig();
  if (!config) throw new ForbiddenException('Inbound Voice is unavailable');
  return config;
};

const authenticated = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('Inbound Voice is unavailable');
  }
};

@Controller(INCONNECT_VOICE_PATH)
export class InconnectVoiceInboundController {
  constructor(
    private readonly inbound: InconnectVoiceInboundService,
    private readonly sessions: InconnectVoiceInboundSessionService,
  ) {}

  @Get('inbound-access')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  access(@Req() request: Request) {
    return authenticated(() =>
      this.sessions.availability(request, configOrDeny()),
    );
  }

  @Post('inbound-preference')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  preference(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({ preference: z.enum(voicePreferences) })
      .strict()
      .safeParse(body);
    if (!input.success)
      throw new BadRequestException('Invalid Voice preference');
    return authenticated(() =>
      this.sessions.availability(
        request,
        configOrDeny(),
        input.data.preference,
      ),
    );
  }

  @Post('inbound-session')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  start(@Req() request: Request) {
    return authenticated(() => this.sessions.start(request, configOrDeny()));
  }

  @Post('inbound-session/update')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  update(@Req() request: Request, @Body() body: unknown) {
    const input = sessionUpdate.safeParse(body);
    if (!input.success)
      throw new BadRequestException('Invalid Voice session update');
    const { id, state, refresh } = input.data;
    return authenticated(() =>
      this.sessions.update(request, configOrDeny(), id, state, refresh),
    );
  }

  @Post('inbound-offer/:id')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  offer(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = offerInput.safeParse(body);
    if (!uuid.safeParse(id).success || !input.success)
      throw new BadRequestException('Invalid Voice offer');
    const { sessionId, action } = input.data;
    return authenticated(() =>
      this.inbound.offer(request, configOrDeny(), id, sessionId, action),
    );
  }

  @Post('inbound')
  @Header('Cache-Control', 'no-store')
  @UseGuards(PublicEndpointGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  receive(@Req() request: Request & { rawBody?: Buffer }) {
    return runInboundCallback(() =>
      this.inbound.receive(request, configOrDeny()),
    );
  }

  @Post('inbound-progress')
  @Header('Cache-Control', 'no-store')
  @UseGuards(PublicEndpointGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  progress(@Req() request: Request & { rawBody?: Buffer }) {
    return runInboundCallback(() =>
      this.inbound.callback(request, configOrDeny()),
    );
  }
}
