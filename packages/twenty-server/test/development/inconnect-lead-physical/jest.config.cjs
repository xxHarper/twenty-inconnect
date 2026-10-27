// Dedicated config: no application setup, global hooks, dotenv, Nx or workers.
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/*.spec.ts'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
        module: { type: 'commonjs' },
      },
    ],
  },
  moduleNameMapper: {
    '^test/development/inconnect-lead-physical/(.*)$': '<rootDir>/$1',
  },
  maxWorkers: 1,
};
