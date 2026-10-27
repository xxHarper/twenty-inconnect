describe('PHYS-P1 inert import graph', () => {
  it('imports every module and rejects execution without loading IO/bootstrap modules', () => {
    const forbiddenImports: string[] = [];
    const modules = [
      'node:fs',
      'fs',
      'node:fs/promises',
      'fs/promises',
      'node:child_process',
      'child_process',
      'node:net',
      'net',
      'node:http',
      'http',
      'node:https',
      'https',
      'node:dgram',
      'dgram',
      'node:worker_threads',
      'worker_threads',
      'node:cluster',
      'cluster',
      'pg',
      'pg-pool',
      'typeorm',
      'redis',
      'ioredis',
      'dotenv',
      '@nestjs/core',
    ];
    for (const name of modules)
      jest.doMock(
        name,
        () => {
          forbiddenImports.push(name);
          throw new Error('Forbidden PHYS-P1 IO import');
        },
        { virtual: true },
      );
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('Forbidden signal');
    });
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Forbidden exit');
    });
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Forbidden network');
    });
    try {
      jest.isolateModules(() => {
        require('test/development/inconnect-lead-physical/contracts');
        require('test/development/inconnect-lead-physical/environment');
        require('test/development/inconnect-lead-physical/observations');
        const launcher =
          require('test/development/inconnect-lead-physical/launcher') as typeof import('test/development/inconnect-lead-physical/launcher');
        expect(() => launcher.requirePhysicalExecution()).toThrow('BLOCKED');
        expect(
          launcher.inspectLauncherRequest(['--describe']).physicalExecution,
        ).toBe('BLOCKED');
      });
      expect(forbiddenImports).toEqual([]);
      expect(kill).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      for (const name of modules) jest.dontMock(name);
    }
  });
});
