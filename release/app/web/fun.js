// 表情包 + QQ 空间 两个页面
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const img = (id) => `/sticker-img/${encodeURIComponent(id)}?t=${window.FISH_TOKEN}`;
  const when = (t) => new Date(t).toLocaleString("zh-CN", { hour12: false });

  // ================= 表情包 =================
  /** 第一次打开：有待审核的先看待审核，否则看在用的 */
  let filter = null;
  let data = { items: [], usage: {}, counts: {} };
  let ranked = null;

  async function loadStickers() {
    data = await api("/api/stickers");
    $("#sfPending").textContent = data.counts.pending || "";
    $("#sfApproved").textContent = data.counts.approved || "";
    const u = data.usage || {};
    $("#stickerUsage").textContent = u.date ? `今天看了 ${u.labeled} 张图${u.web ? `、上网找了 ${u.web} 次` : ""}，约 ${u.tokens} token` : "";
    if (!filter) filter = data.counts.pending ? "pending" : "approved";
    $$("[data-sfilter]").forEach((x) => x.classList.toggle("on", x.dataset.sfilter === filter));
    render();
  }

  function render() {
    const grid = $("#stickerGrid");
    let items = data.items.filter((it) => it.status === filter);
    if (ranked) {
      const order = new Map(ranked.map((r, i) => [r.id, i]));
      items = data.items.filter((it) => order.has(it.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
    }
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty">${ranked ? "库里没有匹配的表情。真聊天时它会去网上找一张（如果开了「去网上找」）。" : filter === "pending" ? "没有要审核的。群里有人发表情包时会自动收集到这里。" : "表情库还是空的：点右上角「上传表情」，或者等它从群里收集、去网上找。"}</div>`;
      return;
    }
    grid.innerHTML = items.map((it) => {
      const score = ranked?.find((r) => r.id === it.id)?.score;
      return `<div class="sticker" data-id="${it.id}">
        <img src="${img(it.id)}" loading="lazy" alt="">
        <div class="sticker-desc">${esc(it.desc)}${score !== undefined ? ` <b>匹配 ${score}</b>` : ""}</div>
        <input data-k="emotions" value="${esc((it.emotions || []).join(" "))}" placeholder="情绪" title="情绪（空格隔开）">
        <input data-k="tags" value="${esc((it.tags || []).join(" "))}" placeholder="标签" title="检索标签（空格隔开），改完按回车">
        <div class="sticker-meta">${esc(it.source === "upload" ? "你上传的" : it.source === "web" ? it.from || "网上找的" : `收集自${String(it.from || "").replace(/^group:/, "群 ").replace(/^private:/, "私聊 ") || "群聊"}`)} · 用过 ${it.uses || 0} 次</div>
        <div class="row gap0">
          ${it.status === "pending" ? `<button data-act="approve">通过</button><button class="ghost danger" data-act="reject" title="删掉，以后同一张图不再收集">拒绝</button>` : `<button class="ghost danger" data-act="delete">删除</button>`}
        </div>
      </div>`;
    }).join("");
  }

  $("#stickerGrid").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".sticker").dataset.id;
    await api(`/api/stickers/${id}/${btn.dataset.act}`, {});
    toast({ approve: "已启用", reject: "已拒绝，同一张图不会再收", delete: "已删除" }[btn.dataset.act]);
    loadStickers();
  });
  $("#stickerGrid").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !e.target.dataset.k) return;
    const card = e.target.closest(".sticker");
    await api(`/api/stickers/${card.dataset.id}/edit`, { [e.target.dataset.k]: e.target.value });
    toast("标签已保存");
    loadStickers();
  });
  $$("[data-sfilter]").forEach((b) => (b.onclick = () => {
    filter = b.dataset.sfilter;
    ranked = null;
    $("#stickerSearch").value = "";
    $$("[data-sfilter]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));
  let searchTimer;
  $("#stickerSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = e.target.value.trim();
      ranked = q ? (await api("/api/stickers/try", { query: q })).ranked : null;
      render();
    }, 300);
  });

  $("#stickerUpload").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    for (const [i, f] of files.entries()) {
      toast(`正在看图打标签（${i + 1}/${files.length}）……`);
      const dataUrl = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(f);
      });
      const r = await api("/api/stickers/upload", { data: dataUrl, name: f.name }).catch((err) => ({ error: err.message }));
      if (r.error || r.skipped) toast(`${f.name}：${r.error || { unsafe: "内容不合适，没收", "not image": "不是图片" }[r.skipped] || r.skipped}`);
    }
    filter = "approved";
    $$("[data-sfilter]").forEach((x) => x.classList.toggle("on", x.dataset.sfilter === "approved"));
    loadStickers();
  });

  // ================= 空间 =================
  async function loadQzone() {
    const q = await api("/api/qzone");
    $("#qzoneDraft").innerHTML = q.draft ? `<p class="hint">📝 等你在 QQ 私聊回「发」的草稿：${esc(q.draft.text)}</p>` : "";
    $("#qzoneHistory").innerHTML = q.history?.length
      ? q.history.slice(0, 30).map((h) => `<div class="qz-row"><span>${h.ok ? "✅" : "❌"} ${when(h.at)}</span><span>${esc(h.text)}${h.ok ? "" : `<br><b class="danger-text">${esc(h.error)}</b>`}</span></div>`).join("")
      : "还没有发过。";
  }

  const prev = window.onTabShow;
  window.onTabShow = (tab) => {
    prev?.(tab);
    if (tab === "stickers") loadStickers();
    if (tab === "qzone") loadQzone();
  };
  window.onTabShow(location.hash.slice(1));
  setInterval(() => {
    if ($("#tab-stickers").classList.contains("active") && !ranked && !document.activeElement?.dataset?.k) loadStickers();
    if ($("#tab-qzone").classList.contains("active")) loadQzone();
  }, 15000);
})();
