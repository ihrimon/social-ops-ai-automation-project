import { describe, expect, it, vi, beforeEach } from "vitest";

const axiosGetMock = vi.fn();
const graphGetMock = vi.fn();

vi.mock("axios", () => ({
  default: { get: axiosGetMock },
}));

vi.mock("../../src/config/env.js", () => ({
  appConfig: { logLevel: "silent", nodeEnv: "test" },
  whatsappConfig: { accessToken: "test-token", phoneNumberId: "123456" },
}));

vi.mock("../../src/integrations/facebook/graph-client.js", () => ({
  graphGet: graphGetMock,
}));

const { fetchMetaAttachmentAsBase64 } = await import("../../src/integrations/facebook/media.js");
const { fetchWhatsAppMediaAsBase64 } = await import("../../src/integrations/whatsapp/media.js");

describe("fetchMetaAttachmentAsBase64", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
  });

  it("downloads the URL, base64-encodes the body, and reads the content-type", async () => {
    axiosGetMock.mockResolvedValue({
      data: Buffer.from("fake-image-bytes"),
      headers: { "content-type": "image/jpeg" },
    });

    const result = await fetchMetaAttachmentAsBase64("https://cdn.example.com/photo.jpg");

    expect(axiosGetMock).toHaveBeenCalledWith("https://cdn.example.com/photo.jpg", {
      responseType: "arraybuffer",
    });
    expect(result).toEqual({
      data: Buffer.from("fake-image-bytes").toString("base64"),
      mimeType: "image/jpeg",
    });
  });

  it("returns null (rather than throwing) when the download fails", async () => {
    axiosGetMock.mockRejectedValue(new Error("network down"));

    const result = await fetchMetaAttachmentAsBase64("https://cdn.example.com/photo.jpg");

    expect(result).toBeNull();
  });
});

describe("fetchWhatsAppMediaAsBase64", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    graphGetMock.mockReset();
  });

  it("resolves the media URL via the Graph API, then downloads it with a Bearer header", async () => {
    graphGetMock.mockResolvedValue({
      data: { url: "https://lookaside.example.com/media/abc", mime_type: "audio/ogg" },
    });
    axiosGetMock.mockResolvedValue({
      data: Buffer.from("fake-audio-bytes"),
      headers: {},
    });

    const result = await fetchWhatsAppMediaAsBase64("media-id-1");

    expect(graphGetMock).toHaveBeenCalledWith("media-id-1", {}, "test-token");
    expect(axiosGetMock).toHaveBeenCalledWith("https://lookaside.example.com/media/abc", {
      responseType: "arraybuffer",
      headers: { Authorization: "Bearer test-token" },
    });
    expect(result).toEqual({
      data: Buffer.from("fake-audio-bytes").toString("base64"),
      mimeType: "audio/ogg",
    });
  });

  it("returns null when the Graph API lookup returns no URL", async () => {
    graphGetMock.mockResolvedValue({ data: {} });

    const result = await fetchWhatsAppMediaAsBase64("media-id-1");

    expect(result).toBeNull();
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it("returns null (rather than throwing) when the download step fails", async () => {
    graphGetMock.mockResolvedValue({ data: { url: "https://lookaside.example.com/media/abc" } });
    axiosGetMock.mockRejectedValue(new Error("network down"));

    const result = await fetchWhatsAppMediaAsBase64("media-id-1");

    expect(result).toBeNull();
  });
});
