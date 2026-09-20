import { useEffect, useState } from "react";
import {
  approvePost,
  describeApiError,
  listPendingPosts,
  listPosts,
  rejectPost,
  type PostLog,
} from "../api/client";

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export default function Posts() {
  const [pending, setPending] = useState<PostLog[]>([]);
  const [recent, setRecent] = useState<PostLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [pendingRes, recentRes] = await Promise.all([listPendingPosts(), listPosts()]);
      setPending(pendingRes.posts);
      setRecent(recentRes.posts);
    } catch (error) {
      setLoadError(describeApiError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApprove(id: string) {
    setActionError(null);
    try {
      const result = await approvePost(id);
      if (!result.ok) {
        setActionError(result.error || "Approve failed.");
      }
    } catch (error) {
      setActionError(describeApiError(error));
    }
    await load();
  }

  async function handleReject(id: string) {
    setActionError(null);
    try {
      const result = await rejectPost(id);
      if (!result.ok) {
        setActionError(result.error || "Reject failed.");
      }
    } catch (error) {
      setActionError(describeApiError(error));
    }
    await load();
  }

  if (loading) return <p>Loading...</p>;
  if (loadError) return <p className="error-text">{loadError}</p>;

  return (
    <div>
      <h2>Pending approval</h2>
      {actionError && <p className="error-text">{actionError}</p>}
      {pending.length === 0 && <p className="muted">No drafts are waiting for a decision.</p>}
      {pending.map((post) => (
        <div className="card" key={post._id}>
          <div className="card-header">
            <strong>{post.topic || "Untitled"}</strong>
            <StatusBadge status={post.status} />
          </div>
          {post.imageUrl && <img className="post-image" src={post.imageUrl} alt="" />}
          <p className="article-text">{post.article}</p>
          {post.approveError && (
            <p className="error-text">Last attempt failed: {post.approveError}</p>
          )}
          <div className="card-actions">
            <button onClick={() => handleApprove(post._id)}>Approve &amp; publish</button>
            <button className="danger" onClick={() => handleReject(post._id)}>
              Reject
            </button>
          </div>
        </div>
      ))}

      <h2>Recent posts</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Topic</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((post) => (
            <tr key={post._id}>
              <td>{post.postDateKey || new Date(post.createdAt).toLocaleDateString()}</td>
              <td>{post.topic || "—"}</td>
              <td>
                <StatusBadge status={post.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
