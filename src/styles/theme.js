export const C = {
  bg: "#F0FAF8", card: "#FFFFFF", accent: "#00B4A0", accentLight: "#E0F5F1",
  accentHover: "#008F7E", text: "#1A2F2B", muted: "#5E8078", success: "#00C48C",
  successLight: "#E0F8F0", error: "#FF6584", errorLight: "#FFF0F3",
  border: "#D4F0EB", inputBg: "#F0FAF8", overlay: "rgba(26, 47, 43, 0.45)",
};

export const injectStyles = () => {
  if (document.getElementById("sq-styles")) return;
  const s = document.createElement("style");
  s.id = "sq-styles";
  s.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F0FAF8; font-family: 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif; color: #1A2F2B; -webkit-font-smoothing: antialiased; padding-bottom: env(safe-area-inset-bottom, 0); overflow-x: hidden; }
    h1, h2, h3, h4 { font-family: 'Nunito', sans-serif; font-weight: 800; }
    input[type="text"], textarea { font-family: 'Nunito', sans-serif; }
    ::placeholder { color: #B0E0D8; }
    .fade-in { animation: fadeIn 0.4s ease-out both; }
    .slide-in-right { animation: slideInRight 0.3s ease-out both; }
    .slide-in-left { animation: slideInLeft 0.3s ease-out both; }
    .slide-up { animation: slideUp 0.3s ease-out both; }
    .score-anim { animation: countUp 0.6s 0.5s ease-out both; }
    .skeleton { background: linear-gradient(90deg, #D4F0EB 25%, #E8F7F4 50%, #D4F0EB 75%); background-size: 600px 100%; animation: shimmer 1.8s infinite ease-in-out; border-radius: 8px; }
    .skeleton-glow { animation: skeletonGlow 2s infinite ease-in-out; }
    @keyframes skeletonGlow { 0%, 100% { box-shadow: 0 0 8px rgba(0, 180, 160, 0.08), 0 1px 4px rgba(0,60,50,0.06); } 50% { box-shadow: 0 0 20px rgba(0, 180, 160, 0.18), 0 4px 12px rgba(0,60,50,0.08); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes scoreReveal { from { stroke-dashoffset: 339.292; } }
    @keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
    @keyframes shimmer { from { background-position: -600px 0; } to { background-position: 600px 0; } }
    @keyframes confettiDrop { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(105vh) rotate(720deg); opacity: 0; } }
    @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes overlayFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes progressGrow { from { width: 0%; } }
    .safe-top { padding-top: max(16px, env(safe-area-inset-top, 16px)) !important; }
    .safe-top-fixed { top: env(safe-area-inset-top, 12px) !important; }
    .app-container { max-width: 520px; margin: 0 auto; width: 100%; }
    .app-header-inner { max-width: 520px; margin: 0 auto; }
    .quiz-grid { display: flex; flex-direction: column; gap: 12px; }
    .history-list { display: flex; flex-direction: column; gap: 10px; }
    @media (min-width: 768px) {
      .app-container { max-width: 700px; }
      .app-header-inner { max-width: 700px; }
      .quiz-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    }
    @media (min-width: 1200px) {
      .app-container { max-width: 860px; }
      .app-header-inner { max-width: 860px; }
    }
    /* Desktop sidebar layout (>=1024px) */
    .desktop-sidebar { display: none !important; }
    .desktop-in-progress-pill { display: none !important; }
    .add-quiz-btn-desktop { display: none; }
    @media (min-width: 1024px) {
      .desktop-sidebar { display: flex !important; }
      .desktop-main { margin-left: 220px; }
      .desktop-header-fixed { left: 220px !important; margin-left: 0 !important; padding-left: 40px !important; padding-right: 40px !important; }
      .mobile-tab-bar { display: none !important; }
      .app-container { max-width: 100%; padding-left: 40px !important; padding-right: 40px !important; }
      .app-header-inner { max-width: 100%; }
      .quiz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
      .desktop-in-progress-pill { display: inline-block !important; }
      .add-quiz-btn-mobile { display: none !important; }
      .add-quiz-btn-desktop { display: flex !important; }
    }
    @media (min-width: 1400px) {
      .app-container { padding-left: 60px !important; padding-right: 60px !important; }
      .desktop-header-fixed { padding-left: 60px !important; padding-right: 60px !important; }
    }
  `;
  document.head.appendChild(s);
};
