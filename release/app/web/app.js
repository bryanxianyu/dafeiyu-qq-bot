const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Fish-Token": window.FISH_TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.blob();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- 导航 ----------
function go(tab) {
  if (!document.getElementById(`tab-${tab}`)) tab = "status";
  history.replaceState(null, "", `#${tab}`);
  $$("nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  $$(".tab").forEach((s) => s.classList.toggle("active", s.id === `tab-${tab}`));
  if (tab === "ext") loadExtensions();
  if (tab === "logs") pollLogs(true);
  if (tab === "basic") refreshModels();
  if (state) render();
  window.onTabShow?.(tab);
}
$$("nav a").forEach((a) => (a.onclick = () => go(a.dataset.tab)));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) go(g.dataset.goto);
  const o = e.target.closest("[data-open]");
  if (o) api("/api/open-folder", { which: o.dataset.open });
});

// ---------- 表单 ----------
let state = null;
let modelCatalog = null;
let refreshingModels = false;
const modelFields = { chatModel: "使用默认模型", memoryModel: "跟随聊天", visionModel: "跟随聊天" };

function updateModelOptions() {
  const providers = modelCatalog?.providers ?? [];
  for (const [field, fallback] of Object.entries(modelFields)) {
    const select = $(`select[name=${field}]`);
    const value = select.value;
    select.replaceChildren(new Option(fallback, ""));
    for (const provider of providers) {
      for (const model of provider.models) {
        if (field === "visionModel" && !model.inputModalities?.includes("image")) continue;
        select.add(new Option(`${model.name || model.id} · ${provider.id}`, JSON.stringify([provider.id, model.id])));
      }
    }
    if (value && ![...select.options].some((option) => option.value === value)) {
      select.add(new Option(`当前选择（目录中不可用）：${value}`, value));
    }
    select.value = value;
  }
  updateEffortOptions();
}

function updateEffortOptions() {
  const chatModel = $("select[name=chatModel]").value;
  for (const [field, modelField] of [["chatReasoningEffort", "chatModel"], ["memoryReasoningEffort", "memoryModel"], ["visionReasoningEffort", "visionModel"]]) {
    const select = $(`select[name=${field}]`);
    const value = select.value;
    let ref = $(`select[name=${modelField}]`).value || (modelField !== "chatModel" ? chatModel : "");
    let route;
    try { route = ref ? JSON.parse(ref) : modelCatalog?.chat && [modelCatalog.chat.provider, modelCatalog.chat.model]; } catch {}
    const model = modelCatalog?.providers?.find((p) => p.id === route?.[0])?.models?.find((m) => m.id === route?.[1]);
    select.replaceChildren(new Option(field === "chatReasoningEffort" ? "模型默认" : "跟随聊天", ""));
    if (field !== "chatReasoningEffort") select.add(new Option("使用此模型默认", "default"));
    for (const effort of model?.reasoning?.efforts ?? []) select.add(new Option(effort.name || effort.id, effort.id));
    if (value && ![...select.options].some((o) => o.value === value)) select.add(new Option(`当前选择（模型未声明支持）：${value}`, value));
    select.value = value;
  }
}
for (const field of Object.keys(modelFields)) $(`select[name=${field}]`).addEventListener("change", updateEffortOptions);

async function refreshModels() {
  if (refreshingModels) return;
  refreshingModels = true;
  const status = $("#modelStatus");
  try {
    modelCatalog = await api("/api/models");
    updateModelOptions();
    const count = modelCatalog.providers.reduce((sum, provider) => sum + provider.models.length, 0);
    status.textContent = count ? `已读取 ${count} 个模型` : "fish profile 暂无可选模型";
    render();
  } catch {
    status.textContent = "暂时无法读取模型。请启动大肥鱼，或查看 DSH 日志后重试。";
  } finally {
    refreshingModels = false;
  }
}
$("#refreshModels").addEventListener("click", refreshModels);
setInterval(() => {
  if ($("#tab-basic").classList.contains("active")) refreshModels();
}, 10000);


function fillForms(config) {
  for (const form of $$("[data-form]")) fillOne(form, config);
}

function fillOne(form, config) {
  {
    for (const el of form.elements) {
      if (!el.name || !(el.name in config || el.name === "apiKey" || el.name === "onebotToken")) continue;
      const v = config[el.name];
      if (el.name === "apiKey") {
        el.value = "";
        el.placeholder = config.apiKeySet ? `已设置（尾号 ${config.apiKeyTail}），不改就留空` : "sk-……";
      } else if (el.name === "onebotToken") {
        el.value = "";
        el.placeholder = config.onebotTokenSet ? "已设置，不改就留空" : "未设置可留空";
      } else if (el.type === "checkbox") el.checked = Boolean(v);
      else if (el.type === "radio") el.checked = el.value === String(v);
      else if (el.tagName === "SELECT") {
        // 下拉框里没有的值（比如自己填过别的模型）补成一个选项，别丢
        if (v != null && ![...el.options].some((o) => o.value === String(v))) el.add(new Option(String(v), String(v)));
        el.value = String(v ?? "");
      } else el.value = Array.isArray(v) ? v.join(", ") : v ?? "";
    }
    setDirty(form, false);
  }
  syncOnebotUi();
  syncGroupUi();
  if (form.closest("#tab-basic")) updateEffortOptions();
}

function syncOnebotUi() {
  const builtin = $("input[name=useBuiltinNapcat]");
  $("input[name=onebotToken]").disabled = builtin.checked && !builtin.disabled;
}
$("input[name=useBuiltinNapcat]").addEventListener("change", syncOnebotUi);

/** 表单有没改的：按钮变成「保存修改」，旁边提示；离开页面前提醒 */
function setDirty(form, dirty) {
  form.classList.toggle("dirty", dirty);
  const btn = $("button[type=submit]", form);
  if (btn) btn.textContent = dirty ? "保存修改" : "保存";
  const hint = $(".save-hint", form);
  if (hint && dirty) hint.textContent = "有改动还没保存";
  else if (hint && hint.textContent === "有改动还没保存") hint.textContent = "";
}
window.addEventListener("beforeunload", (e) => {
  if ($$("[data-form].dirty").length) e.preventDefault();
});

function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || (el.name === "onebotToken" && !el.value.trim())) continue;
    if (el.type === "radio") {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "range" || el.type === "number") out[el.name] = Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

$$("[data-form]").forEach((form) => {
  const mark = () => setDirty(form, true);
  form.addEventListener("input", mark);
  form.addEventListener("change", mark);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      const r = await api("/api/config", readForm(form));
      state = r;
      // 只刷新这一个表单，别把其他页没保存的改动冲掉
      fillOne(form, state.config);
      render();
      const hint = $(".save-hint", form);
      const msg = state.missing.length ? `已保存，还缺：${state.missing.join("、")}` : !r.changed?.length ? "没有改动" : r.restarted ? "✅ 已保存，大肥鱼重启一下（几秒）" : "✅ 已保存，立即生效";
      if (hint) hint.textContent = msg;
      toast(msg);
    } catch (err) {
      toast(`保存失败：${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
});

function syncGroupUi() {
  const natural = $("input[name=groupMode][value=natural]").checked;
  $("[data-natural]").classList.toggle("hidden", !natural);
  const c = Number($("input[name=groupChattiness]").value);
  $("#chatVal").textContent = c === 0 ? "只在提到“鱼”时看一眼" : `${Math.round(c * 100)}%${c >= 0.35 ? "（话痨）" : c <= 0.1 ? "（安静）" : ""}`;
  const rl = Number($("input[name=rateLimit]").value);
  $("#rateVal").textContent = rl === 0 ? "不限" : rl;
}
$$("input[name=groupMode], input[name=groupChattiness], input[name=rateLimit]").forEach((el) => el.addEventListener("input", syncGroupUi));

// ---------- 状态 ----------
const pill = (el, text, cls) => {
  el.textContent = text;
  el.className = `pill ${cls ?? ""}`;
};

let qrShown = 0;
async function render() {
  if (!state) return;
  if (state.platform === "darwin") {
    for (const label of $$("[data-windows-qq]")) {
      label.classList.add("hidden");
      $("input", label).disabled = true;
    }
    syncOnebotUi();
    const details = $("#onebotSettings");
    const summary = $("summary", details);
    if (summary.textContent !== "外部 OneBot v11") {
      summary.textContent = "外部 OneBot v11";
      details.open = true;
    }
  }
  $("#ver").textContent = `v${state.version}`;
  $("#extCount").textContent = state.extensions || "";
  $("#pendingBadge").textContent = state.pending || "";
  $("#stickerBadge").textContent = state.stickerPending || "";

  const banner = $("#banner");
  const msgs = [];
  // 还没配好：首页有分步引导；其他页面顶上提醒一句
  if (state.missing.length && !$("#tab-status").classList.contains("active")) msgs.push(`还差 <b>${state.missing.join("、")}</b> 才能开始养鱼 → <a data-goto="basic">去填写</a>`);
  if (state.pathWarning) msgs.push(`当前目录含中文或空格（${state.pathWarning}），NapCat 可能启动失败，建议把整个文件夹移到 D:\\dafeiyu 这类路径。`);
  banner.innerHTML = msgs.join("<br>");
  banner.classList.toggle("hidden", msgs.length === 0);

  // NapCat
  const n = state.napcat;
  const nb = $("#napBody");
  if (!n.enabled) {
    pill($("#napPill"), "外部 OneBot");
    nb.innerHTML = `<div class="kv"><span>地址</span><b>${state.config.onebotUrl}</b></div>`;
  } else if (n.status === "installing") {
    pill($("#napPill"), "安装中", "warn");
    nb.innerHTML = `<p class="hint">正在下载并安装 QQ（约 200MB），进度见 <a class="link" data-goto="logs">日志 → NapCat</a>。</p>`;
  } else if (!n.installed) {
    pill($("#napPill"), "未安装");
    nb.innerHTML = `<p class="hint">点「启动」会自动安装 NapCat（会从腾讯官方下载 QQ，约 200MB）。</p>`;
  } else if (n.status !== "running") {
    pill($("#napPill"), "未启动");
    nb.innerHTML = `<p class="hint">点「启动」登录机器人 QQ。</p>`;
  } else if (n.login) {
    pill($("#napPill"), "已登录", "ok");
    nb.innerHTML = `<div class="kv"><span>机器人</span><b>${n.login.nickname}</b><span>QQ 号</span><b>${n.login.uin}</b></div>`;
    qrShown = 0;
  } else {
    pill($("#napPill"), "等待扫码", "warn");
    if (n.qrcode && n.qrcode !== qrShown) {
      qrShown = n.qrcode;
      try {
        const blob = await api("/api/napcat/qrcode");
        nb.innerHTML = `<div class="qr"><img src="${URL.createObjectURL(blob)}"><p>用机器人小号的手机 QQ 扫码登录</p></div>`;
      } catch {
        nb.innerHTML = `<p class="hint">正在生成二维码……</p>`;
      }
    } else if (!n.qrcode) nb.innerHTML = `<p class="hint">正在启动 QQ，稍等几秒……</p>`;
    let err = $(".login-err", nb);
    if (n.loginError && !err) nb.insertAdjacentHTML("beforeend", `<p class="login-err danger-text"></p>`);
    err = $(".login-err", nb);
    if (err) err.textContent = n.loginError ? `扫码后被腾讯拒绝：${n.loginError}` : "";
  }
  $("#napStart").disabled = !n.enabled || n.status === "running" || n.status === "installing";
  $("#napStop").disabled = !n.enabled || n.status !== "running";
  $("#napRestart").disabled = !n.enabled || n.status === "installing";

  // 大肥鱼
  const f = state.fish;
  const fb = $("#fishBody");
  const c = state.config;
  const rows = `<div class="kv"><span>模型</span><b id="activeChatModel"></b><span>主人</span><b>${c.owners.join(", ") || "未设置"}</b><span>群</span><b>${c.allowGroups.join(", ") || "无"}</b><span>群聊</span><b>${c.groupMode === "natural" ? `自然插话（${Math.round(c.groupChattiness * 100)}%）` : "只在被叫到时"}</b></div>`;
  if (f.status === "running" && f.connected) pill($("#fishPill"), "在线", "ok");
  else if (f.status === "running" || f.status === "starting") pill($("#fishPill"), "等待 QQ 连接", "warn");
  else if (f.status === "crashed") pill($("#fishPill"), "反复崩溃", "bad");
  else pill($("#fishPill"), "未启动");
  fb.innerHTML = rows + (f.lastError && f.status !== "running" ? `<p class="hint" style="color:var(--red)">${f.lastError.replace(/</g, "&lt;")}</p>` : "");
  $("#activeChatModel").textContent = chatModelName();
  $("#fishStart").disabled = f.status === "running" || f.status === "starting";
  $("#fishStop").disabled = f.status !== "running" && f.status !== "starting";
  $("#fishRestart").disabled = state.missing.length > 0;
  renderHome();
}

/** 首页：一句话总状态 + 新手引导 + 今天的活动 */
function chatModelName() {
  if (state.config.chatModel) return JSON.parse(state.config.chatModel)[1];
  return modelCatalog?.chat?.model ?? (state.config.apiKeySet ? state.config.model : "DSH 默认模型");
}

function renderHome() {
  const n = state.napcat;
  const f = state.fish;
  const t = state.today ?? {};
  const qqOk = !n.enabled || Boolean(n.login);
  const online = f.status === "running" && f.connected;
  const persona = t.persona ? `「${t.persona}」` : "";
  let level;
  let title;
  let sub;
  if (state.missing.length) {
    [level, title, sub] = ["off", "还没开始养鱼", "按下面的步骤填好就能上线。"];
  } else if (online) {
    const who = n.login ? `${n.login.nickname}（${n.login.uin}）` : "QQ";
    [level, title, sub] = ["ok", `大肥鱼在线，正在用${persona || "默认"}人格聊天`, `登录的是 ${who} · 模型 ${chatModelName().replace(/</g, "&lt;")}`];
  } else if (n.enabled && n.status === "running" && !n.login && n.qrcode) {
    [level, title, sub] = ["warn", "等你扫码登录 QQ", n.loginError ? `上次扫码被腾讯拒绝：${n.loginError}` : "用机器人 QQ 的手机 QQ 扫下面的二维码（托盘程序也会弹出扫码窗口）。"];
  } else if (f.status === "crashed") {
    [level, title, sub] = ["bad", "大肥鱼反复崩溃了", f.lastError || "看看「日志」里的报错，或者点「重启」。"];
  } else if (f.status === "running" || f.status === "starting" || n.status === "installing") {
    [level, title, sub] = ["warn", n.status === "installing" ? "正在安装 QQ 组件" : "正在上线……", n.status === "installing" ? "第一次要下载约 200MB，稍等几分钟。" : "等 QQ 登录好就会连上，一般十几秒。"];
  } else {
    [level, title, sub] = ["off", "大肥鱼没在运行", "点下面「大肥鱼」卡片里的「启动」。"];
  }
  $("#heroDot").className = `hero-dot ${level}`;
  $("#heroTitle").textContent = title;
  $("#heroSub").textContent = sub;

  // 新手引导：没配好或还没登录时才出现
  const steps = [
    { done: Boolean(state.config.chatModel || modelCatalog?.chat || state.config.apiKeySet), text: "在 DSH 配置并选择聊天模型", go: "basic" },
    { done: state.config.owners.length > 0, text: "填你的 QQ 号，让它认得主人", go: "basic" },
    { done: state.config.allowGroups.length > 0, text: "填它能说话的群（不填就只能私聊）", go: "basic", optional: true },
    { done: qqOk, text: "用机器人 QQ 扫码登录" },
    { done: online, text: "大肥鱼上线" }
  ];
  const showSetup = state.missing.length > 0 || !qqOk;
  $("#setupPanel").classList.toggle("hidden", !showSetup);
  if (showSetup) {
    $("#setupSteps").innerHTML = steps.map((s) => `<li class="${s.done ? "done" : ""}"><span>${s.done ? "✓" : ""}</span>${s.text}${s.optional ? "<small>可选</small>" : ""}${!s.done && s.go ? ` <a class="link" data-goto="${s.go}">去填写 →</a>` : ""}</li>`).join("");
  }

  const ago = (ms) => {
    if (!ms) return "今天还没说过话";
    const s = (Date.now() - ms) / 1000;
    return s < 60 ? "刚刚" : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : `${Math.floor(s / 3600)} 小时前`;
  };
  $("#todayTiles").innerHTML = [
    ["今天收到", `${t.received ?? 0} 条`],
    ["今天回复", `${t.replied ?? 0} 句`],
    ["看了没接话", `${t.lurked ?? 0} 次`],
    ["发表情包", `${t.stickers ?? 0} 张`],
    ["上次说话", ago(t.lastReply)]
  ].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join("");
}

const act = (id, path, msg) => ($(id).onclick = async () => {
  state = await api(path, {});
  render();
  toast(msg);
});
act("#napStart", "/api/napcat/start", "正在启动 QQ……");
act("#napStop", "/api/napcat/stop", "QQ 已停止");
act("#napRestart", "/api/napcat/restart", "正在重启 QQ……");
act("#fishStart", "/api/fish/start", "正在放生大肥鱼……");
act("#fishStop", "/api/fish/stop", "大肥鱼已收回鱼缸");
act("#fishRestart", "/api/fish/restart", "大肥鱼重启中……");

async function pollState(first) {
  try {
    state = await api("/api/state");
    if (first) {
      fillForms(state.config);
      refreshModels();
    }
    render();
  } catch {
    $("#banner").innerHTML = "连不上控制台：大肥鱼是不是已经退出了？双击桌面上的「大肥鱼」重新打开。";
    $("#banner").classList.remove("hidden");
  }
}

// ---------- 日志 ----------
const logState = { fish: 0, napcat: 0, system: 0 };
const logLines = { fish: [], napcat: [], system: [] };
let logSrc = "fish";

async function fetchLogs(src) {
  const { lines } = await api(`/api/logs?source=${src}&after=${logState[src]}`);
  // 定时器和切换标签可能同时在拉：只收比已有的新的行，避免重复
  const fresh = lines.filter((l) => l.seq > logState[src]);
  if (fresh.length) {
    logState[src] = fresh.at(-1).seq;
    logLines[src].push(...fresh.map((l) => l.text));
    if (logLines[src].length > 1000) logLines[src].splice(0, logLines[src].length - 1000);
  }
  return fresh.length > 0;
}

/** 首页动态只看聊天：重连这类正常的连接抖动不显示（连接状态看上面的卡片） */
const NOISE = /QQ 连接断开|已连上 QQ|model listing|心智服务暂时连不上/;

async function pollLogs(force) {
  try {
    const fishNew = await fetchLogs("fish");
    if (fishNew || force) $("#miniLog").textContent = logLines.fish.filter((l) => !NOISE.test(l)).slice(-12).join("\n") || "（今天还没有聊天）";
    if ($("#tab-logs").classList.contains("active")) {
      const changed = logSrc === "fish" ? fishNew : await fetchLogs(logSrc);
      const box = $("#logBox");
      if (changed || force) {
        const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
        box.textContent = logLines[logSrc].join("\n") || "（暂无日志）";
        if (atBottom || force) box.scrollTop = box.scrollHeight;
      }
    }
  } catch {}
}
$$("#logSrc button").forEach((b) => (b.onclick = () => {
  logSrc = b.dataset.src;
  $$("#logSrc button").forEach((x) => x.classList.toggle("on", x === b));
  pollLogs(true);
}));

// ---------- 扩展 ----------
const TYPE = { persona: "人格卡", memory: "记忆", other: "其他" };
async function loadExtensions() {
  const list = await api("/api/extensions");
  const box = $("#extList");
  box.innerHTML = list.length ? "" : `<div class="panel hint">还没有扩展。把扩展文件夹放进 data\\extensions 即可。</div>`;
  for (const ext of list) {
    const div = document.createElement("div");
    div.className = "panel ext";
    div.innerHTML = `
      <label class="switch"><input type="checkbox" ${ext.enabled ? "checked" : ""}><span></span></label>
      <div class="info"><b>${ext.name}</b><span class="tag">${TYPE[ext.type] ?? ext.type}</span> <span class="hint" style="display:inline">${ext.version}</span>
        <p>${ext.description}</p></div>
      ${ext.panel ? `<button class="ghost">设置</button>` : ""}`;
    $("input", div).onchange = async (e) => {
      await api(`/api/extensions/${encodeURIComponent(ext.id)}/enabled`, { enabled: e.target.checked });
      toast(`${ext.name} 已${e.target.checked ? "启用" : "停用"}，重启大肥鱼后生效`);
      pollState();
    };
    const btn = $("button", div);
    if (btn) btn.onclick = () => {
      $("#extPanelTitle").textContent = `${ext.name} · 设置`;
      $("#extFrame").src = `/ext/${encodeURIComponent(ext.id)}/${ext.panel}`;
      $("#extPanel").classList.remove("hidden");
      $("#extPanel").scrollIntoView({ behavior: "smooth" });
    };
    box.appendChild(div);
  }
}
$("#extPanelClose").onclick = () => {
  $("#extPanel").classList.add("hidden");
  $("#extFrame").src = "about:blank";
};

// ---------- 人格快捷切换（运行状态页） ----------
async function loadPersonaSwitch() {
  const box = $("#personaSwitch");
  if (!box || !state) return;
  let cards;
  try {
    cards = await api("/api/mind/cards");
  } catch {
    return;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const name = (cid) => cards.cards.find((c) => c.id === cid)?.name ?? "?";
  const rows = [{ chat: "default", label: "默认", note: "没单独指定的聊天都用它", current: cards.defaultCard }];
  const chats = new Set([...(state.config.allowGroups || []).map((g) => `group:${g}`), ...(state.config.owners || []).map((o) => `private:${o}`), ...Object.keys(cards.bindings)]);
  for (const chat of chats) {
    const [type, num] = chat.split(":");
    const bound = cards.bindings[chat];
    rows.push({ chat, label: type === "group" ? `群 ${num}` : (state.config.owners || []).includes(Number(num)) ? `主人私聊 ${num}` : `私聊 ${num}`, note: bound ? "" : `跟随默认（${name(cards.defaultCard)}）`, current: bound ?? cards.defaultCard });
  }
  box.innerHTML = rows.map((r) => `
    <div class="persona-row" data-chat="${esc(r.chat)}">
      <div><b>${esc(r.label)}</b><span class="hint inline">当前：${esc(name(r.current))}${r.note ? ` · ${esc(r.note)}` : ""}</span></div>
      <div class="seg">${cards.cards.map((c) => `<button class="${c.id === r.current ? "on" : "ghost"}" data-card="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>
    </div>`).join("");
}
$("#personaSwitch")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-card]");
  if (!btn) return;
  const chat = btn.closest("[data-chat]").dataset.chat;
  const r = await api("/api/mind/switch", { chat, card: btn.dataset.card }).catch((err) => ({ error: err.message }));
  toast(r.ok ? `✅ ${chat === "default" ? "默认人格" : "这个聊天"}已切到「${r.card.name}」，下一句话生效` : `切换失败：${r.error ?? ""}`);
  loadPersonaSwitch();
});
const prevTabShow = window.onTabShow;
window.onTabShow = (tab) => {
  prevTabShow?.(tab);
  if (tab === "status") loadPersonaSwitch();
};
setInterval(() => $("#tab-status").classList.contains("active") && loadPersonaSwitch(), 10000);

go(location.hash.slice(1) || "status");
pollState(true).then(loadPersonaSwitch);
pollLogs(true);
setInterval(pollState, 2000);
setInterval(pollLogs, 1500);
