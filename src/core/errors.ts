export type ErrorCode =
  | 'file-too-large'
  | 'file-empty'
  | 'unsupported-format'
  | 'limit-exceeded'
  | 'malformed'
  | 'cancelled'
  | 'timeout'
  | 'worker-failure'
  | 'read-failed'
  | 'refused';

/** Structured, serialisable error. Messages never contain file-derived text. */
export interface StructuredError {
  code: ErrorCode;
  message: string;
}

export class ParseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseLimitError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

export function toStructuredError(e: unknown): StructuredError {
  if (e instanceof CancelledError) return { code: 'cancelled', message: 'The job was cancelled.' };
  if (e instanceof ParseLimitError) return { code: 'limit-exceeded', message: e.message };
  if (e instanceof RefusedError) return { code: 'refused', message: e.message };
  // Do not forward arbitrary error text: it may embed file-derived strings.
  return { code: 'worker-failure', message: 'The job stopped because of an unexpected error.' };
}
