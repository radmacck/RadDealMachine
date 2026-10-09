import {
  getGetOutcomeLearningQueryKey,
  useGetOutcomeLearning,
  useReviewOutcomeCalibration,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleHelp, FlaskConical, LineChart, ShieldCheck } from "lucide-react";

function delta(value: number | null) {
  if (value == null) return "—";
  const amount = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}$${amount}`;
}

export function OutcomeLearningPanel() {
  const client = useQueryClient();
  const q = useGetOutcomeLearning({
    query: { queryKey: getGetOutcomeLearningQueryKey(), refetchInterval: 60_000 },
  });
  const review = useReviewOutcomeCalibration({
    mutation: {
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: getGetOutcomeLearningQueryKey() });
      },
    },
  });
  const report = q.data;

  return (
    <section className="fd-panel" data-testid="panel-outcome-learning" aria-labelledby="outcome-learning-title">
      <div className="fd-section-head">
        <div className="fd-section-title">
          <LineChart size={15} />
          <span id="outcome-learning-title">Outcome learning</span>
          <small>{report ? report.calibrationStatus.replaceAll("_", " ").toLowerCase() : "loading evidence"}</small>
        </div>
      </div>
      {q.isError && (
        <div className="fd-empty" role="alert">
          Outcome evidence could not be refreshed; do not infer calibration from stale or missing data.
        </div>
      )}
      {q.isLoading && !report && <div className="fd-empty" role="status">Loading persisted outcome evidence…</div>}
      {report && (
        <>
          <div className="fd-metrics" aria-label="Outcome sample counts">
            <div className="fd-metric">
              <span><div className="fd-metric-value">{report.realOutcomeCount}</div><div className="fd-metric-label">Recorded real outcome events</div></span>
            </div>
            <div className="fd-metric">
              <span><div className="fd-metric-value">{report.syntheticOutcomeCount}</div><div className="fd-metric-label">Synthetic exercise events · excluded</div></span>
            </div>
            <div className="fd-metric">
              <span><div className="fd-metric-value">{report.sampleSizes.arv} / {report.sampleSizes.repairs}</div><div className="fd-metric-label">Eligible ARV / repair samples</div></span>
            </div>
          </div>
          <div className="fd-start-facts">
            <div>
              <span className="fd-start-label">Prediction deltas · actual minus predicted</span>
              <p>ARV {delta(report.deltas.arv.mean)} ({report.deltas.arv.sampleSize} samples) · repairs {delta(report.deltas.repairs.mean)} ({report.deltas.repairs.sampleSize} samples)</p>
            </div>
            <div className="fd-start-missing">
              <span className="fd-start-label">Calibration boundary</span>
              <p>Rule {report.ruleVersion}; live underwriting and offer economics remain unchanged. Synthetic records never count as live performance evidence.</p>
            </div>
          </div>
          {report.missingData.length > 0 && (
            <details className="fd-work-guidance-detail">
              <summary><CircleHelp size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />What evidence is missing</summary>
              <ul className="list-disc pl-5">{report.missingData.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          )}
          {report.recommendations.length > 0 && (
            <div className="fd-list" aria-label="Calibration recommendations">
              {report.recommendations.slice(0, 3).map((item) => (
                <article className="fd-row" key={item.id} data-testid={`calibration-${item.id}`}>
                  <div className="fd-row-top">
                    <div className="fd-row-name">{item.metricKey} · {item.status.replaceAll("_", " ").toLowerCase()}</div>
                    <span className="fd-pill fd-pill-dark">{item.sampleSize}/{item.minimumSampleSize}</span>
                  </div>
                  <div className="fd-row-copy">{item.summary}</div>
                  <div className="fd-row-meta">{item.currentRuleVersion} → proposed {item.proposedRuleVersion}; no automatic deployment.</div>
                  {item.status === "PENDING_REVIEW" && report.canReview && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="fd-button"
                        type="button"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ id: item.id, data: {
                          decision: "APPROVE_FOR_SEPARATE_CHANGE_REVIEW",
                          note: "Reviewed for a separate, versioned change; this action does not deploy the rule.",
                        } })}
                      >
                        <ShieldCheck size={13} />Approve for separate review
                      </button>
                      <button
                        className="fd-button"
                        type="button"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ id: item.id, data: {
                          decision: "REJECT",
                          note: "Rejected during owner review; existing rule remains active.",
                        } })}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {item.status === "PENDING_REVIEW" && !report.canReview && (
                    <div className="fd-row-meta">Owner review is required; no rule is active from this recommendation.</div>
                  )}
                </article>
              ))}
            </div>
          )}
          {review.isError && <div className="fd-empty" role="alert">The calibration review was not recorded. Verify owner authorization and retry from the recommendation.</div>}
          {report.recentOutcomes.length > 0 && (
            <details className="fd-work-guidance-detail">
              <summary><FlaskConical size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Recent persisted outcomes ({report.recentOutcomes.length})</summary>
              <div className="fd-list">
                {report.recentOutcomes.slice(0, 5).map((item) => (
                  <div className="fd-worker-row" key={item.id}>
                    <span className={`fd-pill ${item.synthetic ? "fd-pill-coral" : ""}`}>{item.synthetic ? "Synthetic" : item.verificationState.replaceAll("_", " ")}</span>
                    <span className="fd-worker-label">
                      <b>{item.eventType.replaceAll("_", " ")}</b>
                      <span className="fd-row-meta"> · {item.source} · {item.occurredAt ? new Date(item.occurredAt).toLocaleString() : "event time not recorded"} · recorded {new Date(item.recordedAt).toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
