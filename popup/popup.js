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

function safeSetHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function safeSetStyle(id, prop, val) {
  const el = $(id);
  if (el) el.style[prop] = val;
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

function renderCard(card) {
  if (!$("cardStatusBadge")) return;
  lastCard = card;

  if (!card) {
    safeSetHTML("cardStatusBadge", '<span class="badge badge-die">❌</span><span id="cardStatusText">Карта не получена</span>');
    safeSetStyle("cardStatusText", "color", "#ef4444");
    updateCardPreview(null, lastAddress);
    updateProfileSummary();
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
    safeSetHTML("cardStatusBadge", '<span class="badge badge-live">LIVE</span><span id="cardStatusText">' + (card.validationMessage || "Approved") + '</span>');
    safeSetStyle("cardStatusText", "color", "#22c55e");
  } else if (vs === "unavailable" || vs === "rate_limited" || vs === "timeout") {
    safeSetHTML("cardStatusBadge", '<span class="badge badge-unavailable">API</span><span id="cardStatusText">' + (card.validationMessage || "API недоступен") + '</span>');
    safeSetStyle("cardStatusText", "color", "#a855f7");
  } else if (vs === "failed") {
    safeSetHTML("cardStatusBadge", '<span class="badge badge-unknown">Лун ✓</span><span id="cardStatusText">Live не подтверждена</span>');
    safeSetStyle("cardStatusText", "color", "#f59e0b");
  } else if (vs === "checking") {
    safeSetHTML("cardStatusBadge", '<span class="badge badge-loading">⏳</span><span id="cardStatusText">' + (card.validationMessage || "Проверяется...") + '</span>');
    safeSetStyle("cardStatusText", "color", "#94a3b8");
  } else {
    safeSetHTML("cardStatusBadge", '<span class="badge badge-unknown">?</span><span id="cardStatusText">Неизвестно</span>');
    safeSetStyle("cardStatusText", "color", "#f59e0b");
  }
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
    li.innerHTML = `<span class="report-label">${item.label}</span><span class="${statusClass}">${statusLabel}</span>`;
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

function saveCurrentToProfile() {
  const active = profiles.find(p => p.id === activeProfileId);
  if (!active) return;
  chrome.runtime.sendMessage({
    action: "saveProfile",
    profile: {
      ...active,
      country: $("countrySelect")?.value || currentCountry,
      bin: $("binInput")?.value?.replace(/\D/g, "") || active.bin,
      email: $("emailInput")?.value?.trim() || ""
    }
  }, res => {
    if (res?.profiles) {
      profiles = res.profiles;
      updateProfileSummary();
    }
  });
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
  safeSetHTML("cardStatusBadge", '<span class="badge badge-loading">⏳</span><span id="cardStatusText">Проверка карты...</span>');
  safeSetStyle("cardStatusText", "color", "#94a3b8");

  cardPollTimer = setInterval(async () => {
    cardPollCount++;
    if (cardPollCount > CARD_POLL_MAX) {
      stopCardPolling(onDone);
      safeSetHTML("cardStatusBadge", '<span class="badge badge-unavailable">⏱</span><span id="cardStatusText">Проверка зависла — нажмите «Новая»</span>');
      safeSetStyle("cardStatusText", "color", "#a855f7");
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

  const cardRes = await sendBg("getCardCache", {}, 5000);
  if (cardRes?.card) renderCard(cardRes.card);
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

  const cardRes = await sendBg("getCardCache", {}, 5000);
  if (cardRes?.card) renderCard(cardRes.card);
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

function injectAndFill(tabId, mode) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus("error", "Не удалось внедрить");
      return;
    }
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: "fillNow", mode }, res => {
        if (chrome.runtime.lastError) {
          setStatus("error", "Ошибка инъекции");
          return;
        }
        handleFillResult(res);
      });
    }, 1200);
  });
}

function fillPage(mode) {
  const labels = { all: "Всё", address: "Адрес", card: "Карта" };
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;
    setStatus("", `Заполнение: ${labels[mode] || mode}...`);
    if ($("fillReportPanel")) $("fillReportPanel").hidden = true;

    chrome.tabs.sendMessage(tabId, { action: "fillNow", mode }, res => {
      if (chrome.runtime.lastError) {
        setStatus("", "Внедрение скрипта...");
        injectAndFill(tabId, mode);
        return;
      }
      handleFillResult(res);
    });
  });
}

async function initPopup() {
  setupCopyOnClick();
  setStatus("", "Загрузка...");

  const boot = await sendBg("getPopupBootstrap", {}, 20000);
  if (boot?.error) {
    setStatus("error", boot.error === "timeout" ? "Таймаут загрузки" : "Ошибка расширения");
    loadProfiles();
    loadBinPresets();
    return;
  }

  safeSetText("versionTag", `v${boot.version || "2.1.1"}`);
  profiles = boot.profiles || [];
  activeProfileId = boot.activeId || profiles[0]?.id || "default";
  currentCountry = boot.country || "US";
  lastAddress = boot.address || null;
  lastCard = boot.card || null;

  renderProfiles(activeProfileId);
  renderCountriesList(boot.countries, currentCountry);
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

  if (!lastAddress) {
    setStatus("", "Получение адреса...");
    const refreshed = await sendBg("refreshAddress", { country: currentCountry });
    if (refreshed?.address) {
      lastAddress = refreshed.address;
      if (boot.email) lastAddress = { ...lastAddress, email: boot.email };
      renderAddress(lastAddress);
    }
  }

  if (lastCard?.validationStatus === "checking") {
    startCardPolling();
    setStatus("", "Проверка карты...");
  } else if (lastAddress) {
    setStatus("active", "Данные готовы");
  } else {
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

$("btnPinAddress")?.addEventListener("click", () => {
  const action = addressPinned ? "unpinAddress" : "pinAddress";
  const country = $("countrySelect")?.value || currentCountry;
  chrome.runtime.sendMessage({ action, country }, res => {
    if (action === "pinAddress" && res?.address) {
      lastAddress = res.address;
      renderAddress(lastAddress);
      setStatus("active", "Адрес закреплён 📌");
    } else {
      updatePinUI(false);
      if (lastAddress) lastAddress = { ...lastAddress, pinned: false };
      setStatus("active", "Адрес откреплён");
    }
  });
});

$("profileSelect")?.addEventListener("change", () => {
  const id = $("profileSelect").value;
  setStatus("", "Смена профиля...");
  chrome.runtime.sendMessage({ action: "setActiveProfile", id }, res => {
    if (!res?.profile) {
      setStatus("error", "Ошибка профиля");
      return;
    }
    activeProfileId = id;
    const p = res.profile;
    if ($("countrySelect")) $("countrySelect").value = p.country;
    if ($("binInput")) $("binInput").value = p.bin || "";
    if ($("emailInput")) $("emailInput").value = p.email || "";
    highlightBinPreset(p.bin);
    currentCountry = p.country;
    loadAddressForCountry(p.country);
    loadPinnedStatus();
    setStatus("active", `${p.name} ✅`);
  });
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

$("btnAddProfile")?.addEventListener("click", () => {
  const profile = {
    name: `Профиль ${profiles.length + 1}`,
    country: $("countrySelect")?.value || currentCountry,
    bin: $("binInput")?.value?.replace(/\D/g, "") || "5154620022",
    email: $("emailInput")?.value?.trim() || ""
  };
  chrome.runtime.sendMessage({ action: "saveProfile", profile }, res => {
    if (res?.error === "max_profiles") {
      setStatus("error", "Максимум 50 профилей");
      return;
    }
    if (res?.profile) {
      profiles = res.profiles;
      chrome.runtime.sendMessage({ action: "setActiveProfile", id: res.profile.id }, () => {
        activeProfileId = res.profile.id;
        renderProfiles(activeProfileId);
        setStatus("active", `${res.profile.name} создан ✅`);
      });
    }
  });
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

$("btnSaveEmail")?.addEventListener("click", () => {
  const email = $("emailInput")?.value?.trim() || "";
  chrome.runtime.sendMessage({ action: "setUserEmail", email }, res => {
    if (res?.email !== undefined) {
      safeSetText("addrEmail", res.email || "—");
      if (lastAddress) lastAddress = { ...lastAddress, email: res.email };
      $("btnSaveEmail").style.color = "#22c55e";
      setTimeout(() => { $("btnSaveEmail").style.color = ""; }, 1200);
      saveCurrentToProfile();
      updateProfileSummary();
      setStatus("active", "Email сохранён ✅");
    }
  });
});

$("emailInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter") $("btnSaveEmail")?.click();
});

chrome.storage.local.get(["autoFillEnabled", "autoFillMode"], data => {
  if ($("autoFillToggle")) $("autoFillToggle").checked = data.autoFillEnabled !== false;
  if ($("autoFillMode")) $("autoFillMode").value = data.autoFillMode || "all";
});

$("autoFillToggle")?.addEventListener("change", () => {
  chrome.storage.local.set({ autoFillEnabled: $("autoFillToggle").checked });
});

$("autoFillMode")?.addEventListener("change", () => {
  chrome.storage.local.set({ autoFillMode: $("autoFillMode").value });
});

$("devModeToggle")?.addEventListener("change", () => {
  chrome.runtime.sendMessage({ action: "setDevMode", devMode: $("devModeToggle").checked });
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