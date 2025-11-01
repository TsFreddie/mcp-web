#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cheerio from "cheerio";
import * as pureimage from "pureimage";
import { Readable, PassThrough } from "stream";
import { readFile } from "fs/promises";
import path from "path";
import http from "http";
import { randomBytes } from "crypto";

import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

const supportedRegions: Record<string, string> = {
  global: "",
  argentina: "ar-es",
  australia: "au-en",
  austria: "at-de",
  belgium_fr: "be-fr",
  belgium_nl: "be-nl",
  brazil: "br-pt",
  bulgaria: "bg-bg",
  canada_en: "ca-en",
  canada_fr: "ca-fr",
  catalonia: "ct-ca",
  chile: "cl-es",
  china: "cn-zh",
  colombia: "co-es",
  croatia: "hr-hr",
  czech_republic: "cz-cs",
  denmark: "dk-da",
  estonia: "ee-et",
  finland: "fi-fi",
  france: "fr-fr",
  germany: "de-de",
  greece: "gr-el",
  hong_kong: "hk-tzh",
  hungary: "hu-hu",
  iceland: "is-is",
  india_en: "in-en",
  indonesia_en: "id-en",
  ireland: "ie-en",
  israel_en: "il-en",
  italy: "it-it",
  japan: "jp-jp",
  korea: "kr-kr",
  latvia: "lv-lv",
  lithuania: "lt-lt",
  malaysia_en: "my-en",
  mexico: "mx-es",
  netherlands: "nl-nl",
  new_zealand: "nz-en",
  norway: "no-no",
  pakistan_en: "pk-en",
  peru: "pe-es",
  philippines_en: "ph-en",
  poland: "pl-pl",
  portugal: "pt-pt",
  romania: "ro-ro",
  russia: "ru-ru",
  saudi_arabia: "xa-ar",
  singapore: "sg-en",
  slovakia: "sk-sk",
  slovenia: "sl-sl",
  south_africa: "za-en",
  spain_ca: "es-ca",
  spain_es: "es-es",
  sweden: "se-sv",
  switzerland_de: "ch-de",
  switzerland_fr: "ch-fr",
  taiwan: "tw-tzh",
  thailand_en: "th-en",
  turkey: "tr-tr",
  us_english: "us-en",
  us_spanish: "us-es",
  ukraine: "ua-uk",
  united_kingdom: "uk-en",
  vietnam_en: "vn-en",
};

const supportedDateFrame: Record<string, string> = {
  any: "",
  past_day: "d",
  past_week: "w",
  past_month: "m",
  past_year: "y",
};

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

// CAPTCHA challenge state
let captchaState: {
  challenge: string | null;
  images: string[] | null;
  action: string | null;
  submitValue: string | null;
  checkboxNames: string[] | null;
} = {
  challenge: null,
  images: null,
  action: null,
  submitValue: null,
  checkboxNames: null,
};

let captchaImages = new Map<string, Buffer>();

const main = async () => {
  const hostname = "127.0.0.1";
  const captchaServer = await new Promise<any>((resolve) => {
    // Basic HTTP server just for serving the CAPTCHA image
    const server = http.createServer((req, res) => {
      const image = captchaImages.get(req.url || "");
      if (image) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/png");
        res.end(image);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    server.listen(0, hostname, () => {
      resolve(server);
    });
  });

  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const lang = locale.split("-")[0];

  const defaultHeaders = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": !lang ? "en-US,en;q=0.9" : `${locale},${lang};q=0.9`,
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

    // Check if we got a CAPTCHA challenge
    const challengeForm = $("#challenge-form");
    if (challengeForm.length > 0) {
      // Extract CAPTCHA details
      const action = challengeForm.attr("action") || "";
      const submitButton = challengeForm.find(
        "button[name='challenge-submit']"
      );
      const submitValue = submitButton.attr("value") || "";

      // Extract image URLs and checkbox names
      const images: string[] = [];
      const checkboxNames: string[] = [];
      challengeForm.find(".anomaly-modal__image").each((i, elem) => {
        const src = $(elem).attr("src") || "";
        // Convert relative path to absolute URL
        const absoluteUrl = new URL(src, "https://duckduckgo.com").href;
        images.push(absoluteUrl);

        // Extract checkbox name from the image filename
        const filename = src.split("/").pop()?.replace(".jpg", "") || "";
        if (filename) {
          checkboxNames.push(`image-check_${filename}`);
        }
      });

      const challenge = challengeForm
        .find(".anomaly-modal__instructions")
        .text();

      // Store CAPTCHA state
      captchaState = {
        challenge,
        images,
        action,
        submitValue,
        checkboxNames,
      };

      return {
        mode: "captcha" as const,
        error: "Search blocked by CAPTCHA challenge.",
        captcha: {
          challenge,
          images,
        },
      } as const;
    }

    // Check if we got an error form
    const errorForm = $("#error-form");
    if (errorForm.length > 0) {
      const instruction = errorForm
        .find(".anomaly-modal__error-instructions")
        .first();

      return {
        mode: "captcha-failed" as const,
        error: instruction.text().trim(),
        next: errorForm.attr("action") || "",
      } as const;
    }

    // Check if we got an success form
    const successForm = $("#success-form");
    if (successForm.length > 0) {
      return {
        mode: "captcha-success" as const,
      } as const;
    }

    const resultsElement = $(".results");
    if (resultsElement.length == 0) {
      // Not a result page, can't display results
      return {
        mode: "unknown" as const,
      } as const;
    }

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
        mode: "results" as const,
        hasMore,
        results,
      } as const;
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
      mode: "results" as const,
      hasMore,
      results,
    } as const;
  }

  const overlay = async () => {
    // load image
    const file = await readFile(
      path.join(import.meta.dir, "assets/captcha-overlay.png")
    );
    const readable = new Readable();
    readable.push(file);
    readable.push(null);
    const image = await pureimage.decodePNGFromStream(readable);
    return image;
  };

  const dataToResult = async (
    data: Awaited<ReturnType<typeof parseSearchResults>>,
    query: string
  ): Promise<{
    content: Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image";
          data: string;
          mimeType: string;
        }
    >;
    isError?: boolean;
  }> => {
    if (data.mode === "captcha-failed") {
      return {
        content: [
          {
            type: "text",
            text: `Captcha failed. Notify user to retry giving the captcha result.\n\n${data.error}.`,
          },
        ],
        isError: true,
      };
    }

    if (data.mode === "captcha-success") {
      // search again
      return {
        content: [
          {
            type: "text",
            text: `Captcha successfully solved. You should call "search" tool again.`,
          },
        ],
      };
    }

    if (data.mode === "unknown") {
      // error
      return {
        content: [
          {
            type: "text",
            text: `Search can not be performed due to unknown error.`,
          },
        ],
      };
    }

    if (data.captcha) {
      // Check if we got a CAPTCHA challenge
      // Download all images in parallel
      const imageBuffers: Buffer[] = await Promise.all(
        data.captcha.images.map(async (imageUrl) => {
          if (!imageUrl) return null;
          try {
            const response = await fetch(imageUrl);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              return Buffer.from(arrayBuffer);
            }
          } catch (error) {
            console.error(`Error downloading image ${imageUrl}:`, error);
          }
          return null;
        })
      ).then((buffers) => buffers.filter((buffer) => buffer !== null));

      // Check if we have all 9 images
      if (imageBuffers.length === 9) {
        // Create a 3x3 grid of images
        // Each image is 100x100 pixels based on the CAPTCHA
        const tileSize = 256;
        const compositeImages = [];

        // Create the composite image
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const index = row * 3 + col;
            compositeImages.push({
              input: imageBuffers[index],
              top: row * tileSize,
              left: col * tileSize,
            });
          }
        }

        // Create a blank canvas for the composite image
        const canvas = pureimage.make(tileSize * 3, tileSize * 3);
        const ctx = canvas.getContext("2d");

        // Fill with white background
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, tileSize * 3, tileSize * 3);

        // Composite images onto canvas
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const index = row * 3 + col;
            const readable = new Readable();
            readable.push(imageBuffers[index]);
            readable.push(null);
            const img = await pureimage.decodeJPEGFromStream(readable);
            ctx.drawImage(
              img,
              0,
              0,
              img.width,
              img.height,
              col * tileSize,
              row * tileSize,
              tileSize,
              tileSize
            );

            // Draw index number
            ctx.fillStyle = "red";
            ctx.font = "20px Arial";
            ctx.fillText(
              index.toString(),
              col * tileSize - 5,
              row * tileSize - 25
            );
          }
        }

        // Overlay image
        const overlayImage = await overlay();
        ctx.drawImage(overlayImage, 0, 0, tileSize * 3, tileSize * 3);

        // Convert to PNG buffer
        const passThrough = new PassThrough();
        const chunks: Buffer[] = [];
        passThrough.on("data", (chunk) => chunks.push(chunk));
        await pureimage.encodePNGToStream(canvas, passThrough);
        passThrough.end();
        const buffer = Buffer.concat(chunks);
        const imageUrl = `/${randomBytes(16).toString("hex")}.png`;
        captchaImages.set(imageUrl, buffer);

        // available for 5 minutes
        setTimeout(() => captchaImages.delete(imageUrl), 5 * 60 * 1000);

        return {
          content: [
            {
              type: "text",
              text: `Search blocked by CAPTCHA challenge.\n\nAsk user to solve CAPTCHA: "${
                data.captcha.challenge
              }". Inform user that the search requires CAPTCHA to be solved. Inform user to check this image "http://${hostname}:${
                (captchaServer.address() as any).port
              }${imageUrl}" and reply the result numbers selected from 1 to 9. Do not attempt to solve it for user or provide suggestions.\n\nThen use the "solve_captcha" tool with the list of result numbers.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Search blocked by DuckDuckGo, this search cannot be performed.`,
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Found ${
            data.results?.length || 0
          } results for query "${query}". ${
            data.hasMore
              ? "More pages available via search_next tool. Only use it if you have yet to obtain enough information."
              : "No more pages available."
          }\n\nResults:\n${
            data.results
              ?.map((r) => `(${r.title})[${r.url}]\n${r.description}`)
              .join("\n\n") || "No results found."
          }`,
        },
      ],
    };
  };

  // Create an MCP server with stdio transport
  const server = new McpServer({
    name: "mcp-web",
    version: "1.0.0",
  });

  // Register the fetch tool
  server.registerTool(
    "fetch",
    {
      title: "Fetch URL",
      description:
        "Fetches the content of a URL and returns the extracted article content. Only supports GET requests. Not suitable for debugging HTML.",
      inputSchema: {
        url: z.string().url().describe("The URL to read about"),
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
        const startTime = Date.now();
        const dom = parseHTML(html);
        // remove all iframes
        const iframes = dom.document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          iframe.remove();
        }
        // remove all svgs
        const svgs = dom.document.querySelectorAll("svg");
        for (const svg of svgs) {
          svg.remove();
        }
        // remove all data URIs
        const dataURIs = dom.document.querySelectorAll("[src^='data:']");
        for (const dataURI of dataURIs) {
          dataURI.setAttribute("src", "");
        }
        const domTime = Date.now() - startTime;
        const article = await Defuddle(dom as any, url, {
          markdown: true,
        });
        const articleTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                domTime: domTime,
                articleTime: articleTime,
                content: article.content,
              }),
            },
          ],
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
        "Searches DuckDuckGo and returns parsed results. Convert user's natrual language to keywords if needed. Starts from page 1 every time it is called. Use the fetch tool on result URLs to read more about them.",
      inputSchema: {
        query: z.string().describe("The search query"),
        region: z
          .enum(Object.keys(supportedRegions) as [string, ...string[]])
          .optional()
          .describe("The region to search in"),
        dateFrame: z
          .enum(Object.keys(supportedDateFrame) as [string, ...string[]])
          .optional()
          .describe("The date frame to search in"),
      },
    },
    async ({ query, region, dateFrame }) => {
      try {
        // Reset search state for new search
        searchState = {
          currentQuery: query,
          currentPage: 1,
          nextFormData: null,
        };

        const searchParams = new URLSearchParams();
        searchParams.set("q", query);
        if (region && supportedRegions[region]) {
          searchParams.set("kl", supportedRegions[region]);
        }
        if (dateFrame && supportedDateFrame[dateFrame]) {
          searchParams.set("df", supportedDateFrame[dateFrame]);
        }
        searchParams.set("b", "");

        // Make the search request with proper headers
        const response = await fetch("https://html.duckduckgo.com/html/", {
          method: "POST",
          headers: {
            ...defaultHeaders,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://html.duckduckgo.com",
          },
          body: searchParams.toString(),
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
        const result = await dataToResult(data, query);
        return result;
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
        const result = await dataToResult(data, searchState.currentQuery || "");
        return result;
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

  // Register the solve_captcha tool
  server.registerTool(
    "solve_captcha",
    {
      title: "Solve CAPTCHA Challenge",
      description:
        "Solves a CAPTCHA challenge by providing the indices of images containing the requested object",
      inputSchema: {
        indices: z
          .array(z.number())
          .describe(
            "Array of indices (1-9) of images that contain the requested object"
          ),
      },
    },
    async ({ indices }) => {
      try {
        // Check if we have a CAPTCHA challenge
        if (
          !captchaState.challenge ||
          !captchaState.images ||
          !captchaState.action ||
          !captchaState.submitValue ||
          !captchaState.checkboxNames
        ) {
          return {
            content: [
              {
                type: "text",
                text: "No CAPTCHA challenge is currently active.",
              },
            ],
            isError: true,
          };
        }

        // Build form data
        const formData = new URLSearchParams();

        // Add the submit value
        formData.append("challenge-submit", captchaState.submitValue);

        // Add selected image checkboxes
        for (const index of indices) {
          if (index >= 1 && index <= captchaState.checkboxNames.length) {
            const checkboxName = captchaState.checkboxNames[index - 1];
            if (checkboxName) {
              formData.append(checkboxName, "1");
            }
          }
        }

        const actionUrl = new URL(
          captchaState.action,
          "https://duckduckgo.com"
        );

        // Make the POST request to solve the CAPTCHA
        const response = await fetch(actionUrl, {
          method: "POST",
          headers: {
            ...defaultHeaders,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://html.duckduckgo.com",
          },
          body: formData.toString(),
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error solving CAPTCHA: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }

        // Reset CAPTCHA state
        const html = await response.text();

        // Parse search results
        const data = await parseSearchResults(html);
        return await dataToResult(data, searchState.currentQuery || "");
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [
            { type: "text", text: `Error solving CAPTCHA: ${errorMessage}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main();
