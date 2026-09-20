import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { getToken, setUnauthorizedHandler } from "./api/client";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Posts from "./pages/Posts";
import Conversations from "./pages/Conversations";
import ConversationDetail from "./pages/ConversationDetail";
import Knowledge from "./pages/Knowledge";
import Analytics from "./pages/Analytics";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** Sends the user back to the login page whenever the API rejects their session token (e.g. a 12h token that has expired). */
function UnauthorizedRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    setUnauthorizedHandler(() => navigate("/login", { replace: true }));
    return () => setUnauthorizedHandler(null);
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <>
      <UnauthorizedRedirect />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/posts" replace />} />
                  <Route path="/posts" element={<Posts />} />
                  <Route path="/conversations" element={<Conversations />} />
                  <Route path="/conversations/:userId" element={<ConversationDetail />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                </Routes>
              </Layout>
            </RequireAuth>
          }
        />
      </Routes>
    </>
  );
}
