import { z } from 'zod';
import { type QueryRunner } from 'typeorm';

import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { type InstanceCommandConnectionVerification } from 'src/engine/core-modules/upgrade/types/instance-command-connection-verification';

export const sessionIdentitySchema = z.strictObject({
  database: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  version: z.string().min(1),
  dataDirectory: z.string().min(1),
  systemIdentifier: z.string().regex(/^\d+$/),
  currentUser: z.string().min(1),
  sessionUser: z.string().min(1),
  clientAddress: z.literal('127.0.0.1/32'),
  backendPid: z.number().int().positive(),
  backendStart: z.string().min(1),
});
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
export type ExpectedIdentity = Omit<
  SessionIdentity,
  'backendPid' | 'backendStart'
>;

export const SESSION_IDENTITY_SQL = `
  SELECT current_database() AS database, inet_server_addr()::text AS host,
    inet_server_port() AS port, current_setting('server_version') AS version,
    current_setting('data_directory') AS "dataDirectory",
    (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
    current_user AS "currentUser", session_user AS "sessionUser",
    inet_client_addr()::text AS "clientAddress", pg_backend_pid() AS "backendPid",
    (SELECT backend_start::text FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS "backendStart"
`;

// Compare effective session state rather than trusting configured pool options.
export const verifySessionIdentity = (
  input: unknown,
  expected: ExpectedIdentity,
  retained?: SessionIdentity,
): SessionIdentity => {
  const identity = sessionIdentitySchema.parse(input);

  requireCondition(
    Object.entries(expected).every(
      ([key, value]) => identity[key as keyof SessionIdentity] === value,
    ),
    'Actual connected session identity mismatch (including current_user/session_user)',
  );
  requireCondition(
    !retained ||
      Object.keys(identity).every(
        (key) =>
          identity[key as keyof SessionIdentity] ===
          retained[key as keyof SessionIdentity],
      ),
    'Connection replacement/reconnect detected; retained verification is invalid',
  );
  return identity;
};

export const createSessionConnectionVerification = (
  expected: ExpectedIdentity,
): InstanceCommandConnectionVerification => {
  const pinnedExpected = Object.freeze(
    sessionIdentitySchema
      .omit({ backendPid: true, backendStart: true })
      .parse(expected),
  );
  const retainedSessions = new WeakMap<QueryRunner, SessionIdentity>();

  return {
    verifyConnection: async (queryRunner) => {
      const rows: unknown = await queryRunner.query(SESSION_IDENTITY_SQL);

      requireCondition(
        Array.isArray(rows) && rows.length === 1,
        'Exactly one actual session identity row required',
      );
      const identity = verifySessionIdentity(
        (rows as unknown[])[0],
        pinnedExpected,
        retainedSessions.get(queryRunner),
      );

      retainedSessions.set(queryRunner, identity);
    },
  };
};

export const requireExtensions = (
  input: unknown,
  required: string[],
): string[] => {
  const extensions = z
    .array(z.strictObject({ name: z.string().min(1) }))
    .parse(input)
    .map(({ name }) => name);

  requireCondition(
    required.every((name) => extensions.includes(name)),
    'Required PostgreSQL extensions are absent; automatic installation is forbidden',
  );
  return extensions;
};
