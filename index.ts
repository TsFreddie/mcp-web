#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cheerio from "cheerio";

// Search state management
let searchState: {
  currentQuery: string | null;
  currentPage: number;
  nextFormData: string | null;
} = {
  currentQuery: null,
  currentPage: 1,
  nextFormData: null,
};

const defaultHeaders = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,zh-CN;q=0.7,en;q=0.3",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  Referer: "https://html.duckduckgo.com/",
  "Sec-GPC": "1",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  DNT: "1",
  Priority: "u=0, i",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  TE: "trailers",
};

// Shared function for parsing search results
async function parseSearchResults(html: string) {
  // Parse the HTML with Cheerio
  const $ = cheerio.load(html);

  // Extract search results
  const results: { title: string; url: string; description: string }[] = [];

  // Look for result containers - DuckDuckGo uses .result class
  $(".result").each((i: number, elem: any) => {
    const $result = $(elem);
    const titleElement = $result.find(".result__a").first();
    const urlElement = $result.find(".result__a").first();
    const descriptionElement = $result.find(".result__snippet").first();

    if (titleElement.length > 0) {
      const title = titleElement.text().trim();
      const url = urlElement.attr("href") || "";
      const description =
        descriptionElement.length > 0 ? descriptionElement.text().trim() : "";

      if (title) {
        results.push({
          title,
          url,
          description,
        });
      }
    }
  });

  // Look for pagination forms
  const next = $("form>[value='Next']").parent();
  const hasMore = next.length;

  if (!hasMore) {
    return {
      hasMore,
      results,
    };
  }

  // Make the next page request
  const inputs = next.find("input");
  const formData = new URLSearchParams();
  for (const input of inputs) {
    if (input.attribs.name) {
      formData.append(input.attribs.name, input.attribs.value || "");
    }
  }

  searchState.nextFormData = formData.toString();

  return {
    hasMore,
    results,
  };
}

// Create an MCP server with stdio transport
const server = new McpServer({
  name: "web-search-server",
  version: "1.0.0",
});

// Register the fetch tool
server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetches the content of a URL and returns the HTML. Only supports GET requests.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Optional headers to include in the request"),
    },
  },
  async ({ url, headers }) => {
    try {
      // Parse url
      const origin = new URL(url).origin;

      // Merge custom headers with default headers
      const mergedHeaders = { ...defaultHeaders, Origin: origin, ...headers };

      // Make the fetch request
      const response = await fetch(url, {
        method: "GET",
        headers: mergedHeaders,
      });

      // Get the HTML content
      const html = await response.text();

      return {
        content: [{ type: "text", text: html }],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          { type: "text", text: `Error fetching URL: ${errorMessage}` },
        ],
        isError: true,
      };
    }
  }
);

// Register the search tool
server.registerTool(
  "search",
  {
    title: "Search DuckDuckGo",
    description:
      "Searches DuckDuckGo and returns parsed results. Starts from page 1 every time it is called. Use the fetch tool on result URLs to read more about them.",
    inputSchema: {
      query: z.string().describe("The search query"),
    },
  },
  async ({ query }) => {
    try {
      // Reset search state for new search
      searchState = {
        currentQuery: query,
        currentPage: 1,
        nextFormData: null,
      };

      // Make the search request with proper headers
      const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          ...defaultHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://html.duckduckgo.com",
        },
        body: `q=${encodeURIComponent(query)}&b=`,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching search results: ${response.status} ${response.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const html = await response.text();

      // Parse search results
      const data = await parseSearchResults(html);

      return {
        content: [
          {
            type: "text",
            text: `Found ${data.results.length} results for query "${query}". ${
              data.hasMore
                ? "More pages available via search_next tool. Only use it if you have yet to obtain enough information."
                : "No more pages available."
            }\n\nResults:\n${data.results
              .map((r) => `(${r.title})[${r.url}]\n${r.description}`)
              .join("\n\n")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          { type: "text", text: `Error performing search: ${errorMessage}` },
        ],
        isError: true,
      };
    }
  }
);

// Register the search_next tool
server.registerTool(
  "search_next",
  {
    title: "Next Search Page",
    description:
      "Navigates to the next page of search results. Warning: Do not use more than 3 times as search quality degrades with excessive pagination.",
  },
  async () => {
    if (!searchState.nextFormData || searchState.currentPage > 5) {
      return {
        content: [
          {
            type: "text",
            text: "No next page available.",
          },
        ],
        isError: true,
      };
    }

    try {
      searchState.currentPage++;
      const body = searchState.nextFormData;
      searchState.nextFormData = null;

      // Make the search request with proper headers
      const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          ...defaultHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://html.duckduckgo.com",
        },
        body,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching search results: ${response.status} ${response.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const html = await response.text();

      // Parse search results
      const data = await parseSearchResults(html);

      return {
        content: [
          {
            type: "text",
            text: `Found ${data.results.length} results for query "${
              searchState.currentQuery
            }". ${
              data.hasMore || searchState.currentPage > 5
                ? "More pages available via search_next tool. Only use it if you have yet to obtain enough information."
                : "No more pages available."
            }\n\nResults:\n${data.results
              .map((r) => `(${r.title})[${r.url}]\n${r.description}`)
              .join("\n\n")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          { type: "text", text: `Error performing search: ${errorMessage}` },
        ],
        isError: true,
      };
    }
  }
);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
