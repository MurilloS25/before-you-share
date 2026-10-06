import type { StructuredError } from '../core/errors';
import { LIMITS } from '../core/limits';
import type { JobStage, ResultPayload, WorkerRequest, WorkerResponse } from './protocol';

/** Minimal Worker surface so tests can substitute a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
}

export type JobOutcome = { ok: true; payload: ResultPayload } | { ok: false; error: StructuredError };

export interface JobHandlers {
  onProgress?: (stage: JobStage, fraction: number | null) => void;
}

export interface JobHandle {
  promise: Promise<JobOutcome>;
  cancel(): void;
}

export interface ClientOptions {
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Coordinates the single analysis worker. Rules:
 *  - at most one job runs at a time (LIMITS.maxConcurrentJobs); a new analysis supersedes the old one;
 *  - cancelling or timing out terminates the worker, which frees its memory and stops it for certain;
 *  - every result is checked against the worker generation and job id, so a late message from an
 *    earlier run can never be applied to the current one.
 */
export class AnalysisClient {
  private worker: WorkerLike | null = null;
  private generation = 0;
  private nextJobId = 1;
  private active: { jobId: number; generation: number; finish: (o: JobOutcome) => void; timer: unknown; handlers: JobHandlers; kind: WorkerRequest['type'] } | null = null;
  /** True while the worker holds the file of the last successful analysis. */
  private hasSession = false;
  /** Count of messages ignored because they belonged to an older job or worker. Exposed for tests and diagnostics. */
  ignoredStale = 0;

  constructor(
    private readonly factory: () => WorkerLike,
    private readonly opts: ClientOptions = {},
  ) {}

  get busy(): boolean {
    return this.active !== null;
  }
  get sessionOpen(): boolean {
    return this.hasSession && this.worker !== null;
  }

  private spawn(): WorkerLike {
    const generation = ++this.generation;
    const w = this.factory();
    w.onmessage = (e) => this.onMessage(generation, e.data);
    w.onerror = () => this.fail(generation, { code: 'worker-failure', message: 'The analysis worker stopped unexpectedly.' });
    w.onmessageerror = () => this.fail(generation, { code: 'worker-failure', message: 'The analysis worker sent a message this page could not read.' });
    this.worker = w;
    this.hasSession = false;
    return w;
  }

  private killWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.hasSession = false;
    this.generation++; // anything still in flight from the old worker is now stale
  }

  private clearActive(): void {
    if (this.active) {
      (this.opts.clearTimer ?? ((id) => clearTimeout(id as number)))(this.active.timer);
      this.active = null;
    }
  }

  private onMessage(generation: number, msg: WorkerResponse): void {
    if (generation !== this.generation) {
      this.ignoredStale++;
      return;
    }
    if (msg.type === 'ready') return;
    const a = this.active;
    if (!a || msg.jobId !== a.jobId) {
      this.ignoredStale++;
      return;
    }
    if (msg.type === 'progress') {
      a.handlers.onProgress?.(msg.stage, msg.fraction);
      return;
    }
    const finish = a.finish;
    const kind = a.kind;
    this.clearActive();
    if (msg.type === 'result') {
      if (msg.payload.kind === 'analysis' && kind === 'analyse') this.hasSession = msg.payload.supported;
      finish({ ok: true, payload: msg.payload });
    } else {
      finish({ ok: false, error: msg.error });
    }
  }

  private fail(generation: number, error: StructuredError): void {
    if (generation !== this.generation || !this.active) return;
    const finish = this.active.finish;
    this.clearActive();
    this.killWorker();
    finish({ ok: false, error });
  }

  private start(request: (jobId: number) => WorkerRequest, handlers: JobHandlers, transfer: Transferable[] = []): JobHandle {
    // A new job supersedes a running one (concurrency stays at one).
    if (this.active) this.cancelActive();
    const worker = this.worker ?? this.spawn();
    const jobId = this.nextJobId++;
    const req = request(jobId);
    let finishFn: (o: JobOutcome) => void = () => undefined;
    const promise = new Promise<JobOutcome>((resolve) => {
      finishFn = resolve;
    });
    const generation = this.generation;
    const timer = (this.opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.fail(generation, { code: 'timeout', message: `The job took longer than ${Math.round((this.opts.timeoutMs ?? LIMITS.jobTimeoutMs) / 1000)} seconds and was stopped.` });
    }, this.opts.timeoutMs ?? LIMITS.jobTimeoutMs);
    this.active = { jobId, generation, finish: finishFn, timer, handlers, kind: req.type };
    worker.postMessage(req, transfer);
    return { promise, cancel: () => this.cancelJob(jobId) };
  }

  private cancelJob(jobId: number): void {
    if (this.active?.jobId === jobId) this.cancelActive();
  }

  private cancelActive(): void {
    const a = this.active;
    if (!a) return;
    this.clearActive();
    this.killWorker();
    a.finish({ ok: false, error: { code: 'cancelled', message: 'The job was cancelled.' } });
  }

  /** Start analysing a file. Supersedes any running job and discards the previous file from memory. */
  analyse(file: File, handlers: JobHandlers = {}): JobHandle {
    // A new file always gets a fresh worker so nothing from the previous file can remain in memory.
    if (this.active) this.cancelActive();
    this.killWorker();
    return this.start((jobId) => ({ type: 'analyse', jobId, file }), handlers);
  }

  transform(groups: string[], handlers: JobHandlers = {}): JobHandle {
    return this.start((jobId) => ({ type: 'transform', jobId, groups }), handlers);
  }

  previewPdf(handlers: JobHandlers = {}): JobHandle {
    return this.start((jobId) => ({ type: 'preview-pdf', jobId }), handlers);
  }

  cancel(): void {
    this.cancelActive();
  }

  /** Reset: stops any job and terminates the worker so every byte it held is released. */
  dispose(): void {
    this.cancelActive();
    this.killWorker();
  }
}

export function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module', name: 'analysis' }) as unknown as WorkerLike;
}
