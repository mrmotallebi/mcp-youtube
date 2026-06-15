import { describe, expect, it } from "bun:test";
import { downloadYoutubeSubtitles, parseSupportedUrl } from "../src";

const INTEGRATION_TEST_URL = "https://www.youtube.com/watch?v=8Z75iu6t8FY";

describe("downloadYoutubeSubtitles integration", () => {
  it(
    "should download subtitles from the requested YouTube video",
    async () => {
      const content = await downloadYoutubeSubtitles(
        parseSupportedUrl(INTEGRATION_TEST_URL)
      );

      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain(".vtt");
      expect(content).toContain("====================");
      expect(content).not.toContain("-->");
      expect(content).not.toContain("<00:");
    },
    60_000
  );
});
