// 扩展设置页 SDK：在 panel.html 里 <script src="/sdk.js"></script> 后使用 window.FishExt
(() => {
  const id = decodeURIComponent(location.pathname.split("/")[2] || "");
  const token = window.parent?.FISH_TOKEN;
  const call = async (path, body) => {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Fish-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`请求失败 ${res.status}`);
    return res.json();
  };
  window.FishExt = {
    id,
    /** 读本扩展的 config.json */
    getConfig: () => call(`/api/extensions/${encodeURIComponent(id)}/config`),
    /** 整体覆盖写入本扩展的 config.json */
    setConfig: (config) => call(`/api/extensions/${encodeURIComponent(id)}/config`, config),
    /** 控制台当前状态（版本、配置摘要、运行状态） */
    getState: () => call("/api/state"),
    /** 重启大肥鱼，让扩展改动生效 */
    restartFish: () => call("/api/fish/restart", {})
  };
})();
