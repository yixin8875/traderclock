/* 在任何 React/CSS 之前套用主题，避免启动瞬间闪白。 */
(function () {
  try {
    var raw = localStorage.getItem("tradeclock.ui");
    var p = raw ? JSON.parse(raw) : {};
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = p.theme || "light";
    var dark = theme === "dark" || (theme === "system" && systemDark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.density = p.density === "compact" ? "compact" : "comfortable";
    window.__UI_PREFS__ = p;
  } catch (e) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.density = "comfortable";
  }
})();
