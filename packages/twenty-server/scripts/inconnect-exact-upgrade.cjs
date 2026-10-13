// Source-only preview launcher. No application, datasource or registry bootstrap.
if (require.main === module) {
  const { readFileSync } = require('node:fs');
  const { resolve, sep } = require('node:path');
  const { transformSync } = require('@swc/core');
  const { register } = require('tsconfig-paths');

  if (
    process.platform !== 'linux' ||
    process.versions.node.split('.')[0] !== '24'
  ) {
    throw new Error('Only Linux/WSL with Linux Node 24 is supported');
  }
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) {
    throw new Error('Ambient Node loader/preload overrides are forbidden');
  }
  const serverRoot = resolve(__dirname, '..');
  const unregister = register({
    baseUrl: serverRoot,
    paths: { 'src/*': ['src/*'] },
  });
  const previousLoader = require.extensions['.ts'];
  require.extensions['.ts'] = (loadedModule, filename) => {
    if (!filename.startsWith(resolve(serverRoot, 'src') + sep)) {
      if (previousLoader) return previousLoader(loadedModule, filename);
      throw new Error(
        'Source loader received a file outside twenty-server/src',
      );
    }
    const transformed = transformSync(readFileSync(filename, 'utf8'), {
      filename,
      swcrc: false,
      module: { type: 'commonjs' },
      jsc: { target: 'es2020', parser: { syntax: 'typescript' } },
    });
    loadedModule._compile(transformed.code, filename);
  };
  const {
    runCli,
    reportFailure,
  } = require('../src/database/scripts/inconnect-exact-upgrade/cli.ts');
  void runCli(process.argv.slice(2))
    .catch(reportFailure)
    .finally(() => {
      if (previousLoader) require.extensions['.ts'] = previousLoader;
      else delete require.extensions['.ts'];
      unregister();
    });
}
