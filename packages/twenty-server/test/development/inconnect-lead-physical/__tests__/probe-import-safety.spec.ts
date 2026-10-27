describe('PHYS-P2 native entry import and authorization boundary', () => {
  it('imports native bindings but performs no filesystem, spawn, signal or network operation', async () => {
    const spawn = jest.fn(() => {
      throw new Error('Real process forbidden');
    });
    const filesystem = {
      open: jest.fn(),
      lstat: jest.fn(),
      mkdir: jest.fn(),
      readFile: jest.fn(),
    };
    jest.doMock('node:child_process', () => ({ spawn }));
    jest.doMock('node:fs/promises', () => filesystem);
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('Signal forbidden');
    });
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Network forbidden');
    });
    try {
      let run:
        | (typeof import('test/development/inconnect-lead-physical/probe-only/live-probe-entry'))['runLiveProbeOnly']
        | undefined;
      jest.isolateModules(() => {
        const entry =
          require('test/development/inconnect-lead-physical/probe-only/live-probe-entry') as typeof import('test/development/inconnect-lead-physical/probe-only/live-probe-entry');
        run = entry.runLiveProbeOnly;
      });
      if (!run) throw new Error('Missing entry');
      await expect(
        run({ force: true, capability: 'POSTGRES_INIT' }),
      ).rejects.toThrow('BLOCKED');
      expect(spawn).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      for (const mocked of Object.values(filesystem))
        expect(mocked).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      jest.dontMock('node:child_process');
      jest.dontMock('node:fs/promises');
    }
  });
});
