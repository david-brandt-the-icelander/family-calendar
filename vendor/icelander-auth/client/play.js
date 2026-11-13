// play.js: the games' side of play time and tips (icelander.net docs/accounts.md, "Tips"). The games hub serves
// it at icelander.net/games/play.js; a game's page loads it with its id:
//   <script src="/games/play.js" data-game="rally" defer></script>
// and its game-over screen may call, at game over only:
//   window.icelanderTips?.gameOver(element)
//
// Once a minute, while the tab is visible and the player has touched a key, the mouse, the screen or a gamepad
// in the last two minutes, it tells the hub a minute was played (POST /games/api/play/heartbeat). gameOver asks the
// hub whether to suggest a tip (GET /games/api/tips) and, if so, shows a line or a card in `element`: always with a
// way to dismiss it, never during play. Nothing is shown to supporters or to anyone invited.
(() => {
  const script = document.currentScript;
  const game = script?.dataset.game ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(game)) return;
  const IDLE_MS = 2 * 60 * 1000;
  let lastInput = 0;
  const touched = () => {
    lastInput = Date.now();
  };
  for (const type of ["keydown", "pointerdown", "touchstart", "wheel"]) addEventListener(type, touched, { passive: true, capture: true });
  setInterval(() => {
    for (const pad of navigator.getGamepads?.() ?? []) if (pad?.buttons.some((b) => b.pressed) || pad?.axes.some((a) => Math.abs(a) > 0.3)) touched();
  }, 2000);
  setInterval(() => {
    if (document.visibilityState !== "visible" || Date.now() - lastInput > IDLE_MS) return;
    fetch("/games/api/play/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game }), credentials: "same-origin" }).catch(() => {});
  }, 60_000);

  const el = (tag, style, text) => {
    const e = document.createElement(tag);
    Object.assign(e.style, style);
    if (text) e.textContent = text;
    return e;
  };

  async function gameOver(where) {
    if (!(where instanceof Element)) return;
    let tip;
    try {
      tip = await (await fetch("/games/api/tips", { credentials: "same-origin" })).json();
    } catch {
      return;
    }
    if (!tip || (tip.show !== "line" && tip.show !== "card") || !/^https:\/\/ko-fi\.com\//.test(tip.url)) return;
    const box = el("div", { margin: "1rem auto", maxWidth: "26rem", padding: tip.show === "card" ? "1rem 1.2rem" : ".4rem .6rem", borderRadius: ".7rem",
      background: "rgba(255,255,255,.08)", color: "inherit", font: "inherit", fontSize: ".9rem", lineHeight: "1.45", textAlign: "center" });
    box.setAttribute("role", "note");
    box.append(el("p", { margin: "0 0 .6rem" }, tip.show === "card"
      ? "Enjoying the games? They're free, made by one person. If you'd like to, you can buy me a coffee."
      : "Free games, made by one person. A tip is always welcome, never needed."));
    const row = el("div", { display: "flex", gap: ".5rem", justifyContent: "center", flexWrap: "wrap" });
    for (const p of tip.prices ?? []) {
      const a = el("a", { padding: ".35rem .7rem", borderRadius: ".5rem", border: "1px solid currentColor", color: "inherit", textDecoration: "none" }, `${p.label} ($${p.amount})`);
      a.href = tip.url;
      a.target = "_blank";
      a.rel = "noopener";
      row.append(a);
    }
    const no = el("button", { padding: ".35rem .7rem", borderRadius: ".5rem", border: "0", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer", textDecoration: "underline" }, "Not now");
    no.type = "button";
    no.addEventListener("click", () => box.remove());
    row.append(no);
    box.append(row);
    where.append(box);
    fetch("/games/api/tips/shown", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }

  window.icelanderTips = { gameOver };
})();
