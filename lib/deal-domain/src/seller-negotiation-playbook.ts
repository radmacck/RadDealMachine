export type SellerPlaybookKind = "SITUATION_HYPOTHESIS" | "OBJECTION_GUIDANCE";

export interface SellerPlaybookSource {
  sourceId: string;
  title: string;
  url: string;
  accessedAt: string;
  relevance: string;
  scopeLimit: string;
  author?: string;
  publishedAt?: string | null;
  accessContext?: string;
  topic?: string;
  marketJurisdiction?: string | null;
  materialType?: "PUBLIC_ARTICLE" | "PUBLIC_RESOURCE_CATALOG" | "PUBLIC_INTERVIEW" | "PUBLIC_PDF" | "OTHER";
  claimStatus?: "SOURCE_CLAIM_NOT_PROJECT_VALIDATED" | "PUBLIC_DESCRIPTION_ONLY";
}

export interface SellerPlaybookOperationalIntelligence {
  domain: "SELLER_CONVERSATION" | "UNDERWRITING" | "BUYER_DISPOSITION" | "TRANSACTION_READINESS";
  sourceClaim: string;
  claimStatus: "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED" | "PUBLIC_DESCRIPTION_ONLY";
  synthesizedMethod: string;
  rationale: string;
  supportingEvidence: string[];
  refutingEvidence: string[];
  nextQuestionOrAction: string;
  humanDecision: string;
  outcomeValidation: "NO_REAL_DEAL_OUTCOME_VALIDATION";
}

export interface SellerPlaybookContent {
  title: string;
  kind: SellerPlaybookKind;
  hypothesis: string;
  matchTerms: string[];
  discoveryQuestions: string[];
  empatheticResponse: string;
  negotiationOptions: string[];
  followUpGuidance: string[];
  risks: string[];
  escalationConditions: string[];
  confirmingEvidence: string[];
  refutingEvidence: string[];
  doNotPromise: string[];
  operationalIntelligence?: SellerPlaybookOperationalIntelligence;
}

export interface SellerPlaybookSeed {
  slug: string;
  content: SellerPlaybookContent;
  sourceProvenance: SellerPlaybookSource[];
}

export interface SellerPlaybookEvidence {
  id: string;
  category: string;
  statement: string;
  sourceType: string;
  classification: string;
}

export interface SellerPlaybookRelevance {
  status: "SELLER_REPORTED_TOPIC_TO_CONFIRM" | "GENERAL_QUESTION";
  reason: string;
  evidenceRefs: string[];
}

const LISTENING_SOURCE = {
  sourceId: "HARVARD_PON_LISTENING_2026",
  title: "Negotiation Skills for Win-Win Negotiations",
  url: "https://www.pon.harvard.edu/daily/negotiation-skills-daily/listening-skills-for-maximum-success/",
  accessedAt: "2026-10-09T21:39:58.000Z",
  relevance: "Supports the general use of active listening to reduce tension and learn information.",
  scopeLimit: "Does not establish any seller motivation, property fact, negotiation outcome, or legal rule.",
  author: "Program on Negotiation at Harvard Law School",
  publishedAt: null,
  accessContext: "Public article; accessed 2026-10-09. No publication date was visible.",
  topic: "General negotiation listening",
  marketJurisdiction: null,
  materialType: "PUBLIC_ARTICLE",
  claimStatus: "SOURCE_CLAIM_NOT_PROJECT_VALIDATED",
} satisfies SellerPlaybookSource;

const QUESTIONS_SOURCE = {
  sourceId: "HARVARD_PON_QUESTIONS_2026",
  title: "Negotiation Questions: How Asking Better Questions Leads to Better Deals",
  url: "https://www.pon.harvard.edu/daily/negotiation-skills-daily/ask-better-questions-in-negotiation-nb/",
  accessedAt: "2026-10-09T21:39:58.000Z",
  relevance: "Supports open, non-antagonistic questions as a way to understand a counterpart's position.",
  scopeLimit: "Does not establish any seller motivation, property fact, negotiation outcome, or legal rule.",
  author: "Program on Negotiation at Harvard Law School",
  publishedAt: null,
  accessContext: "Public article; accessed 2026-10-09. No publication date was visible.",
  topic: "General negotiation questions",
  marketJurisdiction: null,
  materialType: "PUBLIC_ARTICLE",
  claimStatus: "SOURCE_CLAIM_NOT_PROJECT_VALIDATED",
} satisfies SellerPlaybookSource;

const sourceProvenance = [LISTENING_SOURCE, QUESTIONS_SOURCE];
const JERRY_REO_SOURCE = {
  sourceId: "JERRY_NORTON_REO_ARTICLE",
  title: "5 Tips For Getting Bank Owned REOs Cheap",
  url: "https://flippingmastery.com/5_tips_for_getting_bank_owned_reos",
  accessedAt: "2026-10-10T00:00:00.000Z",
  relevance: "The public article says repair-cost support can help explain an offer and makes claims about REO seller preferences.",
  scopeLimit: "Educator claims only; REO/bank-owned context, not a rule for individual sellers. Do not adopt dual-agency, waived-inspection, or higher-EMD suggestions without legal and owner review. No project outcome validation.",
  author: "Jerry Norton (attributed by Flipping Mastery; no page byline displayed)",
  publishedAt: null,
  accessContext: "Full public article page fetched without sign-in or payment; no publication date displayed.",
  topic: "REO acquisition, repair evidence, and offer preparation",
  marketJurisdiction: "United States REO context stated by the source; no state-specific rule established.",
  materialType: "PUBLIC_ARTICLE",
  claimStatus: "SOURCE_CLAIM_NOT_PROJECT_VALIDATED",
} satisfies SellerPlaybookSource;
const PACE_FREEBIES_SOURCE = {
  sourceId: "PACE_MORBY_TEXTING_SCRIPT_PDF",
  title: "Texting Script",
  url: "https://resources.pacejmorby.com/wp-content/uploads/2024/01/Texting-Script.pdf",
  accessedAt: "2026-10-10T00:00:00.000Z",
  relevance: "The public one-page script sequences property/owner context, willingness to discuss, seller price/timing questions, and a follow-up conversation.",
  scopeLimit: "The sequence is paraphrased, not copied. This educational material does not establish efficacy, permission to contact, or any seller's motivation. No project outcome validation.",
  author: "Pace Morby (linked from the official freebies catalog; no PDF byline displayed)",
  publishedAt: null,
  accessContext: "One-page PDF fetched from the direct link on Pace Morby's public freebies catalog without login, payment, or form submission. PDF metadata creation date was 2023-12-08; it is not treated as a publication date.",
  topic: "Seller text outreach, price/timing questions, and follow-up conversation",
  marketJurisdiction: null,
  materialType: "PUBLIC_PDF",
  claimStatus: "SOURCE_CLAIM_NOT_PROJECT_VALIDATED",
} satisfies SellerPlaybookSource;

function entry(
  slug: string,
  title: string,
  kind: SellerPlaybookKind,
  hypothesis: string,
  matchTerms: string[],
  discoveryQuestions: string[],
  empatheticResponse: string,
  negotiationOptions: string[],
  followUpGuidance: string[],
  risks: string[],
  escalationConditions: string[],
  confirmingEvidence: string[],
  refutingEvidence: string[],
  doNotPromise: string[],
  sources: SellerPlaybookSource[] = sourceProvenance,
  operationalIntelligence?: SellerPlaybookOperationalIntelligence,
): SellerPlaybookSeed {
  return {
    slug,
    sourceProvenance: sources,
    content: {
      title,
      kind,
      hypothesis,
      matchTerms,
      discoveryQuestions,
      empatheticResponse,
      negotiationOptions,
      followUpGuidance,
      risks,
      escalationConditions,
      confirmingEvidence,
      refutingEvidence,
      doNotPromise,
      ...(operationalIntelligence ? { operationalIntelligence } : {}),
    },
  };
}

const BASE_BOUNDARIES = [
  "Do not promise a price, closing date, repairs, title result, funding, or certainty that has not been approved and verified.",
  "Suggestions are conversation guidance only. Recalculate and obtain the required approval before changing offer economics or terms.",
];

export const SELLER_NEGOTIATION_PLAYBOOK_SEEDS: SellerPlaybookSeed[] = [
  entry(
    "relocation-or-deadline",
    "Possible timing or relocation need",
    "SITUATION_HYPOTHESIS",
    "If the seller says they have a move or deadline, timing may matter. Do not infer a deadline from a listing, vacancy, or property record.",
    ["relocat", "moving", "move date", "deadline", "new job", "start date"],
    ["What timing would work best for you?", "Is there a date you need to plan around, or is the timing flexible?", "What would make the process feel manageable?"],
    "Acknowledge the stated timing and ask what flexibility they actually have before discussing options.",
    ["Compare an approved faster close with a more flexible date only after title, access, funds, and authority are checked.", "Ask whether certainty, price, or timing matters most; do not assume the trade-off."],
    ["Record the seller's exact stated date and whether it is firm or tentative.", "Agree on one follow-up time; do not create urgency."],
    ["A seller-reported target date is not a guaranteed closing date.", "A deadline statement may be incomplete or may change."],
    ["Escalate if requested timing conflicts with contract, title, funding, inspection, or required review."],
    ["Seller directly states a date or timing preference and confirms it when clarified."],
    ["Seller says there is no deadline or declines to identify one."],
    BASE_BOUNDARIES,
  ),
  entry(
    "estate-or-inherited-property",
    "Possible estate or inherited-property context",
    "SITUATION_HYPOTHESIS",
    "If the seller volunteers an estate or inheritance context, authority, parties, and timing may need verification. Never infer this from a name, age, vacancy, or public record.",
    ["inherit", "estate", "probate", "executor", "administrator", "beneficiary"],
    ["What is the best way to understand who needs to be involved in a decision?", "Are there documents or representatives we should coordinate with?", "What timing would be useful to discuss?"],
    "Thank the seller for sharing only what they are comfortable sharing; keep questions limited to the transaction.",
    ["Offer a clear review process and time to consult their chosen representative.", "Discuss timing or access only after authorized parties and applicable documents are confirmed."],
    ["Record who the seller says is involved, label it seller-reported, and request authorized verification through the transaction workflow."],
    ["Do not assume the person speaking has signing authority.", "Avoid probing family, inheritance, or financial details that are not necessary."],
    ["Require qualified legal/title review for probate, estate authority, multiple owners, or disputed authority."],
    ["Seller voluntarily identifies an estate-related process and provides verifiable transaction authority later."],
    ["Seller says the property is not part of an estate or declines to discuss it."],
    [...BASE_BOUNDARIES, "Do not interpret probate or estate documents as legal advice; route them for qualified review."],
  ),
  entry(
    "landlord-or-tenant-context",
    "Possible landlord or tenant concern",
    "SITUATION_HYPOTHESIS",
    "If the seller describes rental or tenant circumstances, occupancy and access may affect the process. Rental ownership alone does not establish landlord fatigue or a desire to sell.",
    ["tenant", "renter", "landlord", "lease", "rental", "eviction"],
    ["Is anyone living in the property now?", "Are there lease, access, or notice requirements we should know about?", "What would a workable transition look like for everyone involved?"],
    "Acknowledge the practical constraints without taking sides or promising a tenant outcome.",
    ["Compare an as-is path with a verified access/inspection plan.", "Explore dates or possession terms only through approved offer and contract review."],
    ["Record occupancy and access as seller-reported until corroborated.", "Route tenant communication through the authorized, legally reviewed process."],
    ["Do not promise removal, vacant possession, or a particular legal result.", "Respect tenant privacy and access restrictions."],
    ["Escalate eviction, lease interpretation, tenant rights, or contested possession to qualified counsel."],
    ["Seller reports a lease, occupant, or access constraint and provides transaction-relevant details."],
    ["Seller confirms the property is not tenant-occupied or no rental arrangement exists."],
    [...BASE_BOUNDARIES, "Do not provide legal advice or promise an eviction, notice, or tenant result."],
  ),
  entry(
    "condition-or-repair-burden",
    "Possible repair or condition concern",
    "SITUATION_HYPOTHESIS",
    "If the seller reports repair concerns, the scope and evidence may affect underwriting. Listing language or photos alone do not prove a defect or repair cost.",
    ["repair", "roof", "foundation", "hvac", "plumbing", "electrical", "water damage", "condition"],
    ["Which areas concern you most?", "What have you observed, and when?", "Have any repairs already been completed or inspected?"],
    "Thank the seller for the detail and separate what they personally observed from estimates or second-hand reports.",
    ["Compare an as-is proposal with a separately reviewed repair scope.", "Re-run deterministic repair scenarios only after evidence is recorded and rates are current."],
    ["Capture category, exact statement, source, and clarification status; keep seller reports distinct from inspections."],
    ["Do not diagnose from a brief call or promise a repair credit before authorized calculation."],
    ["Escalate safety concerns, structural issues, environmental hazards, or specialist work for qualified inspection."],
    ["Seller provides a dated, specific condition statement or a report that can be reviewed."],
    ["Seller says the item is not present, was repaired, or cannot be confirmed."],
    BASE_BOUNDARIES,
  ),
  entry(
    "vacancy-or-carrying-costs",
    "Possible vacancy or ongoing-property costs",
    "SITUATION_HYPOTHESIS",
    "If the seller says the property is vacant or mentions ongoing costs, those may affect their preferences. A vacancy indicator does not establish financial pressure or seller motivation.",
    ["vacant", "vacancy", "utilities", "insurance", "maintenance", "carrying cost", "empty"],
    ["Is the property occupied today?", "Are there property expenses or maintenance issues you want us to understand?", "Would you prefer a particular access or showing arrangement?"],
    "Ask permission before discussing costs and accept that the seller may not wish to share them.",
    ["Explore access, inspection, and timing preferences without implying the seller must sell.", "Any carrying-cost assumptions stay in underwriting and require evidence."],
    ["Record occupancy and any volunteered expenses as seller-reported, with date and clarification status."],
    ["Do not infer financial distress, inability to maintain the property, or urgency from vacancy."],
    ["Escalate unsafe conditions, utility shutoff, or access/security concerns through the approved operational process."],
    ["Seller directly confirms current occupancy status or a specific expense."],
    ["Seller reports occupancy or states those costs are not relevant."],
    BASE_BOUNDARIES,
  ),
  entry(
    "tax-foreclosure-or-title-pressure",
    "Sensitive tax, foreclosure, lien, or title concern",
    "SITUATION_HYPOTHESIS",
    "If the seller raises a tax, foreclosure, lien, or title issue, it requires careful evidence review. Public-record indicators alone do not prove a seller's situation, urgency, or authority.",
    ["tax", "foreclosure", "lien", "title", "delinquent", "judgment", "auction"],
    ["Is there a transaction-related title or tax issue you would like us to route for review?", "Would you like your attorney or chosen advisor included?", "What information may we request through the proper review process?"],
    "Use neutral language, avoid pressure, and let the seller choose whether to discuss the issue.",
    ["Pause economic or closing assurances until the record and parties are reviewed.", "Offer only to coordinate an evidence review through authorized professionals."],
    ["Keep source records and seller statements separate; record evidence references and last-checked dates."],
    ["Do not exploit a deadline, advise on debt or foreclosure, or claim a payoff/title result."],
    ["Immediately route threatened foreclosure, disputed liens, bankruptcy, tax advice, or title defects to qualified legal/title professionals."],
    ["Seller voluntarily identifies an issue and a qualified professional later supplies reviewable evidence."],
    ["No seller statement or current, reliable source confirms the issue."],
    [...BASE_BOUNDARIES, "Do not give legal, tax, debt, or foreclosure advice; do not use distress to create urgency."],
  ),
  entry(
    "partnership-or-family-decision",
    "Possible shared-owner decision",
    "SITUATION_HYPOTHESIS",
    "If the seller says other owners or decision-makers are involved, alignment and authority may need review. Never infer divorce, family conflict, or partnership dissolution.",
    ["co-owner", "partner", "business partner", "divorce", "separation", "siblings", "other owner"],
    ["Who should receive the same transaction information?", "How would you like us to coordinate a review among the decision-makers?", "Are there timing or communication preferences we should respect?"],
    "Acknowledge that shared decisions can take coordination; do not ask for personal details.",
    ["Offer the same written, versioned terms to authorized parties.", "Allow time for each party's independent review; do not negotiate secretly with one party."],
    ["Record the stated parties and communication preferences; verify authority separately."],
    ["Do not infer conflict from ownership records or pressure one owner to bypass another."],
    ["Escalate disputed authority, divorce, guardianship, incapacity, or disagreement to qualified counsel."],
    ["Seller voluntarily identifies additional decision-makers and they are confirmed through proper records."],
    ["Seller says no other decision-maker is involved or the record shows otherwise."],
    [...BASE_BOUNDARIES, "Do not advise on family, divorce, partnership, or ownership rights."],
  ),
  entry(
    "stale-or-withdrawn-listing",
    "Possible listing or market fatigue",
    "SITUATION_HYPOTHESIS",
    "A stale, withdrawn, expired, or price-reduced listing is only a source observation. It does not establish frustration, motivation, or willingness to accept a lower price.",
    ["expired listing", "withdrawn", "price reduction", "price cut", "relisted", "listing"],
    ["Are you still considering a sale?", "What has worked or not worked in the process so far?", "What outcome matters most to you now?"],
    "Avoid criticizing another agent, offer, or prior choice; ask what the seller wants going forward.",
    ["Compare a reviewed as-is path with a market-exposure path only when supported by approved data.", "Revisit price only through current comps and authorized versioned economics."],
    ["Verify listing status and source freshness before relying on it; respect any active representation or contact restrictions."],
    ["Do not treat listing changes as proof of seller fatigue or permission to bypass an agent."],
    ["Escalate active representation, exclusivity, or source-use restrictions for review."],
    ["Seller directly confirms sale plans and describes preferred process."],
    ["Seller says the property is not for sale or listing data is stale."],
    BASE_BOUNDARIES,
  ),
  entry(
    "convenience-or-certainty",
    "Possible preference for convenience or certainty",
    "SITUATION_HYPOTHESIS",
    "The seller may value a simpler process if they say so. Do not claim a sale will be certain, fast, or free of contingencies before every required gate is met.",
    ["convenience", "simple process", "certainty", "hassle", "easy sale", "quick sale"],
    ["What parts of a sale would you most like to make straightforward?", "Which steps or contingencies are important to you?", "What would you need to see before feeling comfortable?"],
    "Reflect the seller's stated preference and ask what evidence would make the process credible.",
    ["Compare timing, inspection, access, and price options only within authorized policy.", "Provide written next steps and explicit conditions rather than a verbal guarantee."],
    ["Record what the seller said they value; confirm that any option remains feasible with the transaction team."],
    ["Do not promise certainty, cash availability, closing date, or waived protections."],
    ["Escalate any request to omit required disclosure, inspection, approval, or contract protections."],
    ["Seller expressly prioritizes a process feature and confirms it after explanation."],
    ["Seller prioritizes price or another factor instead."],
    BASE_BOUNDARIES,
  ),
  entry(
    "price-maximizer-or-low-offer",
    "Price expectations or a low-offer objection",
    "OBJECTION_GUIDANCE",
    "If the seller challenges price or states a target, understand the basis before discussing a response. Their expectation is seller-reported evidence, not authorization to change an offer.",
    ["too low", "low offer", "asking price", "price", "counteroffer", "competing offer", "higher offer"],
    ["What evidence or property features are most important in your price expectation?", "Would you like us to review any specific comparable sales or completed improvements?", "Besides price, are there terms you want considered?"],
    "Acknowledge that the price matters and invite the seller to explain their perspective before responding.",
    ["Recheck comps, condition, costs, and current policy; create a new economics version before any changed offer.", "Discuss non-price terms only as options for review, not as promises."],
    ["Capture exact seller expectation, context, and date; preserve existing authorization and communication history."],
    ["Do not argue, disparage the property, invent comps, or imply a revised number is approved."],
    ["Require owner authorization for any changed offer and qualified review for unusual terms."],
    ["Seller states a specific price or responds to an exact authorized offer."],
    ["Seller clarifies that the earlier amount was not a firm expectation."],
    BASE_BOUNDARIES,
  ),
  entry(
    "trust-assignment-or-proof",
    "Trust, assignment, or proof-of-funds concern",
    "OBJECTION_GUIDANCE",
    "If the seller questions identity, assignment, or funds, answer only with verifiable role, approved disclosures, and real provider-supported evidence.",
    ["proof of funds", "assignment", "assign", "wholesale", "who are you", "legitimate", "trust", "cash buyer"],
    ["What would you like clarified about our role or the proposed process?", "Would written information or a conversation with an authorized reviewer help?", "Which document or evidence do you want reviewed?"],
    "Take the concern seriously; explain only the role and terms in the current authorized documents.",
    ["Offer an approved written disclosure or verified proof only when actually available.", "Pause for legal/template review if assignment or transaction structure is unclear."],
    ["Record the exact concern and document requested; do not say a document was sent unless delivery is confirmed."],
    ["Never imply direct funds, lender approval, buyer commitment, or guaranteed performance without evidence."],
    ["Escalate assignment disclosure, licensing, funds verification, or contract-structure questions to the owner and qualified reviewer."],
    ["Seller confirms the concern was answered using a reviewed, current document or verifiable evidence."],
    ["Seller declines further discussion or says the concern remains unresolved."],
    [...BASE_BOUNDARIES, "Do not fabricate proof of funds, buyer identity, delivery, or legal disclosure."],
  ),
  entry(
    "inspection-emd-access-and-timing",
    "Inspection, earnest money, access, or closing-term concern",
    "OBJECTION_GUIDANCE",
    "If the seller asks about inspection, EMD, access, or timing, terms must match the current authorized economics and reviewed documents.",
    ["inspection", "earnest", "emd", "deposit", "access", "showing", "closing date", "inspection period"],
    ["Which part of access or timing is the concern?", "What dates or restrictions should be documented for review?", "Would you like the written terms clarified before deciding?"],
    "Restate the question in neutral terms, then check the exact current document rather than relying on memory.",
    ["Route a requested alternative for authorized calculation and contract review.", "Do not characterize funds or milestones as satisfied until reviewed evidence is stored."],
    ["Record the requested term; compare it with the immutable offer/document version before responding."],
    ["Do not promise EMD delivery, waived inspection, access, or close dates without approval and evidence."],
    ["Escalate any change to price, EMD, inspection rights, access, or closing terms for owner/legal review."],
    ["An authorized reviewer approves the exact revised term and its document version."],
    ["The seller accepts the existing reviewed terms or withdraws the request."],
    [...BASE_BOUNDARIES, "Never report a prepared document, planned deposit, or requested date as completed."],
  ),
  entry(
    "title-lien-tenant-or-professional",
    "Title, lien, tenant, agent, or attorney issue",
    "OBJECTION_GUIDANCE",
    "If the seller mentions a title, lien, tenant, agent, or attorney issue, preserve the statement and route it to the right reviewer without interpretation.",
    ["title", "lien", "tenant", "agent", "attorney", "lawyer", "deed", "co-owner"],
    ["Who should be included in the next discussion?", "What document or contact may we request through the approved process?", "Would you prefer your attorney or representative to coordinate?"],
    "Respect the seller's chosen professional and explain that the issue will be reviewed before any assurance is given.",
    ["Pause external promises and collect only documents the authorized workflow permits.", "Keep buyer/seller terms unchanged until a reviewed amendment or new authorization exists."],
    ["Preserve the source record and seller statement as separate evidence with timestamps."],
    ["Do not give legal advice, interpret liens or deeds, or contact represented parties outside approved policy."],
    ["Escalate legal interpretation, disputed title, representation, or tenant rights to qualified professionals."],
    ["A qualified reviewer records a current, party-matched resolution."],
    ["The issue is not confirmed or evidence is stale/mismatched."],
    [...BASE_BOUNDARIES, "Do not claim title cleared, lien paid, party authorized, or tenant matter resolved without reviewed evidence."],
  ),
  entry(
    "counteroffer-or-changing-terms",
    "Seller counteroffer or changed terms",
    "OBJECTION_GUIDANCE",
    "A counter or changed seller term is a request to evaluate, not an accepted amendment or authority to alter the offer.",
    ["counter", "counteroffer", "change the price", "different terms", "new terms", "change the offer"],
    ["Which exact term would you like changed?", "What other terms are important to you?", "May we document this request and return with an approved version?"],
    "Confirm the seller's requested terms accurately before discussing whether they can be considered.",
    ["Create a new deterministic economics/offer version where applicable and route it for the required approval.", "Maintain the previously authorized offer and communication history until replaced by an authorized version."],
    ["Record each requested term, who stated it, and when; do not present a draft as accepted."],
    ["Do not accept a counter verbally unless the existing authority and workflow explicitly permit it."],
    ["Require owner approval and reviewed amendment/contract handling for changed or executed terms."],
    ["The exact counter is captured and reviewed through the versioned offer workflow."],
    ["Seller withdraws or clarifies the counter before review."],
    [...BASE_BOUNDARIES, "Do not create, send, or execute contract language from a playbook suggestion."],
  ),
  entry(
    "no-response-or-follow-up",
    "No response or follow-up planning",
    "OBJECTION_GUIDANCE",
    "Silence does not establish interest, refusal, urgency, or permission for repeated contact.",
    ["no answer", "voicemail", "no response", "call back", "follow up", "not available"],
    ["If contact is re-established, is there a preferred time or channel?", "Would you like us to follow up, and when?", "Is there a preferred way to stop further contact?"],
    "Respect the seller's time and stated contact preferences.",
    ["Use only the approved contact channel and cadence; stop when required by policy or request.", "Keep follow-up as a scheduled internal task until a permitted provider confirms any external message."],
    ["Record attempted contact separately from seller response; preserve call date, route, and outcome."],
    ["Do not claim a voicemail or message was delivered unless a provider confirms it.", "Do not increase contact frequency based on guessed motivation."],
    ["Escalate opt-out, representation, consent, or contact-permission questions to the responsible operator."],
    ["Seller explicitly confirms a preferred follow-up method/time or opts in."],
    ["No response, opt-out, or unreachable route remains unresolved."],
    [...BASE_BOUNDARIES, "Do not send or claim a communication from this guidance."],
  ),
  entry(
    "evidence-backed-reo-offer-review",
    "Evidence-backed offer review for bank-owned properties",
    "OBJECTION_GUIDANCE",
    "This guidance is limited to REO acquisition context. The educator's claims about institutional seller preferences are not universal and do not establish a seller's motivation or this project's outcomes.",
    ["reo", "bank owned", "bank-owned", "repair estimate", "offer justification", "institutional seller"],
    ["Which current, property-specific condition evidence supports the repair scope?", "Which comparable sales support the value range, and what differs?", "Are any access, inspection, or offer terms already approved for this deal?"],
    "Explain the evidence and uncertainty plainly. Do not characterize a lower offer as accepted or preferred by a seller.",
    ["Carry sourced condition evidence into deterministic repair scenarios and cite the estimate inputs.", "Compare an offer only against current comps, repair assumptions, transaction costs, and authorized policy.", "Do not waive inspection rights, increase EMD, use dual agency, or alter terms based on the article; require the established legal/owner review gates."],
    ["Record the seller's actual response separately from the educator's source claim.", "Refresh stale comp/condition inputs before recalculating; a new recommendation is not a new authorization."],
    ["The article discusses REO listings and offers; it does not prove individual bank policy or apply automatically to owner-occupants.", "Condition evidence and repair costs need their own provenance; an article is not a property inspection."],
    ["Escalate representation/dual-agency, inspection waiver, EMD changes, unusual terms, and institutional approval conditions to qualified review."],
    ["Current property-specific comps and documented condition inputs support a deterministic analysis; any seller preference is separately confirmed."],
    ["The property is not an REO, the source policy is not applicable, the cited condition is unsupported, or current comps contradict the premise."],
    [...BASE_BOUNDARIES, "Do not remove inspection protections, change EMD, assert dual-agency suitability, or claim institutional approval from an educator article."],
    [JERRY_REO_SOURCE],
    {
      domain: "UNDERWRITING",
      sourceClaim: "Jerry Norton's public REO article claims that documented repair costs can help explain an offer and describes cash, inspection, and earnest-money preferences as attractive to banks.",
      claimStatus: "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED",
      synthesizedMethod: "Use property-specific, provenance-backed repair and comp evidence to explain a deterministic offer range; keep source claims about REO preferences separate from this property's facts and retain inspection/EMD safeguards unless separately approved.",
      rationale: "A transparent evidence trail makes the offer rationale reviewable without turning an educator's general claim into seller intent, property condition, or approval.",
      supportingEvidence: ["Current comp records with source/date and reconciliation status.", "Property-specific condition evidence and documented repair-rate assumptions.", "Current authorized economics and offer snapshot."],
      refutingEvidence: ["Non-REO seller or different institutional requirements.", "Stale or conflicting comps/condition evidence.", "No approved authority for changed inspection, deposit, or representation terms."],
      nextQuestionOrAction: "Refresh comps and condition evidence, then review the existing deterministic underwriting snapshot; ask the seller or authorized representative only about terms they have actually stated.",
      humanDecision: "Owner retains all offer/term authorization; qualified legal/title reviewers decide representation, inspection, and contract questions.",
      outcomeValidation: "NO_REAL_DEAL_OUTCOME_VALIDATION",
    },
  ),
  entry(
    "permission-aware-text-follow-up",
    "Permission-aware seller follow-up",
    "OBJECTION_GUIDANCE",
    "A public Pace Morby script demonstrates a sequence of seller-contact topics. It is an educational example, not evidence of efficacy, consent, or a particular seller's motivation.",
    ["texting", "text message", "follow up text", "seller outreach", "negotiation script", "price expectations", "timeline"],
    ["After verifying the property/contact context, is the owner open to discussing a sale?", "If so, what price range and timing does the seller state?", "What question remains unanswered from the last conversation?", "Would the seller prefer no further contact?"],
    "Use the seller's stated contact preference, keep language factual and brief, and let the seller set the pace.",
    ["Use the source's topic order only as a preparation scaffold: verify context, ask whether discussion is welcome, then ask open price/timing questions.", "Prepare only an internal follow-up suggestion that references the last persisted conversation; do not send it automatically.", "When authorized communication capability exists, require the existing role/permission checks and provider confirmation before recording delivery.", "If asked for an offer, do not improvise a number; use current deterministic underwriting and explicit approval."],
    ["Keep no-response as unknown, observe opt-outs, and preserve the last confirmed channel and timestamp.", "A follow-up task is not proof that a text was sent or delivered."],
    ["The script is an educational example and does not show that a seller agrees with the process or that it produces a result.", "Contact consent, channel permission, opt-out, and communications law remain separate checks."],
    ["Escalate missing or conflicting contact-use permission, opt-out, representation, or a request involving protected communications."],
    ["A seller directly confirms a preferred channel/time and existing permission records allow it."],
    ["No response, an opt-out, stale permission, or an unverified route."],
    [...BASE_BOUNDARIES, "Do not send a text, claim delivery, or treat a follow-up suggestion as authorization."],
    [PACE_FREEBIES_SOURCE],
    {
      domain: "SELLER_CONVERSATION",
      sourceClaim: "The one-page public script sequences an initial property/owner check, an invitation to discuss, seller price/timing questions, and a follow-up conversation.",
      claimStatus: "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED",
      synthesizedMethod: "Use the sequence as a call-preparation scaffold only: confirm context, ask whether a discussion is welcome, then ask open price/timing questions. Derive any follow-up prompt from persisted conversation and permission state; never generate an external send event.",
      rationale: "Topic order can help avoid soliciting price or urgency before confirming who and what the conversation concerns; this is not a tested outcome claim.",
      supportingEvidence: ["Current, reviewed direct-contact route and source-specific permission.", "Seller confirms willingness to discuss and supplies their own answer."],
      refutingEvidence: ["No response, explicit opt-out, stale route, identity conflict, or unresolved permission."],
      nextQuestionOrAction: "Confirm the property and recipient, ask whether discussion is welcome, then record the seller's own stated price/timing without assuming motivation.",
      humanDecision: "The authorized operator decides whether and when to contact and what to say; offer amounts require separate deterministic underwriting and explicit approval. Delivery requires provider confirmation.",
      outcomeValidation: "NO_REAL_DEAL_OUTCOME_VALIDATION",
    },
  ),
];

const NORMALIZE_TERM = (value: string) => value.toLocaleLowerCase("en-US");

export function evaluateSellerPlaybookRelevance(
  content: SellerPlaybookContent,
  evidence: SellerPlaybookEvidence[],
): SellerPlaybookRelevance {
  const sellerStatements = evidence.filter(
    (item) => item.sourceType === "SELLER" && item.classification === "INDICATED",
  );
  const matches = sellerStatements.filter((item) => {
    const searchable = NORMALIZE_TERM(`${item.category} ${item.statement}`);
    return content.matchTerms.some((term) => term.length > 0 && searchable.includes(NORMALIZE_TERM(term)));
  });
  if (matches.length > 0) {
    return {
      status: "SELLER_REPORTED_TOPIC_TO_CONFIRM",
      reason: "A seller-reported statement contains a related topic. It remains seller-reported evidence, not an independently verified fact or established motivation.",
      evidenceRefs: [...new Set(matches.map((item) => item.id))],
    };
  }
  return {
    status: "GENERAL_QUESTION",
    reason: "No matching seller-reported evidence is recorded. Use only as an optional question; do not infer this situation from property or public-record signals.",
    evidenceRefs: [],
  };
}
