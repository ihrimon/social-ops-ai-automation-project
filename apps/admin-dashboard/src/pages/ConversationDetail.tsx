import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getConversation,
  pauseConversation,
  resumeConversation,
  setConversationLead,
  type ConversationDetail as ConversationDetailData,
  type LeadRequirements,
  type LeadStatus,
} from "../api/client";

const REQUIREMENT_LABELS: Record<keyof LeadRequirements, string> = {
  contactName: "Name",
  contactPhone: "Phone",
  businessType: "Business type",
  hasExistingWebsite: "Existing website?",
  pageCount: "Pages needed",
  features: "Features",
  deadline: "Deadline",
  referenceWebsite: "Reference site",
  budgetHint: "Budget hint",
};

function RequirementsCard({ requirements }: { requirements: LeadRequirements | null }) {
  const rows = (Object.keys(REQUIREMENT_LABELS) as (keyof LeadRequirements)[])
    .map((key) => ({ key, label: REQUIREMENT_LABELS[key], value: requirements?.[key] }))
    .filter(({ value }) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-header">
        <strong>Auto-detected requirements</strong>
        <span className="muted">from conversation, AI-extracted</span>
      </div>
      <table style={{ width: "100%" }}>
        <tbody>
          {rows.map(({ key, label, value }) => (
            <tr key={key}>
              <td className="muted" style={{ paddingRight: "1rem", verticalAlign: "top" }}>
                {label}
              </td>
              <td>{Array.isArray(value) ? value.join(", ") : value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ConversationDetail() {
  const { userId = "" } = useParams();
  const [data, setData] = useState<ConversationDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    const result = await getConversation(userId);
    setData(result);
    setNote(result.leadNote ?? "");
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function handlePause() {
    await pauseConversation(userId);
    await load();
  }

  async function handleResume() {
    await resumeConversation(userId);
    await load();
  }

  async function handleLeadChange(status: LeadStatus) {
    await setConversationLead(userId, status, note || undefined);
    await load();
  }

  if (loading || !data) return <p>Loading...</p>;

  return (
    <div>
      <p>
        <Link to="/conversations">&larr; Back to conversations</Link>
      </p>
      <div className="card-header">
        <h2>{userId}</h2>
        {data.paused ? (
          <button onClick={handleResume}>Resume AI replies</button>
        ) : (
          <button onClick={handlePause}>Pause AI (hand off to human)</button>
        )}
      </div>
      {data.paused && (
        <p className="muted">
          AI replies paused
          {data.pausedUntil ? ` until ${new Date(data.pausedUntil).toLocaleString()}` : ""}.
        </p>
      )}

      <div className="card">
        <div className="card-header">
          <strong>Lead status</strong>
          {data.leadStatus !== "none" && (
            <span className={`badge badge-${data.leadStatus}`}>{data.leadStatus}</span>
          )}
        </div>
        <input
          placeholder="Optional note (budget, requirements, etc.)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ width: "100%", margin: "0.5rem 0" }}
        />
        <div className="card-actions">
          <button onClick={() => handleLeadChange("lead")} disabled={data.leadStatus === "lead"}>
            Mark as lead
          </button>
          <button onClick={() => handleLeadChange("sale")} disabled={data.leadStatus === "sale"}>
            Mark as sale
          </button>
          {data.leadStatus !== "none" && (
            <button className="link-button" onClick={() => handleLeadChange("none")}>
              Clear
            </button>
          )}
        </div>
      </div>

      <RequirementsCard requirements={data.requirements} />

      <div className="thread">
        {data.messages.map((message, index) => (
          <div
            key={index}
            className={`bubble bubble-${message.role}${message.isHumanAdmin ? " bubble-admin" : ""}`}
          >
            <div className="bubble-meta">
              {message.isHumanAdmin ? "human admin" : message.role} ·{" "}
              {new Date(message.createdAt).toLocaleString()}
            </div>
            <div>{message.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
