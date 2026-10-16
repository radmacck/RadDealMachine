export const WORKER_MAX_ATTEMPTS = 3;
export const WORKER_LEASE_TIMEOUT_MS = 3 * 60_000;

export function workerRetryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export function workerFailureDisposition(attempts: number, now: Date, retryable = true) {
  const deadLetter = !retryable || attempts >= WORKER_MAX_ATTEMPTS;
  const retryAt = deadLetter ? null : new Date(now.getTime() + workerRetryDelayMs(attempts));
  return {
    state: deadLetter ? "FAILED" as const : "QUEUED" as const,
    retryAt,
    nextAction: deadLetter ? "OPERATOR_REVIEW_AND_QUEUE_NEW_IDEMPOTENCY_KEY" : "WAIT_FOR_SCHEDULED_RETRY",
    message: deadLetter
      ? `Dead-lettered after ${attempts} failed attempts; operator review and a fresh idempotency key are required.`
      : `Attempt ${attempts} failed; retry safely scheduled for ${retryAt!.toISOString()}.`,
  };
}

export function workerFailureIsRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error) || typeof error.status !== "number")
    return true;
  const status = error.status;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function workerRecoveryMessage(disposition: ReturnType<typeof workerFailureDisposition>, requester: string): string {
  const owner = requester.startsWith("system:")
    ? "Human owner: UNASSIGNED; this failure is routed to the operator queue."
    : `Accountable requestor: ${requester}.`;
  return `${disposition.message} ${owner} Next action: ${disposition.nextAction}.`;
}

export function workerLeaseExpired(state: string, updatedAt: Date, now: Date): boolean {
  return state === "RUNNING" && now.getTime() - updatedAt.getTime() >= WORKER_LEASE_TIMEOUT_MS;
}
