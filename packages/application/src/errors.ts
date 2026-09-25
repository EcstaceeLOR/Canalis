export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "TASK_NOT_FOUND"
  | "TASK_ALREADY_EXECUTED"
  | "TASK_NOT_ACTIVE"
  | "INVALID_TASK_TRANSITION"
  | "PROVIDER_MODE_UNSUPPORTED"
  | "PROVIDER_EXECUTION_FAILED"
  | "CHANNEL_NOT_FOUND"
  | "CHANNEL_NOT_READY"
  | "LIVE_SANDBOX_BUDGET_EXCEEDED"
  | "LIVE_CHANNELS_NOT_OPEN"
  | "LIVE_CHANNEL_MODE_REQUIRED"
  | "LIVE_CHANNEL_NOT_PREPARED"
  | "LIVE_CHANNEL_OPEN_EVIDENCE_MISSING"
  | "LIVE_TASK_NOT_EXECUTED"
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_CHALLENGE_NOT_FOUND"
  | "AUTH_CHALLENGE_EXPIRED"
  | "AUTH_CHALLENGE_USED"
  | "AUTH_WALLET_MISMATCH"
  | "AUTH_SIGNATURE_INVALID"
  | "FORBIDDEN";

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
