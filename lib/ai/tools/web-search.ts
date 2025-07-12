import { tool } from 'ai';
import { z } from 'zod';

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

export const webSearch = tool({
  description:
    'Perform a real-time web search using the Serper API and return the most relevant organic results. Always use this tool when up-to-date information from the public web is required.',
  inputSchema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  execute: async ({ query }: { query: string }): Promise<{ results: SerperResult[] }> => {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      throw new Error(
        'SERPER_API_KEY is not defined. Please add it to your environment configuration.',
      );
    }

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ q: query }),
    });

    if (!response.ok) {
      throw new Error(`Serper request failed with status ${response.status}`);
    }

    const data = await response.json();

    // "organic" results contain the primary search listings.
    const results: SerperResult[] = (data?.organic ?? []).map((item: any) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
    }));

    return { results };
  },
}); 