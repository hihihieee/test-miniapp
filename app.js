/* Palm VPN Mini App — личный кабинет в Telegram */
const tg = window.Telegram && window.Telegram.WebApp;
const CONNECT_BASE = "https://connect.palma-net.pw";

const S = {
    uid: null,
    token: null,
    me: null,
    dev: null,
    prices: null,
    tab: "home",
    plan: null,
    devTarget: null,
    purchaseDevices: 2,
    paymentMode: "autopay",
};

const $ = (id) => document.getElementById(id);

function haptic(type = "light") {
    try {
        if (type === "ok") tg.HapticFeedback.notificationOccurred("success");
        else if (type === "err") tg.HapticFeedback.notificationOccurred("error");
        else tg.HapticFeedback.impactOccurred(type);
    } catch (e) {
        /* вне Telegram — молча */
    }
}

let toastTimer = null;
function toast(msg, bad = false) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), 2600);
}

function esc(s) {
    return String(s == null ? "" : s).replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
}

function plural(n, one, few, many) {
    const a = Math.abs(n) % 100,
        b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
}

function daysLeft(endDate) {
    if (!endDate) return 0;
    const end = new Date(String(endDate).replace(" ", "T"));
    return Math.max(0, Math.ceil((end - new Date()) / 86400000));
}

function fmtDate(s) {
    if (!s) return "—";
    const d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

async function api(path, opts = {}) {
    const headers = { Accept: "application/json" };
    if (S.uid && S.token) {
        headers["X-User-Id"] = String(S.uid);
        headers["X-Session-Token"] = S.token;
    }
    if (opts.body) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);
    let res;
    try {
        res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: controller.signal });
    } finally { clearTimeout(timeout); }
    let data = null;
    try {
        data = await res.json();
    } catch (e) {
        /* пустое тело */
    }
    if (!res.ok) {
        const err = new Error((data && data.detail) || `Ошибка ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

// Экран загрузки держим не меньше секунды: запросы отвечают за ~200 мс, и
// анимированный робот успевал только мигнуть.
const BOOT_MIN_MS = 1000;
let bootStart = 0;

function bootHeld() {
    const left = BOOT_MIN_MS - (Date.now() - bootStart);
    return left > 0 ? new Promise((r) => setTimeout(r, left)) : Promise.resolve();
}

async function fail(msg) {
    await bootHeld();
    $("screen-boot").classList.add("hidden");
    $("error-text").textContent = msg;
    $("screen-error").classList.remove("hidden");
}

async function boot() {
    bootStart = Date.now();
    if (tg) {
        tg.ready();
        tg.expand();
    }
    const initData = tg && tg.initData;
    if (!initData) {
        fail("Откройте кабинет кнопкой в боте @palm_vpnbot — вне Telegram он не работает.");
        return;
    }
    try {
        const auth = await api("/api/auth/tg", {
            method: "POST",
            body: { init_data: initData },
        });
        S.uid = auth.user_id;
        S.token = auth.session_token;
    } catch (e) {
        fail(e.message);
        return;
    }
    try {
        const [me, prices] = await Promise.all([
            api("/api/me"),
            api("/api/prices"),
        ]);
        S.me = me;
        S.prices = prices;
    } catch (e) {
        fail(e.message);
        return;
    }
    await bootHeld();
    $("screen-boot").classList.add("hidden");
    $("screen-app").classList.remove("hidden");
    renderHeader();
    switchTab("home");
    restorePayment();
    loadDevices();
}

function renderHeader() {
    if (!$("hi")) return;
    const me = S.me;
    const tgu = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || {};
    const name = me.first_name || tgu.first_name || "друг";
    $("hi").textContent = [name, me.last_name || tgu.last_name].filter(Boolean).join(" ");
    $("uid").textContent = me.username ? "@" + me.username : `ID ${me.user_id}`;
    $("balance").textContent = `${Math.round(me.balance)} ₽`;

    const av = $("avatar");
    if (tgu.photo_url) {
        const img = new Image();
        img.src = tgu.photo_url;
        img.alt = "";
        av.textContent = "";
        av.appendChild(img);
    } else {
        av.textContent = (name[0] || "P").toUpperCase();
    }
}

const TABS = ["home", "devices", "extend", "profile"];

function refreshLucideIcons(root = document) {
    try { if (window.lucide?.createIcons) window.lucide.createIcons({ root }); } catch (_) {}
}
refreshLucideIcons();

function switchTab(tab) {
    const hasSubscription = Boolean(S.me?.sub);
    document.body.classList.toggle("no-subscription", !hasSubscription);
    document.querySelector(".page-heading").classList.toggle("hidden", !hasSubscription);
    document.querySelector(".bnav").classList.toggle("hidden", !hasSubscription);
    if (!hasSubscription) tab = "home";
    document.querySelector('.bnav-item[data-tab="devices"]').classList.toggle("hidden", !hasSubscription);
    document.querySelector('.bnav').classList.toggle("without-devices", !hasSubscription);
    if (tab === "devices" && !hasSubscription) tab = "home";
    S.tab = tab;
    $("page-title").textContent = {home: "Ваше подключение", devices: "Ваши устройства", extend: S.me?.sub && !S.me.sub.is_trial ? "Продление подписки" : "Выберите тариф", profile: "Ваш профиль"}[tab];
    $("nav-plan-label").textContent = S.me?.sub && !S.me.sub.is_trial ? "Продлить" : "Тариф";
    TABS.forEach((t) => {
        $("tab-" + t).classList.toggle("hidden", t !== tab);
    });
    document.querySelectorAll(".bnav-item").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tab);
        if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
    });
    if (tab === "home") renderHome();
    else if (tab === "devices") renderDevices();
    else if (tab === "extend") renderExtend();
    else renderProfile();
    window.scrollTo({ top: 0 });
}

document.querySelectorAll(".bnav-item").forEach((b) => {
    b.addEventListener("click", () => {
        haptic("light");
        switchTab(b.dataset.tab);
    });
});

const ICON = {
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    monitor:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="14" height="11" rx="2"/><path d="M18 8h4v12h-4z"/><path d="M6 19h6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5"/><path d="M17 8.5a3 3 0 0 1 0 5.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h5l2 3h4l2-3h5"/><path d="M4 12 6 5h12l2 7v7H4z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.6l-2.95 13.9c-.22 1-.82 1.24-1.66.77l-4.58-3.37-2.21 2.13c-.24.24-.45.45-.92.45l.33-4.67 8.5-7.68c.37-.33-.08-.51-.57-.18L6.4 12.99l-4.5-1.41c-.98-.3-1-.98.2-1.45l17.6-6.78c.82-.3 1.53.2 1.24 1.25z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M12 16V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>',
};

function subState(days) {
    if (days <= 0) return { cls: "bad", label: "Истекла" };
    if (days <= 3) return { cls: "bad", label: "Истекает" };
    if (days <= 7) return { cls: "warn", label: "Скоро конец" };
    return { cls: "ok", label: "Активна" };
}

function renderHome() {
    const me = S.me;
    const sub = me.sub;
    const el = $("tab-home");

    if (!sub) {
        el.innerHTML = `
          <section class="no-sub-hero" aria-labelledby="no-sub-title">
            <img class="no-sub-logo" src="https://static.palmcdn.top/logos/logo_w.png" alt="Palm VPN" width="48" height="48" />
            <h1 id="no-sub-title">Ваш план закончился</h1>
            <p>Соберите новый тариф, чтобы возобновить подписку.</p>
            <ul class="no-sub-benefits">
              <li><img src="https://static.palmcdn.top/icons/tick.svg" alt="" />VPN без рекламы</li>
              <li><img src="https://static.palmcdn.top/icons/tick.svg" alt="" />Мобильная связь</li>
              <li><img src="https://static.palmcdn.top/icons/tick.svg" alt="" />Много локаций</li>
              <li><img src="https://static.palmcdn.top/icons/tick.svg" alt="" />Безлимитный трафик</li>
            </ul>
          </section>
          <section id="no-sub-checkout" class="no-sub-checkout" aria-label="Оформление подписки"></section>`;

        // Keep the proven tariff/payment flow, but render it directly below
        // the locked no-subscription screen instead of a separate tab.
        const checkout = $("no-sub-checkout");
        renderExtend(checkout);
        return;
    }

    const days = daysLeft(sub.end_date);
    const st = subState(days);
    const total = sub.start_date
        ? Math.max(1, Math.round((new Date(String(sub.end_date).replace(" ", "T")) - new Date(String(sub.start_date).replace(" ", "T"))) / 86400000))
        : 30;
    const pct = Math.max(2, Math.min(100, Math.round((days / total) * 100)));

    el.innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="hero-label">Подписка ${sub.is_trial ? "· пробная" : ""}</div>
          <div class="big">${days}<span class="big-unit">${plural(days, "день", "дня", "дней")}</span></div>
        </div>
        <span class="chip ${st.cls}">${st.label}</span>
      </div>
      <div class="bar"><div class="bar-fill ${st.cls === "ok" ? "" : st.cls}" style="width:${pct}%"></div></div>
    </div>

    <div class="card">
      <div class="row"><span class="row-k">Действует до</span><span class="row-v">${esc(fmtDate(sub.end_date))}</span></div>
      <div class="row"><span class="row-k">Устройств в тарифе</span><span class="row-v">${esc(sub.devices)}</span></div>
      <div class="row"><span class="row-k">Номер подписки</span><span class="row-v mono">${esc(sub.id)}</span></div>
    </div>

    <button class="btn btn-primary" id="btn-connect">${ICON.shield} Подключиться</button>
    <div class="btn-row mt16">
      <button class="btn btn-ghost" id="btn-copy">${ICON.copy} Копировать ссылку</button>
      <button class="btn btn-ghost" id="btn-goext">${ICON.clock} Продлить</button>
    </div>`;

    $("btn-connect").addEventListener("click", () => {
        haptic("medium");
        showConnectGuide(sub.id, me.subscription_url);
    });
    $("btn-copy").addEventListener("click", () => copySubUrl(me.subscription_url));
    $("btn-goext").addEventListener("click", () => {
        haptic("light");
        switchTab("extend");
    });
}

// Гайд по подключению
function showConnectGuide(subId, subUrl) {
    const apps = {
        happ: {
            name: "Happ",
            desc: "Основной рекомендуемый клиент",
            route: "happ",
            stores: {
                ios: "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215",
                android: "https://play.google.com/store/apps/details?id=com.happproxy",
            }
        },
        incy: {
            name: "Incy",
            desc: "Резервный клиент",
            route: "incy",
            stores: {
                ios: "https://apps.apple.com/app/incy/id6736894479",
                android: "https://play.google.com/store/apps/details?id=com.incy.app",
            }
        }
    };

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Подключение</h3>
                <button class="modal-close" id="close-guide">✕</button>
            </div>
            <div class="modal-body">
                <p class="guide-hint">Выберите приложение для подключения:</p>

                <div class="app-card" data-app="happ">
                    <div class="app-info">
                        <div class="app-name">Happ</div>
                        <div class="app-desc">Основной рекомендуемый</div>
                    </div>
                    <div class="app-arrow">→</div>
                </div>

                <div class="app-card" data-app="incy">
                    <div class="app-info">
                        <div class="app-name">Incy</div>
                        <div class="app-desc">Резервный клиент</div>
                    </div>
                    <div class="app-arrow">→</div>
                </div>

                <div class="guide-divider">или</div>

                <button class="btn btn-ghost btn-block" id="btn-copy-guide">
                    ${ICON.copy} Скопировать ссылку
                </button>

                <button class="btn btn-ghost btn-block mt8" id="btn-open-web">
                    ${ICON.share} Открыть веб-версию
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    setTimeout(() => modal.classList.add("show"), 10);

    const close = () => {
        modal.classList.remove("show");
        setTimeout(() => modal.remove(), 300);
    };

    modal.querySelector("#close-guide").addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    modal.querySelectorAll(".app-card").forEach(card => {
        card.addEventListener("click", () => {
            const appKey = card.dataset.app;
            const app = apps[appKey];
            showAppSteps(subId, subUrl, app);
            close();
        });
    });

    modal.querySelector("#btn-copy-guide").addEventListener("click", () => {
        copySubUrl(subUrl);
        close();
    });

    modal.querySelector("#btn-open-web").addEventListener("click", () => {
        openLink(`${CONNECT_BASE}/${subId}`);
        close();
    });
}

function showAppSteps(subId, subUrl, app) {
    const platform = detectPlatform();
    const storeUrl = app.stores[platform] || app.stores.ios;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${app.name}</h3>
                <button class="modal-close" id="close-steps">✕</button>
            </div>
            <div class="modal-body">
                <p class="guide-subtitle">${app.desc}</p>

                <div class="step">
                    <div class="step-num">1</div>
                    <div class="step-content">
                        <div class="step-title">Установите приложение</div>
                        <div class="step-desc">Скачайте ${app.name} из магазина приложений</div>
                        <a href="${storeUrl}" class="btn btn-ghost btn-sm mt8" target="_blank">
                            Скачать ${app.name}
                        </a>
                    </div>
                </div>

                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-content">
                        <div class="step-title">Добавьте подписку</div>
                        <div class="step-desc">Нажмите кнопку ниже — приложение откроется автоматически</div>
                        <button class="btn btn-primary btn-sm mt8" id="btn-add-sub">
                            ${ICON.shield} Добавить подписку
                        </button>
                    </div>
                </div>

                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-content">
                        <div class="step-title">Подключитесь</div>
                        <div class="step-desc">Выберите сервер в приложении и нажмите «Подключить»</div>
                    </div>
                </div>

                <div class="guide-divider">Если не открылось</div>

                <button class="btn btn-ghost btn-block" id="btn-copy-steps">
                    ${ICON.copy} Скопировать ссылку
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add("show"), 10);

    const close = () => {
        modal.classList.remove("show");
        setTimeout(() => modal.remove(), 300);
    };

    modal.querySelector("#close-steps").addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    modal.querySelector("#btn-add-sub").addEventListener("click", () => {
        const url = `https://links.palma-net.pw/${app.route}?id=${subId}`;
        openLink(url);
        haptic("ok");
        toast("Открываем приложение...");
    });

    modal.querySelector("#btn-copy-steps").addEventListener("click", () => {
        copySubUrl(subUrl);
    });
}

function detectPlatform() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 2)) {
        return "ios";
    }
    if (/Android/.test(ua)) {
        return "android";
    }
    return "ios"; // default
}

function openLink(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Некорректная ссылка");
    if (parsed.hostname === "t.me" && tg?.openTelegramLink) tg.openTelegramLink(url);
    else if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, "_blank", "noopener");
}

function openBot() {
    const u = (S.me && S.me.bot_username) || "palm_vpnbot";
    const link = `https://t.me/${u}`;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, "_blank", "noopener");
}

async function copySubUrl(url) {
    if (!url) return toast("Ссылка недоступна", true);
    try {
        await navigator.clipboard.writeText(url);
        haptic("ok");
        toast("Ссылка скопирована");
    } catch (e) {
        haptic("err");
        toast("Не удалось скопировать", true);
    }
}

async function activateTrial() {
    const btn = $("btn-trial");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Активируем…';
    try {
        await api("/api/trial/activate", { method: "POST" });
        haptic("ok");
        toast("Пробная подписка активна!");
        await refresh();
    } catch (e) {
        haptic("err");
        toast(e.message, true);
        btn.disabled = false;
        btn.innerHTML = `${ICON.zap} Получить пробные 3 дня`;
    }
}

async function refresh() {
    S.me = await api("/api/me");
    renderHeader();
    refreshLucideIcons();
    await loadDevices();
    switchTab(S.tab);
}

async function loadDevices() {
    try {
        S.dev = await api("/api/devices");
    } catch (e) {
        S.dev = null;
    }
    if (S.tab === "devices") renderDevices();
}

// Только марка устройства и ОС. device_name не трогаем: у неразобранных
// записей там сырое "Happ/5.1.0/ios/2607150016626" с HWID в хвосте.
function devPlatform(h) {
    const os = [h.dev_os, h.dev_ver].filter(Boolean).join(" ");
    return [h.dev_model, os].filter(Boolean).join(" · ");
}

function renderDevices() {
    const el = $("tab-devices");
    const d = S.dev;

    if (!d || !d.sub_id) {
        el.innerHTML = `<div class="card"><div class="empty">${ICON.monitor}
      <div>Устройства появятся после оформления подписки.</div></div></div>`;
        return;
    }

    const hist = d.history || [];
    const online = hist.filter((h) => h.is_active).length;

    el.innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="hero-label">Сейчас онлайн</div>
          <div class="big">${online}<span class="big-unit">из ${esc(d.limit)}</span></div>
        </div>
        <span class="chip ${online > d.limit ? "bad" : "ok"}">${online > d.limit ? "Превышен лимит" : "В пределах лимита"}</span>
      </div>
      <div class="bar"><div class="bar-fill ${online > d.limit ? "bad" : ""}" style="width:${Math.min(100, d.limit ? Math.round((online / d.limit) * 100) : 0)}%"></div></div>
    </div>

    <div class="card">
      <div class="card-title">${ICON.monitor} История подключений</div>
      ${
          hist.length
              ? hist
                    .map(
                        (h) => `
        <div class="dev">
          <span class="dev-dot ${h.is_active ? "on" : ""}"></span>
          <div class="dev-body">
            <div class="dev-ip">${esc(devPlatform(h) || "Устройство не определилось")}</div>
            <div class="dev-meta">${esc([h.country, h.city].filter(Boolean).join(" · ") || "—")}</div>
          </div>
        </div>`,
                    )
                    .join("")
              : `<div class="empty">${ICON.monitor}<div>Пока никто не подключался.</div></div>`
      }
    </div>

    <button class="btn btn-danger" id="btn-kick">Сбросить все подключения</button>
    <div class="fs12 t3 mt16" style="text-align:center">
      Отключит все устройства — заново подключатся автоматически
    </div>`;

    $("btn-kick").addEventListener("click", kickDevices);
}

async function kickDevices() {
    const btn = $("btn-kick");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Сбрасываем…';
    try {
        await api("/api/devices/kick", { method: "POST", body: {} });
        haptic("ok");
        toast("Подключения сброшены");
        await loadDevices();
        renderDevices();
    } catch (e) {
        haptic("err");
        toast(e.message, true);
        btn.disabled = false;
        btn.textContent = "Сбросить все подключения";
    }
}

function renderExtend(target = null) {
    const el = target || $("tab-extend");
    const sub = S.me.sub;
    const paidSub = sub && !sub.is_trial;
    const autopay = S.me.autopay;
    if (paidSub && autopay?.active) {
        el.innerHTML = `<div class="card autopay-card">
          <div class="card-title">${ICON.shield} Автопродление включено</div>
          <div class="row"><span class="row-k">Период</span><span class="row-v">${esc(autopay.period_days)} ${plural(autopay.period_days, "день", "дня", "дней")}</span></div>
          <div class="row"><span class="row-k">Следующее списание</span><span class="row-v">${esc(autopay.amount)} ₽</span></div>
          <div class="card-desc mt16">Оставшиеся оплаченные дни сохраняются. Ручное продление недоступно, пока включены автосписания.</div>
          <button class="btn btn-danger-soft mt16" id="btn-cancel-autopay">Отключить автопродление</button>
        </div>`;
        $("btn-cancel-autopay").addEventListener("click", cancelAutopay);
        return;
    }

    const recurringAvailable = Object.keys(S.prices.autopay_periods || {}).length > 0;
    if (!recurringAvailable) S.paymentMode = "once";
    const recurring = S.paymentMode === "autopay";
    const periods = recurring ? (S.prices.autopay_periods || {}) : (S.prices.extend || S.prices.periods || {});
    const keys = Object.keys(periods)
        .map(Number)
        .sort((a, b) => a - b);
    const best = keys.length ? keys[keys.length - 1] : null;
    if (!keys.includes(Number(S.plan))) S.plan = keys.includes(30) ? 30 : keys[0];

    const deviceOptions = Object.keys(S.prices.devices || {}).map(Number).sort((a, b) => a - b);
    if (!deviceOptions.includes(Number(S.purchaseDevices))) S.purchaseDevices = deviceOptions[0] || 2;
    const cur = paidSub ? Number(sub.devices) || 1 : S.purchaseDevices;
    const maxDev = Number(S.prices.max_devices) || 20;
    const addPrice = Number(S.prices.device_add_price) || 0;
    if (S.devTarget == null || S.devTarget < cur) S.devTarget = cur;

    const planPrice = (days) => Number(periods[days]) + (recurring ? Number((S.prices.devices || {})[cur] || 0) : (!paidSub ? Number((S.prices.devices || {})[cur] || 0) : 0));

    el.innerHTML = `
    <div class="card">
      ${sub?.is_trial ? '<div class="notice">Пробный ключ сохранится, переподключаться не придётся.</div>' : ""}
      ${!paidSub ? `<div class="card-title">${ICON.monitor} Количество устройств</div>
        <div class="choice-grid devices-choice">${deviceOptions.map(d => `<button type="button" class="choice ${cur === d ? "sel" : ""}" data-devices="${d}" aria-pressed="${cur === d}">${d}<small>устр.</small></button>`).join("")}</div>` : ""}
      <div class="card-title section-title">${ICON.shield} Способ продления</div>
      <div class="segmented" role="group" aria-label="Способ оплаты">
        ${recurringAvailable ? `<button type="button" class="segment ${recurring ? "active" : ""}" data-mode="autopay">СБП автоматически</button>` : ""}
        <button type="button" class="segment ${!recurring ? "active" : ""}" data-mode="once">Разовая оплата</button>
      </div>
      <div class="mode-note">${recurring ? "Остаток дней сохранится. Следующее списание — через выбранный период." : "Без последующих автоматических списаний."}</div>
      <div class="card-title section-title">${ICON.clock} ${paidSub ? "На сколько продлить" : "Период подписки"}</div>
      <div class="plans" id="plans">
        ${keys
            .map((d) => {
                const price = planPrice(d);
                const perDay = (price / d).toLocaleString("ru-RU", {maximumFractionDigits: 1});
                return `<button type="button" class="plan ${S.plan === d ? "sel" : ""}" data-days="${d}" aria-pressed="${S.plan === d}">
            <div>
              <div class="plan-days">${d} ${plural(d, "день", "дня", "дней")}${d === best ? '<span class="plan-tag">выгодно</span>' : ""}</div>
              <div class="plan-note">${perDay} ₽ в день</div>
            </div>
            <div class="plan-price">${price} ₽</div>
          </button>`;
            })
            .join("")}
      </div>
      <button class="btn btn-primary mt16" id="btn-pay">${ICON.zap} ${paidSub ? "Продлить" : "Оформить подписку"}</button>
      ${recurring ? '<p class="legal-note">Оплачивая, вы принимаете <a href="https://links.palma-net.pw/legal?doc=autopay" target="_blank" rel="noopener">условия автосписаний</a>.</p>' : ""}
    </div>

    ${paidSub ? `<div class="card">
      <div class="card-title">${ICON.monitor} Добавить устройств</div>
      <div class="card-desc">Сейчас в тарифе ${esc(cur)} ${plural(cur, "устройство", "устройства", "устройств")}.
      Каждое дополнительное — ${addPrice} ₽ до конца текущей подписки.</div>
      <div class="stepper">
        <button class="step-btn" id="dev-minus" ${S.devTarget <= cur ? "disabled" : ""}>−</button>
        <div class="step-val">
          <div class="step-num" id="dev-num">${S.devTarget}</div>
          <div class="step-k">${plural(S.devTarget, "устройство", "устройства", "устройств")}</div>
        </div>
        <button class="step-btn" id="dev-plus" ${S.devTarget >= maxDev ? "disabled" : ""}>+</button>
      </div>
      <div class="step-sum" id="dev-sum"></div>
      <button class="btn btn-primary" id="btn-paydev">${ICON.zap} Докупить устройства</button>
    </div>` : ""}

    <div class="fs12 t3 pay-caption">Оплата зачисляется автоматически</div>`;

    el.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
        S.paymentMode = button.dataset.mode;
        S.plan = null;
        haptic("light");
        renderExtend(el);
    }));
    el.querySelectorAll("[data-devices]").forEach(button => button.addEventListener("click", () => {
        S.purchaseDevices = Number(button.dataset.devices);
        haptic("light");
        renderExtend(el);
    }));

    el.querySelectorAll(".plan").forEach((p) => {
        p.addEventListener("click", () => {
            haptic("light");
            S.plan = Number(p.dataset.days);
            el.querySelectorAll(".plan").forEach((x) => {x.classList.remove("sel"); x.setAttribute("aria-pressed", "false");});
            p.classList.add("sel");
            p.setAttribute("aria-pressed", "true");
        });
    });
    $("btn-pay").addEventListener("click", payExtend);

    if (!paidSub) return;
    const syncDev = () => {
        const added = S.devTarget - cur;
        $("dev-num").textContent = S.devTarget;
        $("dev-num").nextElementSibling.textContent = plural(
            S.devTarget,
            "устройство",
            "устройства",
            "устройств",
        );
        $("dev-sum").textContent = added
            ? `+${added} ${plural(added, "устройство", "устройства", "устройств")} · ${added * addPrice} ₽`
            : "Выберите больше, чем сейчас";
        $("dev-minus").disabled = S.devTarget <= cur;
        $("dev-plus").disabled = S.devTarget >= maxDev;
        $("btn-paydev").disabled = added <= 0;
    };
    $("dev-minus").addEventListener("click", () => {
        if (S.devTarget > cur) {
            S.devTarget--;
            haptic("light");
            syncDev();
        }
    });
    $("dev-plus").addEventListener("click", () => {
        if (S.devTarget < maxDev) {
            S.devTarget++;
            haptic("light");
            syncDev();
        }
    });
    $("btn-paydev").addEventListener("click", payDevices);
    syncDev();
}

function payExtend() {
    const days = S.plan;
    const recurring = S.paymentMode === "autopay";
    const sub = S.me.sub;
    const paidSub = sub && !sub.is_trial;
    const devices = paidSub ? Number(sub.devices) : Number(S.purchaseDevices);
    const periods = recurring ? (S.prices.autopay_periods || {}) : (S.prices.extend || S.prices.periods || {});
    const price = Number(periods[days]) + (recurring || !paidSub ? Number((S.prices.devices || {})[devices] || 0) : 0);
    if (!price) return toast("Выберите срок", true);
    const kind = paidSub ? "extend" : "subscription";
    const body = paidSub ? {sub_id: sub.id, days, devices} : {devices, period: days};
    checkout(kind, body, price, `${paidSub ? "Продление" : "Подписка"} на ${days} дней`, recurring ? ["antilopay"] : ["rollypay", "xrocket"]);
}

function payDevices() {
    const selected = S.devTarget;
    const added = selected - Number(S.me.sub.devices);
    const price = added * Number(S.prices.device_add_price);
    if (added <= 0 || !price) return toast("Выберите больше устройств", true);
    checkout("devices", {sub_id: S.me.sub.id, selected}, price, "Устройства: " + S.me.sub.devices + " → " + selected);
}

async function cancelAutopay() {
    if (!window.confirm("Отключить автопродление? Текущая подписка продолжит работать до даты окончания.")) return;
    const btn = $("btn-cancel-autopay");
    btn.disabled = true;
    btn.textContent = "Отключаем…";
    try {
        await api("/api/autopay/cancel", {method: "POST"});
        haptic("ok");
        toast("Автопродление отключено");
        await refresh();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = "Отключить автопродление";
        haptic("err");
        toast(e.message, true);
    }
}

let checkoutBusy = false;
let pendingPayment = null;
let paymentTimer = null;
let checkingPayment = false;
const paymentKey = () => "palm-payment-" + S.uid;

function savePayment(value) {
    pendingPayment = value;
    try {
        if (value) localStorage.setItem(paymentKey(), JSON.stringify(value));
        else localStorage.removeItem(paymentKey());
    } catch (_) { /* Private mode: keep the invoice for this session. */ }
    renderPendingPayment();
}

function restorePayment() {
    try { pendingPayment = JSON.parse(localStorage.getItem(paymentKey()) || "null"); } catch (_) {}
    if (!pendingPayment || typeof pendingPayment !== "object" || !pendingPayment.body) pendingPayment = null;
    renderPendingPayment();
    if (pendingPayment?.payment_ref) pollPayment();
}

function renderPendingPayment() {
    const el = $("pending-payment");
    el.classList.toggle("hidden", !pendingPayment);
    if (!pendingPayment) return;
    const p = pendingPayment;
    const hasUrl = Boolean(p.payment_url);
    el.innerHTML = '<div class="card-title">' + ICON.clock + 'Ваш счёт сохранён</div>' +
        '<p class="card-desc">' + esc(p.label) + ' · ' + esc(p.amount) + ' ₽</p>' +
        '<p class="card-desc payment-status">' + (hasUrl ? 'После оплаты проверьте статус. Повторно платить не нужно.' : 'Платёжная система готовит ссылку. Новый счёт создавать не нужно.') + '</p>' +
        '<div class="btn-row mt16"><button class="btn btn-primary" id="invoice-open">' + (hasUrl ? 'Открыть счёт' : 'Проверить готовность') + '</button>' +
        '<button class="btn btn-ghost" id="invoice-check">Проверить оплату</button></div>' +
        '<button class="text-button" id="invoice-dismiss">Закрыть карточку</button>';
    $("invoice-open").disabled = checkoutBusy;
    $("invoice-open").onclick = () => hasUrl ? openLink(p.payment_url) : pollPayment(true);
    $("invoice-check").onclick = () => pollPayment(true);
    $("invoice-dismiss").onclick = () => {
        if (checkoutBusy || checkingPayment) return;
        if (!window.confirm("Это скроет карточку, но не отменит счёт. Если вы уже оплатили, дождитесь подтверждения и не создавайте новый.")) return;
        clearTimeout(paymentTimer);
        savePayment(null);
    };
}

function checkout(kind, body, price, label, allowedMethods = ["rollypay", "xrocket"]) {
    if (checkoutBusy || document.querySelector(".payment-dialog")) return;
    if (pendingPayment) {
        $("pending-payment").scrollIntoView({behavior: "smooth", block: "center"});
        return toast("Сначала проверьте сохранённый счёт");
    }
    showPaymentMethodModal(price, label, allowedMethods, (method) => {
        const request_id = window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
        const order = {kind, body: {...body, method, request_id}, amount: price, label};
        savePayment(order);
        createInvoice(order);
    });
}

async function createInvoice(order) {
    if (checkoutBusy) return;
    checkoutBusy = true;
    renderPendingPayment();
    try {
        const r = await api("/api/pay/" + order.kind, {method: "POST", body: order.body});
        if (!r.payment_ref) throw new Error("Не удалось зарегистрировать счёт. Обратитесь в поддержку.");
        savePayment({...order, ...r});
        if (r.payment_url) openLink(r.payment_url);
        else toast("Счёт создаётся. Ссылка появится автоматически.");
        pollPayment();
    } catch (e) {
        toast(e.message, true);
    } finally {
        checkoutBusy = false;
        renderPendingPayment();
    }
}

function showPaymentMethodModal(price, label, allowedMethods, onSelect) {
    const methods = (S.prices.payment_methods || []).filter(m => allowedMethods.includes(m.key));
    if (!methods.length) return toast("Оплата временно недоступна. Напишите в поддержку.", true);
    const previous = document.activeElement;
    const modal = document.createElement("div");
    modal.className = "modal-overlay payment-dialog";
    modal.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="payment-title">' +
        '<div class="modal-header"><h3 id="payment-title">Оплата подписки</h3><button class="modal-close" aria-label="Закрыть">×</button></div>' +
        '<div class="modal-body"><p class="checkout-label">' + esc(label) + '</p><div class="payment-price">К оплате <strong>' + esc(price) + ' ₽</strong></div>' +
        methods.map(m => '<button type="button" class="payment-method" data-method="' + esc(m.key) + '"><span class="payment-icon">' + paymentIcon(m.key) +
        '</span><span class="payment-info"><span class="payment-name">' + esc(m.name) + '</span><span class="payment-desc">' + esc(m.desc) + '</span></span><span class="payment-arrow">→</span></button>').join("") +
        (methods.some(m => m.recurrent) ? '<p class="checkout-note">Оплачивая, вы принимаете <a href="https://links.palma-net.pw/legal?doc=autopay" target="_blank" rel="noopener">условия автосписаний</a>. Отключить автопродление можно в профиле.</p>' : '<p class="checkout-note">Срок и лимит обновятся после подтверждения оплаты.</p>') + '</div></div>';
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        modal.remove();
        document.body.classList.remove("modal-open");
        previous?.focus();
    };
    modal.querySelector(".modal-close").onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.onkeydown = e => {
        if (e.key === "Escape") close();
        if (e.key === "Tab") {
            const buttons = [...modal.querySelectorAll("button")];
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last.focus();}
            else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}
        }
    };
    modal.querySelectorAll(".payment-method").forEach(button => button.onclick = () => {
        if (closed) return;
        const method = button.dataset.method;
        close();
        onSelect(method);
    });
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modal.classList.add("show"));
    modal.querySelector(".modal-close").focus();
}

function paymentIcon(key) {
    const src = key === "xrocket" ? "/icon-xrocket.png" : key === "rollypay" ? "/icon-sbp.png" : "/icon-shield.png";
    return '<img src="' + src + '" alt="" width="24" height="24" loading="lazy">';
}

async function pollPayment(manual = false, attempt = 0) {
    clearTimeout(paymentTimer);
    if (checkingPayment || !pendingPayment?.payment_ref) return;
    let order = pendingPayment;
    checkingPayment = true;
    try {
        const r = await api("/api/pay/check/" + encodeURIComponent(order.payment_ref));
        if (pendingPayment !== order) return;
        if (r.payment_url && (!order.payment_url || r.payment_ref !== order.payment_ref)) {
            const updated = {...order, payment_url: r.payment_url, payment_ref: r.payment_ref || order.payment_ref};
            savePayment(updated);
            order = updated;
            if (manual) openLink(r.payment_url);
        }
        if (r.status === "completed") {
            savePayment(null);
            haptic("ok");
            toast(order.kind === "devices" ? "Оплачено — лимит устройств обновлён" : order.kind === "subscription" ? "Оплачено — подписка активирована" : "Оплачено — подписка продлена");
            await refresh();
        } else if (r.status === "expired") {
            savePayment(null);
            toast("Срок счёта истёк или он отменён. Можно создать новый.", true);
        } else if (manual && r.status === "creating") toast("Ссылка ещё готовится. Повторно платить не нужно.");
        else if (manual) toast("Подтверждение ещё не пришло. Повторно платить не нужно.");
    } catch (e) {
        if (manual) toast("Не удалось проверить оплату. Счёт сохранён, попробуйте позже.", true);
    } finally {
        checkingPayment = false;
        if (pendingPayment === order && attempt < 40 && !document.hidden)
            paymentTimer = setTimeout(() => pollPayment(false, attempt + 1), 3000);
    }
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && S.token && pendingPayment?.payment_ref) pollPayment();
    else clearTimeout(paymentTimer);
});

function renderProfile() {
    const me = S.me;
    const el = $("tab-profile");
    const refLink =
        me.ref_link ||
        `https://t.me/${me.bot_username || "palm_vpnbot"}?start=${me.user_id}`;

    el.innerHTML = `
    <div class="profile-identity">
      <div class="avatar" id="avatar">P</div>
      <div class="profile-name"><div id="hi"></div><div id="uid"></div></div>
    </div>
    <div class="profile-balance"><span>Баланс</span><strong id="balance"></strong></div>
    ${me.autopay?.active ? `<div class="card autopay-summary">
      <div class="card-title">${ICON.shield} Автопродление активно</div>
      <div class="card-desc">${esc(me.autopay.amount)} ₽ каждые ${esc(me.autopay.period_days)} ${plural(me.autopay.period_days, "день", "дня", "дней")}</div>
      <button class="btn btn-danger-soft mt16" id="profile-cancel-autopay">Отключить</button>
    </div>` : ""}
    <div class="card">
      <div class="card-title">${ICON.user} Аккаунт</div>
      <div class="row"><span class="row-k">Telegram ID</span><span class="row-v mono">${esc(me.user_id)}</span></div>
      <div class="row"><span class="row-k">Email</span><span class="row-v">${me.email ? esc(me.email) : "не привязан"}</span></div>
    </div>

    <div class="card">
      <div class="card-title">${ICON.users} Приведи друга</div>
      <div class="card-desc">За каждую оплату приглашённого — ${esc(me.ref_percent || 30)}% на ваш баланс.
      Друг получает продлённый пробный период.</div>
      <div class="ref-stats">
        <div class="ref-stat">
          <div class="ref-stat-val">${esc(me.ref_count || 0)}</div>
          <div class="ref-stat-k">${plural(me.ref_count || 0, "друг", "друга", "друзей")}</div>
        </div>
        <div class="ref-stat">
          <div class="ref-stat-val">${Math.round(me.ref_earned || 0)} ₽</div>
          <div class="ref-stat-k">заработано</div>
        </div>
      </div>
      <div class="ref-link" id="ref-link">${esc(refLink)}</div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="btn-refcopy">${ICON.copy} Копировать</button>
        <button class="btn btn-primary" id="btn-refshare">${ICON.share} Поделиться</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${ICON.shield} Поддержка</div>
      <div class="card-desc">Вопрос по подписке или подключению — напишите в бота, отвечаем быстро.</div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" id="btn-bot3">${ICON.tg} Написать</button>
        <button class="btn btn-ghost" id="btn-rate">Оценить</button>
      </div>
    </div>`;

    renderHeader();
    const cancel = $("profile-cancel-autopay");
    if (cancel) cancel.addEventListener("click", cancelAutopay);

    $("btn-refcopy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(refLink);
            haptic("ok");
            toast("Ссылка скопирована");
        } catch (e) {
            haptic("err");
            toast("Не удалось скопировать", true);
        }
    });
    $("btn-refshare").addEventListener("click", () => {
        haptic("medium");
        const text = "Пользуюсь Palm VPN — быстрый, без настроек. Заходи по моей ссылке:";
        const url = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`;
        if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, "_blank", "noopener");
    });
    $("btn-bot3").addEventListener("click", openBot);
    $("btn-rate").addEventListener("click", () => {
        haptic("light");
        openLink(`https://rate.palmvpn.club/?user_id=${me.user_id}`);
    });
}

$("btn-reload").addEventListener("click", () => location.reload());
boot();
