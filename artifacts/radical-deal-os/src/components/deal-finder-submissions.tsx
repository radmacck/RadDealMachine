import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDealFinderSubmissionsQueryKey, getListBuyersQueryKey,
  useListDealFinderSubmissions, useListBuyers, useCreateDealFinderSubmission,
  useRecordDealFinderSubmissionAction,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNotice } from "@/components/state-views";
import { useAccess } from "@/hooks/use-access";

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `finder-${Date.now()}-${Math.random()}`;

export function DealFinderSubmissions() {
  const { isOwner, canResearch } = useAccess();
  const qc = useQueryClient();
  const submissions = useListDealFinderSubmissions({ query: { queryKey: getListDealFinderSubmissionsQueryKey(), refetchInterval: 15000 } });
  const finders = useListBuyers({ query: { queryKey: getListBuyersQueryKey(), enabled: isOwner } });
  const create = useCreateDealFinderSubmission();
  const act = useRecordDealFinderSubmissionAction();
  const [finderId, setFinderId] = useState("");
  const [propertyAddress, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostal] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(newKey);
  const [note, setNote] = useState("");
  const [actionEvidence, setActionEvidence] = useState("");
  const [wholesaler, setWholesaler] = useState("");
  const [exactFeeTerms, setExactFeeTerms] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const destinations = (finders.data ?? []).filter((b) => ["DEAL_FINDER", "GURU"].includes(b.destinationKind ?? ""));
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: getListDealFinderSubmissionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListBuyersQueryKey() }),
  ]);
  const submit = () => {
    setError("");
    create.mutate({ data: { idempotencyKey: key, finderId, propertyAddress, city, state: state.toUpperCase(), postalCode,
      opportunity, evidenceUrl, evidenceReference, authorizedToShare: true } }, {
      onSuccess: () => { setKey(newKey()); setAddress(""); setOpportunity(""); setEvidenceUrl(""); setEvidenceReference(""); setShare(false); void refresh(); },
      onError: (e) => setError(e.message),
    });
  };
  const record = (id: string, version: number, action: "ACCEPT"|"DECLINE"|"HANDOFF"|"AGREE_FEE"|"MARK_RECEIVED"|"DISPUTE_FEE"|"WAIVE_FEE") => {
    setError("");
    act.mutate({ id, data: { version, action, note, evidenceUrl: actionEvidence,
      ...(action === "HANDOFF" ? { wholesaler } : {}),
      ...(action === "AGREE_FEE" ? { exactFeeTerms, feeAmount: Number(feeAmount), currency } : {}),
    } }, { onSuccess: () => { setNote(""); void refresh(); }, onError: (e) => setError(e.message) });
  };
  if (!canResearch && !isOwner) return null;
  return <section className="card space-y-4" data-testid="deal-finder-submissions">
    <div><p className="eyebrow">Deal finder handoff</p><h2 className="text-xl font-semibold">Sourcer opportunity submissions</h2>
      <p className="text-sm text-muted-foreground">Private, evidence-linked intake. Sharing authority is not seller contact consent; submissions do not qualify a seller or clear CALL_READY. Fee terms are not proof of payment or a legal determination.</p></div>
    {isOwner && <div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1 text-xs">Authorized finder<select className="h-9 rounded border bg-background px-2 text-sm" value={finderId} onChange={e=>setFinderId(e.target.value)}><option value="">Select finder</option>{destinations.map(d=><option key={d.id} value={d.id}>{d.name} · {d.destinationKind}</option>)}</select></label>
      <label className="grid gap-1 text-xs">Property address<Input value={propertyAddress} onChange={e=>setAddress(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">City<Input value={city} onChange={e=>setCity(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">State / postal code<div className="flex gap-2"><Input maxLength={2} value={state} onChange={e=>setState(e.target.value)} /><Input value={postalCode} onChange={e=>setPostal(e.target.value)} /></div></label>
      <label className="grid gap-1 text-xs md:col-span-2">Opportunity details (no seller contact details)<Textarea value={opportunity} onChange={e=>setOpportunity(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Evidence URL (HTTPS)<Input value={evidenceUrl} onChange={e=>setEvidenceUrl(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Exact evidence reference<Input value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-xs md:col-span-2"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)} /> I am authorized to share this opportunity and supporting information.</label>
      <Button disabled={create.isPending || !finderId || !share} onClick={submit}>Record opportunity submission</Button>
    </div>}
    {error && <ErrorNotice error={error} />}
    {submissions.isLoading ? <p className="text-sm">Loading submissions…</p> : submissions.error ? <ErrorNotice error={submissions.error} /> :
      (submissions.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No finder submissions recorded.</p> :
      <ol className="space-y-3">{submissions.data!.map(s=><li key={s.id} className="rounded border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><b>{s.propertyAddress}, {s.city}, {s.state} {s.postalCode}</b><span>{s.status} · fee {s.feeStatus}</span></div>
        <p className="text-xs text-muted-foreground">Attributed to {s.finderName} · submitted {new Date(s.submittedAt).toLocaleString()} by {s.submittedBy}</p>
        <p className="my-2 whitespace-pre-wrap">{s.opportunity}</p>
        <p className="text-xs"><a className="underline" href={s.evidenceUrl} target="_blank" rel="noreferrer">Evidence</a> · {s.evidenceReference}</p>
        {s.wholesaler && <p>Handoff: {s.wholesaler}</p>}
        {s.exactFeeTerms && <p>Exact fee terms: {s.exactFeeTerms} · {s.feeAmount} {s.currency} · {s.feeStatus}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Seller identity, signing authority and channel permission require the separate seller-evidence review.</p>
        {isOwner && <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Input placeholder="Evidence URL for this review/action" value={actionEvidence} onChange={e=>setActionEvidence(e.target.value)} />
          <Input placeholder="Review note" value={note} onChange={e=>setNote(e.target.value)} />
          {s.status === "SUBMITTED" && <div className="flex gap-2"><Button size="sm" onClick={()=>record(s.id,s.version,"ACCEPT")}>Accept</Button><Button size="sm" variant="outline" onClick={()=>record(s.id,s.version,"DECLINE")}>Decline</Button></div>}
          {s.status === "ACCEPTED" && <div className="flex gap-2"><Input placeholder="Receiving wholesaler" value={wholesaler} onChange={e=>setWholesaler(e.target.value)} /><Button size="sm" onClick={()=>record(s.id,s.version,"HANDOFF")}>Hand off</Button></div>}
          {["ACCEPTED","HANDED_OFF"].includes(s.status) && s.feeStatus === "NOT_AGREED" && <div className="grid grid-cols-3 gap-2"><Input placeholder="Exact fee terms" value={exactFeeTerms} onChange={e=>setExactFeeTerms(e.target.value)} /><Input placeholder="Amount" type="number" value={feeAmount} onChange={e=>setFeeAmount(e.target.value)} /><Input maxLength={3} value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())} /><Button size="sm" onClick={()=>record(s.id,s.version,"AGREE_FEE")}>Record agreed terms</Button></div>}
          {s.feeStatus === "PENDING" && <Button size="sm" onClick={()=>record(s.id,s.version,"MARK_RECEIVED")}>Record fee received</Button>}
          {["PENDING","RECEIVED"].includes(s.feeStatus) && <Button size="sm" variant="outline" onClick={()=>record(s.id,s.version,"DISPUTE_FEE")}>Dispute fee</Button>}
          {["PENDING","DISPUTED"].includes(s.feeStatus) && <Button size="sm" variant="outline" onClick={()=>record(s.id,s.version,"WAIVE_FEE")}>Waive fee</Button>}
        </div>}
        <details className="mt-2 text-xs"><summary>Audit history ({s.history.length})</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(s.history,null,2)}</pre></details>
      </li>)}</ol>}
  </section>;
}
