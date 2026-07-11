interface GraphError {
  message: string;
}

interface GraphPage<T> {
  data?: T[];
  error?: GraphError;
  paging?: { next?: string };
}

export async function fetchGraphPages<T>(initialUrl: string): Promise<{
  data: T[];
  error?: GraphError;
}> {
  const rows: T[] = [];
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const response: Response = await fetch(nextUrl);
    const page = (await response.json()) as GraphPage<T>;

    if (page.error) return { data: [], error: page.error };

    rows.push(...(page.data || []));
    nextUrl = page.paging?.next || null;
  }

  return { data: rows };
}
