export type SearchError = { message: string; queryProblem: boolean };

/** Maps an API error code to a message that says what happened and how to fix it (WCAG 3.3.1, 3.3.3). */
export function searchErrorFor(code: string): SearchError {
  switch (code) {
    case "people_search_not_supported":
      return { message: "People and contact lookup is not supported. Search by MARADMIN number, MOS, or policy topic.", queryProblem: true };
    case "message_centric_query_required":
      return { message: "Add a MARADMIN number, MOS, or policy topic to your search, for example “reenlistment bonus” or “MOS 3044”.", queryProblem: true };
    case "query_required":
      return { message: "Enter letters or numbers to search.", queryProblem: true };
    case "rate_limited":
      return { message: "Too many searches in a short time. Wait a minute, then try again.", queryProblem: false };
    default:
      return { message: "Search is temporarily unavailable. The official links remain the authoritative source.", queryProblem: false };
  }
}

export function resultCountMessage(count: number, query: string): string {
  const noun = count === 1 ? "result" : "results";
  if (!count) return query ? `No results for “${query}”.` : "No catalog records to show.";
  return query ? `${count} ${noun} for “${query}”.` : `${count} latest MARADMINs shown.`;
}
