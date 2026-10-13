import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import {
  type Inventory,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

const readSource = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
const unwrap = (expression: ts.Expression): ts.Expression =>
  ts.isAsExpression(expression) ? unwrap(expression.expression) : expression;

const initializer = (source: ts.SourceFile, name: string): ts.Expression => {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === name && declaration.initializer)
        return unwrap(declaration.initializer);
    }
  }
  throw new Error(`Missing static constant ${name}`);
};

// Read actual decorator arrays and named imports; comments or unused imports do
// not establish provider registration. Unsupported expressions fail closed.
export const registeredModuleReferences = (
  source: ts.SourceFile,
  className: string,
  propertyName: string,
): string[] => {
  const declaration = source.statements.find(
    (entry) => ts.isClassDeclaration(entry) && entry.name?.text === className,
  );
  requireCondition(Boolean(declaration), 'Missing provider module class');
  const decorator = (
    ts.getDecorators(declaration as ts.ClassDeclaration) ?? []
  ).find(
    (entry) =>
      ts.isCallExpression(entry.expression) &&
      entry.expression.expression.getText(source) === 'Module',
  );
  const options =
    decorator && ts.isCallExpression(decorator.expression)
      ? decorator.expression.arguments[0]
      : undefined;
  requireCondition(
    Boolean(options) && ts.isObjectLiteralExpression(options as ts.Node),
    'Unsupported module registration',
  );
  const property = (options as ts.ObjectLiteralExpression).properties.find(
    (entry) =>
      ts.isPropertyAssignment(entry) &&
      entry.name.getText(source) === propertyName,
  );
  const array =
    property && ts.isPropertyAssignment(property)
      ? property.initializer
      : undefined;
  requireCondition(
    Boolean(array) && ts.isArrayLiteralExpression(array as ts.Node),
    'Missing module registration array',
  );
  const elements = (array as ts.ArrayLiteralExpression).elements;
  requireCondition(
    elements.every(ts.isIdentifier),
    'Unsupported module registration array',
  );
  return elements.map((entry) => (entry as ts.Identifier).text);
};

const requireNamedImport = (
  source: ts.SourceFile,
  name: string,
  path: string,
): void => {
  requireCondition(
    source.statements.filter((entry) => {
      if (
        !ts.isImportDeclaration(entry) ||
        !ts.isStringLiteral(entry.moduleSpecifier) ||
        entry.moduleSpecifier.text !== path
      )
        return false;
      const bindings = entry.importClause?.namedBindings;
      return (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          (binding) => binding.name.text === name && !binding.propertyName,
        )
      );
    }).length === 1,
    'Unresolved or redirected registration import',
  );
};

export const auditSources = (
  serverRoot: string,
  billingEnabled: boolean,
): Inventory => {
  const upgradeRoot = join(serverRoot, 'src/engine/core-modules/upgrade');
  const current = initializer(
    readSource(
      join(upgradeRoot, 'constants/twenty-current-version.constant.ts'),
    ),
    'TWENTY_CURRENT_VERSION',
  );
  const previous = initializer(
    readSource(
      join(upgradeRoot, 'constants/twenty-previous-versions.constant.ts'),
    ),
    'TWENTY_PREVIOUS_VERSIONS',
  );

  requireCondition(
    ts.isStringLiteral(current) &&
      ts.isArrayLiteralExpression(previous) &&
      previous.elements.every(ts.isStringLiteral),
    'Unsupported version constants',
  );
  const versions = [
    ...(previous as ts.ArrayLiteralExpression).elements.map(
      (element) => (element as ts.StringLiteral).text,
    ),
    (current as ts.StringLiteral).text,
  ];
  const constant = readSource(
    join(
      serverRoot,
      'src/database/commands/upgrade-version-command/instance-commands.constant.ts',
    ),
  );
  const providerModule = readSource(
    join(
      serverRoot,
      'src/database/commands/upgrade-version-command/instance-command-provider.module.ts',
    ),
  );
  requireNamedImport(
    providerModule,
    'INSTANCE_COMMANDS',
    'src/database/commands/upgrade-version-command/instance-commands.constant',
  );
  requireNamedImport(providerModule, 'Module', '@nestjs/common');
  const providerClass = providerModule.statements.find(
    (statement) =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === 'InstanceCommandProviderModule',
  );

  requireCondition(
    Boolean(providerClass),
    'Missing registered provider module',
  );
  const moduleDecorator = (
    ts.getDecorators(providerClass as ts.ClassDeclaration) ?? []
  ).find(
    (decorator) =>
      ts.isCallExpression(decorator.expression) &&
      decorator.expression.expression.getText(providerModule) === 'Module',
  );
  const moduleOptions =
    moduleDecorator && ts.isCallExpression(moduleDecorator.expression)
      ? moduleDecorator.expression.arguments[0]
      : undefined;

  requireCondition(
    Boolean(moduleOptions) &&
      ts.isObjectLiteralExpression(moduleOptions as ts.Node),
    'Unsupported provider module',
  );
  const providersProperty = (
    moduleOptions as ts.ObjectLiteralExpression
  ).properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(providerModule) === 'providers',
  );
  const providerArray =
    providersProperty && ts.isPropertyAssignment(providersProperty)
      ? providersProperty.initializer
      : undefined;

  requireCondition(
    Boolean(providerArray) &&
      ts.isArrayLiteralExpression(providerArray as ts.Node) &&
      (providerArray as ts.ArrayLiteralExpression).elements.filter(
        (element) =>
          ts.isSpreadElement(element) &&
          element.expression.getText(providerModule) === 'INSTANCE_COMMANDS',
      ).length === 1,
    'INSTANCE_COMMANDS is not registered in provider discovery',
  );
  requireCondition(
    (providerArray as ts.ArrayLiteralExpression).elements.every(
      (element) =>
        (ts.isSpreadElement(element) &&
          element.expression.getText(providerModule) === 'INSTANCE_COMMANDS') ||
        (ts.isIdentifier(element) &&
          element.text === 'SimpleSecretEncryptionUtil'),
    ),
    'Unsupported additional provider discovery',
  );
  requireNamedImport(
    providerModule,
    'SimpleSecretEncryptionUtil',
    'src/engine/core-modules/two-factor-authentication/utils/simple-secret-encryption.util',
  );
  const providers = initializer(constant, 'INSTANCE_COMMANDS');

  requireCondition(
    ts.isArrayLiteralExpression(providers) &&
      providers.elements.every(ts.isIdentifier),
    'Unsupported provider array',
  );
  const imports = new Map<string, string>();

  for (const statement of constant.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      requireCondition(
        !binding.propertyName &&
          (statement.moduleSpecifier.text.startsWith(
            'src/database/commands/upgrade-version-command/',
          ) ||
            /^\.\/\d+-\d+\/[a-z0-9-]+$/.test(statement.moduleSpecifier.text)),
        'Unexpected command import',
      );
      imports.set(
        binding.name.text,
        statement.moduleSpecifier.text.startsWith('./')
          ? join(
              serverRoot,
              'src/database/commands/upgrade-version-command',
              `${statement.moduleSpecifier.text}.ts`,
            )
          : join(serverRoot, `${statement.moduleSpecifier.text}.ts`),
      );
    }
  }

  const commands: Inventory['commands'] = [];

  for (const provider of (providers as ts.ArrayLiteralExpression).elements) {
    const className = (provider as ts.Identifier).text;
    const path = imports.get(className);

    requireCondition(Boolean(path), 'Unresolved provider');
    const source = readSource(path as string);
    const declaration = source.statements.find(
      (statement) =>
        ts.isClassDeclaration(statement) && statement.name?.text === className,
    );

    requireCondition(Boolean(declaration), 'Unresolved command class');
    requireCondition(
      (declaration as ts.ClassDeclaration).modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true,
      'Command class is not exported',
    );
    requireNamedImport(
      source,
      'RegisteredInstanceCommand',
      'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator',
    );
    const decorators =
      ts.getDecorators(declaration as ts.ClassDeclaration) ?? [];
    const registered = decorators.filter(
      (decorator) =>
        ts.isCallExpression(decorator.expression) &&
        decorator.expression.expression.getText(source) ===
          'RegisteredInstanceCommand',
    );

    requireCondition(registered.length <= 1, 'Duplicate registration');
    requireCondition(
      registered.length === 1,
      'Incomplete command source registration',
    );
    const args = (registered[0].expression as ts.CallExpression).arguments;

    requireCondition(
      (args.length === 2 || args.length === 3) &&
        ts.isStringLiteral(args[0]) &&
        ts.isNumericLiteral(args[1]),
      'Unsupported registration',
    );
    const version = (args[0] as ts.StringLiteral).text;
    const timestamp = (args[1] as ts.NumericLiteral).text;
    let kind: 'fast' | 'slow' = 'fast';

    if (args.length === 3) {
      requireCondition(
        args[2].getText(source).replace(/\s/g, '') === "{type:'slow'}",
        'Unsupported registration options',
      );
      kind = 'slow';
    }
    if (versions.includes(version))
      commands.push({
        name: `${version}_${className}_${timestamp}`,
        kind,
        source: path as string,
      });
  }

  const orderingKeys = commands.map(
    ({ name, kind }) =>
      `${name.split('_')[0]}_${kind}_${name.slice(name.lastIndexOf('_') + 1)}`,
  );

  requireCondition(
    new Set(orderingKeys).size === commands.length,
    'Duplicate registered timestamp within command kind/version',
  );
  const legacyRoot = join(
    serverRoot,
    'src/database/typeorm/core/legacy-typeorm-migrations-do-not-add',
  );
  const legacyNames = (
    billingEnabled ? ['common', 'billing'] : ['common']
  ).flatMap((directory) =>
    readdirSync(join(legacyRoot, directory))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => {
        const source = readSource(join(legacyRoot, directory, name));
        const classes = source.statements.filter(ts.isClassDeclaration);

        requireCondition(
          classes.length === 1 && Boolean(classes[0].name),
          'Unexpected legacy migration source',
        );
        const nameProperty = classes[0].members.find(
          (member) =>
            ts.isPropertyDeclaration(member) &&
            member.name.getText(source) === 'name',
        );

        if (nameProperty && ts.isPropertyDeclaration(nameProperty)) {
          requireCondition(
            Boolean(nameProperty.initializer) &&
              ts.isStringLiteral(nameProperty.initializer as ts.Expression),
            'Unsupported legacy migration name',
          );
          return (nameProperty.initializer as ts.StringLiteral).text;
        }
        return classes[0].name?.text as string;
      }),
  );

  const previousVersion = versions[versions.length - 2];
  const previousDirectory = previousVersion.split('.').slice(0, 2).join('-');
  const commandsRoot = join(
    serverRoot,
    'src/database/commands/upgrade-version-command',
  );
  const workspaceProvider = readSource(
    join(commandsRoot, 'workspace-command-provider.module.ts'),
  );
  const versionPath = `src/database/commands/upgrade-version-command/${previousDirectory}/${previousDirectory}-upgrade-version-command.module`;
  const previousModuleName = `V${previousDirectory.replace('-', '_')}_UpgradeVersionCommandModule`;
  requireNamedImport(workspaceProvider, 'Module', '@nestjs/common');
  requireNamedImport(workspaceProvider, previousModuleName, versionPath);
  requireCondition(
    registeredModuleReferences(
      workspaceProvider,
      'WorkspaceCommandProviderModule',
      'imports',
    ).includes(previousModuleName),
    'Previous workspace module is not registered',
  );
  const versionModule = readSource(
    join(
      commandsRoot,
      previousDirectory,
      `${previousDirectory}-upgrade-version-command.module.ts`,
    ),
  );
  requireNamedImport(versionModule, 'Module', '@nestjs/common');
  const previousProviders = registeredModuleReferences(
    versionModule,
    previousModuleName,
    'providers',
  );

  const workspaceCommands = readdirSync(join(commandsRoot, previousDirectory))
    .filter((name) => name.endsWith('.command.ts'))
    .flatMap((file) => {
      const source = readSource(join(commandsRoot, previousDirectory, file));

      return source.statements
        .filter(ts.isClassDeclaration)
        .flatMap((declaration) => {
          const decorator = (ts.getDecorators(declaration) ?? []).find(
            (entry) =>
              ts.isCallExpression(entry.expression) &&
              entry.expression.expression.getText(source) ===
                'RegisteredWorkspaceCommand',
          );

          if (!decorator) return [];
          const args = (decorator.expression as ts.CallExpression).arguments;

          requireCondition(
            args.length >= 2 &&
              ts.isStringLiteral(args[0]) &&
              ts.isNumericLiteral(args[1]) &&
              Boolean(declaration.name),
            'Unsupported workspace registration',
          );
          const version = (args[0] as ts.StringLiteral).text;
          const className = declaration.name?.text as string;

          requireCondition(
            version === previousVersion &&
              previousProviders.filter((name) => name === className).length ===
                1,
            'Unregistered previous workspace command',
          );
          requireNamedImport(
            versionModule,
            className,
            `src/database/commands/upgrade-version-command/${previousDirectory}/${file.slice(0, -3)}`,
          );
          return [
            {
              name: `${version}_${className}_${args[1].getText(source)}`,
              timestamp: Number(args[1].getText(source)),
            },
          ];
        });
    })
    .sort((first, second) => first.timestamp - second.timestamp);

  requireCondition(
    workspaceCommands.length > 0,
    'Missing previous workspace safety check',
  );
  return {
    commands,
    legacyNames,
    previousWorkspaceCommand:
      workspaceCommands[workspaceCommands.length - 1].name,
  };
};
