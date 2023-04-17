import type { ClientOptions, EventProcessor } from '@sentry/types';
import type { Debugger, InspectorNotification } from 'inspector';
import type { LRUMap } from 'lru_map';

import { defaultStackParser } from '../../src';
import type { DebugSession, FrameVariables } from '../../src/integrations/localvariables';
import { createCallbackList, LocalVariables } from '../../src/integrations/localvariables';
import { NODE_VERSION } from '../../src/nodeVersion';
import { getDefaultNodeClientOptions } from '../../test/helper/node-client-options';

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

interface ThrowOn {
  configureAndConnect?: boolean;
  getLocalVariables?: boolean;
}

class MockDebugSession implements DebugSession {
  private _onPause?: (message: InspectorNotification<Debugger.PausedEventDataType>, callback: () => void) => void;

  constructor(private readonly _vars: Record<string, Record<string, unknown>>, private readonly _throwOn?: ThrowOn) {}

  public configureAndConnect(
    onPause: (message: InspectorNotification<Debugger.PausedEventDataType>, callback: () => void) => void,
    _captureAll: boolean,
  ): void {
    if (this._throwOn?.configureAndConnect) {
      throw new Error('configureAndConnect should not be called');
    }

    this._onPause = onPause;
  }

  public getLocalVariables(objectId: string, callback: (vars: Record<string, unknown>) => void): void {
    if (this._throwOn?.getLocalVariables) {
      throw new Error('getLocalVariables should not be called');
    }

    callback(this._vars[objectId]);
  }

  public runPause(message: InspectorNotification<Debugger.PausedEventDataType>): Promise<void> {
    return new Promise(resolve => {
      this._onPause?.(message, resolve);
    });
  }
}

interface LocalVariablesPrivate {
  _cachedFrames: LRUMap<string, FrameVariables[]>;
  _setup(addGlobalEventProcessor: (callback: EventProcessor) => void, clientOptions: ClientOptions): void;
}

const exceptionEvent = {
  method: 'Debugger.paused',
  params: {
    reason: 'exception',
    data: {
      description:
        'Error: Some  error\n' +
        '    at two (/dist/javascript/src/main.js:23:9)\n' +
        '    at one (/dist/javascript/src/main.js:19:3)\n' +
        '    at Timeout._onTimeout (/dist/javascript/src/main.js:40:5)\n' +
        '    at listOnTimeout (node:internal/timers:559:17)\n' +
        '    at process.processTimers (node:internal/timers:502:7)',
    },
    callFrames: [
      {
        callFrameId: '-6224981551105448869.1.0',
        functionName: 'two',
        location: { scriptId: '134', lineNumber: 22 },
        url: '',
        scopeChain: [
          {
            type: 'local',
            object: {
              type: 'object',
              className: 'Object',
              objectId: '-6224981551105448869.1.2',
            },
            name: 'two',
          },
        ],
        this: {
          type: 'object',
          className: 'global',
        },
      },
      {
        callFrameId: '-6224981551105448869.1.1',
        functionName: 'one',
        location: { scriptId: '134', lineNumber: 18 },
        url: '',
        scopeChain: [
          {
            type: 'local',
            object: {
              type: 'object',
              className: 'Object',
              objectId: '-6224981551105448869.1.6',
            },
            name: 'one',
          },
        ],
        this: {
          type: 'object',
          className: 'global',
        },
      },
    ],
  },
};

const exceptionEvent100Frames = {
  method: 'Debugger.paused',
  params: {
    reason: 'exception',
    data: {
      description:
        'Error: Some  error\n' +
        '    at two (/dist/javascript/src/main.js:23:9)\n' +
        '    at one (/dist/javascript/src/main.js:19:3)\n' +
        '    at Timeout._onTimeout (/dist/javascript/src/main.js:40:5)\n' +
        '    at listOnTimeout (node:internal/timers:559:17)\n' +
        '    at process.processTimers (node:internal/timers:502:7)',
    },
    callFrames: new Array(100).fill({
      callFrameId: '-6224981551105448869.1.0',
      functionName: 'two',
      location: { scriptId: '134', lineNumber: 22 },
      url: '',
      scopeChain: [
        {
          type: 'local',
          object: {
            type: 'object',
            className: 'Object',
            objectId: '-6224981551105448869.1.2',
          },
          name: 'two',
        },
      ],
      this: {
        type: 'object',
        className: 'global',
      },
    }),
  },
};

describeIf((NODE_VERSION.major || 0) >= 18)('LocalVariables', () => {
  it('Adds local variables to stack frames', async () => {
    expect.assertions(7);

    const session = new MockDebugSession({
      '-6224981551105448869.1.2': { name: 'tim' },
      '-6224981551105448869.1.6': { arr: [1, 2, 3] },
    });
    const localVariables = new LocalVariables({}, session);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
      includeLocalVariables: true,
    });

    let eventProcessor: EventProcessor | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._setup(callback => {
      eventProcessor = callback;
    }, options);

    expect(eventProcessor).toBeDefined();

    await session.runPause(exceptionEvent);

    expect((localVariables as unknown as LocalVariablesPrivate)._cachedFrames.size).toBe(1);

    let frames: FrameVariables[] | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._cachedFrames.forEach(f => {
      frames = f;
    });

    expect(frames).toBeDefined();

    const vars = frames as FrameVariables[];

    expect(vars).toEqual([
      { function: 'two', vars: { name: 'tim' } },
      { function: 'one', vars: { arr: [1, 2, 3] } },
    ]);

    const event = await eventProcessor?.(
      {
        event_id: '9cbf882ade9a415986632ac4e16918eb',
        platform: 'node',
        timestamp: 1671113680.306,
        level: 'fatal',
        exception: {
          values: [
            {
              type: 'Error',
              value: 'Some error',
              stacktrace: {
                frames: [
                  {
                    function: 'process.processTimers',
                    lineno: 502,
                    colno: 7,
                    in_app: false,
                  },
                  {
                    function: 'listOnTimeout',
                    lineno: 559,
                    colno: 17,
                    in_app: false,
                  },
                  {
                    function: 'Timeout._onTimeout',
                    lineno: 40,
                    colno: 5,
                    in_app: true,
                  },
                  {
                    function: 'one',
                    lineno: 19,
                    colno: 3,
                    in_app: true,
                  },
                  {
                    function: 'two',
                    lineno: 23,
                    colno: 9,
                    in_app: true,
                  },
                ],
              },
              mechanism: { type: 'generic', handled: true },
            },
          ],
        },
      },
      {},
    );

    expect(event?.exception?.values?.[0].stacktrace?.frames?.[3]?.vars).toEqual({ arr: [1, 2, 3] });
    expect(event?.exception?.values?.[0].stacktrace?.frames?.[4]?.vars).toEqual({ name: 'tim' });

    expect((localVariables as unknown as LocalVariablesPrivate)._cachedFrames.size).toBe(0);
  });

  it('Only considers the first 5 frames', async () => {
    expect.assertions(4);

    const session = new MockDebugSession({});
    const localVariables = new LocalVariables({}, session);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
      includeLocalVariables: true,
    });

    let eventProcessor: EventProcessor | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._setup(callback => {
      eventProcessor = callback;
    }, options);

    expect(eventProcessor).toBeDefined();

    await session.runPause(exceptionEvent100Frames);

    expect((localVariables as unknown as LocalVariablesPrivate)._cachedFrames.size).toBe(1);

    let frames: FrameVariables[] | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._cachedFrames.forEach(f => {
      frames = f;
    });

    expect(frames).toBeDefined();

    const vars = frames as FrameVariables[];

    expect(vars.length).toEqual(5);
  });

  it('Should not lookup variables for non-exception reasons', async () => {
    expect.assertions(1);

    const session = new MockDebugSession({}, { getLocalVariables: true });
    const localVariables = new LocalVariables({}, session);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
      includeLocalVariables: true,
    });

    (localVariables as unknown as LocalVariablesPrivate)._setup(_ => {}, options);

    const nonExceptionEvent = {
      method: exceptionEvent.method,
      params: { ...exceptionEvent.params, reason: 'non-exception-reason' },
    };

    await session.runPause(nonExceptionEvent);

    expect((localVariables as unknown as LocalVariablesPrivate)._cachedFrames.size).toBe(0);
  });

  it('Should not initialize when disabled', async () => {
    expect.assertions(1);

    const session = new MockDebugSession({}, { configureAndConnect: true });
    const localVariables = new LocalVariables({}, session);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
    });

    let eventProcessor: EventProcessor | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._setup(callback => {
      eventProcessor = callback;
    }, options);

    expect(eventProcessor).toBeUndefined();
  });

  it('Should not initialize when inspector not loaded', async () => {
    expect.assertions(1);

    const localVariables = new LocalVariables({}, undefined);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
    });

    let eventProcessor: EventProcessor | undefined;

    (localVariables as unknown as LocalVariablesPrivate)._setup(callback => {
      eventProcessor = callback;
    }, options);

    expect(eventProcessor).toBeUndefined();
  });

  it('Should cache identical uncaught exception events', async () => {
    expect.assertions(1);

    const session = new MockDebugSession({
      '-6224981551105448869.1.2': { name: 'tim' },
      '-6224981551105448869.1.6': { arr: [1, 2, 3] },
    });
    const localVariables = new LocalVariables({}, session);
    const options = getDefaultNodeClientOptions({
      stackParser: defaultStackParser,
      includeLocalVariables: true,
    });

    (localVariables as unknown as LocalVariablesPrivate)._setup(_ => {}, options);

    await session.runPause(exceptionEvent);
    await session.runPause(exceptionEvent);
    await session.runPause(exceptionEvent);
    await session.runPause(exceptionEvent);
    await session.runPause(exceptionEvent);

    expect((localVariables as unknown as LocalVariablesPrivate)._cachedFrames.size).toBe(1);
  });

  describe('createCallbackList', () => {
    it('Should call callbacks in reverse order', done => {
      const log: number[] = [];

      const { add, next } = createCallbackList<number>(n => {
        expect(log).toEqual([5, 4, 3, 2, 1]);
        expect(n).toBe(15);
        done();
      });

      add(n => {
        log.push(1);
        next(n + 1);
      });

      add(n => {
        log.push(2);
        next(n + 1);
      });

      add(n => {
        log.push(3);
        next(n + 1);
      });

      add(n => {
        log.push(4);
        next(n + 1);
      });

      add(n => {
        log.push(5);
        next(n + 11);
      });

      next(0);
    });

    it('only calls complete once even if multiple next', done => {
      const { add, next } = createCallbackList<number>(n => {
        expect(n).toBe(1);
        done();
      });

      add(n => {
        next(n + 1);
        // We dont actually do this in our code...
        next(n + 1);
      });

      next(0);
    });

    it('calls completed if added closure throws', done => {
      const { add, next } = createCallbackList<number>(n => {
        expect(n).toBe(10);
        done();
      });

      add(n => {
        throw new Error('test');
        next(n + 1);
      });

      next(10);
    });
  });
});
