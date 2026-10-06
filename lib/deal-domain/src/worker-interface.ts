/** Provider-independent orchestration boundary. Naelo is not a runtime dependency. */
export interface AuthorizedWorkerCommand {
  id: string;
  capability: "DISCOVER_SELLERS"|"DISCOVER_BUYERS"|"QUALIFY_BUYER"|"REVERIFY_BUYER"|"FOLLOW_UP_SELLER"|"MONITOR_DEAL";
  subjectId: string|null;
  actorId: string;
  evidenceReferences: string[];
  approvedCommunicationReference: string|null;
}
export interface WorkerExecutionResult {
  commandId: string;
  state: "PENDING_EXECUTION"|"WAITING_EXTERNAL"|"SUCCEEDED"|"FAILED";
  reason: string;
  evidenceReferences: string[];
  nextAction: string;
}
export interface WorkerExecutionPort {
  id: string;
  availableCapabilities(): Promise<AuthorizedWorkerCommand["capability"][]>;
  execute(command: AuthorizedWorkerCommand): Promise<WorkerExecutionResult>;
}
export const WORKER_CAPABILITIES = [
  {id:"native-human-handoff",capability:"FOLLOW_UP_SELLER",state:"AVAILABLE",reason:"Recurring native execution persists informational seller/buyer handoffs, actual human contact/reply events and stale-context retirement. It does not send messages or grant commercial authority.",nextAction:"Review pending handoffs, document permitted human contact and record actual replies; use existing owner approval/verification workflows."},
  {id:"phila-opa-properties",capability:"DISCOVER_SELLERS",state:"AVAILABLE",reason:"Bounded official Philadelphia property records can be collected as raw property observations and passed through market-specific relevance criteria. Property records do not establish seller motivation or create active leads.",nextAction:"Review source terms and enable the six-hour discovery schedule; work only the candidates that meet configured evidence thresholds."},
  {id:"phila-opa",capability:"DISCOVER_BUYERS",state:"AVAILABLE",reason:"Bounded official corporate-owner feed; observed prospects only, Philadelphia coverage.",nextAction:"Review terms and enable buyer discovery. Qualify current buying separately."},
  {id:"buyer-pool",capability:"REVERIFY_BUYER",state:"AVAILABLE",reason:"Recurring evidence-expiry review creates durable outreach/evidence tasks and blocks stale matching.",nextAction:"Review prepared outreach and provide actual current evidence."},
  {id:"public-investor-websites-posts",capability:"DISCOVER_BUYERS",state:"PENDING_CONNECTION",reason:"No permitted website/post connector configured; no scraping or access claimed.",nextAction:"Connect a permitted feed through the discovery execution port; individual sourced prospects can be recorded now."},
  {id:"google-form-responses",capability:"DISCOVER_BUYERS",state:"PENDING_CONNECTION",reason:"Historical form is reference; no response spreadsheet is connected.",nextAction:"Connect an authorized response feed; map into prospect/criteria adapters without bypassing verification."},
  {id:"communication-provider",capability:"QUALIFY_BUYER",state:"PENDING_CONNECTION",reason:"No authorized messaging provider/session connected. Prepared tasks remain WAITING_EXTERNAL, not sent.",nextAction:"Use permitted human outreach and record evidence, or connect an authorized communication executor."},
  {id:"naelo",capability:"ORCHESTRATE",state:"PENDING_CONNECTION",reason:"Provider-independent command/result port has a running native human-handoff implementation; Naelo runtime is not connected or required.",nextAction:"Future Naelo can implement OrchestrationPort and delegate WorkerExecutionPort without replacing financial, provenance or approval gates."},
] as const;