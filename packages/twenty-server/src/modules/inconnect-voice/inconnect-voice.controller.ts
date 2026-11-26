import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { type Request } from 'express';
import { z } from 'zod';

import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { INCONNECT_VOICE_PATH } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceService } from 'src/modules/inconnect-voice/inconnect-voice.service';

const requestSchema = z
  .object({
    recordId: z.string().uuid(),
    inboundSessionId: z.string().uuid().optional(),
  })
  .strict();
const lookupSchema = z
  .object({
    number: z.string().trim().min(1).max(64),
    after: z.string().uuid().optional(),
  })
  .strict();
const manualSchema = z
  .object({
    number: z.string().trim().min(1).max(64),
    recordId: z.string().uuid().nullable(),
    inboundSessionId: z.string().uuid().optional(),
  })
  .strict();
const parseId = (value: unknown) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException('Expected an ID');
  return parsed.data;
};

@Controller(INCONNECT_VOICE_PATH)
export class InconnectVoiceController {
  constructor(private readonly voice: InconnectVoiceService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  status(@Req() request: Request) {
    return this.voice.status(request);
  }

  @Post('session')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  issue(@Req() request: Request, @Body() body: unknown) {
    const input = requestSchema.safeParse(body);

    if (!input.success) throw new BadRequestException('Expected a record ID');

    return this.voice.issue(
      request,
      input.data.recordId,
      undefined,
      input.data.inboundSessionId,
    );
  }

  @Get('phone-access')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  phoneAccess(@Req() request: Request) {
    return this.voice.phoneAccess(request);
  }

  @Post('lookup')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  lookup(@Req() request: Request, @Body() body: unknown) {
    const input = lookupSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Enter a phone number');
    return this.voice.lookup(request, input.data.number, input.data.after);
  }

  @Post('manual-session')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  issueManual(@Req() request: Request, @Body() body: unknown) {
    const input = manualSchema.safeParse(body);
    if (!input.success)
      throw new BadRequestException('Enter a phone number and association');
    return this.voice.issue(
      request,
      input.data.recordId,
      input.data.number,
      input.data.inboundSessionId,
    );
  }

  @Get('recents')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  recents(@Req() request: Request, @Query('before') before?: string) {
    return this.voice.recents(
      request,
      before === undefined ? undefined : parseId(before),
    );
  }

  @Get('manual-call/:callId')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  manualCall(
    @Req() request: Request,
    @Param('callId') callId: string,
    @Query('recordId') recordId?: string,
  ) {
    return this.voice.callStatus(
      request,
      recordId === undefined ? null : parseId(recordId),
      parseId(callId),
      undefined,
      true,
    );
  }

  @Post('manual-call/:callId/:action')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  updateManualCall(
    @Req() request: Request,
    @Param('callId') callId: string,
    @Param('action') action: string,
    @Query('recordId') recordId?: string,
  ) {
    if (action !== 'cancel' && action !== 'reconcile')
      throw new BadRequestException('Unknown Voice action');
    return this.voice.callStatus(
      request,
      recordId === undefined ? null : parseId(recordId),
      parseId(callId),
      action,
      true,
    );
  }

  @Post('twiml')
  @UseGuards(PublicEndpointGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  renderTwiml(@Req() request: Request & { rawBody?: Buffer }) {
    // Twilio authenticates this callback with its signature and a one-time intent.
    return this.voice.renderTwiml(request);
  }

  @Post('call-progress')
  @UseGuards(PublicEndpointGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  progressCallback(@Req() request: Request & { rawBody?: Buffer }) {
    return this.voice.progressCallback(request);
  }

  @Get('history-access/:recordId')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  historyAccess(@Req() request: Request, @Param('recordId') recordId: string) {
    return this.voice.historyAccess(request, parseId(recordId));
  }

  @Get('history/:recordId')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  history(
    @Req() request: Request,
    @Param('recordId') recordId: string,
    @Query('before') before?: string,
  ) {
    return this.voice.history(
      request,
      parseId(recordId),
      before === undefined ? undefined : parseId(before),
    );
  }

  @Get('history/:recordId/call/:callId')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @Header('Cache-Control', 'no-store')
  callStatus(
    @Req() request: Request,
    @Param('recordId') recordId: string,
    @Param('callId') callId: string,
  ) {
    return this.voice.callStatus(request, parseId(recordId), parseId(callId));
  }

  @Post('history/:recordId/call/:callId/:action')
  @UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  updateCall(
    @Req() request: Request,
    @Param('recordId') recordId: string,
    @Param('callId') callId: string,
    @Param('action') action: string,
  ) {
    if (action !== 'cancel' && action !== 'reconcile')
      throw new BadRequestException('Unknown Voice action');
    return this.voice.callStatus(
      request,
      parseId(recordId),
      parseId(callId),
      action,
    );
  }
}
