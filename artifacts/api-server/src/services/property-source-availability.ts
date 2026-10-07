export type UnconnectedPropertySourceCapability = {
  id: string;
  name: string;
  category: string;
  coverage: string;
  status: "NOT_CONNECTED";
  reason: string;
  nextAction: string;
};

const noVerifiedAccess = "No source-approved API, export, integration, or other permitted access method has been configured and verified in this workspace. This app has not queried this provider.";
const activationAction = "Enable only after confirming the source's intended-use terms, permitted access method, rate limits, and any required authorization; then add a real adapter.";

/**
 * These are capability gaps, not connector registrations. Discovery workers
 * iterate only the separately validated live-adapter registry.
 */
export const NOT_CONNECTED_PROPERTY_SOURCE_CAPABILITIES: UnconnectedPropertySourceCapability[] = [
  {
    id: "zillow-listings-fsbo",
    name: "Zillow listings and FSBO",
    category: "LISTING",
    coverage: "Residential for-sale and owner-sale listing observations.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
  {
    id: "redfin-listings",
    name: "Redfin listings",
    category: "LISTING",
    coverage: "Residential listing observations and listing-history changes.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
  {
    id: "independent-fsbo-sites",
    name: "Independent FSBO and owner-sale sites",
    category: "LISTING",
    coverage: "Owner-published sale offers from independent public sites.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
  {
    id: "local-listing-sites",
    name: "Local real-estate listing sites",
    category: "LISTING",
    coverage: "Local broker, community, and real-estate listing sources outside the connected Philadelphia public-record feeds.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
  {
    id: "public-distress-filings",
    name: "Foreclosure, probate, and other public distress filings",
    category: "PUBLIC_RECORD",
    coverage: "Jurisdiction-specific public filings beyond the currently connected Philadelphia L&I, vacancy, OPA, and transfer datasets.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
  {
    id: "parcel-tax-delinquency",
    name: "Parcel-level tax delinquency",
    category: "PUBLIC_RECORD",
    coverage: "Tax delinquency attributable to an exact parcel.",
    status: "NOT_CONNECTED",
    reason: "The available Philadelphia tax-balance data is geographically aggregated, not parcel-specific; this system does not infer individual delinquency from it.",
    nextAction: "A jurisdiction-specific, parcel-level source with a permitted access method and exact parcel identifiers is required.",
  },
  {
    id: "non-philadelphia-public-records",
    name: "County and municipal public records outside Philadelphia",
    category: "PUBLIC_RECORD",
    coverage: "Parcel, deed, vacancy, unsafe-building, tax, and related records in other jurisdictions.",
    status: "NOT_CONNECTED",
    reason: noVerifiedAccess,
    nextAction: activationAction,
  },
];
