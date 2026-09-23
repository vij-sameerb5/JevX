// JevX site: copy buttons + the terminal "recordings" (rendered at rest, replayable).
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
  const LOGO = ["   ███  █████  ██   ██  ██   ██", "    ██▓ ██▓▓▓▓ ██▓  ██▓  ██ ██▓▓", "    ██▓ ████    ██ ██▓▓   ███▓▓", "██  ██▓ ██▓▓▓   ██▓██▓   ██▓██", " ████▓▓ █████    ███▓▓  ██▓▓ ██", "  ▓▓▓▓   ▓▓▓▓▓    ▓▓▓    ▓▓   ▓▓"]
    .map((row) => L("   " + [...row].map((ch) => (ch === "█" ? o(ch) : ch === "▓" ? `<span style="color:#6e3522">${ch}</span>` : ch)).join("")));

  const REC = {
    first: {
      cap: "First run on a new machine: the JEVX welcome, then the run itself. Later runs show a one-line banner.",
      lines: [C("npx jevx --dry-run"), L(""), ...LOGO, L(""), L("   ", `<span class="o b">JEVX</span>`, d(" · "), "Find where Jev fits in your codebase."), L(d("   v0.4.0 · preview first: jevx --dry-run · all commands: jevx --help")), L(""),
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
      cap: "Real scorecard from the same run: three independent opinions, averaged. 68% is under the 70% bar, so it is previewed, not written.",
      lines: [...box("#1  pay()  app/checkout/page.tsx:239  · found by AI", [
        `Decides   Classify a caught payment exception into a failure kind.`,
        `Why Jev   Wallet and RPC errors are free text that varies by provider;`,
        `          regexes on a few English phrases mislabel them.`, "",
        `AI        ${bar(0.61)}  61%`, `TypeSafe  ${bar(0.76)}  76%`, `Patterns  ${bar(0.69)}  69%`, d("──────────────────────────────"),
        `<span class="b">JEV FIT   68%  POSSIBLE</span>  ${o("→ preview · needs --min-fit 68")}`,
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
        ...box("JEVX RESULT", [`${g("2")} changed  ${d("(fit ≥ your 65%)")}`, `${y("1")} left as is  ${d("(weak, unsure, or not safe to change)")}`, `Checks after: tests ${g("pass")} · typecheck ${g("pass")}`, `Added @typesafe-ai/sdk to package.json`, "", `See every change in red/green: VS Code / Cursor → Source Control`, `Undo everything: ${o("npx jevx undo")}`]),
        L(d("  14 AI call(s) · 96,210 in + 18,400 out tokens · ≈ $0.30 · 142s"))]
    },
    mcp: {
      cap: "Claude Code with JevX as MCP tools (illustrative session). The editor's AI does the reading with its own tokens; no JevX key needed.",
      lines: [C("jevx mcp install"), L("  ", g("✓"), " Claude Code — added for every project"), L("  ", g("✓"), " Cursor — added for every project"), L(""), C("claude"),
        L(o("> "), "use jevx to find where Jev fits in this repo"), L(""), L(o("⏺"), " jevx - jevx_guide ", d("(MCP)")), L(o("⏺"), " jevx - jevx_scan ", d("(MCP)")), L(d("  ⎿ 53 files · 18 candidates · READING ORDER: app/api/…, lib/…, app/checkout/…")),
        L(o("⏺"), " jevx - jevx_read ", d("(MCP)(id: \"file:app/checkout/page.tsx\")")), L(o("⏺"), " jevx - jevx_scorecard ", d("(MCP)(file: \"app/checkout/page.tsx\", start_line: 236 …)")), L(d("  ⎿ average ████████░░ 72%  🟢 STRONG_FIT")),
        L(o("⏺"), " Update(app/checkout/page.tsx)"), L(d("  ⎿ Updated with 18 additions and 6 removals")), L(o("⏺"), " Bash(npm test)"), L(d("  ⎿ ✓ 42 passed")), L(""),
        L("  Changed 1 spot (checkout error classification, 72%). Left countryImage (49%)"), L("  and the airport-code fallback (45%) alone — see .jevx/report.html.")]
    }
  };

  const tabs = [...document.querySelectorAll(".tabs button")];
  const cap = document.getElementById("term-cap");
  let timer = null;
  const render = (rec, typed = false) => {
    clearTimeout(timer);
    screen.innerHTML = "";
    cap.textContent = rec.cap;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!typed || reduce) {
      screen.innerHTML = rec.lines.map(([k, h]) => (k === "cmd" ? `${o("$")} ${e(h)}` : h)).join("\n");
      return;
    }
    let i = 0;
    const next = () => {
      if (i >= rec.lines.length) { screen.insertAdjacentHTML("beforeend", "\n" + '<span class="cur"> </span>'); return; }
      const [kind, h] = rec.lines[i++];
      if (kind === "cmd") {
        const line = document.createElement("span");
        line.innerHTML = (i > 1 ? "\n" : "") + o("$") + " ";
        screen.appendChild(line);
        let c = 0;
        const type = () => {
          if (c < h.length) { line.append(h[c++]); timer = setTimeout(type, 28); }
          else timer = setTimeout(next, 380);
        };
        type();
      } else {
        screen.insertAdjacentHTML("beforeend", (i > 1 ? "\n" : "") + h);
        screen.scrollTop = screen.scrollHeight;
        timer = setTimeout(next, 55);
      }
    };
    next();
  };
  const select = (btn, typed) => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === btn)));
    render(REC[btn.dataset.rec], typed);
  };
  tabs.forEach((t) => t.addEventListener("click", () => select(t, true)));
  document.getElementById("replay")?.addEventListener("click", () => select(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0], true));
  select(tabs[0], false); // at rest: fully rendered
})();
