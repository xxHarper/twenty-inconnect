// v1 fixes the existing Twilio verifier/normalizer, scalar form policy and
// immutable receipt fact. Incompatible changes require a separately reviewed version.
export const INBOUND_INGRESS_CONTRACT_VERSION = 1 as const;

export type ReceiptIngressContract =
  | { kind: 'PRE_DDL' }
  | { kind: 'LEGACY' }
  | { kind: 'SUPPORTED'; version: 1 }
  | { kind: 'UNKNOWN_VERSION' }
  | { kind: 'INVALID' };

export const decodeReceiptIngressContract = (
  installed: boolean,
  value: unknown,
): ReceiptIngressContract => {
  if (!installed)
    return value === undefined ? { kind: 'PRE_DDL' } : { kind: 'INVALID' };
  if (value === null) return { kind: 'LEGACY' };
  if (value === 1) return { kind: 'SUPPORTED', version: 1 };
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? { kind: 'UNKNOWN_VERSION' }
    : { kind: 'INVALID' };
};

// Deliberately NOT registered by InconnectMessagingModule. Supplying this token
// requires a separately reviewed deployment composition; SERVER_URL is unrelated.
export const INBOUND_INGRESS_POLICY = Symbol('INBOUND_INGRESS_POLICY');
export type InboundIngressPolicy = Readonly<{
  mode: 'DIRECT_TLS_V1';
  publicOrigin: string;
}>;
