import {
  evidenceTarget,
  execInput,
  runId,
  exited,
  finalizationActions,
  finalizationInput,
  identity,
  reportSuccess,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/__tests__/fixtures';
import {
  evidenceAcceptance,
  prepareEvidence,
  retainEvidence,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/evidence';
import { finalizeProbe } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/finalization';

describe('total lifecycle finalization with synthetic callbacks', () => {
  it('should require namespace-holder scan coverage for intermediate supervisors', async () => {
    const input = finalizationInput();
    const supervisor = input.inventory.actors[2];

    supervisor.expectedNamespaces.network = '99';
    supervisor.creationNamespaces = { ...supervisor.expectedNamespaces };
    input.inventory.executablePolicies[2].stages[0].namespaces = {
      ...supervisor.expectedNamespaces,
    };
    if (supervisor.observation.state !== 'live')
      throw new Error('Invalid fixture');
    supervisor.observation.namespaces = { ...supervisor.expectedNamespaces };
    const actions = finalizationActions(input);
    const incomplete = await finalizeProbe(input, actions, reportSuccess);

    expect(incomplete.acceptance).toBe('PARTIAL');
    expect(incomplete.diagnostics).toContain(
      'UNVERIFIED:namespaceScanCoverage',
    );
    actions.namespaceHolders = async () => ({
      namespaces: { user: '1', network: '2', mount: '3', pid: '4' },
      scannedNamespaces: [{ kind: 'network', identity: '99' }],
      holders: [],
      scanComplete: true,
    });
    input.recorder = finalizationInput().recorder;
    expect(
      (await finalizeProbe(input, actions, reportSuccess)).acceptance,
    ).toBe('PASS');
  });

  it('should reject a changed creation parent in returned reaping evidence', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);

    actions.processExits = async () =>
      input.inventory.actors.map((actor, index) => {
        const closure = exited(actor);

        if (index === 3 && closure.creation)
          closure.creation = { ...closure.creation, parent: identity(99) };
        return closure;
      });
    expect(
      (await finalizeProbe(input, actions, reportSuccess)).acceptance,
    ).toBe('PARTIAL');
  });

  it('should reject malformed reporting acknowledgments without accepting cleanup', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      async () =>
        JSON.parse('{"evidenceRetained":"true","summaryDelivered":true}'),
    );

    expect(result.acceptance).toBe('PARTIAL');
    expect(result.state).toBe('FINALIZATION_INCOMPLETE');
    expect(result.diagnostics).toContain('MISSING_OR_INVALID:reporting');
  });

  it('should attempt every descriptor and preserve successful closures after an individual failure', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);
    const closed: number[] = [];
    const report = jest.fn(reportSuccess);

    actions.descriptorClosures = async (ordinal) => {
      closed.push(ordinal);
      if (ordinal === 2) throw new Error('synthetic failure');
      return true;
    };
    const result = await finalizeProbe(input, actions, report);

    expect(closed).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.cleanupFailures).toEqual([
      {
        action: 'descriptorClosures',
        code: 'CALLBACK_FAILED',
        descriptorOrdinal: 2,
      },
    ]);
    expect(
      result.evidence.descriptorClosures
        ?.filter((closure) => closure.closed)
        .map((closure) => closure.ordinal),
    ).toEqual([1, 3, 4, 5, 6]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(result.acceptance).toBe('PARTIAL');
  });

  it('should accept complete synthetic evidence only after all independent obligations succeed', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );

    expect(result).toMatchObject({
      state: 'COMPLETE',
      acceptance: 'PASS',
      diagnostics: [],
      cleanupFailures: [],
    });
    expect(result.evidence.processExits).toHaveLength(5);
  });

  it('should return FINALIZATION_INCOMPLETE for a missing namespace snapshot without throwing', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);

    actions.namespaceHolders = async () => ({
      holders: [],
      scanComplete: true,
    });
    const result = await finalizeProbe(input, actions, reportSuccess);

    expect(result.state).toBe('FINALIZATION_INCOMPLETE');
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.diagnostics).toContain('MISSING:namespaceHolders.namespaces');
    expect(result.evidence.descriptorClosures).toHaveLength(6);
  });

  it('should preserve multiple cleanup failures and the original failure while continuing reporting', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);
    const calls: string[] = [];

    input.originalFailure = 'OBSERVATION_FAILED';
    actions.processExits = async () => {
      calls.push('verify');
      throw new Error('private exception');
    };
    actions.namespaceHolders = async () => {
      calls.push('holders');
      throw new TypeError('secondary');
    };
    actions.descriptorClosures = async () => {
      calls.push('close');
      throw new Error('closure');
    };
    actions.output = async () => {
      calls.push('eof');
      return { eof: true, bufferedBytes: 0 };
    };
    actions.parentInvariants = async () => {
      calls.push('parent');
      return true;
    };
    const result = await finalizeProbe(input, actions, async () => {
      calls.push('report');
      throw new Error('reporting');
    });

    expect(calls).toEqual([
      'verify',
      'holders',
      ...Array<string>(6).fill('close'),
      'eof',
      'parent',
      'report',
    ]);
    expect(result.originalFailure).toBe('OBSERVATION_FAILED');
    expect(result.cleanupFailures.map(({ action }) => action)).toEqual([
      'processExits',
      'namespaceHolders',
      ...Array<string>(6).fill('descriptorClosures'),
      'report',
    ]);
    expect(result.evidence.output?.eof).toBe(true);
    expect(result.evidence.parentInvariants).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private exception');
    expect(result.acceptance).toBe('PARTIAL');
  });

  it('should attempt reporting and every available action when callbacks are missing or malformed', async () => {
    const report = jest.fn(reportSuccess);
    const result = await finalizeProbe(
      finalizationInput(),
      {
        namespaceHolders: async () => JSON.parse('{"scanComplete":true}'),
      },
      report,
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.diagnostics).toContain('MISSING_OR_INVALID:namespaceHolders');
  });

  it.each([
    'descriptors',
    'exits',
    'reaping',
    'holders',
    'output',
    'parent',
  ] as const)(
    'should reject acceptance when %s remain unverified',
    async (field) => {
      const positive = finalizationInput();
      expect(
        (
          await finalizeProbe(
            positive,
            finalizationActions(positive),
            reportSuccess,
          )
        ).acceptance,
      ).toBe('PASS');
      const input = finalizationInput();
      const actions = finalizationActions(input);

      if (field === 'descriptors')
        actions.descriptorClosures = async () => false;
      if (field === 'exits') actions.processExits = async () => [];
      if (field === 'reaping')
        actions.processExits = async () =>
          input.inventory.actors.map((actor) => ({
            ...exited(actor),
            exit: {
              identity: actor.creation?.identity ?? identity(999),
              pidfdExitObserved: true,
              waitError: 'ECHILD',
            },
          }));
      if (field === 'holders')
        actions.namespaceHolders = async () => ({
          namespaces: { user: '1', network: '2', mount: '3', pid: '4' },
          scannedNamespaces: [],
          holders: [99],
          scanComplete: true,
        });
      if (field === 'output')
        actions.output = async () => ({ eof: false, bufferedBytes: 1 });
      if (field === 'parent') actions.parentInvariants = async () => false;

      expect(
        (await finalizeProbe(input, actions, reportSuccess)).acceptance,
      ).toBe('PARTIAL');
    },
  );

  it.each([
    'signal',
    'window',
    'telemetry',
    'readiness',
    'report',
    'summary',
  ] as const)(
    'should reject incomplete %s even after complete cleanup',
    async (field) => {
      const positive = finalizationInput();
      const accepted = await finalizeProbe(
        positive,
        finalizationActions(positive),
        reportSuccess,
      );
      expect(accepted.acceptance).toBe('PASS');
      expect(
        evidenceAcceptance(positive.recorder, accepted.reporting.retention),
      ).toBe('PASS');
      const input = finalizationInput();

      if (field === 'signal') input.intentionalSignalObserved = false;
      if (field === 'window') input.observationWindowComplete = false;
      if (field === 'telemetry') input.telemetryComplete = false;
      if (field === 'readiness') input.readiness.state = 'UNKNOWN';
      const result = await finalizeProbe(
        input,
        finalizationActions(input),
        async (reportResult, recorder) => ({
          ...(await reportSuccess(reportResult, recorder)),
          evidenceRetained: field !== 'report',
          summaryDelivered: field !== 'summary',
        }),
      );

      expect(
        evidenceAcceptance(input.recorder, result.reporting.retention),
      ).toBe('PASS');
      expect(result.acceptance).toBe('PARTIAL');
    },
  );

  it('should not trust a claimed READY result for an incomplete owned inventory', async () => {
    const input = finalizationInput();

    input.inventory.otherProcesses.push({
      kind: 'unresolved-owned-process',
      pid: 65,
    });
    expect(
      (await finalizeProbe(input, finalizationActions(input), reportSuccess))
        .acceptance,
    ).toBe('PARTIAL');
  });
});

describe('P1-A invocation-bound finalization authority', () => {
  it.each([
    'input',
    'reporting',
    'both',
    'matching-run',
    'matching-generation',
  ] as const)(
    'should keep a revoked PASS terminal after replacing %s references',
    async (replacement) => {
      const input = finalizationInput();
      const originalRecorder = input.recorder;
      const prepared = prepareEvidence(originalRecorder);
      const result = await finalizeProbe(
        input,
        finalizationActions(input),
        reportSuccess,
      );
      const originalReporting = result.reporting;
      const originalReceipt = originalReporting.retention;
      expect(result.acceptance).toBe('PASS');
      expect(originalReceipt?.state).toBe('RETAINED');
      expect(originalRecorder.record({ kind: 'signal', code: 'SIGTERM' })).toBe(
        false,
      );
      expect(result.acceptance).toBe('PARTIAL');

      const replacementRecorder = finalizationInput().recorder;
      if (
        replacement === 'matching-run' ||
        replacement === 'matching-generation'
      )
        replacementRecorder.record({ kind: 'transition', code: 'READY' });
      const replacementReporting = await reportSuccess(
        result,
        replacementRecorder,
      );
      expect(
        evidenceAcceptance(replacementRecorder, replacementReporting.retention),
      ).toBe('PASS');
      expect(replacementRecorder).not.toBe(originalRecorder);
      if (replacement === 'matching-run')
        expect(replacementRecorder.current().runId).toBe(
          originalRecorder.current().runId,
        );
      if (replacement === 'matching-generation')
        expect(replacementRecorder.current().generation).toBe(
          originalRecorder.current().generation,
        );
      if (replacement !== 'reporting') input.recorder = replacementRecorder;
      if (replacement !== 'input')
        expect(Reflect.set(result, 'reporting', replacementReporting)).toBe(
          false,
        );

      for (let read = 0; read < 3; read += 1) {
        expect(result.acceptance).toBe('PARTIAL');
        expect(originalReporting.evidenceRetained).toBe(false);
        expect(originalReceipt?.state).toBe('PARTIAL');
        expect(evidenceAcceptance(originalRecorder, originalReceipt)).toBe(
          'PARTIAL',
        );
      }
      expect(originalRecorder.current().lifecycle).toBe('INVALID');
      expect(prepareEvidence(originalRecorder)).toBe(prepared);
      expect(prepared.state).toBe('PARTIAL');
    },
  );

  it('should bind the recorder before the first asynchronous finalization callback', async () => {
    const input = finalizationInput();
    const originalRecorder = input.recorder;
    const actions = finalizationActions(input);
    const processExits = actions.processExits;
    actions.processExits = async () => {
      input.recorder = finalizationInput().recorder;
      return processExits();
    };
    const report = jest.fn(reportSuccess);
    const result = await finalizeProbe(input, actions, report);
    expect(report.mock.calls[0][1]).toBe(originalRecorder);
    expect(result.acceptance).toBe('PASS');
    originalRecorder.record({ kind: 'signal', code: 'SIGTERM' });
    expect(result.acceptance).toBe('PARTIAL');
  });

  it('should prevent nested reporting mutations from restoring revoked authority', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );
    const reporting = result.reporting;
    const receipt = reporting.retention;
    expect(result.acceptance).toBe('PASS');
    input.recorder.record({ kind: 'signal', code: 'SIGTERM' });
    expect(Reflect.set(reporting, 'evidenceRetained', true)).toBe(false);
    expect(Reflect.set(reporting, 'summaryDelivered', true)).toBe(false);
    expect(Reflect.set(reporting, 'retention', undefined)).toBe(false);
    if (!receipt) throw new Error('Missing retention fixture');
    expect(Reflect.set(receipt, 'state', 'RETAINED')).toBe(false);
    expect(Reflect.set(receipt, 'sha256', '0'.repeat(64))).toBe(false);
    expect(
      Reflect.defineProperty(result, 'acceptance', { value: 'PASS' }),
    ).toBe(false);
    expect(Reflect.set(result, 'acceptance', 'PASS')).toBe(false);
    expect(result.acceptance).toBe('PARTIAL');
    expect(reporting.evidenceRetained).toBe(false);
    expect(receipt.state).toBe('PARTIAL');
  });

  it('should keep genuine uninvalidated success PASS across repeated reads', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );
    for (let read = 0; read < 3; read += 1) {
      expect(result.acceptance).toBe('PASS');
      expect(result.reporting.retention?.state).toBe('RETAINED');
    }
    expect(input.recorder.current().lifecycle).toBe('RETAINED');
  });

  it('should never promote failed retention even with a genuine replacement receipt', async () => {
    const input = finalizationInput();
    const originalRecorder = input.recorder;
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      async (_result, recorder) => ({
        evidenceRetained: true,
        summaryDelivered: true,
        retention: await retainEvidence(
          recorder,
          prepareEvidence(recorder),
          evidenceTarget(),
          runId,
          1000,
          {
            writeExclusive: async () => {
              throw new Error('synthetic retention failure');
            },
            readBack: async () => '',
          },
        ),
      }),
    );
    expect(result.acceptance).toBe('PARTIAL');
    const replacementRecorder = finalizationInput().recorder;
    const replacementReporting = await reportSuccess(
      result,
      replacementRecorder,
    );
    expect(Reflect.set(result, 'reporting', replacementReporting)).toBe(false);
    input.recorder = replacementRecorder;
    expect(replacementReporting.retention?.state).toBe('RETAINED');
    expect(result.reporting.retention?.state).toBe('PARTIAL');
    expect(result.acceptance).toBe('PARTIAL');
    expect(originalRecorder.current().lifecycle).toBe('INVALID');
  });
});

describe('M2 authoritative candidate and current decision', () => {
  it.each(['success', 'gate', 'report-failure'] as const)(
    'should reconcile the submitted report and current %s decision',
    async (scenario) => {
      const input = finalizationInput();
      if (scenario === 'gate') input.telemetryComplete = false;
      let bytes = '';
      const report = jest.fn(async (candidate, recorder) => {
        bytes = JSON.stringify(candidate);
        if (scenario === 'report-failure')
          throw new Error('private reporting error');
        return reportSuccess(candidate, recorder);
      });
      const result = await finalizeProbe(
        input,
        finalizationActions(input),
        report,
      );
      const historical = JSON.parse(bytes);
      expect(historical.status).toBe('CANDIDATE_PENDING_REPORT');
      expect(historical.acceptance).toBe(
        scenario === 'gate' ? 'PARTIAL' : 'PASS',
      );
      expect(result.acceptance).toBe(
        scenario === 'success' ? 'PASS' : 'PARTIAL',
      );
      expect(JSON.stringify(result.historicalReport)).toBe(bytes);
      if (scenario === 'report-failure') {
        expect(result.currentStatus).toBe('INCOMPLETE');
        expect(result.cleanupFailures).toContainEqual({
          action: 'report',
          code: 'CALLBACK_FAILED',
        });
      } else {
        const reporting = result.reporting;
        const archive = prepareEvidence(input.recorder).artifact;
        const oldArchive = archive.content;
        input.recorder.invalidate('RETENTION_FAILED');
        expect(result.acceptance).toBe('PARTIAL');
        expect(result.state).toBe('FINALIZATION_INCOMPLETE');
        expect(result.currentStatus).toBe('REVOKED');
        expect(result.revocation).toMatchObject({
          reason: 'RECORDER_INVALIDATED',
        });
        expect(result.diagnostics).toContain('REVOKED:recorder');
        expect(reporting.evidenceRetained).toBe(false);
        expect(JSON.stringify(result.historicalReport)).toBe(bytes);
        expect(archive.content).toBe(oldArchive);
        expect(report).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('should detach every gate before a callback mutates caller inputs or the candidate', async () => {
    const input = finalizationInput();
    input.telemetryComplete = false;
    const actions = finalizationActions(input);
    const output = actions.output;
    actions.output = async () => {
      input.telemetryComplete = true;
      input.inventory = finalizationInput().inventory;
      return output();
    };
    const result = await finalizeProbe(
      input,
      actions,
      async (candidate, recorder) => {
        expect(Reflect.set(candidate, 'acceptance', 'PASS')).toBe(false);
        expect(Reflect.set(candidate.diagnostics, '0', 'forged')).toBe(false);
        return reportSuccess(candidate, recorder);
      },
    );
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.historicalReport?.acceptance).toBe('PARTIAL');
    expect(Reflect.set(result, 'diagnostics', [])).toBe(false);
    expect(Reflect.set(result, 'historicalReport', {})).toBe(false);
  });
});

describe('M2 total inventory boundary', () => {
  it.each([
    'observation',
    'expectedNamespaces',
    'actors',
    'helpers',
    'otherProcesses',
    'nested-null',
    'bad-pidfd',
    'bad-parent',
    'bad-array',
    'contradiction',
  ])(
    'should fail closed for %s without skipping independent cleanup',
    async (problem) => {
      const positive = finalizationInput();
      expect(
        (
          await finalizeProbe(
            positive,
            finalizationActions(positive),
            reportSuccess,
          )
        ).acceptance,
      ).toBe('PASS');
      const input = finalizationInput();
      const actions = finalizationActions(input);
      // Cleanup callbacks have independent synthetic observations, not the damaged inventory.
      const exits = await actions.processExits();
      actions.processExits = jest.fn(async () => exits);
      actions.descriptorClosures = jest.fn(async () => true);
      actions.output = jest.fn(actions.output);
      actions.parentInvariants = jest.fn(actions.parentInvariants);
      const actor = input.inventory.actors[1];
      if (problem === 'observation' || problem === 'expectedNamespaces')
        Reflect.deleteProperty(actor, problem);
      if (['actors', 'helpers', 'otherProcesses'].includes(problem))
        Reflect.deleteProperty(input.inventory, problem);
      if (problem === 'nested-null') Reflect.set(actor, 'observation', null);
      if (problem === 'bad-pidfd' && actor.creation)
        Reflect.set(actor.creation.identity, 'pidfdInode', 0);
      if (problem === 'bad-parent' && actor.creation)
        Reflect.set(actor.creation, 'parent', []);
      if (problem === 'bad-array') Reflect.set(input.inventory, 'helpers', {});
      if (problem === 'contradiction' && actor.observation.state === 'live')
        actor.observation.identity.startTicks = '999';
      const report = jest.fn(reportSuccess);
      const result = await finalizeProbe(input, actions, report);
      expect(result.acceptance).toBe('PARTIAL');
      expect(result.state).toBe('FINALIZATION_INCOMPLETE');
      expect(actions.processExits).toHaveBeenCalledTimes(1);
      expect(actions.descriptorClosures).toHaveBeenCalledTimes(6);
      expect(actions.output).toHaveBeenCalledTimes(1);
      expect(actions.parentInvariants).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledTimes(1);
      if (problem !== 'contradiction')
        expect(result.validationErrors.length).toBeGreaterThan(0);
    },
  );

  it.each([
    'inventory-getter',
    'nested-getter',
    'array-getter',
    'proxy',
    'revoked-proxy',
    'prototype',
  ])(
    'should reject %s without invoking caller code and still finalize',
    async (problem) => {
      const input = finalizationInput();
      const actions = finalizationActions(input);
      const exits = await actions.processExits();
      actions.processExits = async () => exits;
      const trap = jest.fn(() => {
        throw new Error('must never execute');
      });
      if (problem === 'inventory-getter')
        Object.defineProperty(input.inventory, 'actors', {
          enumerable: true,
          get: trap,
        });
      if (problem === 'nested-getter')
        Object.defineProperty(input.inventory.actors[1], 'observation', {
          enumerable: true,
          get: trap,
        });
      if (problem === 'array-getter')
        Object.defineProperty(input.inventory.actors, '0', {
          enumerable: true,
          get: trap,
        });
      if (problem === 'proxy')
        input.inventory = new Proxy(input.inventory, {
          get: trap,
          getPrototypeOf: trap,
        });
      if (problem === 'revoked-proxy') {
        const proxy = Proxy.revocable(input.inventory, {});
        proxy.revoke();
        input.inventory = proxy.proxy;
      }
      if (problem === 'prototype')
        Object.setPrototypeOf(
          input.inventory,
          Object.defineProperty({}, 'constructor', { get: trap }),
        );
      const report = jest.fn(reportSuccess);
      const result = await finalizeProbe(input, actions, report);
      expect(result.acceptance).toBe('PARTIAL');
      expect(result.evidence.descriptorClosures).toHaveLength(6);
      expect(report).toHaveBeenCalledTimes(1);
      expect(trap).not.toHaveBeenCalled();
    },
  );

  it('should retain validation, original, multiple cleanup and reporting failures independently', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);
    input.originalFailure = 'OBSERVATION_FAILED';
    Reflect.deleteProperty(input.inventory.actors[0], 'observation');
    actions.processExits = async () => {
      throw new Error('private-original');
    };
    actions.namespaceHolders = async () => {
      throw new Error('private-cleanup');
    };
    const closed: number[] = [];
    actions.descriptorClosures = async (ordinal) => {
      closed.push(ordinal);
      if ([1, 3].includes(ordinal)) throw new Error('private-descriptor');
      return true;
    };
    const result = await finalizeProbe(input, actions, async () => {
      throw new Error('private-report');
    });
    expect(result.originalFailure).toBe('OBSERVATION_FAILED');
    expect(result.validationErrors).toContainEqual({
      boundary: 'inventory',
      path: 'actors.0.observation',
      code: 'invalid_union',
    });
    expect(result.cleanupFailures.map((failure) => failure.action)).toEqual([
      'processExits',
      'namespaceHolders',
      'descriptorClosures',
      'descriptorClosures',
      'report',
    ]);
    expect(closed).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.evidence.output).toEqual({ eof: true, bufferedBytes: 0 });
    expect(result.evidence.parentInvariants).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('should close valid descriptor obligations even with an invalid sibling ordinal', async () => {
    const input = finalizationInput();
    Reflect.set(input, 'requiredDescriptorOrdinals', [1, null, 3, 1]);
    const actions = finalizationActions(input);
    actions.descriptorClosures = jest.fn(async () => true);
    const result = await finalizeProbe(input, actions, reportSuccess);
    expect(actions.descriptorClosures).toHaveBeenCalledTimes(2);
    expect(result.evidence.descriptorClosures).toEqual([
      { ordinal: 1, closed: true },
      { ordinal: 3, closed: true },
    ]);
    expect(result.acceptance).toBe('PARTIAL');
  });
});

describe('M2 receipt binding and complete safe accounting', () => {
  it('should bind a receipt to one finalization even with the same original recorder', async () => {
    const input = finalizationInput();
    const first = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );
    expect(first.acceptance).toBe('PASS');
    const second = await finalizeProbe(
      input,
      finalizationActions(input),
      async () => ({
        evidenceRetained: true,
        summaryDelivered: true,
        retention: first.reporting.retention,
      }),
    );
    expect(second.acceptance).toBe('PARTIAL');
    expect(second.currentStatus).toBe('INCOMPLETE');
    expect(second.diagnostics).toContain('UNVERIFIED:reportReceipt');
    expect(second.reporting.evidenceRetained).toBe(false);
    expect(first.acceptance).toBe('PASS');
  });

  it('should preserve a large validation-error set without losing reporting or throwing', async () => {
    const input = finalizationInput();
    const actions = finalizationActions(input);
    const exits = await actions.processExits();
    actions.processExits = async () => exits;
    Reflect.set(
      input.inventory,
      'actors',
      Array.from({ length: 64 }, () => ({})),
    );
    const report = jest.fn(reportSuccess);
    const result = await finalizeProbe(input, actions, report);
    expect(result.validationErrors.length).toBeGreaterThan(256);
    expect(result.historicalReport?.validationErrors).toEqual(
      result.validationErrors,
    );
    expect(result.evidence.descriptorClosures).toHaveLength(6);
    expect(result.acceptance).toBe('PARTIAL');
    expect(report).toHaveBeenCalledTimes(1);
    input.recorder.invalidate('RETENTION_FAILED');
    expect(result.currentStatus).toBe('REVOKED');
  });

  it('should inspect independently safe holder evidence even with invalid inventory', async () => {
    const input = finalizationInput();
    Reflect.deleteProperty(input.inventory, 'actors');
    const actions = finalizationActions(input);
    actions.namespaceHolders = async () => ({
      holders: [99],
      scanComplete: false,
    });
    const result = await finalizeProbe(input, actions, reportSuccess);
    expect(result.diagnostics).toContain('INVALID:inventory');
    expect(result.diagnostics).toContain('UNVERIFIED:namespaceHolders');
    expect(result.diagnostics).toContain('MISSING:namespaceHolders.namespaces');
  });

  it('should require scan coverage of an intermediate exec namespace as well as current namespaces', async () => {
    const input = finalizationInput();
    input.inventory = execInput();
    const actor = input.inventory.actors[3];
    const transitions = actor.execTransitions;
    if (!transitions || actor.observation.state !== 'live')
      throw new Error('Invalid fixture');
    input.inventory.executablePolicies[3].stages[1].namespaces.network = '98';
    transitions[0].afterNamespaces.network = '98';
    transitions[1].beforeNamespaces.network = '98';
    const actions = finalizationActions(input);
    actions.namespaceHolders = async () => ({
      namespaces: { ...actor.expectedNamespaces },
      holders: [],
      scanComplete: true,
      scannedNamespaces: [{ kind: 'network', identity: '99' }],
    });
    const result = await finalizeProbe(input, actions, reportSuccess);
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.diagnostics).toContain('UNVERIFIED:namespaceScanCoverage');
    input.recorder = finalizationInput().recorder;
    actions.namespaceHolders = async () => ({
      namespaces: { ...actor.expectedNamespaces },
      holders: [],
      scanComplete: true,
      scannedNamespaces: [
        { kind: 'network', identity: '99' },
        { kind: 'network', identity: '98' },
      ],
    });
    expect(
      (await finalizeProbe(input, actions, reportSuccess)).acceptance,
    ).toBe('PASS');
  });

  it('should account for a partial acquisition exit while keeping acquisition unresolved', async () => {
    const input = finalizationInput();
    const { pid, startTicks, pidfdDevice, pidfdInode } = identity(66);
    const kernelIdentity = { pid, startTicks, pidfdDevice, pidfdInode };
    input.inventory.otherProcesses.push({
      kind: 'partially-acquired-process',
      identity: kernelIdentity,
      missing: ['executable', 'namespaces'],
      exit: { identity: kernelIdentity, pidfdExitObserved: true, reaped: true },
    });
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.evidence.partialAcquisitions).toEqual([
      {
        identity: kernelIdentity,
        status: 'EXIT_ACCOUNTED_ACQUISITION_UNRESOLVED',
      },
    ]);
    expect(result.diagnostics).toContain('UNKNOWN:ownedProcess');
  });
});

describe('M2 candidate generation and callback input safety', () => {
  it('should refuse a new recorder generation during reporting despite a valid retained receipt', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      async (candidate, recorder) => {
        expect(candidate.acceptance).toBe('PASS');
        recorder.record({ kind: 'transition', code: 'READY' });
        return reportSuccess(candidate, recorder);
      },
    );
    expect(evidenceAcceptance(input.recorder, result.reporting.retention)).toBe(
      'PASS',
    );
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.diagnostics).toContain('UNVERIFIED:reportReceipt');
    expect(result.reporting.evidenceRetained).toBe(false);
  });

  it.each(['processExits', 'namespaceHolders', 'output'] as const)(
    'should reject an accessor-bearing %s callback result without executing it',
    async (key) => {
      const input = finalizationInput();
      const actions = finalizationActions(input);
      const getter = jest.fn(() => {
        throw new Error('forbidden');
      });
      const bad = Object.defineProperty({}, 'identity', {
        get: getter,
        enumerable: true,
      });
      Reflect.set(actions, key, async () =>
        key === 'processExits' ? [bad] : bad,
      );
      const report = jest.fn(reportSuccess);
      const result = await finalizeProbe(input, actions, report);
      expect(result.acceptance).toBe('PARTIAL');
      expect(result.diagnostics).toContain(`MISSING_OR_INVALID:${key}`);
      expect(result.evidence.descriptorClosures).toHaveLength(6);
      expect(report).toHaveBeenCalledTimes(1);
      expect(getter).not.toHaveBeenCalled();
    },
  );
});
