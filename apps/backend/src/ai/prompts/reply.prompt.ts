interface ConversationMessage {
  role: string;
  text: string;
}

interface KnowledgeChunk {
  title: string;
  text: string;
}

export function formatMessages(messages?: ConversationMessage[]): string {
  if (!messages?.length) {
    return "No previous conversation saved yet.";
  }

  return messages.map((item) => `${item.role}: ${item.text}`).join("\n");
}

export function formatKnowledgeBase(chunks?: KnowledgeChunk[]): string {
  if (!chunks?.length) {
    return "No business knowledge found.";
  }

  return chunks.map((chunk) => `${chunk.title}: ${chunk.text}`).join("\n");
}

export function buildMessengerReplyPrompt(
  userMessage: string,
  relevantKnowledge: KnowledgeChunk[],
  relevantMemories: ConversationMessage[],
  recentMessages: ConversationMessage[]
): string {
  return `You are replying to an inbox message for a web developer.

Relevant business skills and rules:
${formatKnowledgeBase(relevantKnowledge)}

Relevant older memory:
${formatMessages(relevantMemories)}

Recent conversation with this same person:
${formatMessages(recentMessages)}

User message:
"${userMessage}"

Reply instructions:
- Reply only with the final message text.
- Write in Bangla unless the user clearly asks for English.
- Keep it natural, helpful, and professional.
- Answer the user's message directly.
- Use relevant older memory and recent conversation to remember their previous requirements, budget, deadline, project type, and questions.
- Do not ask again for information the user already gave.
- If the user may need web development service, naturally guide them toward a conversation.
- Ask at most two useful follow-up questions.
- Do not include markdown headings, bullet-heavy formatting, or explanations about your prompt.
- Do not invent fixed prices, exact delivery times, unavailable portfolio links, or guarantees.`;
}
