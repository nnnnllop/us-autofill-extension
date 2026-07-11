const $ = id => document.getElementById(id);

const statusDot = $("statusDot");
const statusText = $("statusText");
const appRoot = $("appRoot");
const onboarding = $("onboarding");
const profileSummary = $("profileSummary");
const profileSummaryText = $("profileSummaryText");
const shortcutKbd = $("shortcutKbd");

let cardPollTimer = null;
let currentCountry = "US";
let currentCurrency = "USD";
let lastAddress = null;
let lastCard = null;
let profiles = [];
let activeProfileId = "default";
let addressPinned = false;
let showProfileSummary = true;
let onboardingDismissed = false;
let cardPollCount = 0;
const CARD_POLL_MAX = 40;
const BG_TIMEOUT_MS = 15000;

function sendBg(action, payload = {}, timeoutMs = BG_TIMEOUT_MS) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ error: "timeout" }), timeoutMs);
    chrome.runtime.sendMessage({ action, ...payload }, res => {
      if (chrome.runtime.lastError) {
        finish({ error: chrome.runtime.lastError.message });
        return;
      }
      finish(res ?? { error: "no_response" });
    });
  });
}

function dismissOnboarding() {
  onboardingDismissed = true;
  if (onboarding) onboarding.hidden = true;
  chrome.storage.local.set({ onboardingDone: true });
  sendBg("setSettings", { onboardingDone: true }, 5000);
}

function applySettings(settings) {
  if (!settings) return;
  if ($("soundMuteToggle")) $("soundMuteToggle").checked = !settings.soundMuted;
  if ($("compactModeToggle")) $("compactModeToggle").checked = !!settings.compactMode;
  if ($("stripeFabToggle")) $("stripeFabToggle").checked = settings.stripeFabEnabled !== false;
  showProfileSummary = settings.showProfileSummary !== false;
  if ($("showSummaryToggle")) $("showSummaryToggle").checked = showProfileSummary;
  document.body.classList.toggle("compact-mode", !!settings.compactMode);
  if (settings.onboardingDone) {
    onboardingDismissed = true;
    if (onboarding) onboarding.hidden = true;
  } else if (onboarding && !onboardingDismissed) {
    onboarding.hidden = false;
  }
}

function updateAutoFillBetaNote(enabled) {
  const note = $("autoFillBetaNote");
  if (note) note.hidden = !enabled;
}

function setDevLogCount(count) {
  safeSetText("devLogCount", `Логи: ${count || 0}`);
}

function formatDevLogLine(log) {
  const ts = log.ts || "";
  const level = (log.level || "info").toUpperCase();
  const source = log.source || "unknown";
  const message = log.message || "";
  const url = log.url ? ` | ${log.url}` : "";
  const details = log.details ? ` | ${log.details}` : "";
  return `[${ts}] [${level}] [${source}] ${message}${url}${details}`;
}

function serializeDevLogs(logs) {
  if (!logs.length) return "Dev-логов нет.";
  return logs.map(formatDevLogLine).join("\n");
}

async function fetchDevLogs() {
  const res = await sendBg("getDevLogs", {}, 8000);
  return Array.isArray(res?.logs) ? res.logs : [];
}

async function refreshDevLogCount() {
  const logs = await fetchDevLogs();
  setDevLogCount(logs.length);
  return logs;
}

async function downloadDevLogs() {
  const logs = await refreshDevLogCount();
  const blob = new Blob([serializeDevLogs(logs)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `autofill-dev-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("active", "Dev-логи скачаны");
}

async function copyDevLogs() {
  const logs = await refreshDevLogCount();
  try {
    await navigator.clipboard.writeText(serializeDevLogs(logs));
    setStatus("active", "Dev-логи скопированы");
  } catch {
    setStatus("error", "Не удалось скопировать dev-логи");
  }
}

async function clearDevLogs() {
  const res = await sendBg("clearDevLogs", {}, 8000);
  if (res?.ok) {
    setDevLogCount(0);
    setStatus("active", "Dev-логи очищены");
  } else {
    setStatus("error", "Не удалось очистить dev-логи");
  }
}

function renderCountriesList(countries, selectedCode) {
  const sel = $("countrySelect");
  if (!sel || !countries) return;
  sel.innerHTML = "";
  countries.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.flag} ${c.name}`;
    if (c.code === selectedCode) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderCurrenciesList(currencies, selectedCode) {
  const sel = $("currencySelect");
  if (!sel || !currencies) return;
  sel.innerHTML = "";
  currencies.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.flag} ${c.code} — ${c.name}`;
    if (c.code === selectedCode) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderBinPresetsList(presets, activeBin) {
  const el = $("binPresets");
  if (!el || !presets) return;
  el.innerHTML = "";
  presets.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bin-preset";
    btn.dataset.bin = p.bin;
    btn.textContent = p.short;
    btn.title = `${p.label} — ${p.bin}`;
    btn.addEventListener("click", () => {
      if ($("binInput")) $("binInput").value = p.bin;
      highlightBinPreset(p.bin);
      sendBg("setBin", { bin: p.bin }).then(() => {
        saveCurrentToProfile();
        refreshCardOnly(true);
      });
    });
    el.appendChild(btn);
  });
  if (activeBin) highlightBinPreset(activeBin);
}

const STATE_LABELS = {
  US: "Штат", GB: "Графство", DE: "Земля", FR: "Регион",
  CA: "Провинция", AU: "Штат", NL: "Провинция", IT: "Регион",
  ES: "Регион", PL: "Воеводство"
};

const REPORT_STATUS_LABELS = {
  filled: "✓",
  not_found: "—",
  skipped: "·",
  pending: "?",
  iframe: "↗"
};

const fillButtons = ["btnFillAll", "btnFillAddress", "btnFillCard"].map($).filter(Boolean);
const refreshButtons = ["btnRefreshAddress", "btnRefreshCard", "btnRefreshAll"].map($).filter(Boolean);

function safeSetText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setCardStatus(badgeText, badgeClass, text, color) {
  const el = $("cardStatusBadge");
  if (!el) return;
  el.textContent = "";

  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass}`;
  badge.textContent = badgeText;

  const status = document.createElement("span");
  status.id = "cardStatusText";
  status.textContent = text;
  if (color) status.style.color = color;

  el.appendChild(badge);
  el.appendChild(status);
}

function setButtonsDisabled(disabled) {
  fillButtons.forEach(btn => { btn.disabled = disabled; });
}

function setRefreshDisabled(disabled) {
  refreshButtons.forEach(btn => { btn.disabled = disabled; });
}

function formatCardNumber(num) {
  if (!num) return "•••• •••• •••• ••••";
  return num.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function maskCardNumber(num) {
  if (!num) return "•••• •••• •••• ••••";
  const clean = num.replace(/\s/g, "");
  if (clean.length <= 10) return clean;
  return formatCardNumber(clean.slice(0, 6) + "•••••" + clean.slice(-4));
}

function setStatus(type, text) {
  if (!statusDot || !statusText) return;
  statusDot.className = "dot " + (type || "");
  statusText.textContent = text;
}

function updateCardPreview(card, address) {
  const name = address?.fullName || "—";
  safeSetText("cardPreviewName", name.toUpperCase());
  if (!card) {
    safeSetText("cardPreviewNumber", "•••• •••• •••• ••••");
    safeSetText("cardPreviewExpiry", "—");
    safeSetText("cardTypeBadge", "—");
    return;
  }
  safeSetText("cardPreviewNumber", maskCardNumber(card.number));
  safeSetText("cardPreviewExpiry", card.formattedExpiry || "—");
  safeSetText("cardTypeBadge", (card.type || "card").toUpperCase().slice(0, 4));
}

function updatePinUI(pinned) {
  addressPinned = !!pinned;
  const badge = $("pinBadge");
  const btn = $("btnPinAddress");
  if (badge) badge.hidden = !pinned;
  if (btn) {
    btn.classList.toggle("active", pinned);
    btn.title = pinned ? "Открепить адрес" : "Закрепить адрес";
    btn.textContent = pinned ? "📍" : "📌";
  }
}

function updateProfileSummary() {
  const el = profileSummary;
  const textEl = profileSummaryText;
  if (!el || !textEl) return;

  if (!showProfileSummary) {
    el.hidden = true;
    return;
  }

  const active = profiles.find(p => p.id === activeProfileId);
  const cardShort = (lastCard?.type || "card").toUpperCase().slice(0, 4);
  const email = ($("emailInput")?.value || lastAddress?.email || active?.email || "").trim();
  const emailShort = email.length > 22 ? email.slice(0, 20) + "…" : (email || "—");

  textEl.textContent = `${active?.name || "—"} · ${cardShort} · ${active?.country || currentCountry} · ${emailShort}`;
  el.hidden = false;
}

function renderAddress(addr) {
  if (!addr) return;
  const code = addr.country || currentCountry;
  safeSetText("addrStateLabel", STATE_LABELS[code] || "Регион");
  safeSetText("addrZipLabel", code === "US" ? "Индекс" : "Почтовый индекс");
  safeSetText("addrEmail", addr.email || "—");
  safeSetText("addrFirstName", addr.firstName || "—");
  safeSetText("addrLastName", addr.lastName || "—");
  safeSetText("addrAddress1", addr.address1 || "—");
  safeSetText("addrCity", addr.city || "—");
  safeSetText("addrState", addr.stateAbbr ? `${addr.stateAbbr} (${addr.state})` : (addr.state || "—"));
  safeSetText("addrZip", addr.zip || "—");
  safeSetText("addrCountry", addr.countryName ? `${addr.country} — ${addr.countryName}` : (addr.country || "—"));
  updatePinUI(addr.pinned);
  updateProfileSummary();
}

function renderCheckDetails(checks) {
  const el = $("cardCheckDetails");
  if (!el) return;
  if (!checks || !Array.isArray(checks) || checks.length === 0) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }

  el.innerHTML = "";
  checks.forEach(c => {
    const row = document.createElement("div");
    row.className = "check-row";

    let badgeClass = "badge-unknown";
    let statusText = c.status || "UNKNOWN";
    if (c.code === 1) {
      badgeClass = "badge-live";
      statusText = "APPROVED";
    } else if (c.code === 0) {
      badgeClass = "badge-die";
      statusText = "DECLINED";
    } else if (c.status === "rate_limited") {
      badgeClass = "badge-unavailable";
      statusText = "LIMIT";
    } else if (c.status === "timeout") {
      badgeClass = "badge-unavailable";
      statusText = "TIMEOUT";
    } else if (c.status === "unavailable") {
      badgeClass = "badge-unavailable";
      statusText = "ERROR";
    }

    const codeSpan = c.code !== undefined && c.code !== null && c.code !== -1
      ? `<span class="check-meta-item">Код: <strong>${c.code}</strong></span>`
      : "";

    const timeSpan = c.time !== undefined && c.time !== null
      ? `<span class="check-meta-item">Время: <strong>${c.time} мс</strong></span>`
      : "";

    row.innerHTML = `
      <div class="check-header">
        <span class="check-api">${c.api || "unknown"}</span>
        <span class="badge ${badgeClass}">${statusText}</span>
      </div>
      <div class="check-meta">
        ${codeSpan}
        <span class="check-meta-item check-meta-msg" title="${c.message || ''}">Ответ: <strong>${c.message || '—'}</strong></span>
        ${timeSpan}
      </div>
    `;
    el.appendChild(row);
  });
  el.hidden = false;
}

function renderCard(card) {
  if (!$("cardStatusBadge")) return;
  lastCard = card;

  if (!card) {
    setCardStatus("❌", "badge-die", "Карта не получена", "#ef4444");
    updateCardPreview(null, lastAddress);
    updateProfileSummary();
    const detailsEl = $("cardCheckDetails");
    if (detailsEl) {
      detailsEl.innerHTML = "";
      detailsEl.hidden = true;
    }
    return;
  }

  const num = card.number || "";
  safeSetText("cardNumber", num.length > 10 ? num.slice(0, 6) + "•••••" + num.slice(-4) : num);
  safeSetText("cardExpiry", card.formattedExpiry || "—");
  safeSetText("cardCVV", card.cvv ? "•••" : "—");
  safeSetText("cardType", (card.type || "—").toUpperCase());
  safeSetText("cardBank", card.bank || "—");
  updateCardPreview(card, lastAddress);
  updateProfileSummary();

  const vs = card.validationStatus;
  if (card.validated && vs === "live") {
    setCardStatus("API: APPROVED", "badge-live", "Approved (namso & chkr)", "#22c55e");
  } else if (card.validated && vs === "live_partial") {
    setCardStatus("APPROVED (LIMIT)", "badge-unknown", "Approved (namso), chkr limit", "#f59e0b");
  } else if (vs === "unavailable" || vs === "rate_limited" || vs === "timeout") {
    setCardStatus("API", "badge-unavailable", card.validationMessage || "API недоступен", "#a855f7");
  } else if (vs === "failed") {
    setCardStatus("Лун ✓", "badge-unknown", "Live не подтверждена", "#f59e0b");
  } else if (vs === "checking") {
    setCardStatus("⏳", "badge-loading", card.validationMessage || "Проверяется...", "#94a3b8");
  } else {
    setCardStatus("?", "badge-unknown", "Неизвестно", "#f59e0b");
  }

  renderCheckDetails(card.checks);
}

function renderFillReport(result) {
  const panel = $("fillReportPanel");
  const list = $("fillReportList");
  if (!panel || !list || !result?.report) return;

  const relevant = result.report.filter(r => r.status !== "pending");
  if (relevant.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  list.innerHTML = "";
  relevant.forEach(item => {
    const li = document.createElement("li");
    li.className = "report-item";
    const statusClass = `report-status report-status--${item.status}`;
    const statusLabel = REPORT_STATUS_LABELS[item.status] || item.status;
    const label = document.createElement("span");
    label.className = "report-label";
    label.textContent = item.label;
    const status = document.createElement("span");
    status.className = statusClass;
    status.textContent = statusLabel;
    li.appendChild(label);
    li.appendChild(status);
    list.appendChild(li);
  });
}

function handleFillResult(res) {
  if (!res) {
    setStatus("error", "Нет ответа");
    return;
  }
  renderFillReport(res);
  if (res.filled > 0) setStatus("active", res.message || `Заполнено ${res.filled}`);
  else if (res.neutral) setStatus("", res.message || "Нет полей");
  else setStatus("", res.message || "Нечего заполнять");
}

async function copyText(text, label) {
  if (!text || text === "—") return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("active", `${label} скопировано ✅`);
    setTimeout(() => setStatus("active", "Готово"), 1200);
  } catch {
    setStatus("error", "Не удалось скопировать");
  }
}

function setupCopyOnClick() {
  document.querySelectorAll(".data-item--copy").forEach(item => {
    item.addEventListener("click", () => {
      const id = item.dataset.copy;
      const rawId = item.dataset.copyRaw;
      let text = "";

      if (rawId === "cardNumberRaw" && lastCard?.number) text = lastCard.number;
      else if (rawId === "cardCVVRaw" && lastCard?.cvv) text = lastCard.cvv;
      else if (id) {
        const el = $(id);
        text = el?.textContent?.trim() || "";
      }

      if (!text || text === "—") return;
      copyText(text, item.querySelector(".data-label")?.textContent || "Значение");
      item.classList.add("copied");
      setTimeout(() => item.classList.remove("copied"), 800);
    });
  });
}

function loadCountries(selectedCode) {
  chrome.runtime.sendMessage({ action: "getCountries" }, res => {
    const sel = $("countrySelect");
    if (!sel || !res?.countries) return;
    sel.innerHTML = "";
    res.countries.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.flag} ${c.name}`;
      if (c.code === selectedCode) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function renderProfiles(activeId) {
  const sel = $("profileSelect");
  if (!sel) return;
  sel.innerHTML = "";
  profiles.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    sel.appendChild(opt);
  });
  const delBtn = $("btnDeleteProfile");
  const addBtn = $("btnAddProfile");
  if (delBtn) delBtn.disabled = profiles.length <= 1;
  if (addBtn) addBtn.disabled = profiles.length >= 50;
  updateProfileSummary();
}

function loadProfiles() {
  chrome.runtime.sendMessage({ action: "getProfiles" }, res => {
    if (!res?.profiles) return;
    profiles = res.profiles;
    activeProfileId = res.activeId || profiles[0]?.id;
    renderProfiles(activeProfileId);
    const active = profiles.find(p => p.id === activeProfileId);
    if (active) {
      if ($("emailInput")) $("emailInput").value = active.email || "";
      if ($("binInput")) $("binInput").value = active.bin || "";
      highlightBinPreset(active.bin);
    }
  });
}

function getProfilePayload(profile) {
  return {
    ...profile,
    country: $("countrySelect")?.value || currentCountry,
    currency: $("currencySelect")?.value || currentCurrency,
    bin: $("binInput")?.value?.replace(/\D/g, "") || profile.bin,
    email: $("emailInput")?.value?.trim() || ""
  };
}

async function saveCurrentToProfile() {
  const active = profiles.find(p => p.id === activeProfileId);
  if (!active) return;
  const res = await sendBg("saveProfile", { profile: getProfilePayload(active) }, 8000);
  if (res?.profiles) {
    profiles = res.profiles;
    updateProfileSummary();
  }
}

async function applyProfileToUI(profile, options = {}) {
  if (!profile) return;
  activeProfileId = profile.id;
  currentCountry = profile.country || currentCountry;
  currentCurrency = profile.currency || currentCurrency;
  if ($("countrySelect")) $("countrySelect").value = currentCountry;
  if ($("currencySelect")) $("currencySelect").value = currentCurrency;
  if ($("binInput")) $("binInput").value = profile.bin || "";
  if ($("emailInput")) $("emailInput").value = profile.email || "";
  highlightBinPreset(profile.bin);

  const pinRes = await sendBg("getPinnedStatus", {}, 8000);
  updatePinUI(pinRes?.pinned);

  const addrRes = await sendBg("getAddress", { country: currentCountry, cacheOnly: true }, 5000);
  if (pinRes?.address) {
    lastAddress = profile.email
      ? { ...pinRes.address, email: profile.email, pinned: true }
      : { ...pinRes.address, pinned: true };
  } else if (addrRes?.address) {
    lastAddress = profile.email
      ? { ...addrRes.address, email: profile.email }
      : addrRes.address;
  }
  if (lastAddress) renderAddress(lastAddress);

  if (options.reloadCard) {
    const cardRes = await sendBg("getCardCache", {}, 5000);
    if (cardRes?.card) {
      renderCard(cardRes.card);
      if (cardRes.card.validationStatus === "checking") startCardPolling();
    } else {
      await refreshCardOnly(true);
    }
  }

  updateProfileSummary();
}

async function switchProfile(id) {
  await saveCurrentToProfile();
  setStatus("", "Смена профиля...");
  const res = await sendBg("setActiveProfile", { id }, 10000);
  if (!res?.profile) {
    setStatus("error", res?.error === "timeout" ? "Таймаут профиля" : "Ошибка профиля");
    return;
  }
  if (res.profiles) profiles = res.profiles;
  await applyProfileToUI(res.profile, { reloadCard: true });
  setStatus("active", `${res.profile.name} ✅`);
}

function highlightBinPreset(bin) {
  const el = $("binPresets");
  if (!el) return;
  const clean = (bin || "").replace(/\D/g, "");
  el.querySelectorAll(".bin-preset").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.bin === clean);
  });
}

function loadBinPresets() {
  chrome.runtime.sendMessage({ action: "getBinPresets" }, res => {
    const el = $("binPresets");
    if (!el || !res?.presets) return;
    el.innerHTML = "";
    res.presets.forEach(p => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bin-preset";
      btn.dataset.bin = p.bin;
      btn.textContent = p.short;
      btn.title = `${p.label} — ${p.bin}`;
      btn.addEventListener("click", () => {
        if ($("binInput")) $("binInput").value = p.bin;
        highlightBinPreset(p.bin);
        chrome.runtime.sendMessage({ action: "setBin", bin: p.bin }, () => {
          saveCurrentToProfile();
          refreshCardOnly(true);
        });
      });
      el.appendChild(btn);
    });
    chrome.runtime.sendMessage({ action: "getBin" }, r => {
      if (r?.bin) highlightBinPreset(r.bin);
    });
  });
}

function loadAddressForCountry(country) {
  chrome.runtime.sendMessage({ action: "getAddress", country }, res => {
    if (!res?.address) return;
    currentCountry = country;
    chrome.runtime.sendMessage({ action: "getUserEmail" }, emailRes => {
      lastAddress = emailRes?.email ? { ...res.address, email: emailRes.email } : res.address;
      renderAddress(lastAddress);
      chrome.runtime.sendMessage({ action: "getCardCache" }, cardRes => {
        if (cardRes?.card) renderCard(cardRes.card);
      });
    });
  });
}

function loadPinnedStatus() {
  chrome.runtime.sendMessage({ action: "getPinnedStatus" }, res => {
    updatePinUI(res?.pinned);
  });
}

function stopCardPolling(onDone) {
  if (cardPollTimer) clearInterval(cardPollTimer);
  cardPollTimer = null;
  cardPollCount = 0;
  if (onDone) onDone();
}

function startCardPolling(onDone) {
  stopCardPolling();
  setCardStatus("⏳", "badge-loading", "Проверка карты...", "#94a3b8");

  cardPollTimer = setInterval(async () => {
    cardPollCount++;
    if (cardPollCount > CARD_POLL_MAX) {
      stopCardPolling(onDone);
      setCardStatus("⏱", "badge-unavailable", "Проверка зависла — нажмите «Новая»", "#a855f7");
      setStatus("error", "Проверка карты зависла");
      return;
    }

    const res = await sendBg("getCardCache", {}, 5000);
    if (res?.error) {
      stopCardPolling(onDone);
      setStatus("error", "Нет связи с расширением");
      return;
    }

    const card = res?.card;
    if (!card) return;
    if (card.validationStatus === "checking") {
      safeSetText("cardStatusText", card.validationMessage || "Проверка...");
      return;
    }

    renderCard(card);
    stopCardPolling(onDone);
    setStatus("active", card.validated ? "Карта LIVE ✅" : "Карта готова");
  }, 1500);
}

async function refreshAddressOnly() {
  const country = $("countrySelect")?.value || currentCountry;
  $("btnRefreshAddress").disabled = true;
  setStatus("", addressPinned ? "Новое имя..." : "Новый адрес...");

  const res = await sendBg("refreshAddress", { country });
  $("btnRefreshAddress").disabled = false;

  if (res?.error === "timeout") {
    setStatus("error", "Таймаут адреса — попробуйте снова");
    return;
  }
  if (res?.error) {
    setStatus("error", "Нет связи с расширением");
    return;
  }
  if (!res?.address) {
    setStatus("error", "Ошибка адреса");
    return;
  }

  const emailRes = await sendBg("getUserEmail", {}, 5000);
  lastAddress = emailRes?.email
    ? { ...res.address, email: emailRes.email, pinned: res.pinned }
    : { ...res.address, pinned: res.pinned };
  renderAddress(lastAddress);
  saveCurrentToProfile();
  setStatus("active", addressPinned ? "Имя обновлено ✅" : "Адрес обновлён ✅");
}

async function refreshCardOnly(silent) {
  $("btnRefreshCard").disabled = true;
  setButtonsDisabled(true);
  if (!silent) setStatus("", "Новая карта...");

  const res = await sendBg("startCardCheck");
  if (!res?.started) {
    $("btnRefreshCard").disabled = false;
    setButtonsDisabled(false);
    if (!silent) setStatus("error", res?.error === "timeout" ? "Таймаут карты" : "Ошибка карты");
    return;
  }

  if (res.card) renderCard(res.card);
  else {
    const cardRes = await sendBg("getCardCache", {}, 5000);
    if (cardRes?.card) renderCard(cardRes.card);
  }

  startCardPolling(() => {
    $("btnRefreshCard").disabled = false;
    setButtonsDisabled(false);
  });
}

async function refreshAll() {
  setRefreshDisabled(true);
  setButtonsDisabled(true);
  setStatus("", "Обновление...");
  const country = $("countrySelect")?.value || currentCountry;

  const res = await sendBg("refreshAddress", { country });
  if (res?.address) {
    const emailRes = await sendBg("getUserEmail", {}, 5000);
    lastAddress = emailRes?.email
      ? { ...res.address, email: emailRes.email, pinned: res.pinned }
      : { ...res.address, pinned: res.pinned };
    renderAddress(lastAddress);
  }

  const res2 = await sendBg("startCardCheck");
  if (!res2?.started) {
    setRefreshDisabled(false);
    setButtonsDisabled(false);
    setStatus("active", res?.address ? "Адрес обновлён" : "Ошибка обновления");
    return;
  }

  if (res2.card) renderCard(res2.card);
  else {
    const cardRes = await sendBg("getCardCache", {}, 5000);
    if (cardRes?.card) renderCard(cardRes.card);
  }

  startCardPolling(() => {
    setRefreshDisabled(false);
    setButtonsDisabled(false);
    setStatus("active", "Всё обновлено ✅");
  });
}

function copyAddress() {
  if (!lastAddress) return;
  const lines = [
    lastAddress.fullName, lastAddress.email, lastAddress.address1,
    `${lastAddress.city}, ${lastAddress.stateAbbr || lastAddress.state} ${lastAddress.zip}`,
    lastAddress.countryName || lastAddress.country
  ].filter(Boolean);
  copyText(lines.join("\n"), "Адрес");
}

function copyCard() {
  if (!lastCard?.number) return;
  copyText(`${lastCard.number}|${lastCard.month}|${lastCard.year}|${lastCard.cvv}`, "Карта");
}

async function fillPage(mode) {
  const labels = { all: "Всё", address: "Адрес", card: "Карта" };
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) return;
  const tabId = tabs[0].id;
  setStatus("", `Заполнение: ${labels[mode] || mode}...`);
  if ($("fillReportPanel")) $("fillReportPanel").hidden = true;

  const res = await sendBg("fillAllFrames", { tabId, mode }, 35000);
  if (res?.error) {
    setStatus("error", res.error === "timeout" ? "Таймаут заполнения" : "Ошибка заполнения");
    refreshDevLogCount();
    return;
  }
  handleFillResult(res);
  refreshDevLogCount();
}

async function initPopup() {
  setupCopyOnClick();
  setStatus("", "Загрузка...");

  const boot = await sendBg("getPopupBootstrap", {}, 10000);
  if (boot?.error) {
    setStatus("error", boot.error === "timeout" ? "Таймаут загрузки" : "Ошибка расширения");
    loadProfiles();
    loadBinPresets();
    return;
  }

  safeSetText("versionTag", `v${boot.version || "2.3.1"}`);
  profiles = boot.profiles || [];
  activeProfileId = boot.activeId || profiles[0]?.id || "default";
  currentCountry = boot.country || "US";
  currentCurrency = boot.currency || "USD";
  lastAddress = boot.address || null;
  lastCard = boot.card || null;

  renderProfiles(activeProfileId);
  renderCountriesList(boot.countries, currentCountry);
  renderCurrenciesList(boot.currencies, currentCurrency);
  renderBinPresetsList(boot.presets, boot.bin);
  applySettings(boot.settings);
  updateProfileSummary();

  const active = profiles.find(p => p.id === activeProfileId);
  if ($("emailInput")) $("emailInput").value = boot.email || active?.email || "";
  if ($("binInput") && boot.bin) $("binInput").value = boot.bin;
  if (active?.bin) highlightBinPreset(active.bin);

  if (lastAddress) renderAddress(lastAddress);
  if (lastCard) renderCard(lastCard);
  updatePinUI(boot.pinned);
  if (shortcutKbd && boot.shortcut) shortcutKbd.textContent = boot.shortcut;
  if ($("devModeToggle")) $("devModeToggle").checked = !!boot.devMode;
  setDevLogCount(boot.devLogCount || 0);

  if (!lastAddress) {
    setStatus("", "Получение адреса...");
    const refreshed = await sendBg("refreshAddress", { country: currentCountry }, 12000);
    if (refreshed?.address) {
      lastAddress = refreshed.address;
      if (boot.email) lastAddress = { ...lastAddress, email: boot.email };
      renderAddress(lastAddress);
    }
  } else {
    setStatus("active", "Данные готовы");
  }

  if (lastCard?.validationStatus === "checking") {
    startCardPolling();
    setStatus("", "Проверка карты...");
  } else if (!lastAddress) {
    setStatus("", "Нажмите «Новый» для адреса");
  }
}

initPopup().catch(() => setStatus("error", "Ошибка инициализации"));

$("btnFillAll")?.addEventListener("click", () => fillPage("all"));
$("btnFillAddress")?.addEventListener("click", () => fillPage("address"));
$("btnFillCard")?.addEventListener("click", () => fillPage("card"));
$("btnRefreshAddress")?.addEventListener("click", refreshAddressOnly);
$("btnRefreshCard")?.addEventListener("click", () => refreshCardOnly(false));
$("btnRefreshAll")?.addEventListener("click", refreshAll);
$("btnCopyAddress")?.addEventListener("click", copyAddress);
$("btnCopyCard")?.addEventListener("click", copyCard);

$("btnPinAddress")?.addEventListener("click", async () => {
  const action = addressPinned ? "unpinAddress" : "pinAddress";
  const country = $("countrySelect")?.value || currentCountry;
  setStatus("", addressPinned ? "Открепление..." : "Закрепление...");
  const res = await sendBg(action, { country }, 10000);
  if (res?.error) {
    setStatus("error", "Ошибка закрепления");
    return;
  }
  if (action === "pinAddress" && res?.address) {
    const email = $("emailInput")?.value?.trim() || res.address.email;
    lastAddress = email ? { ...res.address, email, pinned: true } : { ...res.address, pinned: true };
    renderAddress(lastAddress);
    setStatus("active", "Адрес закреплён 📌");
  } else {
    updatePinUI(false);
    if (lastAddress) lastAddress = { ...lastAddress, pinned: false };
    setStatus("active", "Адрес откреплён");
  }
});

$("profileSelect")?.addEventListener("change", () => {
  switchProfile($("profileSelect").value);
});

$("profileSelect")?.addEventListener("dblclick", () => {
  const active = profiles.find(p => p.id === activeProfileId);
  if (!active) return;
  const name = prompt("Имя профиля:", active.name);
  if (!name?.trim()) return;
  chrome.runtime.sendMessage({ action: "saveProfile", profile: { ...active, name: name.trim() } }, res => {
    if (res?.profiles) {
      profiles = res.profiles;
      renderProfiles(activeProfileId);
      setStatus("active", "Профиль переименован ✅");
    }
  });
});

$("btnAddProfile")?.addEventListener("click", async () => {
  await saveCurrentToProfile();
  const profile = {
    name: `Профиль ${profiles.length + 1}`,
    country: $("countrySelect")?.value || currentCountry,
    bin: $("binInput")?.value?.replace(/\D/g, "") || "5154620022",
    email: $("emailInput")?.value?.trim() || "",
    setActive: true
  };
  setStatus("", "Создание профиля...");
  const res = await sendBg("saveProfile", { profile }, 10000);
  if (res?.error === "max_profiles") {
    setStatus("error", "Максимум 50 профилей");
    return;
  }
  if (!res?.profile) {
    setStatus("error", "Ошибка создания");
    return;
  }
  profiles = res.profiles;
  renderProfiles(res.profile.id);
  await applyProfileToUI(res.profile, { reloadCard: true });
  setStatus("active", `${res.profile.name} создан ✅`);
});

$("btnDeleteProfile")?.addEventListener("click", () => {
  if (profiles.length <= 1) return;
  chrome.runtime.sendMessage({ action: "deleteProfile", id: activeProfileId }, res => {
    if (res?.error) return;
    profiles = res.profiles;
    activeProfileId = res.activeId;
    renderProfiles(activeProfileId);
    const active = profiles.find(p => p.id === activeProfileId);
    if (active) {
      if ($("emailInput")) $("emailInput").value = active.email || "";
      if ($("binInput")) $("binInput").value = active.bin || "";
      if ($("countrySelect")) $("countrySelect").value = active.country;
      currentCurrency = active.currency || currentCurrency;
      if ($("currencySelect")) $("currencySelect").value = currentCurrency;
      loadAddressForCountry(active.country);
    }
    setStatus("active", "Профиль удалён");
  });
});

$("btnExportProfiles")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportProfiles" }, res => {
    if (!res?.data) return;
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autofill-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("active", "Экспорт готов ✅");
  });
});

$("btnImportProfiles")?.addEventListener("click", () => $("importFileInput")?.click());

$("importFileInput")?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      chrome.runtime.sendMessage({ action: "importProfiles", payload }, res => {
        if (res?.error) {
          setStatus("error", "Неверный файл");
          return;
        }
        profiles = res.profiles;
        activeProfileId = res.activeId;
        renderProfiles(activeProfileId);
        const active = profiles.find(p => p.id === activeProfileId);
        if (active) {
          if ($("emailInput")) $("emailInput").value = active.email || "";
          if ($("binInput")) $("binInput").value = active.bin || "";
          if ($("countrySelect")) $("countrySelect").value = active.country;
          currentCurrency = active.currency || currentCurrency;
          if ($("currencySelect")) $("currencySelect").value = currentCurrency;
          loadAddressForCountry(active.country);
        }
        setStatus("active", "Импорт выполнен ✅");
      });
    } catch {
      setStatus("error", "Ошибка JSON");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

$("countrySelect")?.addEventListener("change", () => {
  const code = $("countrySelect").value;
  chrome.runtime.sendMessage({ action: "setCountry", country: code }, res => {
    if (!res?.code) {
      setStatus("error", "Ошибка");
      return;
    }
    currentCountry = res.code;
    loadAddressForCountry(res.code);
    saveCurrentToProfile();
    setStatus("active", `${res.name} ✅`);
  });
});

$("currencySelect")?.addEventListener("change", () => {
  const code = $("currencySelect").value;
  chrome.runtime.sendMessage({ action: "setCurrency", currency: code }, res => {
    if (!res?.code) {
      setStatus("error", "Ошибка валюты");
      return;
    }
    currentCurrency = res.code;
    saveCurrentToProfile();
    setStatus("active", `${res.code} ${res.symbol || ""} ✅`.trim());
  });
});

$("btnSaveEmail")?.addEventListener("click", async () => {
  const email = $("emailInput")?.value?.trim() || "";
  const res = await sendBg("setUserEmail", { email }, 8000);
  if (res?.email !== undefined) {
    safeSetText("addrEmail", res.email || "—");
    if (lastAddress) lastAddress = { ...lastAddress, email: res.email };
    $("btnSaveEmail").style.color = "#22c55e";
    setTimeout(() => { $("btnSaveEmail").style.color = ""; }, 1200);
    await saveCurrentToProfile();
    updateProfileSummary();
    setStatus("active", "Email сохранён ✅");
  } else {
    setStatus("error", "Не удалось сохранить email");
  }
});

$("emailInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter") $("btnSaveEmail")?.click();
});

chrome.storage.local.get(["autoFillEnabled", "autoFillMode"], data => {
  const enabled = data.autoFillEnabled === true;
  if ($("autoFillToggle")) $("autoFillToggle").checked = enabled;
  updateAutoFillBetaNote(enabled);
  if ($("autoFillMode")) $("autoFillMode").value = data.autoFillMode || "all";
});

$("autoFillToggle")?.addEventListener("change", () => {
  const enabled = $("autoFillToggle").checked;
  updateAutoFillBetaNote(enabled);
  chrome.storage.local.set({ autoFillEnabled: enabled });
  if (enabled) {
    setStatus("", "Автозаполнение включено: функция дорабатывается, возможны баги");
  } else {
    setStatus("active", "Автозаполнение выключено");
  }
});

$("autoFillMode")?.addEventListener("change", () => {
  chrome.storage.local.set({ autoFillMode: $("autoFillMode").value });
});

$("devModeToggle")?.addEventListener("change", () => {
  sendBg("setDevMode", { devMode: $("devModeToggle").checked }, 8000).then(() => {
    refreshDevLogCount();
    setStatus("active", $("devModeToggle").checked ? "Dev-логи включены" : "Dev-логи выключены");
  });
});

$("btnDownloadDevLogs")?.addEventListener("click", () => {
  downloadDevLogs().catch(() => setStatus("error", "Не удалось скачать dev-логи"));
});

$("btnCopyDevLogs")?.addEventListener("click", () => {
  copyDevLogs().catch(() => setStatus("error", "Не удалось скопировать dev-логи"));
});

$("btnClearDevLogs")?.addEventListener("click", () => {
  clearDevLogs().catch(() => setStatus("error", "Не удалось очистить dev-логи"));
});

$("soundMuteToggle")?.addEventListener("change", () => {
  chrome.runtime.sendMessage({ action: "setSettings", soundMuted: !$("soundMuteToggle").checked });
});

$("compactModeToggle")?.addEventListener("change", () => {
  const on = $("compactModeToggle").checked;
  document.body.classList.toggle("compact-mode", on);
  chrome.runtime.sendMessage({ action: "setSettings", compactMode: on });
});

$("stripeFabToggle")?.addEventListener("change", () => {
  chrome.runtime.sendMessage({ action: "setSettings", stripeFabEnabled: $("stripeFabToggle").checked });
});

$("btnHideSummary")?.addEventListener("click", () => {
  showProfileSummary = false;
  if ($("showSummaryToggle")) $("showSummaryToggle").checked = false;
  if (profileSummary) profileSummary.hidden = true;
  chrome.runtime.sendMessage({ action: "setSettings", showProfileSummary: false });
});

$("showSummaryToggle")?.addEventListener("change", () => {
  showProfileSummary = $("showSummaryToggle").checked;
  updateProfileSummary();
  chrome.runtime.sendMessage({ action: "setSettings", showProfileSummary });
});

$("btnDismissOnboarding")?.addEventListener("click", dismissOnboarding);

$("btnOpenShortcuts")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.runtime.sendMessage({ action: "getBin" }, res => {
  if (res?.bin && $("binInput")) $("binInput").value = res.bin;
});

$("btnSaveBin")?.addEventListener("click", () => {
  const newBin = $("binInput").value.trim().replace(/\D/g, "");
  if (!newBin) return;
  $("binInput").value = newBin;
  highlightBinPreset(newBin);
  $("btnSaveBin").style.color = "#22c55e";
  setTimeout(() => { $("btnSaveBin").style.color = ""; }, 1200);
  chrome.runtime.sendMessage({ action: "setBin", bin: newBin }, res => {
    if (res?.bin) $("binInput").value = res.bin;
    saveCurrentToProfile();
  });
});

$("binInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter") $("btnSaveBin").click();
});

$("binInput")?.addEventListener("input", () => {
  $("binInput").value = $("binInput").value.replace(/\D/g, "");
  highlightBinPreset($("binInput").value);
});
