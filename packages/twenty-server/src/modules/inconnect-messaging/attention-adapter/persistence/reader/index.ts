// Deliberately not re-exported by the persistence or operational module barrels.
export { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';
export type {
  AttentionReaderInput,
  AttentionReaderResult,
  AttentionReaderError,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';
