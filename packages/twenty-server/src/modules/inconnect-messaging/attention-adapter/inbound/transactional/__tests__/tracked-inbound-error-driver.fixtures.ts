import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { identifier } from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { type Step } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { INBOUND_SESSION_SETTINGS } from '../execute-tracked-inbound';
import {
  INBOUND_CLAIM_SQL,
  INBOUND_RELEASE_SQL,
} from '../tracked-inbound-recovery';
import { causalFixture } from './tracked-inbound.fixtures';

export type DriverAttempt = {
  fixture?: Awaited<ReturnType<typeof causalFixture>>;
  acquisitionError?: Error;
  commitError?: Error;
  rollbackError?: Error;
};

// Actual DataSource, EntityManager, PostgresQueryRunner and QueryFailedError.
// Only pg's pool/client are simulated; initialize/connect-to-server is forbidden.
export const errorDriver = (attempts: DriverAttempt[], transport = false) => {
  const source = new DataSource({
    type: 'postgres',
    entities: [],
    logging: false,
  });
  Object.assign(source, { isInitialized: true });
  const driver = source.driver as PostgresDriver;
  const runners: QueryRunner[] = [];
  const order: string[] = [];
  const mismatches: unknown[] = [];
  const consumed = attempts.map(() => 0);
  let acquired = 0;
  let currentLease = identifier(28);
  const releases: unknown[][] = [];
  let transportQueries = transport ? 2 : 0;
  jest.spyOn(source, 'createQueryRunner').mockImplementation((mode) => {
    const runner = driver.createQueryRunner(mode ?? 'master');
    // This mirrors DataSource.createQueryRunner; the manager remains original.
    runner.manager = source.createEntityManager(runner);
    runners.push(runner);
    return runner;
  });
  jest.spyOn(driver, 'obtainMasterConnection').mockImplementation(async () => {
    // Claim/release are actual short DataSource transactions/queries as well.
    if (
      transportQueries > 0 &&
      (acquired === 0 || acquired > attempts.length)
    ) {
      acquired++;
      transportQueries--;
      return [
        {
          on: jest.fn(),
          removeListener: jest.fn(),
          query: async (statement: string, parameters: unknown[]) => {
            order.push(statement);
            if (statement === INBOUND_CLAIM_SQL) {
              currentLease = String(parameters[3]);
              return {
                rows: [{ id: identifier(27) }],
                rowCount: 1,
                command: 'SELECT',
              };
            }
            if (statement === INBOUND_RELEASE_SQL) {
              releases.push(parameters);
              return {
                rows:
                  parameters[3] === currentLease
                    ? [{ id: identifier(27) }]
                    : [],
                rowCount: parameters[3] === currentLease ? 1 : 0,
                command: 'SELECT',
              };
            }
            if (
              ![
                'START TRANSACTION',
                'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
                'COMMIT',
                'ROLLBACK',
              ].includes(statement)
            )
              mismatches.push(statement);
            return { rows: [], rowCount: null, command: statement };
          },
        },
        jest.fn(),
      ];
    }
    const index = acquired++ - (transport ? 1 : 0);
    const attempt = attempts[index];
    order.push(`acquire-${index}`);
    if (!attempt) {
      mismatches.push('unexpected acquisition');
      throw new Error('unexpected acquisition');
    }
    if (attempt.acquisitionError) throw attempt.acquisitionError;
    const queue = [...(attempt.fixture?.ids ?? [])];
    jest
      .mocked(randomUUID)
      .mockImplementation(
        () => queue.shift()! as ReturnType<typeof randomUUID>,
      );
    return [
      {
        on: jest.fn(),
        removeListener: jest.fn(),
        query: async (statement: string, parameters: unknown[] = []) => {
          order.push(statement);
          if (statement === 'COMMIT' && attempt.commitError)
            throw attempt.commitError;
          if (statement === 'ROLLBACK' && attempt.rollbackError)
            throw attempt.rollbackError;
          if (
            [
              'START TRANSACTION',
              'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
              'COMMIT',
              'ROLLBACK',
              ...INBOUND_SESSION_SETTINGS,
            ].includes(statement)
          )
            return { rows: [], rowCount: null, command: statement };
          const expected: Step | undefined =
            attempt.fixture?.steps[consumed[index]++];
          if (
            !expected ||
            statement !== expected.sql ||
            JSON.stringify(parameters) !== JSON.stringify(expected.parameters)
          ) {
            mismatches.push({ index, statement, parameters, expected });
            throw new Error('driver script mismatch');
          }
          await expected.onQuery?.();
          if (expected.error) throw expected.error;
          const control = expected.result !== undefined;
          return {
            rows: expected.rows,
            rowCount: control ? null : expected.rows.length,
            command: control ? 'SET' : 'SELECT',
          };
        },
      },
      jest.fn(),
    ];
  });
  return {
    source,
    runners,
    order,
    releases,
    replaceOwner: () => {
      currentLease = identifier(99);
    },
    done: () => {
      expect(mismatches).toEqual([]);
      attempts.forEach((attempt, index) =>
        expect(consumed[index]).toBe(attempt.fixture?.steps.length ?? 0),
      );
      expect(runners.every((runner) => runner.isReleased)).toBe(true);
    },
  };
};

export const failAdmission = async (statement: string, error: Error) => {
  const fixture = await causalFixture();
  const index = fixture.steps.findIndex((entry) => entry.sql === statement);
  if (index < 0) throw new Error('Missing admission statement');
  fixture.steps[index].error = error;
  fixture.steps.splice(index + 1);
  return fixture;
};
