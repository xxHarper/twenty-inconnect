export const DEFAULT_DEVICE = 'default';
export type VoiceAudioKind = 'input' | 'output';
type DeviceSelection = Record<VoiceAudioKind, string>;
type VoiceAudioFailure = 'denied' | 'unavailable' | 'unsupported' | 'failed';

export type VoiceAudioIssue = VoiceAudioFailure | 'fallback' | 'lost';

export type VoiceAudioSettings = {
  preferences: DeviceSelection;
  devices: Record<VoiceAudioKind, MediaDeviceInfo[]>;
  effective: Record<VoiceAudioKind, string | null>;
  supported: Record<VoiceAudioKind, boolean>;
  pending: Record<VoiceAudioKind, boolean>;
  issues: Partial<Record<VoiceAudioKind, VoiceAudioIssue>>;
  microphoneAccess: 'unconfirmed' | 'checking' | 'granted' | VoiceAudioFailure;
};

const systemDefaults = { input: DEFAULT_DEVICE, output: DEFAULT_DEVICE };

export const readVoiceAudioPreferences = (key: string): DeviceSelection => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof raw === 'object' && raw !== null) {
      return {
        input:
          'input' in raw && typeof raw.input === 'string' && raw.input
            ? raw.input
            : DEFAULT_DEVICE,
        output:
          'output' in raw && typeof raw.output === 'string' && raw.output
            ? raw.output
            : DEFAULT_DEVICE,
      };
    }
  } catch {
    // Local storage may be disabled or contain malformed preferences.
  }
  return systemDefaults;
};

export const getVoiceAudioIssue = (error: unknown): VoiceAudioFailure => {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return 'denied';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
      case 'OverconstrainedError':
        return 'unavailable';
      case 'NotSupportedError':
        return 'unsupported';
    }
  }
  return 'failed';
};
