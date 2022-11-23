/// <reference types="node" />
/// <reference types="redis" />

import {EventEmitter} from 'events';
import {ClientOpts, RedisClient} from 'redis';

declare class BeeQueue<T = any> extends EventEmitter {
  name: string;
  keyPrefix: string;
  jobs: any;
  paused: boolean;
  settings: any;
  backoffStrategies: Map<string, (job: BeeQueue.Job<T>) => number>;

  constructor(name: string, settings?: BeeQueue.QueueSettings);

  on(ev: 'ready', fn: () => void): this;
  on(ev: 'error', fn: (err: Error) => void): this;
  on(ev: 'succeeded', fn: (job: BeeQueue.Job<T>, result: any) => void): this;
  on(ev: 'retrying', fn: (job: BeeQueue.Job<T>, err: Error) => void): this;
  on(ev: 'failed', fn: (job: BeeQueue.Job<T>, err: Error) => void): this;
  on(ev: 'stalled', fn: (jobId: string) => void): this;

  on(ev: 'job succeeded', fn: (jobId: string, result: any) => void): this;
  on(ev: 'job retrying', fn: (jobId: string, err: Error) => void): this;
  on(ev: 'job failed', fn: (jobId: string, err: Error) => void): this;
  on(ev: 'job progress', fn: (jobId: string, progress: any) => void): this;

  ready(): Promise<this>;
  ready(cb?: (err: Error | null) => void): Promise<this>;

  isRunning(): boolean;

  createJob<U extends T>(data: U): BeeQueue.Job<U>;

  getJob(jobId: string, cb: (job: BeeQueue.Job<T>) => void): void;
  getJob(jobId: string): Promise<BeeQueue.Job<T>>;

  getJobs(
    type: string,
    page: BeeQueue.Page,
    cb: (jobs: BeeQueue.Job<T>[]) => void
  ): void;
  getJobs(type: string, page: BeeQueue.Page): Promise<BeeQueue.Job<T>[]>;

  process<U>(handler: (job: BeeQueue.Job<T>) => Promise<U>): void;
  process<U>(
    handler: (job: BeeQueue.Job<T>, done: BeeQueue.DoneCallback<U>) => void
  ): void;
  process<U>(
    concurrency: number,
    handler: (job: BeeQueue.Job<T>) => Promise<U>
  ): void;
  process<U>(
    concurrency: number,
    handler: (job: BeeQueue.Job<T>, done: BeeQueue.DoneCallback<U>) => void
  ): void;

  checkStalledJobs(interval?: number): Promise<number>;
  checkStalledJobs(
    interval: number,
    cb: (err: Error, numStalled: number) => void
  ): void;
  checkStalledJobs(cb: (err: Error, numStalled: number) => void): void;

  checkHealth(): Promise<BeeQueue.HealthCheckResult>;
  checkHealth(cb: (counts: BeeQueue.HealthCheckResult) => void): void;

  close(cb: () => void): void;
  close(timeout?: number | null): Promise<void>;
  close(timeout: number | undefined | null, cb: () => void): void;

  isRunning(): boolean;

  ready(): Promise<this>;
  ready(cb: () => void): Promise<this>;

  removeJob(jobId: string): Promise<void>;
  removeJob(jobId: string, cb: () => void): void;

  destroy(): Promise<void>;
  destroy(cb: () => void): void;

  saveAll(jobs: BeeQueue.Job<T>[]): Promise<Map<BeeQueue.Job<T>, Error>>;
}

declare namespace BeeQueue {
  interface QueueSettings {
    prefix?: string;
    stallInterval?: number;
    nearTermWindow?: number;
    delayedDebounce?: number;
    redis?: ClientOpts | RedisClient;
    isWorker?: boolean;
    getEvents?: boolean;
    sendEvents?: boolean;
    storeJobs?: boolean;
    ensureScripts?: boolean;
    activateDelayedJobs?: boolean;
    removeOnSuccess?: boolean;
    removeOnFailure?: boolean;
    quitCommandClient?: boolean;
    redisScanCount?: number;
  }

  interface Job<T> extends EventEmitter {
    id: string;
    data: T;
    readonly options: any;
    queue: BeeQueue<T>;
    progress: any;
    status: 'created' | 'succeeded' | 'failed' | 'retrying';

    on(ev: 'succeeded', fn: (result: any) => void): this;
    on(ev: 'retrying', fn: (err: Error) => void): this;
    on(ev: 'failed', fn: (err: Error) => void): this;
    on(ev: 'progress', fn: (progress: any) => void): this;

    setId(id: string): this;
    retries(n: number): this;
    backoff(strategy: string, delayFactor?: number): this;
    delayUntil(dateOrTimestamp: Date | number): this;
    timeout(milliseconds: number): this;
    save(): Promise<this>;
    save(cb: (job: this) => void): void;
    reportProgress(p: any): void;
    remove(): Promise<this>;
    remove(cb: (job: this) => void): void;
  }

  interface Page {
    start?: number;
    end?: number;
    size?: number;
  }

  interface HealthCheckResult {
    waiting: number;
    active: number;
    succeeded: number;
    failed: number;
    delayed: number;
    newestJob?: string;
  }

  type DoneCallback<T> = (error: Error | null, result?: T) => void;
}

export = BeeQueue;
