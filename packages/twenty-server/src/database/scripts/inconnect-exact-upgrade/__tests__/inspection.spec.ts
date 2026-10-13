import { Client } from 'pg';

import {
  APPROVED_COMMANDS,
  EXPECTED_DATA_DIRECTORY,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { inspectReadOnly } from 'src/database/scripts/inconnect-exact-upgrade/inspection';

jest.mock('pg', () => ({ Client: jest.fn() }));

describe('preview database inspection SQL boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should use only SELECT inside an explicitly read-only transaction and close the client', async () => {
    const query = jest.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('current_database() AS database'))
        return {
          rows: [
            {
              database: 'default',
              host: '127.0.0.1/32',
              port: 5432,
              version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
              dataDirectory: EXPECTED_DATA_DIRECTORY,
              systemIdentifier: '123',
              currentUser: 'operator',
              sessionUser: 'operator',
              clientAddress: '127.0.0.1/32',
              backendPid: 1234,
              backendStart: '2026-10-13 00:00:00+00',
            },
          ],
        };
      if (statement.includes('FROM pg_extension'))
        return { rows: [{ name: 'uuid-ossp' }] };
      if (statement.includes('SELECT count(*) FROM pg_stat_activity'))
        return { rows: [{ count: '0' }] };
      if (statement.includes('AS valid')) return { rows: [{ valid: true }] };
      return { rows: [] };
    });
    const client = { connect: jest.fn(), query, end: jest.fn() };
    jest.mocked(Client).mockImplementation(() => client as unknown as Client);

    await inspectReadOnly(
      'postgresql://operator:secret@localhost:5432/default',
      {
        command: APPROVED_COMMANDS[0],
        mode: 'preview',
        expectedCommit: 'a'.repeat(40),
      },
    );
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.stringContaining('default_transaction_read_only=on'),
      }),
    );
    expect(query.mock.calls[0][0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(query.mock.calls[query.mock.calls.length - 1][0]).toBe('ROLLBACK');
    for (const [statement] of query.mock.calls.slice(1, -1))
      expect(statement.trim()).toMatch(/^SELECT\b/);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('should close the connection on introspection failure without performing a write', async () => {
    const failure = new Error('catalog unavailable');
    const client = {
      connect: jest.fn(),
      query: jest.fn().mockRejectedValue(failure),
      end: jest.fn(),
    };
    jest.mocked(Client).mockImplementation(() => client as unknown as Client);

    await expect(
      inspectReadOnly('postgresql://operator:secret@localhost:5432/default', {
        command: APPROVED_COMMANDS[0],
        mode: 'preview',
        expectedCommit: 'a'.repeat(40),
      }),
    ).rejects.toBe(failure);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('should reject a remote target before creating a PostgreSQL client', async () => {
    await expect(
      inspectReadOnly('postgresql://operator:secret@remote:5432/default', {
        command: APPROVED_COMMANDS[0],
        mode: 'preview',
        expectedCommit: 'a'.repeat(40),
      }),
    ).rejects.toThrow();
    expect(Client).not.toHaveBeenCalled();
  });
  it('should reject an unexpected current_user before inspecting schema or tracking', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          database: 'default',
          host: '127.0.0.1/32',
          port: 5432,
          version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
          dataDirectory: EXPECTED_DATA_DIRECTORY,
          systemIdentifier: '123',
          currentUser: 'postgres',
          sessionUser: 'operator',
          clientAddress: '127.0.0.1/32',
          backendPid: 1234,
          backendStart: '2026-10-13 00:00:00+00',
        },
      ],
    });
    const client = { connect: jest.fn(), query, end: jest.fn() };
    jest.mocked(Client).mockImplementation(() => client as unknown as Client);
    await expect(
      inspectReadOnly('postgresql://operator:secret@localhost:5432/default', {
        command: APPROVED_COMMANDS[0],
        mode: 'preview',
        expectedCommit: 'a'.repeat(40),
      }),
    ).rejects.toThrow('current_user/session_user');
    expect(query).toHaveBeenCalledTimes(2);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
