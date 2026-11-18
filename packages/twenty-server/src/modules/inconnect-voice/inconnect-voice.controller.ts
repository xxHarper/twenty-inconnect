import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
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

const requestSchema = z.object({ recordId: z.string().uuid() }).strict();

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

    return this.voice.issue(request, input.data.recordId);
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
}
