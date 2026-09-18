import { type InconnectMessagingAttachmentType } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export const INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES = 16 * 1024 * 1024;

export const INCONNECT_MESSAGING_OUTBOUND_UPLOAD_TTL_MILLISECONDS =
  24 * 60 * 60 * 1000;

const INCONNECT_MESSAGING_OUTBOUND_MAXIMUM_BYTES_BY_TYPE: Readonly<
  Record<InconnectMessagingAttachmentType, number>
> = {
  IMAGE: 5 * 1024 * 1024,
  STICKER: 100 * 1024,
  AUDIO: INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
  VIDEO: INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
  DOCUMENT: INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
  CONTACT: INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
};

export const INCONNECT_MESSAGING_MEDIA_EXTENSION_BY_MIME: Readonly<
  Record<string, string>
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/amr': 'amr',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/3gpp': '3gp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/vcard': 'vcf',
  'text/x-vcard': 'vcf',
  'application/vcard': 'vcf',
};

export const isInconnectMessagingMimeAllowedForType = ({
  mimeType,
  type,
}: {
  mimeType: string;
  type: InconnectMessagingAttachmentType;
}): boolean => {
  const normalized = mimeType.toLowerCase();

  if (!(normalized in INCONNECT_MESSAGING_MEDIA_EXTENSION_BY_MIME))
    return false;
  if (type === 'STICKER') return normalized === 'image/webp';
  if (type === 'IMAGE')
    return normalized === 'image/jpeg' || normalized === 'image/png';
  if (type === 'AUDIO') return normalized.startsWith('audio/');
  if (type === 'VIDEO') return normalized === 'video/mp4';
  if (type === 'CONTACT') {
    return ['text/vcard', 'text/x-vcard', 'application/vcard'].includes(
      normalized,
    );
  }

  return (
    type === 'DOCUMENT' &&
    !normalized.startsWith('image/') &&
    !normalized.startsWith('audio/') &&
    !normalized.startsWith('video/')
  );
};

export const getInconnectMessagingOutboundMaximumBytes = (
  type: InconnectMessagingAttachmentType,
): number => INCONNECT_MESSAGING_OUTBOUND_MAXIMUM_BYTES_BY_TYPE[type];

export const getInconnectMessagingAllowedMimeTypesForType = (
  type: InconnectMessagingAttachmentType,
): readonly string[] =>
  Object.keys(INCONNECT_MESSAGING_MEDIA_EXTENSION_BY_MIME).filter((mimeType) =>
    isInconnectMessagingMimeAllowedForType({ mimeType, type }),
  );
