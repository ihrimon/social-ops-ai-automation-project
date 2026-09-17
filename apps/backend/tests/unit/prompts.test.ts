import { describe, expect, it } from "vitest";
import {
  buildMessengerReplyPrompt,
  formatKnowledgeBase,
  formatMessages,
} from "../../src/ai/prompts/reply.prompt.js";
import { buildCommentClassifyPrompt } from "../../src/ai/prompts/classify.prompt.js";
import { buildArticlePrompt } from "../../src/ai/prompts/article.prompt.js";
import { buildLeadExtractionPrompt } from "../../src/ai/prompts/lead-extraction.prompt.js";

describe("formatMessages", () => {
  it("returns a placeholder for empty/undefined history", () => {
    expect(formatMessages()).toBe("No previous conversation saved yet.");
    expect(formatMessages([])).toBe("No previous conversation saved yet.");
  });

  it("joins role:text pairs with newlines, in order", () => {
    const out = formatMessages([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
    expect(out).toBe("user: hi\nassistant: hello");
  });
});

describe("formatKnowledgeBase", () => {
  it("returns a placeholder when no chunks are given", () => {
    expect(formatKnowledgeBase()).toBe("No business knowledge found.");
    expect(formatKnowledgeBase([])).toBe("No business knowledge found.");
  });

  it("joins title:text pairs", () => {
    const out = formatKnowledgeBase([{ title: "Pricing", text: "Starts at 5000 BDT" }]);
    expect(out).toBe("Pricing: Starts at 5000 BDT");
  });
});

describe("buildMessengerReplyPrompt", () => {
  it("embeds the user message and the Bangla-reply instruction", () => {
    const prompt = buildMessengerReplyPrompt("Website price koto?", [], [], []);
    expect(prompt).toContain("Website price koto?");
    expect(prompt).toContain("Write in Bangla");
  });

  it("embeds relevant knowledge and conversation history when provided", () => {
    const prompt = buildMessengerReplyPrompt(
      "hi",
      [{ title: "Services", text: "We build websites" }],
      [{ role: "user", text: "old memory" }],
      [{ role: "assistant", text: "recent reply" }]
    );
    expect(prompt).toContain("Services: We build websites");
    expect(prompt).toContain("old memory");
    expect(prompt).toContain("recent reply");
  });
});

describe("buildCommentClassifyPrompt", () => {
  it("embeds post/comment text and the SKIP instruction", () => {
    const prompt = buildCommentClassifyPrompt("post text", "nice post!", []);
    expect(prompt).toContain("post text");
    expect(prompt).toContain("nice post!");
    expect(prompt).toContain("SKIP");
  });
});

describe("buildArticlePrompt", () => {
  it("embeds the topic and enforces Bangla-only output", () => {
    const prompt = buildArticlePrompt("landing page tips");
    expect(prompt).toContain("landing page tips");
    expect(prompt).toContain("বাংলায়");
  });
});

describe("buildLeadExtractionPrompt", () => {
  it("embeds the conversation and says nothing is known yet when requirements is null", () => {
    const prompt = buildLeadExtractionPrompt(
      [{ role: "user", text: "amar ekta ecommerce site lagbe" }],
      null
    );
    expect(prompt).toContain("amar ekta ecommerce site lagbe");
    expect(prompt).toContain("None known yet.");
  });

  it("embeds already-known scalar and array fields, skipping empty ones", () => {
    const prompt = buildLeadExtractionPrompt([], {
      contactName: "Rahim",
      contactPhone: null,
      features: ["contact form", "booking"],
    });
    expect(prompt).toContain("contactName: Rahim");
    expect(prompt).toContain("features: contact form, booking");
    expect(prompt).not.toContain("contactPhone");
  });

  it("instructs the model to only use the user's own words and never guess", () => {
    const prompt = buildLeadExtractionPrompt([], null);
    expect(prompt).toContain("Never guess or invent a value.");
  });
});
