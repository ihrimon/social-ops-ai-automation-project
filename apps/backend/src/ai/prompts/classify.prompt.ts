import { formatKnowledgeBase } from "./reply.prompt.js";

interface KnowledgeChunk {
  title: string;
  text: string;
}

export function buildCommentClassifyPrompt(
  postText: string,
  commentText: string,
  relevantKnowledge: KnowledgeChunk[]
): string {
  return `You reply publicly to comments on a Facebook or Instagram Page for a web developer.

Page post context:
"${postText}"

Visitor comment:
"${commentText}"

Relevant business skills and rules:
${formatKnowledgeBase(relevantKnowledge)}

Decide whether the visitor comment is genuinely about web-development services or the post's service offering. This includes questions or interest about websites, e-commerce, landing pages, apps, software, design, pricing, requirements, timeline, or starting a project.

If it is not service-related (for example only praise, greetings, emoji, unrelated chat, spam, or an unclear one-word reaction), reply with exactly: SKIP

If it is service-related, write only a concise public reply in Bangla unless the visitor clearly uses English. Be friendly and helpful, answer from the post context when possible, do not invent fixed prices or delivery times, and invite the visitor to inbox the Page for project-specific details. Do not use headings, hashtags, or markdown.`;
}
