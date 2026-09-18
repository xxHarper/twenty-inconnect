import { type CommonPropertiesJwtPayload } from 'src/engine/core-modules/auth/types/common-properties-jwt-payload.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';

export type InconnectMessagingProviderMediaTokenJwtPayload =
  CommonPropertiesJwtPayload & {
    type: JwtTokenTypeEnum.INCONNECT_MESSAGING_PROVIDER_MEDIA;
    workspaceId: string;
    attachmentId: string;
  };
