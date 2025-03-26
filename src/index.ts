import * as fs from "fs/promises";
import axios from "axios";
import { JSDOM } from "jsdom";
import { URL } from "url";

// Set the base URL to scrape (modify as needed)
let baseUrl = ""

// Directory where the output file will be saved
const directory = "./archived_data/";

// Function to generate a meaningful filename from the URL
const getFilenameFromUrl = (url: string): string => {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split('/').filter(p => p);
  const lastPart = pathParts.length > 0 ? pathParts[pathParts.length - 1] : parsed.hostname;
  return `${lastPart}.json`;
};

const filename = getFilenameFromUrl(baseUrl);

// Initialize the crawl with the starting URL and an empty Set for visited URLs
const initializeCrawl = (startUrl: string): [string, Set<string>] => {
  return [startUrl, new Set()];
};

// Check if a URL should be crawled (not already visited)
const shouldCrawl = (url: string, visited: Set<string>): boolean => {
  return !visited.has(url);
};

// Fetch and parse a URL's content
const crawl = async (
  url: string,
  visited: Set<string>,
  fetchFunc: (url: string) => Promise<JSDOM>
): Promise<[JSDOM | null, Set<string>]> => {
  if (shouldCrawl(url, visited)) {
    visited.add(url);
    try {
      const dom = await fetchFunc(url);
      return [dom, visited];
    } catch (error) {
      console.error(
        `Failed to fetch ${url}:`,
        error instanceof Error ? error.message : error
      );
      return [null, visited];
    }
  }
  return [null, visited];
};

// Extract title and text content from a page
const extractData = (dom: JSDOM): { title: string, text: string } => {
  const title = dom.window.document.title.trim();

  const cleanText = (text: string) => {
    return text
      .replace(/[^a-zA-Z0-9\s.,!?()\[\]{}_+\-=\/*\\:;'"`~|#@$&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const paragraphs = Array.from(dom.window.document.querySelectorAll("p, code, pre, li, ol"))
    .map(element => {
      let text = element.textContent || '';
      if (element.tagName === 'CODE' || element.tagName === 'PRE') {
        return text.replace(/\s+/g, ' ').trim();
      } else {
        return cleanText(text);
      }
    })
    .filter(text => text.length > 0);

  let text = paragraphs.join('\n');
  const maxDesiredLength = 120000;
  if (text.length > maxDesiredLength) {
    console.warn(`Warning: Text truncated from ${text.length} to ${maxDesiredLength} characters.`);
    text = text.substring(0, maxDesiredLength);
  }

  return { title, text };
};

// Find all valid URLs on the page within the same domain
const findUrls = (dom: JSDOM, baseUrl: string): string[] => {
  const base = new URL(baseUrl);
  const links = Array.from(dom.window.document.querySelectorAll("a[href]"));
  return links
    .map((link) => {
      const href = link.getAttribute("href");
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          return url.hostname === base.hostname ? url.href : null;
        } catch {
          return null;
        }
      }
      return null;
    })
    .filter((url) => url !== null) as string[];
};

// Process a URL: crawl, extract data, save, and queue new URLs
const processUrl = async (
  url: string,
  fetchFunc: (url: string) => Promise<JSDOM>,
  saveFunc: (data: { title: string, text: string }) => void,
  visited: Set<string>,
  baseUrl: string
): Promise<Set<string>> => {
  const [dom, updatedVisited] = await crawl(url, visited, fetchFunc);
  if (dom) {
    const data = extractData(dom);
    saveFunc(data);
    const urlsToCrawl = findUrls(dom, baseUrl);
    urlsToCrawl.forEach((newUrl) => {
      if (newUrl && !updatedVisited.has(newUrl)) {
        urlsToVisit.push(newUrl);
      }
    });
  }
  return updatedVisited;
};

// Global variables for crawling and data collection
let urlsToVisit: string[] = [];
let sections: string[] = [];
let seenTitles = new Set<string>();

const [startUrl, visited] = initializeCrawl(baseUrl);
urlsToVisit.push(startUrl);

// Function to fetch page content using axios
const fetchFunc = async (url: string): Promise<JSDOM> => {
  const response = await axios.get(url);
  return new JSDOM(response.data);
};

// Save extracted data, avoiding duplicates based on title
const saveFunc = ({ title, text }: { title: string, text: string }) => {
  if (!seenTitles.has(title)) {
    sections.push(`${title}\n\n${text}`);
    seenTitles.add(title);
  } else {
    console.log(`Skipped duplicate title: ${title}`);
  }
};

// Main execution
(async () => {
  // Ensure the output directory exists
  await fs.mkdir(directory, { recursive: true });

  // Crawl all URLs in a breadth-first manner
  while (urlsToVisit.length > 0) {
    const currentUrl = urlsToVisit.shift()!;
    await processUrl(currentUrl, fetchFunc, saveFunc, visited, baseUrl);
    console.log(
      `Visited: ${visited.size}, Queued: ${urlsToVisit.length}, Sections: ${sections.length}`
    );
  }

  // Combine all sections into a single string
  const content = sections.join('\n\n---\n\n');

  // Save to a JSON file
  await fs.writeFile(
    `${directory}${filename}`,
    JSON.stringify({ content }, null, 2),
    "utf-8"
  );
  console.log("Crawling completed and data saved.");
})().catch(console.error);