export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "TASK_NOT_FOUND"
  | "TASK_ALREADY_EXECUTED"
  | "PROVIDER_MODE_UNSUPPORTED"
  | "PROVIDER_EXECUTION_FAILED"
  | "CHANNEL_NOT_FOUND"
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_ERROR";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export type ApiErrorEnvelope = {
  error: {
    code: ApplicationErrorCode | "INTERNAL_ERROR";
    message: string;
    details?: unknown;
  };
};
