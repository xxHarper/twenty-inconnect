// Separate test-only static entrypoint. This launcher cannot open a datasource.
if (require.main === module) {
  if (process.argv.includes('--execute')) {
    process.stderr.write(
      'PG0: physical execution BLOCKED; separate reviewed PG1 implementation required\n',
    );
    process.exitCode = 1;
  } else {
    const { readFileSync } = require('node:fs');
    const { resolve, sep } = require('node:path');
    const { transformSync } = require('@swc/core');
    const { register } = require('tsconfig-paths');
    if (
      process.platform !== 'linux' ||
      process.versions.node.split('.')[0] !== '24' ||
      process.env.NODE_OPTIONS !== undefined ||
      process.env.NODE_PATH !== undefined
    ) {
      throw new Error('Linux Node 24 without loader overrides required');
    }
    const serverRoot = resolve(__dirname, '..');
    const sourceRoot = resolve(serverRoot, 'src') + sep;
    const unregister = register({
      baseUrl: serverRoot,
      paths: { 'src/*': ['src/*'] },
    });
    const previousLoader = require.extensions['.ts'];
    require.extensions['.ts'] = (loadedModule, filename) => {
      if (!filename.startsWith(sourceRoot))
        throw new Error('Unexpected source import');
      loadedModule._compile(
        transformSync(readFileSync(filename, 'utf8'), {
          filename,
          swcrc: false,
          module: { type: 'commonjs' },
          jsc: { target: 'es2020', parser: { syntax: 'typescript' } },
        }).code,
        filename,
      );
    };
    try {
      const {
        previewPhysicalHarness,
      } = require('../src/database/scripts/inconnect-exact-upgrade/physical-harness/entrypoint.ts');
      process.stdout.write(
        JSON.stringify(previewPhysicalHarness(process.argv.slice(2)), null, 2) +
          '\n',
      );
    } catch {
      process.stderr.write('PG0: unsupported physical harness request\n');
      process.exitCode = 1;
    } finally {
      if (previousLoader) require.extensions['.ts'] = previousLoader;
      else delete require.extensions['.ts'];
      unregister();
    }
  }
}
