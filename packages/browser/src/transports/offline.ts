import type { OfflineStore, OfflineTransportOptions } from '@sentry/core';
import { makeOfflineTransport } from '@sentry/core';
import type { Envelope, InternalBaseTransportOptions, Transport } from '@sentry/types';
import type { TextDecoderInternal } from '@sentry/utils';
import { parseEnvelope, serializeEnvelope } from '@sentry/utils';

// 'Store', 'promisifyRequest' and 'createStore' were originally copied from the 'idb-keyval' package before being
// modified and simplified: https://github.com/jakearchibald/idb-keyval
//
// At commit: 0420a704fd6cbb4225429c536b1f61112d012fca
// Original licence:

// Copyright 2016, Jake Archibald
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

type Store = <T>(callback: (store: IDBObjectStore) => T | PromiseLike<T>) => Promise<T>;

function promisifyRequest<T = undefined>(request: IDBRequest<T> | IDBTransaction): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // @ts-ignore - file size hacks
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    // @ts-ignore - file size hacks
    request.onabort = request.onerror = () => reject(request.error);
  });
}

/** Create or open an IndexedDb store */
export function createStore(dbName: string, storeName: string): Store {
  const request = indexedDB.open(dbName);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const dbp = promisifyRequest(request);

  return callback => dbp.then(db => callback(db.transaction(storeName, 'readwrite').objectStore(storeName)));
}

function keys(store: IDBObjectStore): Promise<number[]> {
  return promisifyRequest(store.getAllKeys() as IDBRequest<number[]>);
}

/** Insert into the store */
export function insert(store: Store, value: Uint8Array | string, maxQueueSize: number): Promise<void> {
  return store(store => {
    return keys(store).then(keys => {
      if (keys.length >= maxQueueSize) {
        return;
      }

      // We insert with an incremented key so that the entries are popped in order
      store.put(value, Math.max(...keys, 0) + 1);
      return promisifyRequest(store.transaction);
    });
  });
}

/** Pop the oldest value from the store */
export function pop(store: Store): Promise<Uint8Array | string | undefined> {
  return store(store => {
    return keys(store).then(keys => {
      if (keys.length === 0) {
        return undefined;
      }

      return promisifyRequest(store.get(keys[0])).then(value => {
        store.delete(keys[0]);
        return promisifyRequest(store.transaction).then(() => value);
      });
    });
  });
}

export interface BrowserOfflineTransportOptions extends OfflineTransportOptions {
  /**
   * Name of indexedDb database to store envelopes in
   * Default: 'sentry-offline'
   */
  dbName?: string;
  /**
   * Name of indexedDb object store to store envelopes in
   * Default: 'queue'
   */
  storeName?: string;
  /**
   * Maximum number of envelopes to store
   * Default: 30
   */
  maxQueueSize?: number;
  /**
   * Only required for testing on node.js
   * @ignore
   */
  textDecoder?: TextDecoderInternal;
}

function createIndexedDbStore(options: BrowserOfflineTransportOptions): OfflineStore {
  let store: Store | undefined;

  // Lazily create the store only when it's needed
  function getStore(): Store {
    if (store == undefined) {
      store = createStore(options.dbName || 'sentry-offline', options.storeName || 'queue');
    }

    return store;
  }

  return {
    insert: async (env: Envelope) => {
      try {
        const serialized = await serializeEnvelope(env, options.textEncoder);
        await insert(getStore(), serialized, options.maxQueueSize || 30);
      } catch (_) {
        //
      }
    },
    pop: async () => {
      try {
        const deserialized = await pop(getStore());
        if (deserialized) {
          return parseEnvelope(
            deserialized,
            options.textEncoder || new TextEncoder(),
            options.textDecoder || new TextDecoder(),
          );
        }
      } catch (_) {
        //
      }

      return undefined;
    },
  };
}

function makeIndexedDbOfflineTransport<T>(
  createTransport: (options: T) => Transport,
): (options: T & BrowserOfflineTransportOptions) => Transport {
  return options => createTransport({ ...options, createStore: createIndexedDbStore });
}

/**
 * Creates a transport that uses IndexedDb to store events when offline.
 */
export function makeBrowserOfflineTransport<T extends InternalBaseTransportOptions>(
  createTransport: (options: T) => Transport,
): (options: T & BrowserOfflineTransportOptions) => Transport {
  return makeIndexedDbOfflineTransport<T>(makeOfflineTransport(createTransport));
}
