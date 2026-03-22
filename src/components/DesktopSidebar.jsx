import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { C } from "../styles/theme";
import { supabase } from "../lib/supabase.js";

const K = {
  activeBg: "#E8F8F3",
  activeText: "#0F6E56",
  activeIcon: "#1D9E75",
  starColor: "#EF9F27",
};

const NAV_ITEMS = [
  { id: "quizzes", label: "Quizzes", icon: "monitor" },
  { id: "lessons", label: "Lessons", icon: "bookOpen" },
  { id: "vocabulary", label: "Vocabulary", icon: "languages" },
  { id: "history", label: "History", icon: "clock" },
];

const ICONS = {
  monitor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  clock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  bookOpen: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  search: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  starFilled: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#EF9F27" stroke="none">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  chatBubble: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  languages: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
    </svg>
  ),
};

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export default function DesktopSidebar({ session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [inProgressCount, setInProgressCount] = useState(0);

  // Carolina state
  const [starredSessions, setStarredSessions] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // Active detection
  const isOnCarolina = location.pathname === "/carolina";
  const activeSessionId = isOnCarolina
    ? new URLSearchParams(location.search).get("session")
    : null;

  // Fetch quiz count
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from("quiz_progress").select("quiz_id")
      .eq("user_id", session.user.id).eq("status", "in_progress")
      .then(({ data }) => { if (data) setInProgressCount(data.length); });
  }, [session?.user?.id]);

  // Fetch Carolina sessions
  const fetchSessions = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/carolina/sessions", { headers });
      if (!res.ok) return;
      const data = await res.json();
      setStarredSessions(data.filter((s) => s.starred));
      setRecentSessions(data.filter((s) => !s.starred).slice(0, 15));
    } catch {}
  }, []);

  useEffect(() => {
    if (session?.user?.id) fetchSessions();
  }, [session?.user?.id, fetchSessions]);

  // Listen for session changes from CarolinaScreen
  useEffect(() => {
    const handler = () => fetchSessions();
    window.addEventListener("carolina-sessions-changed", handler);
    return () => window.removeEventListener("carolina-sessions-changed", handler);
  }, [fetchSessions]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `/api/carolina/search?q=${encodeURIComponent(searchQuery.trim())}`,
          { headers }
        );
        if (!res.ok) return;
        const data = await res.json();
        const grouped = [];
        const seen = new Set();
        for (const r of data) {
          if (!seen.has(r.session_id)) {
            seen.add(r.session_id);
            grouped.push({
              sessionId: r.session_id,
              title: r.session_title,
              mode: r.session_mode,
              snippet:
                r.content.substring(0, 80) +
                (r.content.length > 80 ? "\u2026" : ""),
            });
          }
        }
        setSearchResults(grouped);
      } catch {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Navigation helpers
  const getActiveLearnId = () => {
    if (location.pathname === "/lessons" || location.pathname.startsWith("/lesson/")) return "lessons";
    if (location.pathname === "/vocabulary") return "vocabulary";
    if (location.pathname === "/history" || location.pathname === "/history/view") return "history";
    if (location.pathname === "/storage") return "storage";
    if (location.pathname === "/carolina" || location.pathname === "/dialog") return null;
    return "quizzes";
  };

  const handleLearnClick = (id) => {
    if (id === "lessons") navigate("/lessons");
    else if (id === "vocabulary") navigate("/vocabulary");
    else if (id === "history") navigate("/history");
    else if (id === "storage") navigate("/storage");
    else navigate("/");
  };

  const handleNewChat = () => navigate("/carolina");
  const handleSelectSession = (id) => navigate(`/carolina?session=${id}`);

  const activeLearnId = getActiveLearnId();

  const renderLearnItem = (item) => {
    const active = activeLearnId === item.id;
    return (
      <button
        key={item.id}
        onClick={() => handleLearnClick(item.id)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          padding: "8px 12px", borderRadius: 8, border: "none",
          background: active ? K.activeBg : "transparent",
          color: active ? C.accent : C.muted,
          fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700,
          cursor: "pointer", transition: "background 0.15s", textAlign: "left",
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#F0FAF8"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ display: "flex", flexShrink: 0 }}>{ICONS[item.icon]}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
      </button>
    );
  };

  const renderConversationItem = (s, isStarred) => {
    const active = activeSessionId === s.id;
    return (
      <button
        key={s.id}
        onClick={() => handleSelectSession(s.id)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "6px 8px", borderRadius: 6, border: "none",
          background: active ? K.activeBg : "transparent",
          color: active ? K.activeText : C.text,
          fontFamily: "'Nunito', sans-serif", fontSize: 12, fontWeight: 600,
          cursor: "pointer", transition: "background 0.15s",
          textAlign: "left", minWidth: 0,
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#F0FAF8"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ display: "flex", flexShrink: 0, color: isStarred ? K.starColor : (active ? K.activeIcon : C.muted) }}>
          {isStarred ? ICONS.starFilled : ICONS.chatBubble}
        </span>
        <span style={{
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {s.title || "New conversation"}
        </span>
      </button>
    );
  };

  return (
    <aside className="desktop-sidebar" style={{
      width: 220, minWidth: 220, height: "100vh", position: "fixed", top: 0, left: 0,
      background: C.card, borderRight: `0.5px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      fontFamily: "'Nunito', sans-serif", zIndex: 30,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <img src="/icons/logo.png" alt="Piñata" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>Piñata</span>
      </div>

      {/* Learn section */}
      <div style={{ padding: "0 12px", flexShrink: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", padding: "12px 12px 6px",
        }}>Learn</div>
        {NAV_ITEMS.map(renderLearnItem)}
      </div>

      {/* Divider */}
      <div style={{ margin: "8px 16px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }} />

      {/* Carolina section header + controls */}
      <div style={{ padding: "0 12px", flexShrink: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", padding: "4px 12px 6px",
        }}>Carolina</div>

        {/* New Chat button */}
        <button
          onClick={handleNewChat}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "8px 12px", borderRadius: 8, border: "none",
            background: K.activeBg,
            color: K.activeText,
            fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700,
            cursor: "pointer", transition: "background 0.15s", textAlign: "left",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#D4F0EB"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = K.activeBg; }}
        >
          <span style={{ display: "flex", flexShrink: 0, color: K.activeIcon }}>{ICONS.plus}</span>
          <span>New chat</span>
        </button>

        {/* Search bar */}
        <div style={{ padding: "6px 0 6px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#F5F7F6", borderRadius: 8,
            padding: "6px 10px", border: `1px solid ${C.border}`,
          }}>
            <span style={{ display: "flex", flexShrink: 0, color: C.muted }}>{ICONS.search}</span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 12, fontFamily: "'Nunito', sans-serif", fontWeight: 600,
                color: C.text, minWidth: 0,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 0, display: "flex", color: C.muted,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable: Search Results OR Starred + Recent */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px", minHeight: 0 }}>
        {searchQuery.trim() ? (
          <div>
            {searchResults.length > 0 ? (
              searchResults.map((r) => (
                <button
                  key={r.sessionId}
                  onClick={() => { handleSelectSession(r.sessionId); setSearchQuery(""); }}
                  style={{
                    display: "flex", flexDirection: "column", gap: 2, width: "100%",
                    padding: "8px 8px", borderRadius: 6, border: "none",
                    background: "transparent", cursor: "pointer",
                    fontFamily: "'Nunito', sans-serif", textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#F0FAF8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.title || "Untitled"}
                  </span>
                  <span style={{
                    fontSize: 11, color: C.muted, fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.snippet}
                  </span>
                </button>
              ))
            ) : (
              <div style={{
                padding: "16px 8px", textAlign: "center",
                fontSize: 12, color: C.muted, fontWeight: 600,
              }}>
                No results
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Starred */}
            {starredSessions.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: C.muted,
                  padding: "4px 8px 2px",
                }}>Starred</div>
                {starredSessions.map((s) => renderConversationItem(s, true))}
              </div>
            )}

            {/* Recent */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: C.muted,
                padding: "4px 8px 2px",
              }}>Recent</div>
              {recentSessions.length > 0 ? (
                recentSessions.map((s) => renderConversationItem(s, false))
              ) : (
                <div style={{
                  padding: "12px 8px", fontSize: 12, color: C.muted, fontWeight: 600,
                }}>
                  No conversations yet
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom section */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px", flexShrink: 0 }}>
        {renderLearnItem({ id: "storage", label: "Offline Storage", icon: "settings" })}

        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginTop: 4,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%", background: C.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 14, fontWeight: 800,
          }}>I</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Iulian</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
              Unit 1 {"\u00b7"} {inProgressCount} lesson{inProgressCount !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
