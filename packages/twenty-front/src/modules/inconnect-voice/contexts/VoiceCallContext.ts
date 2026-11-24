import { createContext } from 'react';

export type VoiceLeadTarget = {
  objectMetadataId: string;
  objectNameSingular: string;
  recordId: string;
};

export const VoiceCallContext = createContext<
  ((target: VoiceLeadTarget) => void) | null
>(null);
