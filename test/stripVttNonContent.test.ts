import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  buildYtDlpSubtitleArgs,
  parseAvailableSubtitleLanguages,
  parseSupportedUrl,
  stripVttNonContent,
} from "../src";
import { describe, it, beforeAll, expect } from "bun:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_YOUTUBE_URL = new URL("https://www.youtube.com/watch?v=test");

describe("buildYtDlpSubtitleArgs", () => {
  it("should build English subtitle arguments", () => {
    const args = buildYtDlpSubtitleArgs(TEST_YOUTUBE_URL, "en");
    const subLangIndex = args.indexOf("--sub-lang");

    expect(args[subLangIndex + 1]).toBe("en");
  });

  it("should build fallback subtitle arguments", () => {
    const args = buildYtDlpSubtitleArgs(TEST_YOUTUBE_URL, "all");
    const subLangIndex = args.indexOf("--sub-lang");

    expect(args[subLangIndex + 1]).toBe("all");
  });

  it("should keep the URL after the option separator", () => {
    const optionLikeUrl = new URL("https://www.youtube.com/watch?v=--version");
    const args = buildYtDlpSubtitleArgs(optionLikeUrl, "all");
    const separatorIndex = args.indexOf("--");

    expect(separatorIndex).toBe(args.length - 2);
    expect(args[separatorIndex + 1]).toBe(optionLikeUrl.toString());
  });
});

describe("parseAvailableSubtitleLanguages", () => {
  it("should prefer English, then original captions, then other available captions", () => {
    const languages = parseAvailableSubtitleLanguages(`Language Name                  Formats
ab       Abkhazian             vtt, srt, ttml, srv3, srv2, srv1, json3
de-orig  German (Original)     vtt, srt, ttml, srv3, srv2, srv1, json3
de       German                vtt, srt, ttml, srv3, srv2, srv1, json3
en       English               vtt, srt, ttml, srv3, srv2, srv1, json3`);

    expect(languages).toEqual(["en", "de-orig", "ab", "de"]);
  });
});

describe("parseSupportedUrl", () => {
  it("should accept http and https URLs", () => {
    expect(parseSupportedUrl("https://www.youtube.com/watch?v=test").href).toBe(
      "https://www.youtube.com/watch?v=test"
    );
    expect(parseSupportedUrl("http://example.com/video").href).toBe(
      "http://example.com/video"
    );
  });

  it("should reject option-like values", () => {
    expect(() => parseSupportedUrl("--version")).toThrow(
      "URL must be a valid http(s) URL"
    );
  });

  it("should reject non-http URLs", () => {
    expect(() => parseSupportedUrl("file:///etc/passwd")).toThrow(
      "URL must be a valid http(s) URL"
    );
  });
});

describe("stripVttNonContent", () => {
  const fixturesDir = path.join(__dirname, "fixtures");
  const vrFilePath = path.join(fixturesDir, "vr-bigscreen.en.vtt");
  const contrapointsFilePath = path.join(
    fixturesDir,
    "contrapoints-men.en.vtt"
  );

  let vrVttContent: string;
  let contrapointsVttContent: string;

  beforeAll(() => {
    vrVttContent = fs.readFileSync(vrFilePath, "utf8");
    contrapointsVttContent = fs.readFileSync(contrapointsFilePath, "utf8");
  });

  it("should strip timestamps and formatting from VR video subtitles", () => {
    const result = stripVttNonContent(vrVttContent);

    // Verify no timestamps or formatting tags remain
    expect(result).not.toContain("-->");
    expect(result).not.toContain("<00:");
    expect(result).not.toContain("</c>");
    expect(result).not.toContain("<c>");
    expect(result).not.toContain("align:");
    expect(result).not.toContain("position:");

    // Verify content is preserved
    expect(result).toContain("i still think that this is peak PC");
    expect(result).toContain("gaming A set of Corsera racing sim in VR");
  });

  it("should strip timestamps and formatting from ContraPoints video subtitles", () => {
    const result = stripVttNonContent(contrapointsVttContent);

    // Verify no timestamps or formatting tags remain
    expect(result).not.toContain("-->");
    expect(result).not.toContain("<00:");

    // Verify content is preserved
    expect(result).toContain("(eerie music)");
    expect(result).toContain("Hi boys, it's me again,");
    expect(result).toContain("just your average girl.");
    expect(result).toContain("Look I may be a biological female,");
  });

  it("should remove duplicate adjacent lines", () => {
    const testVtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
Test line

00:00:02.000 --> 00:00:04.000
Test line

00:00:04.000 --> 00:00:06.000
Different line`;

    const result = stripVttNonContent(testVtt);

    // Split result into lines and check there's no duplicates
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("Test line");
    expect(lines[1]).toBe("Different line");
  });

  it("should handle empty input", () => {
    expect(stripVttNonContent("")).toBe("");
  });

  it("should handle input without proper VTT format", () => {
    const result = stripVttNonContent(
      "Just some random text\nwithout VTT formatting"
    );
    expect(result).toBe("");
  });
});
