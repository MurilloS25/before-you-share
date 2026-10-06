import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisClient, type WorkerLike } from '../src/worker/client';
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol';
import { fixture } from './helpers';
import { analyseFixture } from './helpers';

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  posts: WorkerRequest[] = [];
  terminated = false;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: WorkerRequest): void {
    this.posts.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Deliver a message as the browser would, through the handler captured at call time. */
  emit(handler: WorkerLike['onmessage'], msg: WorkerResponse): void {
    handler?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
}

const file = () => new File([fixture('jpeg-clean.jpg') as BlobPart], 'a.jpg', { type: 'image/jpeg' });
let timers: Array<{ fn: () => void; ms: number; id: number; cleared: boolean }> = [];
const opts = {
  timeoutMs: 1000,
  setTimer: (fn: () => void, ms: number) => {
    const t = { fn, ms, id: timers.length, cleared: false };
    timers.push(t);
    return t.id;
  },
  clearTimer: (id: unknown) => {
    const t = timers[id as number];
    if (t) t.cleared = true;
  },
};

beforeEach(() => {
  FakeWorker.all = [];
  timers = [];
});

describe('AnalysisClient', () => {
  it('delivers a result for the current job and reports progress', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const onProgress = vi.fn();
    const job = c.analyse(file(), { onProgress });
    const w = FakeWorker.all[0]!;
    const handler = w.onmessage;
    const id = w.posts[0]!.jobId;
    w.emit(handler, { type: 'progress', jobId: id, stage: 'reading', fraction: 0.5 });
    const report = await analyseFixture('jpeg-clean.jpg');
    w.emit(handler, { type: 'result', jobId: id, payload: { kind: 'analysis', supported: true, report } });
    const out = await job.promise;
    expect(out.ok).toBe(true);
    expect(onProgress).toHaveBeenCalledWith('reading', 0.5);
    expect(c.busy).toBe(false);
    expect(c.sessionOpen).toBe(true);
    expect(timers[0]!.cleared).toBe(true);
  });

  it('cancelling terminates the worker, resolves as cancelled and drops the session', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    job.cancel();
    const out = await job.promise;
    expect(out).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(c.busy).toBe(false);
    expect(c.sessionOpen).toBe(false);
  });

  it('ignores a late result from a cancelled worker and applies only the new job', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const first = c.analyse(file());
    const w1 = FakeWorker.all[0]!;
    const staleHandler = w1.onmessage;
    const staleId = w1.posts[0]!.jobId;
    first.cancel();
    await first.promise;

    const second = c.analyse(file());
    const w2 = FakeWorker.all[1]!;
    expect(w2).not.toBe(w1);
    const report = await analyseFixture('jpeg-clean.jpg');
    // The browser delivers the old worker's result after the new job has started.
    w1.emit(staleHandler, { type: 'result', jobId: staleId, payload: { kind: 'analysis', supported: true, report } });
    expect(c.ignoredStale).toBe(1);
    expect(c.busy).toBe(true);

    w2.emit(w2.onmessage, { type: 'result', jobId: w2.posts[0]!.jobId, payload: { kind: 'analysis', supported: true, report } });
    expect((await second.promise).ok).toBe(true);
  });

  it('ignores a result whose job id is not the active one even from the live worker', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    const w = FakeWorker.all[0]!;
    const report = await analyseFixture('jpeg-clean.jpg');
    w.emit(w.onmessage, { type: 'result', jobId: 9999, payload: { kind: 'analysis', supported: true, report } });
    expect(c.ignoredStale).toBe(1);
    expect(c.busy).toBe(true);
    job.cancel();
  });

  it('a new file supersedes a running analysis: concurrency never exceeds one', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const a = c.analyse(file());
    const b = c.analyse(file());
    expect(await a.promise).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(FakeWorker.all.filter((w) => !w.terminated)).toHaveLength(1);
    b.cancel();
  });

  it('times out, terminates the worker and reports a structured error', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    timers[0]!.fn();
    expect(await job.promise).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(c.busy).toBe(false);
  });

  it('turns a worker crash into a structured error', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    FakeWorker.all[0]!.onerror?.({} as ErrorEvent);
    expect(await job.promise).toMatchObject({ ok: false, error: { code: 'worker-failure' } });
    expect(c.sessionOpen).toBe(false);
  });

  it('keeps the session for a follow-up transform on the same worker', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    const w = FakeWorker.all[0]!;
    const report = await analyseFixture('jpeg-gps.jpg');
    w.emit(w.onmessage, { type: 'result', jobId: w.posts[0]!.jobId, payload: { kind: 'analysis', supported: true, report } });
    await job.promise;
    const t = c.transform(['exif']);
    expect(FakeWorker.all).toHaveLength(1);
    expect(w.posts[1]).toMatchObject({ type: 'transform', groups: ['exif'] });
    t.cancel();
    expect(c.sessionOpen).toBe(false); // cancelling a copy also ends the session so no partial state survives
  });

  it('dispose terminates the worker and releases the session', () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    c.analyse(file());
    c.dispose();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(c.busy).toBe(false);
  });

  it('does not keep unsupported results as a session', async () => {
    const c = new AnalysisClient(() => new FakeWorker(), opts);
    const job = c.analyse(file());
    const w = FakeWorker.all[0]!;
    w.emit(w.onmessage, {
      type: 'result',
      jobId: w.posts[0]!.jobId,
      payload: { kind: 'analysis', supported: false, fingerprint: {} as never, detection: {} as never },
    });
    await job.promise;
    expect(c.sessionOpen).toBe(false);
  });
});
