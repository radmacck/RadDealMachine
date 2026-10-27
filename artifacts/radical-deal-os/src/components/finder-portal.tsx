import { useState } from "react";
import { getListOwnFinderSubmissionsQueryKey, useCreateOwnFinderSubmission, useListOwnFinderSubmissions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNotice } from "@/components/state-views";

const freshKey = () => crypto.randomUUID();

export function FinderPortal() {
  const qc = useQueryClient();
  const key = getListOwnFinderSubmissionsQueryKey();
  const submissions = useListOwnFinderSubmissions({ query: { queryKey: key, refetchInterval: 15000 } });
  const create = useCreateOwnFinderSubmission();
  const [idempotencyKey, setIdempotencyKey] = useState(freshKey);
  const [propertyAddress, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostal] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [authorizedToShare, setAuthorized] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    create.mutate({ data: { idempotencyKey, propertyAddress, city, state: state.toUpperCase(), postalCode,
      opportunity, evidenceUrl, evidenceReference, authorizedToShare: true } }, {
      onSuccess: () => {
        setIdempotencyKey(freshKey()); setAddress(""); setCity(""); setState(""); setPostal("");
        setOpportunity(""); setEvidenceUrl(""); setEvidenceReference(""); setAuthorized(false);
        void qc.invalidateQueries({ queryKey: key });
      },
      onError: e => setError(e.message),
    });
  };

  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 bg-background p-5 text-foreground">
    <header><p className="eyebrow">Approved deal finder</p><h1 className="text-3xl font-semibold">Your opportunity submissions</h1>
      <p className="mt-2 text-sm text-muted-foreground">Submit opportunities you are authorized to share. Do not include seller contact details. Sharing authority does not establish seller contact permission, identity, signing authority, or CALL_READY status.</p></header>
    <section className="card grid gap-3 md:grid-cols-2">
      <label className="grid gap-1 text-xs">Property address<Input value={propertyAddress} onChange={e=>setAddress(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">City<Input value={city} onChange={e=>setCity(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">State<Input maxLength={2} value={state} onChange={e=>setState(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Postal code<Input value={postalCode} onChange={e=>setPostal(e.target.value)} /></label>
      <label className="grid gap-1 text-xs md:col-span-2">Opportunity details<Textarea value={opportunity} onChange={e=>setOpportunity(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Evidence URL (HTTPS)<Input value={evidenceUrl} onChange={e=>setEvidenceUrl(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Evidence reference<Input value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-xs md:col-span-2"><input type="checkbox" checked={authorizedToShare} onChange={e=>setAuthorized(e.target.checked)} /> I am authorized to share this opportunity and supporting information.</label>
      {error && <div className="md:col-span-2"><ErrorNotice error={new Error(error)} /></div>}
      <Button className="md:col-span-2" disabled={create.isPending || !authorizedToShare} onClick={submit}>Submit opportunity</Button>
    </section>
    <section className="card space-y-3"><h2 className="text-xl font-semibold">Your submissions</h2>
      {submissions.isLoading ? <p>Loading submissions…</p> : submissions.error ? <ErrorNotice error={submissions.error} /> :
        !(submissions.data ?? []).length ? <p className="text-sm text-muted-foreground">No submissions yet.</p> :
        <ol className="space-y-3">{submissions.data!.map(s=><li key={s.id} className="rounded border p-3 text-sm">
          <div className="flex justify-between gap-2"><b>{s.propertyAddress}, {s.city}, {s.state} {s.postalCode}</b><span>{s.status}</span></div>
          <p className="my-2 whitespace-pre-wrap">{s.opportunity}</p>
          <p><a className="underline" href={s.evidenceUrl} target="_blank" rel="noreferrer">Evidence</a> · {s.evidenceReference}</p>
          <p className="mt-2 text-xs text-muted-foreground">Submitted {new Date(s.submittedAt).toLocaleString()} · Fee status {s.feeStatus}</p>
        </li>)}</ol>}
    </section>
  </main>;
}
