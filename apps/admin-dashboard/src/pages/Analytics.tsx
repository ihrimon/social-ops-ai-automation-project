import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  getLeadAnalytics,
  getPostAnalytics,
  type Lead,
  type LeadStats,
  type PostAnalyticsRow,
} from "../api/client";

function formatRate(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export default function Analytics() {
  const [posts, setPosts] = useState<PostAnalyticsRow[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getPostAnalytics(10), getLeadAnalytics(20)])
      .then(([postRes, leadRes]) => {
        setPosts(postRes.posts);
        setStats(leadRes.stats);
        setLeads(leadRes.leads);
      })
      .catch((error) => setLoadError(describeApiError(error)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;
  if (loadError) return <p className="error-text">{loadError}</p>;

  return (
    <div>
      <h2>Post performance</h2>
      <p className="muted">Most recent published posts, ranked by likes + comments·2 + shares·3.</p>
      {posts.length === 0 && <p className="muted">No published posts yet.</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Topic</th>
            <th>Likes</th>
            <th>Comments</th>
            <th>Shares</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post._id}>
              <td>{post.postDateKey || new Date(post.createdAt).toLocaleDateString()}</td>
              <td className="truncate">{post.topic || "—"}</td>
              <td>{post.engagement?.likes ?? "—"}</td>
              <td>{post.engagement?.comments ?? "—"}</td>
              <td>{post.engagement?.shares ?? "—"}</td>
              <td>
                {post.engagement?.permalinkUrl && (
                  <a href={post.engagement.permalinkUrl} target="_blank" rel="noreferrer">
                    View
                  </a>
                )}
                {!post.engagement && <span className="muted">unavailable</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Lead conversion</h2>
      {stats && (
        <div className="card">
          <div className="card-actions" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="muted">Conversations</div>
              <strong>{stats.totalConversations}</strong>
            </div>
            <div>
              <div className="muted">
                Leads ({formatRate(stats.totalLeads, stats.totalConversations)})
              </div>
              <strong>{stats.totalLeads}</strong>
            </div>
            <div>
              <div className="muted">
                Sales ({formatRate(stats.totalSales, stats.totalConversations)})
              </div>
              <strong>{stats.totalSales}</strong>
            </div>
          </div>
        </div>
      )}

      <h3>Recent leads</h3>
      {leads.length === 0 && (
        <p className="muted">No conversations marked as a lead or sale yet.</p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Status</th>
            <th>Note</th>
            <th>Marked</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.userId}>
              <td>
                <Link to={`/conversations/${encodeURIComponent(lead.userId)}`}>{lead.userId}</Link>
              </td>
              <td>
                <span className={`badge badge-${lead.status}`}>{lead.status}</span>
              </td>
              <td className="truncate">{lead.note || "—"}</td>
              <td>{new Date(lead.markedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
