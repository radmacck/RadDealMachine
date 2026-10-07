import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBuyerQualificationPortal,
  useRespondToBuyerQualificationPortal,
  type Buyer,
  type BuyerInput,
  type BuyerQualificationPortalResponseInput,
} from "@workspace/api-client-react";
import { BuyerForm } from "@/components/buyer-form";
import { Field } from "@/components/field-row";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/state-views";
import { Button } from "@/components/ui/button";

const sessionTokenKey = "radical-deal-os:buyer-qualification-portal";

function takeCapabilityFromFragment() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fragmentToken = params.get("t");
  if (fragmentToken) {
    try { sessionStorage.setItem(sessionTokenKey, fragmentToken); } catch { /* Memory-only fallback below. */ }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return fragmentToken;
  }
  try { return sessionStorage.getItem(sessionTokenKey) ?? ""; } catch { return ""; }
}

export default function BuyerQualificationPortalPage() {
  const [token, setToken] = useState(takeCapabilityFromFragment);
  const [cacheId] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const [buyingStatus, setBuyingStatus] = useState<"BUYING" | "NOT_BUYING">("BUYING");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const portal = useGetBuyerQualificationPortal({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: ["buyer-qualification-portal", cacheId],
      refetchOnWindowFocus: false,
    },
    request: { headers: { "X-Qualification-Portal-Token": token } },
  });
  const respond = useRespondToBuyerQualificationPortal({
    request: { headers: { "X-Qualification-Portal-Token": token } },
  });

  const submitProfile = (input: BuyerInput) => {
    if (!input.criteria) return;
    const body: BuyerQualificationPortalResponseInput = {
      responseId: crypto.randomUUID(),
      currentBuyingStatus: buyingStatus,
      criteria: input.criteria,
      confirmedCurrent: true,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    respond.mutate({ data: body }, {
      onSuccess: () => {
        try { sessionStorage.removeItem(sessionTokenKey); } catch { /* No persistent token to clear. */ }
        queryClient.removeQueries({ queryKey: ["buyer-qualification-portal", cacheId], exact: true });
        setToken("");
        setSubmitted(true);
      },
    });
  };

  if (!token) {
    return <PortalFrame>
      <h1 className="text-3xl font-semibold">Buyer profile update</h1>
      <p className="mt-3 text-sm text-muted-foreground">Open the private link the Radical operator shared with you. No message or approval is created by opening this page.</p>
    </PortalFrame>;
  }
  if (submitted) {
    return <PortalFrame>
      <p className="eyebrow mb-2">Response received</p>
      <h1 className="text-3xl font-semibold">Your profile is waiting for review.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Your criteria and current-buying answer were saved as self-reported evidence. The operator must verify identity, current activity, funding and criteria before you become eligible for deal matching.</p>
    </PortalFrame>;
  }
  if (portal.isLoading) {
    return <PortalFrame><p className="text-sm text-muted-foreground">Checking this private link…</p></PortalFrame>;
  }
  if (portal.isError || !portal.data) {
    return <PortalFrame>
      <h1 className="text-3xl font-semibold">This profile link cannot be used.</h1>
      <div className="mt-3"><ErrorNotice error={portal.error} /></div>
      <p className="mt-3 text-sm text-muted-foreground">The link may be expired, replaced, or stale after the buyer record changed. Ask the Radical operator for a fresh link.</p>
    </PortalFrame>;
  }

  const buyer = {
    name: portal.data.buyerName,
    criteria: portal.data.criteria,
    source: "Private buyer profile response",
    status: "ACTIVE",
  } as Partial<Buyer>;
  return <PortalFrame>
    <p className="eyebrow mb-2">Private buyer profile · expires {new Date(portal.data.expiresAt).toLocaleDateString()}</p>
    <h1 className="text-3xl font-semibold">Confirm what you are buying now.</h1>
    <p className="mt-3 text-sm text-muted-foreground">For {portal.data.buyerName}. This one-time link does not verify your identity. Your response is recorded as INDICATED and is not approval or a commitment to any deal.</p>
    <div className="mt-6 space-y-4 border-y border-border py-4">
      <Field label="Are you currently buying?">
        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={buyingStatus}
          onChange={(e) => setBuyingStatus(e.target.value as typeof buyingStatus)} data-testid="select-self-reported-buying">
          <option value="BUYING">Yes — I am currently buying</option>
          <option value="NOT_BUYING">No — I am not currently buying</option>
        </select>
      </Field>
      <Field label="Anything the operator should know about this update?">
        <Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} data-testid="input-buyer-self-report-note" />
      </Field>
      <BuyerForm buyer={buyer} criteriaOnly pending={respond.isPending} error={respond.error}
        submitLabel="Submit profile for owner review" onSubmit={submitProfile} />
      <p className="text-xs text-muted-foreground">Submitting updates the unverified profile and pauses existing matching approval until an owner reviews current evidence. No message is sent by this page.</p>
    </div>
  </PortalFrame>;
}

function PortalFrame({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow mb-3">Radical Deal OS · secure profile handoff</p>
      <div className="ledger p-5 md:p-8">{children}</div>
    </div>
  </main>;
}
