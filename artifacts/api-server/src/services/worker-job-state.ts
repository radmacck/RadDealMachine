import type { WorkerJob } from "@workspace/api-zod";

export function completedWorkerJobState(kind: WorkerJob["kind"], message: string): WorkerJob["state"] {
  if (kind === "DISCOVER_PROPERTIES" && message.includes("Source-specific partial failures")) return "PARTIAL";
  return "SUCCEEDED";
}
