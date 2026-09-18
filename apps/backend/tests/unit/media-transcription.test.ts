import { describe, expect, it, vi, beforeEach } from "vitest";

const generateContentFromPartsMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  aiConfig: { model: "gemini-3.6-flash" },
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

vi.mock("../../src/ai/client.js", () => ({
  generateContentFromParts: generateContentFromPartsMock,
}));

const { describeImageMessage, transcribeAudioMessage } =
  await import("../../src/modules/messenger/media-transcription.service.js");

describe("describeImageMessage", () => {
  beforeEach(() => {
    generateContentFromPartsMock.mockReset();
  });

  it("prefixes the description so it's distinguishable from a typed message", async () => {
    generateContentFromPartsMock.mockResolvedValue("a screenshot of a broken checkout page");

    const result = await describeImageMessage("base64data", "image/jpeg");

    expect(result).toBe("[Customer sent an image] a screenshot of a broken checkout page");
    const [, parts] = generateContentFromPartsMock.mock.calls[0];
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "base64data" } });
  });

  it("returns null when Gemini returns an empty description", async () => {
    generateContentFromPartsMock.mockResolvedValue("");

    expect(await describeImageMessage("base64data", "image/jpeg")).toBeNull();
  });

  it("returns null (rather than throwing) on a Gemini failure", async () => {
    generateContentFromPartsMock.mockRejectedValue(new Error("gemini down"));

    await expect(describeImageMessage("base64data", "image/jpeg")).resolves.toBeNull();
  });
});

describe("transcribeAudioMessage", () => {
  beforeEach(() => {
    generateContentFromPartsMock.mockReset();
  });

  it("returns the transcription unprefixed", async () => {
    generateContentFromPartsMock.mockResolvedValue("amar website ta dekhte hobe");

    expect(await transcribeAudioMessage("base64data", "audio/ogg")).toBe(
      "amar website ta dekhte hobe"
    );
  });

  it("returns null (rather than throwing) on a Gemini failure", async () => {
    generateContentFromPartsMock.mockRejectedValue(new Error("gemini down"));

    await expect(transcribeAudioMessage("base64data", "audio/ogg")).resolves.toBeNull();
  });
});
