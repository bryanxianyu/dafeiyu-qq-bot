// 人格卡 + 记忆 两个页面
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const DAY = 86400000;

  // ================= 人格卡 =================
  let cards = null;
  let current = null;
  let dirty = false;

  async function loadCards() {
    cards = await api("/api/mind/cards");
    if (!cards.cards.some((c) => c.id === current)) current = cards.defaultCard;
    dirty = false;
    renderCards();
  }

  const curCard = () => cards.cards.find((c) => c.id === current) ?? cards.cards[0];
  const markDirty = () => {
    dirty = true;
    $("#cardsSave").textContent = "保存修改";
    $("#cardsSave").classList.add("pulse");
  };

  function renderCards() {
    $("#cardsSave").textContent = dirty ? "保存修改" : "保存";
    $("#cardsSave").classList.toggle("pulse", dirty);
    const list = $("#cardList");
    list.innerHTML = "";
    for (const c of cards.cards) {
      const a = document.createElement("a");
      a.className = `card-item${c.id === current ? " on" : ""}`;
      a.innerHTML = `<b>${esc(c.name)}</b>${c.id === cards.defaultCard ? '<span class="tag">默认</span>' : ""}<small>${(c.absolute ?? []).length} 条绝对记忆</small>`;
      a.onclick = () => {
        current = c.id;
        renderCards();
      };
      list.appendChild(a);
    }
    const c = curCard();
    for (const el of $$("[data-card]")) {
      el.value = c[el.dataset.card] ?? "";
      el.oninput = () => {
        c[el.dataset.card] = el.value;
        markDirty();
        if (el.dataset.card === "name") $(".card-item.on b").textContent = el.value;
        sizeHint();
      };
    }
    const abs = $("#absList");
    abs.innerHTML = "";
    (c.absolute ?? []).forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "abs-row";
      row.innerHTML = `<input class="grow" value="${esc(a.text)}" placeholder="例：主人叫阿青，QQ 10001"><input class="scope" value="${esc(a.scope)}" placeholder="适用：全部"><button class="ghost danger">删除</button>`;
      const [text, scope] = $$("input", row);
      text.oninput = () => ((a.text = text.value), markDirty(), sizeHint());
      scope.oninput = () => ((a.scope = scope.value.trim()), markDirty());
      $("button", row).onclick = () => {
        c.absolute.splice(i, 1);
        markDirty();
        renderCards();
      };
      abs.appendChild(row);
    });
    $("#cardDelete").disabled = cards.cards.length <= 1;
    $$("#cardEditor textarea").forEach(autosize);
    sizeHint();
  }

  /** 文本框跟着内容长高，整张卡一眼看全 */
  function autosize(el) {
    if (!el.offsetParent) return; // 页面没显示时量不出高度
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  $("#cardEditor").addEventListener("input", (e) => e.target.tagName === "TEXTAREA" && autosize(e.target));

  function sizeHint() {
    const c = curCard();
    const n = ["identity", "personality", "style", "rules", "examples"].reduce((s, k) => s + (c[k]?.length ?? 0), 0) + (c.absolute ?? []).reduce((s, a) => s + a.text.length, 0);
    $("#cardSize").textContent = `这张卡约 ${n} 字（≈ ${Math.round(n * 0.7)} tokens），每句话都会带上。${n > 2500 ? "偏长了，建议精简到 2000 字以内。" : ""}`;
  }

  $("#cardAdd").onclick = () => {
    const id = Math.random().toString(16).slice(2, 12);
    cards.cards.push({ id, name: "新人格", identity: "", personality: "", style: "", rules: "", examples: "", absolute: [] });
    current = id;
    markDirty();
    renderCards();
  };
  $("#cardDelete").onclick = () => {
    if (!confirm(`删除人格卡「${curCard().name}」？`)) return;
    cards.cards = cards.cards.filter((c) => c.id !== current);
    current = cards.cards[0].id;
    markDirty();
    renderCards();
  };
  $("#absAdd").onclick = () => {
    (curCard().absolute ??= []).push({ text: "", scope: "" });
    markDirty();
    renderCards();
    $$("#absList .abs-row input.grow").at(-1)?.focus();
  };
  $("#cardsSave").onclick = async () => {
    // 只交卡片本身；哪个聊天用哪张卡由首页管，不在这里覆盖
    cards = await api("/api/mind/cards", { cards: cards.cards });
    dirty = false;
    renderCards();
    toast("✅ 已保存，下一句话起生效");
  };
  async function preview() {
    const chat = $("#previewChat").value.trim() || (state?.config.owners[0] ? `private:${state.config.owners[0]}` : "private:0");
    $("#previewChat").value = chat;
    const r = await api("/api/mind/preview", { chat, text: "" });
    $("#previewBox").textContent = r.anchor;
  }
  $("#cardPreviewBtn").onclick = async () => {
    if (dirty) toast("有未保存的修改，预览的是已保存的版本");
    $("#cardPreview").classList.remove("hidden");
    await preview();
    $("#cardPreview").scrollIntoView({ behavior: "smooth" });
  };
  $("#previewChat").onchange = preview;
  $("#cardPreviewClose").onclick = () => $("#cardPreview").classList.add("hidden");
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  // ================= 记忆 =================
  let mem = null;
  let selected = null;

  const scopeLabel = (s) => {
    const [kind, a, b] = s.split(":");
    if (kind === "user") return `👤 ${a}`;
    return a === "group" ? `👥 群 ${b}` : `💬 私聊 ${b}`;
  };
  const dur = (ms) => {
    const d = Math.abs(ms) / DAY;
    if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))} 分钟`;
    if (d < 1) return `${Math.round(d * 24)} 小时`;
    if (d < 60) return `${d.toFixed(d < 10 ? 1 : 0)} 天`;
    return `${Math.round(d / 30)} 个月`;
  };
  const rColor = (r) => (r >= 0.7 ? "var(--green)" : r >= 0.4 ? "var(--amber)" : "var(--red)");

  async function loadMemories() {
    mem = await api("/api/mind/memories");
    renderMemories();
  }

  function renderMemories() {
    const s = mem.stats;
    $("#memTiles").innerHTML = [
      ["长期记忆", s.total],
      ["平均清晰度", `${Math.round(s.avgR * 100)}%`],
      ["待确认", mem.pending.length],
      ["待整理对话", `${s.buffered} 轮`],
      ["累计整理", `${s.extractions} 次 / ${(s.extractedTokens / 1000).toFixed(1)}k tokens`],
      ["累计想起", `${s.recalls} 次`]
    ].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join("");

    // 待确认
    $("#pendingPanel").classList.toggle("hidden", mem.pending.length === 0);
    const pl = $("#pendingList");
    pl.innerHTML = "";
    for (const p of mem.pending) {
      const row = document.createElement("div");
      row.className = "abs-row";
      row.innerHTML = `<input class="grow" value="${esc(p.text)}"><span class="hint inline">来自 ${esc(p.from)}</span><button>确认固化</button><button class="ghost">忽略</button>`;
      const [ok, no] = $$("button", row);
      ok.onclick = async () => {
        await api(`/api/mind/pending/${p.id}/approve`, { text: $("input", row).value });
        toast("已写入人格卡的绝对记忆");
        loadMemories();
      };
      no.onclick = async () => {
        await api(`/api/mind/pending/${p.id}/reject`, {});
        loadMemories();
      };
      pl.appendChild(row);
    }

    // 范围筛选
    const scopes = [...new Set(mem.memories.map((m) => m.scope))];
    const sel = $("#memScope");
    const keep = sel.value;
    sel.innerHTML = `<option value="">全部（${mem.memories.length}）</option>` + scopes.map((x) => `<option value="${esc(x)}">${esc(scopeLabel(x))}</option>`).join("");
    sel.value = scopes.includes(keep) ? keep : "";

    const q = $("#memSearch").value.trim();
    const rows = mem.memories.filter((m) => (!sel.value || m.scope === sel.value) && (!q || m.text.includes(q)));
    const tb = $("#memRows");
    tb.innerHTML = rows.length ? "" : `<tr><td colspan="6" class="hint">还没有长期记忆。多聊几句，它会自动整理（每 ${state?.config.memoryExtractEvery ?? 6} 轮或聊天停下 3 分钟）。</td></tr>`;
    for (const m of rows) {
      const tr = document.createElement("tr");
      if (selected === m.id) tr.className = "on";
      tr.innerHTML = `
        <td class="mem-text">${esc(m.text)}</td>
        <td class="nowrap">${esc(scopeLabel(m.scope))}</td>
        <td class="nowrap stars">${"★".repeat(m.importance)}<span>${"★".repeat(5 - m.importance)}</span></td>
        <td class="nowrap"><div class="rbar"><i style="width:${m.r * 100}%;background:${rColor(m.r)}"></i></div><small>${Math.round(m.r * 100)}%${m.halfIn > 0 ? ` · ${dur(m.halfIn)}后过半` : ""}</small></td>
        <td class="nowrap"><small>${dur(m.stability * DAY)}<br>想起 ${m.reviews ?? 0} 次</small></td>
        <td class="nowrap acts"><button class="ghost sm" data-a="review" title="当作复习一次，加固这条记忆">加固</button><button class="ghost sm" data-a="pin" title="变成永不遗忘的绝对人格记忆">固化</button><button class="ghost sm" data-a="edit">改</button><button class="ghost danger sm" data-a="delete">删</button></td>`;
      tr.onclick = async (e) => {
        const a = e.target.dataset.a;
        if (!a) {
          selected = m.id;
          renderMemories();
          return drawCurve(m);
        }
        e.stopPropagation();
        if (a === "delete" && !confirm("删除这条记忆？")) return;
        if (a === "pin" && !confirm("固化为绝对人格记忆？它会从长期记忆移到人格卡里，永不遗忘，每句话都带上。")) return;
        if (a === "edit") {
          const text = prompt("修改记忆内容", m.text);
          if (text === null) return;
          const imp = prompt("重要度 1-5", m.importance);
          await api(`/api/mind/memory/${m.id}/edit`, { text, importance: Number(imp) || m.importance });
        } else await api(`/api/mind/memory/${m.id}/${a === "review" ? "edit" : a}`, a === "review" ? { review: true } : {});
        toast({ review: "已加固", pin: "已固化为绝对记忆", delete: "已删除", edit: "已修改" }[a]);
        await loadMemories();
        const again = mem.memories.find((x) => x.id === m.id);
        if (again && selected === m.id) drawCurve(again);
      };
      tb.appendChild(tr);
    }
    if (!rows.some((m) => m.id === selected)) $("#curveWrap").classList.add("hidden");

    // 遗忘区
    $("#archiveCount").textContent = mem.archive.length ? `（${mem.archive.length}）` : "";
    const al = $("#archiveList");
    al.innerHTML = mem.archive.length ? "" : `<p class="hint">还没有忘掉的东西。</p>`;
    for (const m of mem.archive) {
      const row = document.createElement("div");
      row.className = "abs-row";
      row.innerHTML = `<span class="grow">${esc(m.text)}</span><span class="hint inline">${esc(scopeLabel(m.scope))} · ${new Date(m.forgotten).toLocaleDateString("zh-CN")} 忘记</span><button class="ghost sm">恢复</button>`;
      $("button", row).onclick = async () => {
        await api(`/api/mind/archive/${m.id}/restore`, {});
        toast("已恢复（并算作想起一次）");
        loadMemories();
      };
      al.appendChild(row);
    }
  }

  /** 画这条记忆的遗忘曲线：从上次想起开始，R = e^(-t/S) */
  function drawCurve(m) {
    $("#curveWrap").classList.remove("hidden");
    const cv = $("#curve");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = 220;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d");
    g.scale(dpr, dpr);
    const pad = { l: 40, r: 16, t: 14, b: 26 };
    const span = Math.max(3 * m.stability, (Date.now() - m.lastReview) / DAY * 1.3, 1);
    const x = (d) => pad.l + (d / span) * (w - pad.l - pad.r);
    const y = (r) => pad.t + (1 - r) * (h - pad.t - pad.b);
    g.clearRect(0, 0, w, h);
    g.font = "11px Microsoft YaHei UI";
    g.fillStyle = "#6b7486";
    g.strokeStyle = "#e3e8f0";
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      g.beginPath();
      g.moveTo(pad.l, y(r));
      g.lineTo(w - pad.r, y(r));
      g.stroke();
      g.fillText(`${r * 100}%`, 4, y(r) + 4);
    }
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const d = (span / ticks) * i;
      g.fillText(d < 1 ? `${Math.round(d * 24)}时` : `${d.toFixed(d < 10 ? 1 : 0)}天`, x(d) - 10, h - 8);
    }
    // 遗忘阈值
    const forget = Number(state?.config.memoryForgetBelow ?? 0.03);
    g.strokeStyle = "#f0caca";
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(pad.l, y(forget));
    g.lineTo(w - pad.r, y(forget));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#d64545";
    g.fillText("遗忘线", w - pad.r - 40, y(forget) - 4);
    // 曲线
    g.strokeStyle = "#2f7cf6";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 200; i++) {
      const d = (span / 200) * i;
      const r = Math.exp(-d / m.stability);
      i ? g.lineTo(x(d), y(r)) : g.moveTo(x(d), y(r));
    }
    g.stroke();
    g.lineWidth = 1;
    // 现在
    const nowD = (Date.now() - m.lastReview) / DAY;
    const nowR = Math.exp(-nowD / m.stability);
    g.fillStyle = rColor(nowR).startsWith("var") ? getComputedStyle(document.body).getPropertyValue(rColor(nowR).slice(4, -1)) : rColor(nowR);
    g.beginPath();
    g.arc(x(nowD), y(nowR), 5, 0, Math.PI * 2);
    g.fill();
    g.fillText(`现在 ${Math.round(nowR * 100)}%`, x(nowD) + 8, y(nowR) - 6);
    const forgetIn = m.lastReview + -Math.log(forget) * m.stability * DAY - Date.now();
    $("#curveInfo").innerHTML = `「${esc(m.text)}」<br>上次想起：${new Date(m.lastReview).toLocaleString("zh-CN")} · 稳定度 S = ${dur(m.stability * DAY)} · 已被想起 ${m.reviews ?? 0} 次 · 如果一直不被想起，约 ${dur(forgetIn)}后忘掉。点「加固」看看曲线怎么变。`;
  }

  $("#memScope").onchange = renderMemories;
  $("#memSearch").oninput = renderMemories;
  $("#addMem").onclick = async () => {
    const r = await api("/api/mind/memory/add", { scope: $("#addScope").value.trim(), text: $("#addText").value.trim(), importance: Number($("#addImp").value) });
    if (!r.ok) return toast("范围格式不对：user:QQ号 / chat:group:群号 / chat:private:QQ号");
    $("#addText").value = "";
    toast("已添加");
    loadMemories();
  };

  const prevTabShow = window.onTabShow;
  window.onTabShow = (tab) => {
    prevTabShow?.(tab);
    if (tab === "persona" && !dirty) loadCards();
    if (tab === "memory") loadMemories();
  };
  window.onTabShow(location.hash.slice(1));
  setInterval(() => $("#tab-memory").classList.contains("active") && loadMemories(), 15000);
})();
