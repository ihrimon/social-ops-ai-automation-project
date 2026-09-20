import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError, listConversations, type ConversationSummary } from "../api/client";

export default function Conversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listConversations()
      .then((res) => setConversations(res.conversations))
      .catch((error) => setLoadError(describeApiError(error)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;
  if (loadError) return <p className="error-text">{loadError}</p>;

  return (
    <div>
      <h2>Conversations</h2>
      {conversations.length === 0 && <p className="muted">No conversations yet.</p>}
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Channel</th>
            <th>Last message</th>
            <th>Messages</th>
            <th>When</th>
            <th>Lead</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation) => (
            <tr key={conversation.userId}>
              <td>
                <Link to={`/conversations/${encodeURIComponent(conversation.userId)}`}>
                  {conversation.userId}
                </Link>
              </td>
              <td>{conversation.platform ?? "—"}</td>
              <td className="truncate">
                {conversation.lastMessageRole}: {conversation.lastMessageText}
              </td>
              <td>{conversation.messageCount}</td>
              <td>{new Date(conversation.lastMessageAt).toLocaleString()}</td>
              <td>
                {conversation.leadStatus !== "none" && (
                  <span className={`badge badge-${conversation.leadStatus}`}>
                    {conversation.leadStatus}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
