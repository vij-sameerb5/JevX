// JevX site: copy buttons, client tabs, and the terminal "recordings" (autoplay loop, pausable).
(() => {
  // ── copy buttons ──
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-copy]");
    if (!btn) return;
    const text = btn.getAttribute("data-copy") || btn.closest(".codebox")?.querySelector("pre")?.innerText || "";
    const done = (label) => { const old = btn.textContent; btn.textContent = label; setTimeout(() => (btn.textContent = old), 1400); };
    try { await navigator.clipboard.writeText(text.trim()); done("Copied"); }
    catch {
      const pre = btn.closest(".codebox")?.querySelector("pre") || btn.previousElementSibling;
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      done("Select + ⌘C");
    }
  });

  // ── generic tab groups (the MCP client picker): [role=tablist].ctabs → panels by aria-controls ──
  document.querySelectorAll(".ctabs").forEach((list) => {
    const ts = [...list.querySelectorAll("[role=tab]")];
    const pick = (t, focus) => {
      ts.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute("aria-controls")); if (p) p.hidden = !on; });
      if (focus) t.focus();
      if (t.dataset.hash && history.replaceState) history.replaceState(null, "", "#" + t.dataset.hash);
    };
    ts.forEach((t, i) => {
      t.addEventListener("click", () => pick(t));
      t.addEventListener("keydown", (ev) => {
        const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        if (d) { ev.preventDefault(); pick(ts[(i + d + ts.length) % ts.length], true); }
      });
    });
    const fromHash = ts.find((t) => t.dataset.hash && "#" + t.dataset.hash === location.hash);
    pick(fromHash || ts.find((t) => t.getAttribute("aria-selected") === "true") || ts[0]);
    if (fromHash) list.closest("section")?.scrollIntoView();
  });

  const screen = document.getElementById("screen");
  if (!screen) return;

  // ── recordings: each line is [kind, html]; kind "cmd" is typed, others appear ──
  const e = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const o = (s) => `<span class="o">${e(s)}</span>`, d = (s) => `<span class="d">${e(s)}</span>`, g = (s) => `<span class="g">${e(s)}</span>`, r = (s) => `<span class="r">${e(s)}</span>`, y = (s) => `<span class="y">${e(s)}</span>`;
  const L = (...parts) => ["out", parts.join("")];
  const C = (s) => ["cmd", s];
  const bar = (p) => o("█".repeat(Math.round(p * 12))) + d("░".repeat(12 - Math.round(p * 12)));
  const box = (title, rows, w = 72) => {
    const top = o("╭─ ") + `<span class="o b">${e(title)}</span>` + o(" " + "─".repeat(Math.max(0, w - title.length - 4)) + "╮");
    const vis = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length;
    return [L(top), ...rows.map((h) => L(o("│ ") + h + " ".repeat(Math.max(0, w - 3 - vis(h))) + o("│"))), L(o("╰" + "─".repeat(w) + "╯"))];
  };
  // the big logo as one block (line-height 1, so the letters touch); ▓ marks the drop shadow, drawn as a dark █
  const LOGO = ["logo", `<span class="logo" aria-label="JEVX">${["   ███  █████  ██   ██  ██   ██", "    ██▓ ██▓▓▓▓ ██▓  ██▓  ██ ██▓▓", "    ██▓ ████    ██ ██▓▓   ███▓▓", "██  ██▓ ██▓▓▓   ██▓██▓   ██▓██", " ████▓▓ █████    ███▓▓  ██▓▓ ██", "  ▓▓▓▓   ▓▓▓▓▓    ▓▓▓    ▓▓   ▓▓"]
    .map((row) => "   " + [...row].map((ch) => (ch === "█" ? o(ch) : ch === "▓" ? '<span class="sh">█</span>' : ch)).join("")).join("\n")}</span>`];

  const REC = {
    first: {
      cap: "First run on a new machine: the JEVX welcome, then the run itself. Later runs show a one-line banner.",
      lines: [C("npx @vij-sameerb5/jevx --dry-run"), LOGO, L("   ", `<span class="o b">JEVX</span>`, d(" · "), "Find where Jev fits in your codebase."), L(d("   v0.4.0 · preview first: jevx --dry-run · all commands: jevx --help")), L(""),
        L(d("  Repo      "), "globalcare-ai"), L(d("  AI        "), "xAI · grok-4.6 ", d("(your key)")), L(d("  TypeSafe  "), g("✓ connected")), L(d("  Keys      from ~/Desktop/jevX/.env + your shell")), L(d("  Mode      "), "preview only — nothing is written"), L(""),
        L(d("  JevX sends xAI your source files to read (not .env files, tests, builds or node_modules), with secrets removed.")), L("  Send code to xAI for this and future runs? [Y/n] ", y("y"))]
    },
    scan: {
      cap: "Real output from a run on GlobalCare (a Next.js medical-travel app), trimmed. The AI reads every source file, logic folders first.",
      lines: [C("jevx --dry-run"), L(""), L("  ", g("✓"), " Indexed 53 files · 18 possible spot(s) ", d("(local, free)")), L("  ", o("◆"), " xAI is reading 49 file(s) in 6 part(s) ", d("~117,961 tokens")),
        L(d("    part 1/6 read · 3 spot(s) · 3 so far")), L(d("    part 2/6 read · 2 spot(s) · 5 so far")), L(d("    part 3/6 read · 5 spot(s) · 10 so far")), L(d("    part 4/6 read · 0 spot(s) · 10 so far")), L(d("    part 5/6 read · 6 spot(s) · 16 so far")), L(d("    part 6/6 read · 5 spot(s) · 21 so far")),
        L("  ", g("✓"), " xAI found 8 spot(s) worth checking"), L("  ", o("◆"), " Reading 1/8 ", d("lib/countryImages.ts:33 countryImage")), L("  ", o("◆"), " Reading 2/8 ", d("app/checkout/page.tsx:239 pay")), L("  ", o("◆"), " Reading 3/8 ", d("app/api/flights/route.ts:80 parseSerpFlights")), L("  ", o("◆"), " Reading 4/8 ", d("app/api/hotels/route.ts:87 POST")), L(d("  …")),
        L(""), L(d("  flights / hotels → left alone: “no patient fields; Google's list is already ranked”")), L(d("  refunds, escrow, payments → never proposed"))]
    },
    card: {
      cap: "A real scorecard: three independent opinions, averaged. 64% is under the 70% bar, so it is previewed, not written.",
      lines: [...box("#1  pay()  app/checkout/page.tsx:239  · found by AI", [
        `Decides   Classify a caught payment exception into a failure kind.`,
        `Why Jev   Wallet and RPC errors are free text that varies by provider;`,
        `          regexes on a few English phrases mislabel them.`, "",
        `AI        ${bar(0.61)}  61%`, `TypeSafe  ${bar(0.63)}  63%`, `Patterns  ${bar(0.69)}  69%`, d("──────────────────────────────"),
        `<span class="b">JEV FIT   64%  POSSIBLE</span>  ${o("→ preview · needs --min-fit 64")}`,
        `Jev uses  choice · “Which failure kind should the user see?”`,
        `Stays     the existing messages; Jev only picks which one.`
      ])]
    },
    diff: {
      cap: "Illustrative red/green change for that checkout spot, in the shape JevX writes: Jev picks, the old regexes stay as the fallback.",
      lines: [L(d("  app/checkout/page.tsx")), L(d("  @@ -236,11 +236,11 @@")), L("       } catch (e: unknown) {"), L("         const msg = e instanceof Error ? e.message : \"Payment failed.\";"),
        L(r("-        if (/User rejected|rejected the request|denied/i.test(msg)) {")), L(g("+        const kind = await failureKind(msg); // Jev: cancelled | timeout | funds | other")), L(g("+        if (kind === \"cancelled\") {")), L("           setError(\"You cancelled the transaction — nothing was charged.\");"),
        L(r("-        } else if (/timed out|timeout/i.test(msg)) {")), L(g("+        } else if (kind === \"timeout\") {")), L(d("         …")), L(""),
        L(d("  @@ new helper @@")), L(g("+const jev = new TypeSafeClient();")), L(g("+const FAILURE = { kind: choice(\"Which kind of payment failure is this?\", {")), L(g("+  cancelled: \"The user rejected or closed the request\", timeout: \"Sent but not confirmed in time\",")), L(g("+  funds: \"Not enough balance or gas\", other: \"Anything else\" }) };")),
        L(g("+async function failureKind(msg: string) {")), L(g("+  try { return (await jev.systemOne({ state: { error: msg }, questions: FAILURE })).answers.kind.choice; }")), L(g("+  catch { return legacyFailureKind(msg); } // the old regexes, unchanged")), L(g("+}"))]
    },
    apply: {
      cap: "Applying on the example helpdesk repo: your tests run before and after, and a change that breaks them is reverted automatically. Figures illustrative.",
      lines: [C("jevx --min-fit 65"), L("  ", g("✓"), " xAI found 3 spot(s) worth checking"), L("  ", o("◆"), " Writing the change ", d("src/routing.ts:8 routeTicket")), L("  ", y("!"), " Writing fits from 65% (below the recommended 70%). Your tests still run and `jevx undo` restores everything."),
        L("  ", o("◆"), " Applying 3 change(s) and running your checks…"), L("  ", g("✓"), " Checks before: tests ", g("pass"), " · typecheck ", g("pass")), L("  ", y("!"), " A check failed — trying the 3 change(s) one at a time"), L("  ", y("!"), " Reverted priorityOf(): tests failed"), L(""),
        ...box("JEVX RESULT", [`${g("2")} changed  ${d("(fit ≥ your 65%)")}`, `${y("1")} left as is  ${d("(weak, unsure, or not safe to change)")}`, `Checks after: tests ${g("pass")} · typecheck ${g("pass")}`, `Added @typesafe-ai/sdk to package.json`, "", `See every change in red/green: VS Code / Cursor → Source Control`, `Undo everything: ${o("npx @vij-sameerb5/jevx undo")}`]),
        L(d("  14 AI call(s) · 96,210 in + 18,400 out tokens · ≈ $0.30 · 142s"))]
    },
    mcp: {
      cap: "Claude Code with JevX as MCP tools (illustrative session). Claude does the reading with its own tokens; no xAI key needed.",
      lines: [C("npm i -g @vij-sameerb5/jevx && jevx mcp install"), L("  ", g("✓"), " Claude Code — added"), L("  ", g("✓"), " Claude Desktop — added"), L("  ", g("✓"), " Cursor — added"), L(d("  ○ Windsurf not found")), L("  ", g("✓"), " VS Code (Copilot) — added"), L(d("  ○ Gemini CLI not found")), L("  ", g("✓"), " Codex CLI — added"), L(""), C("cd ~/code/globalcare-ai && claude"),
        L(o("> "), "use jevx to find where Jev fits in this repo"), L(o("⏺"), " jevx - jevx_guide ", d("(MCP)")), L(o("⏺"), " jevx - jevx_scan ", d("(MCP)")), L(d("  ⎿ 53 files · 18 candidates · TypeSafe ✓ · READING ORDER: app/api/…, lib/…, app/checkout/…")),
        L(o("⏺"), " jevx - jevx_read ", d("(MCP)(ids: [\"file:app/checkout/page.tsx\", …])")), L(o("⏺"), " jevx - jevx_scorecard ", d("(MCP)(file: \"app/checkout/page.tsx\", start_line: 236 …)")), L(d("  ⎿ patterns 69% · AI 61% · TypeSafe 63% → 64% POSSIBLE")), L(o("⏺"), " jevx - jevx_preview_change ", d("(MCP)")), L(d("  ⎿ red/green diff saved · nothing edited")), L(""),
        L("  Found 1 possible fit: checkout error classification (64%). It's under 70%,"), L("  so I only previewed it. Left countryImage (49%) and the airport-code fallback"), L("  alone. Say \"use Jev where the fit is at least 60%\" to write it. See .jevx/report.html")]
    },
    desktop: {
      cap: "Claude Desktop with the one-click jevx.mcpb extension (illustrative). It can't edit files itself, so jevx_apply makes the change: backup, your tests, auto-revert.",
      lines: [L(d("  Claude Desktop → Settings → Extensions → Install extension… → jevx-0.4.0.mcpb")), L(d("  Project folder   "), "~/code/globalcare-ai"), L(d("  TypeSafe key     "), "••••••••••••  ", d("(kept by Claude Desktop, never by JevX)")), L("  ", g("✓"), " JevX 0.4.0 enabled · 11 tools"), L(""),
        L(o("> "), "Use JevX on my project. Preview only — don't change anything yet."), L(o("⏺"), " jevx_guide  ", d("read-only")), L(o("⏺"), " jevx_scan  ", d("read-only · ~/code/globalcare-ai · 53 files")), L(o("⏺"), " jevx_read ×6  ", d("read-only")), L(o("⏺"), " jevx_scorecard  ", d("writes .jevx/ · 64% POSSIBLE")), L(o("⏺"), " jevx_preview_change  ", d("writes .jevx/ · diff only")), L(o("⏺"), " jevx_report  ", d("writes .jevx/report.html")), L(""),
        L("  1 possible fit (checkout errors, 64%) — previewed, not written."), L(""),
        L(o("> "), "Use Jev where the fit is at least 60%."), L(o("⏺"), " jevx_apply  ", y("changes files")), L(d("  ⎿ backup saved · tests "), g("pass"), d(" before · "), g("pass"), d(" after · 1 file changed")), L(""),
        L("  Done: app/checkout/page.tsx now asks Jev, with the old regexes as the fallback."), L("  Say \"undo the JevX change\" any time (jevx_undo).")]
    }
  };

  // ── the player: plays every tab in turn, typed, and loops. Pause any time; clicking a tab jumps there. ──
  const tabs = [...document.querySelectorAll(".tabs button")];
  const cap = document.getElementById("term-cap");
  const btn = document.getElementById("replay");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  tabs.forEach((t) => t.insertAdjacentHTML("beforeend", '<span class="prog" aria-hidden="true"><i></i></span>'));
  const bars = tabs.map((t) => t.querySelector(".prog i"));

  let cur = 0, timer = null, pending = null, userPaused = reduce, inView = false, started = false;
  const playing = () => !userPaused && inView && !document.hidden;
  // every step goes through here, so pausing just holds the next step and resuming runs it
  const later = (fn, ms) => { clearTimeout(timer); pending = fn; if (playing()) timer = setTimeout(() => { pending = null; fn(); }, ms); };
  const resume = () => { if (pending && playing()) { const fn = pending; pending = null; timer = setTimeout(fn, 250); } };
  const halt = () => clearTimeout(timer);

  const sep = (prev, kind) => (prev && prev !== "logo" && kind !== "logo" ? "\n" : "");
  const at = (k, h) => (k === "cmd" ? `${o("$")} ${e(h)}` : h);
  const setBar = (i, frac, ms = 0) => { const b = bars[i]; if (!b) return; b.style.transition = ms ? `width ${ms}ms linear` : "none"; b.style.width = `${Math.round(frac * 100)}%`; };
  const holdFor = (rec) => Math.min(7000, Math.max(3500, 1800 + 70 * rec.lines.length));

  const show = (i) => {
    cur = i;
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(j === i)); setBar(j, j < i ? 1 : 0); });
    const strip = tabs[i].parentElement, tr = tabs[i].getBoundingClientRect(), sr = strip.getBoundingClientRect();
    strip.scrollTo({ left: strip.scrollLeft + tr.left - sr.left - (sr.width - tr.width) / 2, behavior: reduce ? "auto" : "smooth" }); // sideways only, never the page
    cap.textContent = REC[tabs[i].dataset.rec].cap;
  };
  const atRest = (i) => {
    show(i);
    const rec = REC[tabs[i].dataset.rec];
    let prev = null;
    screen.innerHTML = rec.lines.map(([k, h]) => { const s = sep(prev, k) + at(k, h); prev = k; return s; }).join("");
    screen.scrollTop = 0;
  };
  const advance = () => play((cur + 1) % tabs.length);
  const hold = (i) => { const ms = holdFor(REC[tabs[i].dataset.rec]); setBar(i, 1, ms); later(advance, ms); };

  function play(i) {
    halt();
    if (reduce) { atRest(i); setBar(i, 0); hold(i); return; }
    show(i);
    screen.innerHTML = "";
    const rec = REC[tabs[i].dataset.rec];
    const n = rec.lines.length;
    let k = 0, prev = null;
    const next = () => {
      setBar(i, 0.8 * (k / n));
      if (k >= n) { screen.insertAdjacentHTML("beforeend", '\n<span class="cur"> </span>'); hold(i); return; }
      const [kind, h] = rec.lines[k++];
      if (kind === "cmd") {
        const line = document.createElement("span");
        line.innerHTML = sep(prev, kind) + o("$") + " ";
        screen.appendChild(line);
        let c = 0;
        const type = () => (c < h.length ? (line.append(h[c++]), later(type, 26)) : later(next, 420));
        type();
      } else {
        screen.insertAdjacentHTML("beforeend", sep(prev, kind) + h);
        screen.scrollTop = screen.scrollHeight;
        later(next, kind === "logo" ? 400 : 60);
      }
      prev = kind;
    };
    next();
  }

  const label = () => { btn.textContent = userPaused ? "▶ play" : "❚❚ pause"; btn.setAttribute("aria-pressed", String(userPaused)); btn.setAttribute("aria-label", userPaused ? "Play the recordings" : "Pause the recordings"); };
  const start = () => { if (started) return resume(); started = true; hold(0); };
  btn?.addEventListener("click", () => {
    userPaused = !userPaused;
    label();
    if (userPaused) { halt(); const b = bars[cur]; if (b) { b.style.width = getComputedStyle(b).width; b.style.transition = "none"; } }
    else if (!started) start();
    else if (pending) resume();
    else advance();
  });
  tabs.forEach((t, i) => t.addEventListener("click", () => { started = true; if (userPaused) { halt(); pending = null; atRest(i); } else play(i); }));
  document.addEventListener("visibilitychange", () => (document.hidden ? halt() : resume()));
  const term = screen.closest(".term");
  if ("IntersectionObserver" in window && term) {
    new IntersectionObserver(([en]) => { inView = en.isIntersecting; if (!inView) halt(); else start(); }, { threshold: 0.35 }).observe(term);
  } else { inView = true; }
  label();
  atRest(0); // the first frame is complete at once (no-JS-like), then the loop takes over while it's on screen
  if (inView) start();
})();
