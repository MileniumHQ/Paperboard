import type { SearchRecord } from "../types/docs";

/**
 * Rank pages for a query. Every whitespace-separated term must match the page
 * somewhere, so multi-word queries narrow instead of widening. Fields score by
 * specificity: page name beats title beats headings beats body.
 */
export function searchDocs(
    records: SearchRecord[],
    query: string,
): SearchRecord[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored: { record: SearchRecord; score: number }[] = [];

    for (const record of records) {
        const name = record.pageName.toLowerCase();
        const title = record.title.toLowerCase();
        const headings = record.headings.join(" ").toLowerCase();
        const body = record.body.toLowerCase();
        const meta =
            `${record.sectionName} ${record.subsectionName}`.toLowerCase();

        let score = 0;
        let matchedAll = true;

        for (const term of terms) {
            let termScore = 0;
            if (name === term) termScore += 100;
            else if (name.startsWith(term)) termScore += 60;
            else if (name.includes(term)) termScore += 40;
            if (title.includes(term)) termScore += 30;
            if (headings.includes(term)) termScore += 15;
            if (meta.includes(term)) termScore += 8;
            if (body.includes(term)) termScore += 5;

            if (termScore === 0) {
                matchedAll = false;
                break;
            }
            score += termScore;
        }

        if (matchedAll) scored.push({ record, score });
    }

    scored.sort(
        (a, b) =>
            b.score - a.score ||
            a.record.pageName.localeCompare(b.record.pageName),
    );

    return scored.map((entry) => entry.record);
}
