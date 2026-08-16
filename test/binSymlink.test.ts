import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "bun:test";
import { YoutubeMcpClient } from "../src/client";

describe("stdio entry through a bin symlink", () => {
  let mcpClient: YoutubeMcpClient | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await mcpClient?.close();
    mcpClient = undefined;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("starts the server when argv[1] is a symlink to the entrypoint", async () => {
    tempDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}mcp-youtube-bin-`);
    const entry = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/index.ts"
    );
    const bin = path.join(tempDir, "mcp-youtube");
    fs.symlinkSync(entry, bin);

    mcpClient = await YoutubeMcpClient.connect({ args: [bin] });

    const tools = await mcpClient.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "download_youtube_url"
    );
  });
});
