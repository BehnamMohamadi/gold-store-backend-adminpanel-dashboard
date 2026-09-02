
window.AdminAPI = (() => {
  const request = async (url, options = {}) => {
    const config = {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.headers || {}) },
    };

    if (config.body && !(config.body instanceof FormData) && typeof config.body !== "string") {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, config);
    let payload = null;

    if (response.status !== 204) {
      const text = await response.text();
      if (text) {
        try { payload = JSON.parse(text); }
        catch { payload = { message: text }; }
      }
    }

    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      if (response.status === 401 && location.pathname.startsWith("/admin") && location.pathname !== "/admin/login") {
        location.href = "/admin/login";
      }
      throw error;
    }

    return payload;
  };

  const qs = (params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") search.set(key, value);
    });
    const value = search.toString();
    return value ? `?${value}` : "";
  };

  const money = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return `${new Intl.NumberFormat("fa-IR").format(Number(value))} تومان`;
  };

  const number = (value) => value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("fa-IR").format(Number(value));

  const date = (value) => {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(value));
    } catch { return value; }
  };

  const escape = (value = "") => String(value).replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[ch]);

  const badge = (value, type = "order") => {
    const maps = {
      order: {
        pending:["در انتظار","warning"], confirmed:["تأییدشده","success"],
        cancelled:["لغوشده","danger"], expired:["منقضی‌شده","danger"],
      },
      payment: {
        unpaid:["پرداخت‌نشده","danger"], pending:["در انتظار پرداخت","warning"],
        paid:["پرداخت‌شده","success"], failed:["ناموفق","danger"], refunded:["برگشت‌خورده","info"],
      },
      account: {
        active:["فعال","success"], deactivated:["غیرفعال‌شده","warning"], suspended:["تعلیق‌شده","danger"],
      }
    };
    const [label, cls] = maps[type]?.[value] || [value || "—","info"];
    return `<span class="badge ${cls}">${escape(label)}</span>`;
  };

  return { request, qs, money, number, date, escape, badge };
})();
