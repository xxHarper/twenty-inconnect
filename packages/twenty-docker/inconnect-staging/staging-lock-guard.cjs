const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Yarn focus projects a subset in memory and deliberately does not persist it.
module.exports = {
  name: 'staging-lock-guard',
  factory: (require) => {
    const { parseSyml } = require('@yarnpkg/parsers');
    const { structUtils } = require('@yarnpkg/core');

    return {
      hooks: {
        validateProjectAfterInstall(project, report) {
          const locked = parseSyml(
            readFileSync(join(project.cwd, 'yarn.lock'), 'utf8'),
          );
          const resolved = parseSyml(project.generateLockfile());
          const descriptors = new Map();

          for (const [group, entry] of Object.entries(locked)) {
            if (group === '__metadata') continue;
            for (const descriptor of group.split(/, */)) {
              descriptors.set(descriptor, entry);
            }
          }

          let verified = 0;
          let failures = 0;
          for (const [group, entry] of Object.entries(resolved)) {
            if (group === '__metadata') continue;
            const locator = structUtils.parseLocator(entry.resolution);
            if (entry.linkType === 'soft' && locator.reference.startsWith('workspace:')) continue;

            const disabled = project.disabledLocators.has(locator.locatorHash);

            for (const descriptor of group.split(/, */)) {
              const expected = descriptors.get(descriptor);
              if (
                expected?.resolution !== entry.resolution ||
                (entry.checksum !== undefined && expected.checksum !== entry.checksum) ||
                (!disabled && !entry.checksum)
              ) {
                report.reportError(0, `STAGING-S2 lock mismatch: ${descriptor}`);
                failures++;
              } else if (!disabled) {
                verified++;
              }
            }
          }

          if (verified === 0) {
            report.reportError(0, 'STAGING-S2 did not verify any external packages');
          } else if (failures === 0) {
            console.log(`STAGING-S2 lock verified: ${verified} active descriptors`);
          }
        },
      },
    };
  },
};
