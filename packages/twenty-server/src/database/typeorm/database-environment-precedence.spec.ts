import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type DotenvConfigOptions, type DotenvConfigOutput } from 'dotenv';

const DEVELOPMENT_FILE_DATABASE_URL =
  'postgres://file-development.example/development-file';
const DEVELOPMENT_FILE_REPLICA_URL =
  'postgres://file-development.example/development-file-replica';
const TEST_FILE_DATABASE_URL = 'postgres://file-test.example/test-file';
const TEST_FILE_REPLICA_URL = 'postgres://file-test.example/test-file-replica';
const EXPLICIT_DATABASE_URL = 'postgres://explicit-process.example/disposable';
const EXPLICIT_REPLICA_URL =
  'postgres://explicit-process.example/disposable-replica';

type ImportOrder = 'core-first' | 'raw-first';

const originalProcessEnvironment = process.env;
let temporaryEnvironmentDirectory: string;

const getDatabaseUrl = (options: object): unknown =>
  'url' in options ? options.url : undefined;

const redirectDotenvToTemporaryFiles = () => {
  jest.doMock('dotenv', () => {
    const actualDotenv = jest.requireActual<typeof import('dotenv')>('dotenv');

    return {
      ...actualDotenv,
      config: (options: DotenvConfigOptions = {}): DotenvConfigOutput => {
        const requestedPath =
          typeof options.path === 'string' ? options.path : '.env';

        return actualDotenv.config({
          ...options,
          path: path.join(
            temporaryEnvironmentDirectory,
            path.basename(requestedPath),
          ),
        });
      },
    };
  });
};

const importDataSources = async (importOrder: ImportOrder) => {
  if (importOrder === 'core-first') {
    const { typeORMCoreModuleOptions } =
      await import('src/database/typeorm/core/core.datasource');
    const { rawDataSource } =
      await import('src/database/typeorm/raw/raw.datasource');

    return {
      coreUrl: getDatabaseUrl(typeORMCoreModuleOptions),
      rawUrl: getDatabaseUrl(rawDataSource.options),
    };
  }

  const { rawDataSource } =
    await import('src/database/typeorm/raw/raw.datasource');
  const { typeORMCoreModuleOptions } =
    await import('src/database/typeorm/core/core.datasource');

  return {
    coreUrl: getDatabaseUrl(typeORMCoreModuleOptions),
    rawUrl: getDatabaseUrl(rawDataSource.options),
  };
};

describe('database environment precedence', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalProcessEnvironment };
    temporaryEnvironmentDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'twenty-database-environment-'),
    );

    fs.writeFileSync(
      path.join(temporaryEnvironmentDirectory, '.env'),
      [
        `PG_DATABASE_URL=${DEVELOPMENT_FILE_DATABASE_URL}`,
        `PG_DATABASE_REPLICA_URL=${DEVELOPMENT_FILE_REPLICA_URL}`,
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryEnvironmentDirectory, '.env.test'),
      [
        `PG_DATABASE_URL=${TEST_FILE_DATABASE_URL}`,
        `PG_DATABASE_REPLICA_URL=${TEST_FILE_REPLICA_URL}`,
      ].join('\n'),
    );

    redirectDotenvToTemporaryFiles();
  });

  afterEach(() => {
    jest.dontMock('dotenv');
    jest.resetModules();
    process.env = originalProcessEnvironment;
    fs.rmSync(temporaryEnvironmentDirectory, {
      recursive: true,
      force: true,
    });
  });

  it('uses .env as fallback for both datasources outside test', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PG_DATABASE_URL;
    delete process.env.PG_DATABASE_REPLICA_URL;

    const urls = await importDataSources('core-first');

    expect(urls).toEqual({
      coreUrl: DEVELOPMENT_FILE_DATABASE_URL,
      rawUrl: DEVELOPMENT_FILE_DATABASE_URL,
    });
    expect(process.env.PG_DATABASE_REPLICA_URL).toBe(
      DEVELOPMENT_FILE_REPLICA_URL,
    );
  });

  it('keeps an explicit disposable database over the .env default', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PG_DATABASE_URL = EXPLICIT_DATABASE_URL;
    process.env.PG_DATABASE_REPLICA_URL = EXPLICIT_REPLICA_URL;

    const urls = await importDataSources('core-first');

    expect(urls).toEqual({
      coreUrl: EXPLICIT_DATABASE_URL,
      rawUrl: EXPLICIT_DATABASE_URL,
    });
    expect(process.env.PG_DATABASE_REPLICA_URL).toBe(EXPLICIT_REPLICA_URL);
  });

  it('uses .env.test as fallback for both datasources in test', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PG_DATABASE_URL;
    delete process.env.PG_DATABASE_REPLICA_URL;

    const urls = await importDataSources('raw-first');

    expect(urls).toEqual({
      coreUrl: TEST_FILE_DATABASE_URL,
      rawUrl: TEST_FILE_DATABASE_URL,
    });
    expect(process.env.PG_DATABASE_REPLICA_URL).toBe(TEST_FILE_REPLICA_URL);
  });

  it('keeps explicit test database values over .env.test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PG_DATABASE_URL = EXPLICIT_DATABASE_URL;
    process.env.PG_DATABASE_REPLICA_URL = EXPLICIT_REPLICA_URL;

    const urls = await importDataSources('raw-first');

    expect(urls).toEqual({
      coreUrl: EXPLICIT_DATABASE_URL,
      rawUrl: EXPLICIT_DATABASE_URL,
    });
    expect(process.env.PG_DATABASE_REPLICA_URL).toBe(EXPLICIT_REPLICA_URL);
  });

  it.each<ImportOrder>(['core-first', 'raw-first'])(
    'preserves explicit database values with %s import order',
    async (importOrder) => {
      process.env.NODE_ENV = 'development';
      process.env.PG_DATABASE_URL = EXPLICIT_DATABASE_URL;
      process.env.PG_DATABASE_REPLICA_URL = EXPLICIT_REPLICA_URL;

      const urls = await importDataSources(importOrder);

      expect(urls).toEqual({
        coreUrl: EXPLICIT_DATABASE_URL,
        rawUrl: EXPLICIT_DATABASE_URL,
      });
      expect(process.env.PG_DATABASE_URL).toBe(EXPLICIT_DATABASE_URL);
      expect(process.env.PG_DATABASE_REPLICA_URL).toBe(EXPLICIT_REPLICA_URL);
    },
  );
});
