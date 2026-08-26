export type BodyStatus = "metadata_only" | "indexed" | "fetch_blocked" | "parse_failed" | "stale";

export type DocumentSummary = {
  id: string;
  number: string;
  title: string;
  officialURL: string;
  articleID: string;
  publishedAt: string;
  sourceStatus: string;
  bodyStatus: BodyStatus;
  sourceHash: string | null;
  snippet?: string | null;
  rank?: number | null;
};

export type Evidence = {
  documentID: string;
  number: string;
  title: string;
  officialURL: string;
  publishedAt: string;
  sourceHash: string;
  retrievedAt: string;
  section: string;
  excerpt: string;
};

export type EligibilityContext = {
  rank?: string;
  mos?: string;
  component?: "active" | "reserve" | "irr" | "smcr" | "ar";
  zone?: string;
  yearsOfService?: number;
};

export type EligibilityResult = {
  status: "supported" | "not_supported" | "unknown";
  rationale: string;
  missingContext: string[];
  evidence: Evidence[];
  disclaimer: string;
};

export type Coverage = Record<BodyStatus, number> & { total: number; catalogRevision: number };

export type ApiEnvelope<T> = { data: T; requestID: string };
