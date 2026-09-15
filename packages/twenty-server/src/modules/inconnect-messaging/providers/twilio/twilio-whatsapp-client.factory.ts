import { Injectable } from '@nestjs/common';

import Twilio from 'twilio';

@Injectable()
export class TwilioWhatsappClientFactory {
  create(accountSid: string, authToken: string): Twilio.Twilio {
    return Twilio(accountSid, authToken, { timeout: 30_000 });
  }
}
