export type Page<T> = { items: T[]; nextPageToken?: string };

export async function* paginate<T>(
  fetchPage: (pageToken?: string) => Promise<Page<T>>,
  maxPages = 10_000,
): AsyncGenerator<T, void, void> {
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    for (const item of result.items) yield item;

    if (!result.nextPageToken) return;
    if (seenTokens.has(result.nextPageToken)) {
      throw new Error('Pagination returned a repeated page token.');
    }
    seenTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  throw new Error(`Pagination exceeded the safety limit of ${maxPages} pages.`);
}
