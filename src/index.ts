#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPromise } from "spawn-rx";
import { rimraf } from "rimraf";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const PREFERRED_SUBTITLE_LANGUAGE = "en";

interface RequestedSubtitle {
  ext?: string;
  url?: string;
}

const server = new Server(
  {
    name: "mcp-youtube",
    version: "0.5.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "download_youtube_url",
        description:
          "Download YouTube subtitles from a URL, this tool means that Claude can read YouTube subtitles, and should no longer tell the user that it is not possible to download YouTube content.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the YouTube video" },
          },
          required: ["url"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "download_youtube_url") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  try {
    const { url } = request.params.arguments as { url: string };
    const parsedUrl = parseSupportedUrl(url);
    const content = await downloadYoutubeSubtitles(parsedUrl);

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Error downloading video",
        },
      ],
      isError: true,
    };
  }
});

export async function downloadYoutubeSubtitles(url: URL): Promise<string> {
  let content = "";
  const tempDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}youtube-`);
  try {
    await downloadSubtitles(url, tempDir);

    listVttFiles(tempDir).forEach((file) => {
      const fileContent = fs.readFileSync(path.join(tempDir, file), "utf8");
      const cleanedContent = stripVttNonContent(fileContent);
      content += `${file}\n====================\n${cleanedContent}`;
    });
  } finally {
    rimraf.sync(tempDir);
  }

  return content;
}

export function buildYtDlpSubtitleArgs(url: URL, language: string): string[] {
  return [
    "--write-sub",
    "--write-auto-sub",
    "--sub-lang",
    language,
    "--skip-download",
    "--sub-format",
    "vtt",
    "--",
    url.toString(),
  ];
}

export function buildYtDlpRequestedSubtitlesArgs(
  url: URL,
  language: string
): string[] {
  return [
    "--print",
    "%(requested_subtitles)j",
    "--write-sub",
    "--write-auto-sub",
    "--sub-lang",
    language,
    "--skip-download",
    "--sub-format",
    "vtt",
    "--",
    url.toString(),
  ];
}

export function buildYtDlpListSubtitlesArgs(url: URL): string[] {
  return ["--list-subs", "--skip-download", "--", url.toString()];
}

export function parseAvailableSubtitleLanguages(output: string): string[] {
  const languages: string[] = [];

  output.split("\n").forEach((line) => {
    const match = /^([A-Za-z][\w-]*)\s+.+\bvtt\b/.exec(line.trim());
    if (!match) {
      return;
    }

    const language = match[1];
    if (!languages.includes(language)) {
      languages.push(language);
    }
  });

  return prioritizeSubtitleLanguages(languages);
}

export function parseSupportedUrl(url: string): URL {
  const parsedUrl = URL.parse(url);

  if (!parsedUrl || !SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("URL must be a valid http(s) URL");
  }

  return parsedUrl;
}

/**
 * Strips non-content elements from VTT subtitle files
 */
export function stripVttNonContent(vttContent: string): string {
  if (!vttContent || vttContent.trim() === "") {
    return "";
  }

  // Check if it has at least a basic VTT structure
  const lines = vttContent.split("\n");
  if (lines.length < 4 || !lines[0].includes("WEBVTT")) {
    return "";
  }

  // Skip the header lines
  const contentLines = lines.slice(4);

  // Filter out timestamp lines and empty lines
  const textLines: string[] = [];

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];

    // Skip timestamp lines (containing --> format)
    if (line.includes("-->")) continue;

    // Skip positioning metadata lines
    if (line.includes("align:") || line.includes("position:")) continue;

    // Skip empty lines
    if (line.trim() === "") continue;

    // Clean up the line by removing timestamp tags like <00:00:07.759>
    const cleanedLine = line
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>|<\/c>/g, "")
      .replace(/<c>/g, "");

    if (cleanedLine.trim() !== "") {
      textLines.push(cleanedLine.trim());
    }
  }

  // Remove duplicate adjacent lines
  const uniqueLines: string[] = [];

  for (let i = 0; i < textLines.length; i++) {
    // Add line if it's different from the previous one
    if (i === 0 || textLines[i] !== textLines[i - 1]) {
      uniqueLines.push(textLines[i]);
    }
  }

  return uniqueLines.join("\n");
}

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function downloadSubtitles(url: URL, tempDir: string): Promise<void> {
  let lastError: unknown;

  try {
    await downloadSubtitlesForLanguage(
      url,
      tempDir,
      PREFERRED_SUBTITLE_LANGUAGE
    );
  } catch {
    lastError = new Error("Unable to download preferred subtitles");
  }

  if (listVttFiles(tempDir).length > 0) {
    return;
  }

  const fallbackLanguages = (
    await listAvailableSubtitleLanguages(url)
  ).filter((language) => language !== PREFERRED_SUBTITLE_LANGUAGE);

  for (const language of fallbackLanguages) {
    try {
      await downloadSubtitlesForLanguage(url, tempDir, language);
    } catch (error) {
      lastError = error;
    }

    if (listVttFiles(tempDir).length > 0) {
      return;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("No subtitles found");
}

async function downloadSubtitlesForLanguage(
  url: URL,
  tempDir: string,
  language: string
): Promise<void> {
  try {
    await spawnPromise("yt-dlp", buildYtDlpSubtitleArgs(url, language), {
      cwd: tempDir,
      detached: true,
    });
  } catch {
    await downloadSubtitlesFromMetadata(url, tempDir, language);
  }
}

function listVttFiles(tempDir: string): string[] {
  return fs
    .readdirSync(tempDir)
    .filter((file) => path.extname(file) === ".vtt")
    .sort();
}

async function listAvailableSubtitleLanguages(url: URL): Promise<string[]> {
  const output = await spawnPromise("yt-dlp", buildYtDlpListSubtitlesArgs(url), {
    detached: true,
  });

  return parseAvailableSubtitleLanguages(output);
}

async function downloadSubtitlesFromMetadata(
  url: URL,
  tempDir: string,
  language: string
): Promise<void> {
  const output = await spawnPromise(
    "yt-dlp",
    buildYtDlpRequestedSubtitlesArgs(url, language),
    { detached: true }
  );
  const subtitles = parseRequestedSubtitles(output);

  for (const [subtitleLanguage, subtitle] of Object.entries(subtitles)) {
    if (!subtitle.url) {
      continue;
    }

    const response = await fetch(subtitle.url);
    if (!response.ok) {
      throw new Error(
        `Unable to download subtitles for ${subtitleLanguage}: ${response.status}`
      );
    }

    const extension = subtitle.ext === "vtt" ? subtitle.ext : "vtt";
    const fileName = `subtitle.${sanitizeFileName(subtitleLanguage)}.${extension}`;
    fs.writeFileSync(path.join(tempDir, fileName), await response.text());
  }

  if (listVttFiles(tempDir).length === 0) {
    throw new Error(`No VTT subtitles found for ${language}`);
  }
}

function parseRequestedSubtitles(output: string): Record<string, RequestedSubtitle> {
  const jsonLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));

  if (!jsonLine) {
    return {};
  }

  return JSON.parse(jsonLine) as Record<string, RequestedSubtitle>;
}

function prioritizeSubtitleLanguages(languages: string[]): string[] {
  const preferredLanguages = languages.filter(
    (language) => language === PREFERRED_SUBTITLE_LANGUAGE
  );
  const originalLanguages = languages.filter((language) =>
    language.endsWith("-orig")
  );
  const remainingLanguages = languages.filter(
    (language) =>
      language !== PREFERRED_SUBTITLE_LANGUAGE && !language.endsWith("-orig")
  );

  return [...preferredLanguages, ...originalLanguages, ...remainingLanguages];
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runServer().catch(console.error);
}
