import { C } from "../styles/theme";

const NAV_ITEMS = [
  { id: "quizzes", label: "Quizzes", section: "learn", icon: "monitor" },
  { id: "history", label: "History", section: "learn", icon: "clock" },
  { id: "hablar", label: "Hablar", section: "learn", icon: "mic", badge: "beta" },
  { id: "prompts", label: "Prompts", section: "tools", icon: "file" },
  { id: "vocabulary", label: "Vocabulary", section: "tools", icon: "book", badge: "soon" },
  { id: "progress", label: "Progress", section: "tools", icon: "activity" },
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
  mic: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  file: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  book: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  activity: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

export default function DesktopSidebar({ activeTab, onTabChange, onNavigateDialog, inProgressCount }) {
  const isActive = (id) => {
    if (id === "hablar") return false; // Hablar navigates away
    return activeTab === id;
  };

  const handleClick = (id) => {
    if (id === "hablar") {
      onNavigateDialog();
      return;
    }
    if (id === "quizzes" || id === "history") {
      onTabChange(id);
      return;
    }
    // Future features — no-op
    console.log(`[Sidebar] ${id} — coming soon`);
  };

  const renderItem = (item) => {
    const active = isActive(item.id);
    return (
      <button
        key={item.id}
        onClick={() => handleClick(item.id)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          padding: "8px 12px", borderRadius: 8, border: "none",
          background: active ? "#E8F8F3" : "transparent",
          color: active ? C.accent : C.muted,
          fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700,
          cursor: "pointer", transition: "background 0.15s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#F0FAF8"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ display: "flex", flexShrink: 0 }}>{ICONS[item.icon]}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge === "beta" && (
          <span style={{
            padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 800,
            background: "#FFF3E0", color: "#E67E22",
          }}>beta</span>
        )}
        {item.badge === "soon" && (
          <span style={{
            padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 800,
            background: "#F0F0F0", color: "#999",
          }}>soon</span>
        )}
      </button>
    );
  };

  const learnItems = NAV_ITEMS.filter((i) => i.section === "learn");
  const toolItems = NAV_ITEMS.filter((i) => i.section === "tools");

  return (
    <aside className="desktop-sidebar" style={{
      width: 220, minWidth: 220, height: "100vh", position: "fixed", top: 0, left: 0,
      background: C.card, borderRight: `0.5px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      fontFamily: "'Nunito', sans-serif", zIndex: 30,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: C.accent,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>
          🪅
        </div>
        <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>Piñata</span>
      </div>

      {/* Learn section */}
      <div style={{ padding: "0 12px" }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", padding: "12px 12px 6px",
        }}>Learn</div>
        {learnItems.map(renderItem)}
      </div>

      {/* Divider */}
      <div style={{ margin: "8px 16px", borderTop: `1px solid ${C.border}` }} />

      {/* Tools section */}
      <div style={{ padding: "0 12px" }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", padding: "4px 12px 6px",
        }}>Tools</div>
        {toolItems.map(renderItem)}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom section */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px" }}>
        {/* Settings */}
        <button
          onClick={() => console.log("[Sidebar] Settings — coming soon")}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "8px 12px", borderRadius: 8, border: "none",
            background: "transparent", color: C.muted,
            fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700,
            cursor: "pointer", textAlign: "left",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#F0FAF8"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ display: "flex", flexShrink: 0 }}>{ICONS.settings}</span>
          Settings
        </button>

        {/* User profile chip */}
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
