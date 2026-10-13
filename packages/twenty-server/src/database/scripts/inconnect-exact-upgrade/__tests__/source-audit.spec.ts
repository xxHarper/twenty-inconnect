import * as filesystem from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

import {
  auditSources,
  registeredModuleReferences,
} from 'src/database/scripts/inconnect-exact-upgrade/source-audit';

jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

const parse = (text: string) =>
  ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, true);

describe('static registration source of truth', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should ignore comments and unused imports when a required provider is absent from its decorator array', () => {
    const source = parse(
      "import { RequiredCommand } from './command'; // RequiredCommand\n@Module({ providers: [OtherCommand] }) export class CommandsModule {}",
    );
    expect(
      registeredModuleReferences(source, 'CommandsModule', 'providers'),
    ).toEqual(['OtherCommand']);
  });

  it('should reject dynamic or missing module registration rather than guess discovery', () => {
    for (const source of [
      '@Module({}) export class CommandsModule {}',
      '@Module({ providers: computed() }) export class CommandsModule {}',
      '@Module({ providers: [...OTHER] }) export class CommandsModule {}',
    ])
      expect(() =>
        registeredModuleReferences(
          parse(source),
          'CommandsModule',
          'providers',
        ),
      ).toThrow();
  });

  it('should reject a command whose source lost its registered decorator', () => {
    const read =
      jest.requireActual<typeof import('node:fs')>('node:fs').readFileSync;
    jest.mocked(filesystem.readFileSync).mockImplementation((path, options) => {
      const value = read(path, options);
      if (
        String(path).endsWith(
          '2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration.ts',
        )
      )
        return String(value).replace(
          "@RegisteredInstanceCommand('2.32.0', 1790793305698)",
          '',
        );
      return value;
    });
    expect(() =>
      auditSources(resolve(__dirname, '../../../../..'), false),
    ).toThrow('Incomplete command source registration');
  });
});
