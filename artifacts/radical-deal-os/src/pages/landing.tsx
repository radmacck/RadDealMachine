import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { PROVENANCE } from '@/components/provenance-sections';
import { NextSlices } from '@/components/next-slices';

const STEPS = [
  ['01', 'Lead', 'A real seller and a real address, entered once.'],
  ['02', 'Sourced intelligence', 'Every fact is filed by how we know it.'],
  ['03', 'Deterministic underwriting', 'Same comps and repairs, same answer. Every time.'],
  ['04', 'Call next', 'The one seller worth dialing, with a brief.'],
  ['05', 'Logged conversation', 'Outcome, notes, and a dated follow-up.'],
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <div className="flex gap-2">
          <Button asChild variant="ghost" data-testid="link-sign-in"><Link href="/sign-in">Sign in</Link></Button>
          <Button asChild data-testid="link-sign-up"><Link href="/sign-up">Create account</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16">
        <section className="rise grid gap-8 py-10 md:grid-cols-[1.3fr_1fr] md:py-16">
          <div>
            <p className="eyebrow mb-4">Internal tool / team access only</p>
            <h1 className="text-5xl font-semibold leading-[1.02] md:text-7xl">Know the number before you pick up the phone.</h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">Radical Deal OS is the working desk for our wholesaling team. Analysts research. The math is fixed. Mom calls the next seller with a brief in hand.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" data-testid="button-hero-sign-in"><Link href="/sign-in">Sign in to the desk <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" data-testid="button-hero-sign-up"><Link href="/sign-up">New teammate</Link></Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">New accounts wait for owner approval. No seller data is visible before sign-in.</p>
          </div>
          <div className="ledger self-start p-4" data-testid="panel-provenance-legend">
            <p className="eyebrow mb-3">Every statement is filed as one of</p>
            <ul className="space-y-2">
              {PROVENANCE.map((p) => (
                <li key={p.key} className={`prov-bar prov-${p.key} bg-background py-2 pl-3`}>
                  <p className="font-display text-lg font-semibold">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.blurb}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="border-y border-border py-8" data-testid="section-pipeline">
          <p className="eyebrow mb-4">What this release does</p>
          <ol className="grid gap-4 md:grid-cols-5">
            {STEPS.map(([n, t, d], i) => (
              <li key={n} className="rise" style={{ animationDelay: `${i * 70}ms` }}>
                <p className="font-mono text-sm text-signal">{n}</p>
                <h3 className="text-xl font-semibold leading-tight">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="grid gap-6 py-8 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-2">Honest about scope</p>
            <p className="text-sm text-muted-foreground">This release covers research, underwriting, calls, immutable offer drafts, owner authorization, and recording offers a person actually communicated. It never sends messages and does not execute contracts. Contracts and closing are not built.</p>
          </div>
          <NextSlices />
        </section>
      </main>
    </div>
  );
}
