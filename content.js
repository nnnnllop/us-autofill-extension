/* ═══════════════════════════════════════════════════════
   AutoFill — Content Script v2.1
   ═══════════════════════════════════════════════════════ */

const FILL_RETRY_DELAYS = [0, 800, 1200, 2000, 3500];
const IFRAME_RETRY_DELAYS = [1000, 2000, 3000];
const STRIPE_FAB_KEY = "stripeFabEnabled";

const MSG_SOURCE = "US_AUTOFILL_V2";
const IS_TOP_FRAME = window === window.top;

const STRIPE_HOST_RE = /(?:^|\.)stripe\.com$/i;
const STRIPE_CHECKOUT_RE = /^checkout\.stripe\.com$|^buy\.stripe\.com$/i;
const STRIPE_IFRAME_RE = /^js\.stripe\.com$|^elements\.stripe\.com$|^hooks\.stripe\.com$/i;

const FIELD_LABELS = {
  email: "Email",
  firstName: "Имя",
  lastName: "Фамилия",
  fullName: "Имя на карте",
  address1: "Адрес",
  address2: "Адрес 2",
  city: "Город",
  state: "Регион",
  zip: "Индекс",
  country: "Страна",
  cardNumber: "Номер карты",
  cardExpiry: "Срок",
  cardCVV: "CVV"
};

const ADDRESS_KEYS = ["email", "firstName", "lastName", "fullName", "address1", "address2", "city", "state", "zip", "country"];
const CARD_KEYS = ["fullName", "cardNumber", "cardExpiry", "cardCVV"];

const COUNTRY_PATTERNS = {
  US: { values: ["US", "USA", "840"], patterns: [/^US$/i, /^USA$/i, /^United States/i, /^США/i] },
  GB: { values: ["GB", "UK", "GBR", "826"], patterns: [/^GB$/i, /^UK$/i, /^United Kingdom/i, /^Великобритания/i] },
  DE: { values: ["DE", "DEU", "276"], patterns: [/^DE$/i, /^Germany/i, /^Deutschland/i, /^Германия/i] },
  FR: { values: ["FR", "FRA", "250"], patterns: [/^FR$/i, /^France/i, /^Франция/i] },
  CA: { values: ["CA", "CAN", "124"], patterns: [/^CA$/i, /^Canada/i, /^Канада/i] },
  AU: { values: ["AU", "AUS", "36"], patterns: [/^AU$/i, /^Australia/i, /^Австралия/i] },
  NL: { values: ["NL", "NLD", "528"], patterns: [/^NL$/i, /^Netherlands/i, /^Нидерланды/i] },
  IT: { values: ["IT", "ITA", "380"], patterns: [/^IT$/i, /^Italy/i, /^Италия/i] },
  ES: { values: ["ES", "ESP", "724"], patterns: [/^ES$/i, /^Spain/i, /^Испания/i] },
  PL: { values: ["PL", "POL", "616"], patterns: [/^PL$/i, /^Poland/i, /^Польша/i] }
};

const COUNTRY_SEARCH_TERMS = {
  US: /united states|usa|^us$|сша/i,
  GB: /united kingdom|great britain|^uk$|^gb$|великобритания/i,
  DE: /germany|deutschland|германия/i,
  FR: /france|франция/i,
  CA: /canada|канада/i,
  AU: /australia|австралия/i,
  NL: /netherlands|holland|нидерланды/i,
  IT: /italy|italia|италия/i,
  ES: /spain|españa|испания/i,
  PL: /poland|polska|польша/i
};

const FIELD_MAP = {
  email: {
    selectors: [
      'input[name="email"]', 'input[id="email"]', 'input[type="email"]',
      'input[autocomplete="email"]', 'input[data-testid="email-input"]',
      'input[name="checkout[email]"]', 'input[id="email-input"]',
      'input[placeholder*="email" i]'
    ],
    keywords: ["email", "e-mail", "почта"]
  },
  firstName: {
    selectors: [
      'input[name*="first" i]', 'input[autocomplete="given-name"]',
      'input[data-elements-stable-field-name*="firstName"]',
      'input[name="billingFirstName"]', 'input[name="checkout[shipping_address][first_name]"]',
      'input[name="checkout[billing_address][first_name]"]'
    ],
    keywords: ["first name", "fname", "имя", "given name"]
  },
  lastName: {
    selectors: [
      'input[name*="last" i]', 'input[autocomplete="family-name"]',
      'input[data-elements-stable-field-name*="lastName"]',
      'input[name="billingLastName"]', 'input[name="checkout[shipping_address][last_name]"]',
      'input[name="checkout[billing_address][last_name]"]'
    ],
    keywords: ["last name", "lname", "фамилия", "surname"]
  },
  fullName: {
    selectors: [
      'input[autocomplete="cc-name"]', 'input[autocomplete="name"]',
      'input[name*="cardholder" i]', 'input[name*="fullname" i]',
      'input[data-elements-stable-field-name*="name"]',
      'input[name="billingName"]', 'input[name="name"]',
      'input[name="checkout[billing_address][name]"]'
    ],
    keywords: ["name on card", "cardholder", "full name", "имя владельца"]
  },
  address1: {
    selectors: [
      'input[autocomplete="address-line1"]', 'input[autocomplete="street-address"]',
      'input[name*="address1" i]', 'input[name*="street" i]', 'input[name*="line1" i]',
      'input[name="billingAddressLine1"]',
      'input[name="checkout[shipping_address][address1]"]',
      'input[name="checkout[billing_address][address1]"]'
    ],
    keywords: ["address 1", "street", "улица", "billing address", "адрес"]
  },
  address2: {
    selectors: [
      'input[autocomplete="address-line2"]', 'input[name*="address2" i]',
      'input[name="billingAddressLine2"]',
      'input[name="checkout[shipping_address][address2]"]'
    ],
    keywords: ["address 2", "apartment", "suite", "apt"]
  },
  city: {
    selectors: [
      'input[autocomplete="address-level2"]', 'input[name*="city" i]',
      'input[name="billingLocality"]',
      'input[name="checkout[shipping_address][city]"]',
      'input[name="checkout[billing_address][city]"]'
    ],
    keywords: ["city", "город", "town"]
  },
  state: {
    selectors: [
      'select[autocomplete="address-level1"]', 'select[name*="state" i]',
      'input[name*="state" i]', 'select[name="billingAdministrativeArea"]',
      'select[name="checkout[shipping_address][province]"]',
      'select[name="checkout[billing_address][province]"]'
    ],
    keywords: ["state", "region", "province", "штат"]
  },
  zip: {
    selectors: [
      'input[autocomplete="postal-code"]', 'input[name*="zip" i]',
      'input[name*="postal" i]', 'input[name="billingPostalCode"]',
      'input[name="checkout[shipping_address][zip]"]',
      'input[name="checkout[billing_address][zip]"]'
    ],
    keywords: ["zip", "postal", "postcode", "индекс"]
  },
  country: {
    selectors: [
      'select[autocomplete="country"]', 'select[name*="country" i]',
      'select[name="billingCountry"]',
      'select[name="checkout[shipping_address][country]"]',
      'select[name="checkout[billing_address][country]"]'
    ],
    keywords: ["country", "страна"]
  },
  cardNumber: {
    selectors: [
      'input[name="cardnumber"]', 'input[name="cardNumber"]',
      'input[autocomplete="cc-number"]', 'input[name*="cardnumber" i]',
      'input[data-elements-stable-field-name*="cardNumber"]',
      'input[name="number"]', 'input[id="card-number"]'
    ],
    keywords: ["card number", "номер карты"]
  },
  cardExpiry: {
    selectors: [
      'input[name="exp-date"]', 'input[autocomplete="cc-exp"]',
      'input[name*="expiry" i]', 'input[data-elements-stable-field-name*="cardExpiry"]',
      'input[name="expiry"]', 'input[id="card-expiry"]'
    ],
    keywords: ["expiry", "expiration", "mm/yy", "срок"]
  },
  cardCVV: {
    selectors: [
      'input[name="cvc"]', 'input[autocomplete="cc-csc"]',
      'input[name*="cvv" i]', 'input[data-elements-stable-field-name*="cardCvc"]',
      'input[name="verification_value"]', 'input[id="card-cvc"]'
    ],
    keywords: ["cvc", "cvv", "security code"]
  }
};

/* ───────────── State ───────────── */

let devMode = false;
let stripePrepDone = false;
let observerDebounce = null;
let stripeFillDebounce = null;
let fillInProgress = false;
let stripeFabEl = null;

/* ───────────── Utils ───────────── */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(...args) {
  if (devMode) console.log("[AutoFill]", ...args);
}

function warn(...args) {
  if (devMode) console.warn("[AutoFill]", ...args);
}

function loadDevMode() {
  chrome.storage.local.get(["devMode"], d => { devMode = !!d.devMode; });
}

loadDevMode();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.devMode) devMode = !!changes.devMode.newValue;
});

function isFillable(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.type === "hidden") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (el.offsetParent !== null) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function queryAllDeep(selector, root = document) {
  const out = [];
  try {
    root.querySelectorAll(selector).forEach(el => { if (isFillable(el)) out.push(el); });
    root.querySelectorAll("*").forEach(el => {
      if (el.shadowRoot) out.push(...queryAllDeep(selector, el.shadowRoot));
    });
  } catch (_) {}
  return out;
}

function dispatchEvents(el) {
  el.dispatchEvent(new Event("focus", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setNativeValue(el, value) {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/* ───────────── Platform detection ───────────── */

function hasStripeCheckoutUI() {
  return !!document.querySelector(
    'iframe[src*="js.stripe.com"], iframe[name^="__privateStripeFrame"], ' +
    '[data-testid="hosted-payment-submit-button"], button[class*="SubmitButton"]'
  );
}

function isStripeCheckoutPage() {
  return STRIPE_CHECKOUT_RE.test(location.hostname) ||
    (IS_TOP_FRAME && hasStripeCheckoutUI());
}

function isStripeIframe() {
  return STRIPE_IFRAME_RE.test(location.hostname);
}

function isShopifyCheckout() {
  return /checkout\.shopify\.com$/.test(location.hostname) ||
    !!document.querySelector('form[action*="checkout"], input[name="checkout[email]"]');
}

function isPaddleCheckout() {
  return /paddle\.com$|buy\.paddle\.com$/.test(location.hostname) ||
    !!document.querySelector('[class*="paddle"], iframe[src*="paddle.com"]');
}

function isLemonSqueezyCheckout() {
  return /lemonsqueezy\.com$/.test(location.hostname) ||
    !!document.querySelector('iframe[src*="lemonsqueezy"], [class*="lemonsqueezy"]');
}

function detectPlatform() {
  if (isStripeCheckoutPage() || isStripeIframe()) return "stripe";
  if (isShopifyCheckout()) return "shopify";
  if (isPaddleCheckout()) return "paddle";
  if (isLemonSqueezyCheckout()) return "lemon";
  return "generic";
}

function usesStripeInput(platform) {
  return platform === "stripe" || platform === "paddle" || platform === "lemon";
}

/* ───────────── Field discovery ───────────── */

function findBySelectors(selectors) {
  for (const sel of selectors) {
    try {
      const found = queryAllDeep(sel);
      if (found.length) return found[0];
      const el = document.querySelector(sel);
      if (el && isFillable(el)) return el;
    } catch (_) {}
  }
  return null;
}

function findByLabel(keywords) {
  const labels = document.querySelectorAll("label");
  for (const label of labels) {
    const text = label.textContent.trim().toLowerCase();
    if (!keywords.some(kw => text.includes(kw))) continue;
    const forId = label.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el && isFillable(el)) return el;
    }
    const input = label.querySelector("input, select, textarea");
    if (input && isFillable(input)) return input;
  }
  return null;
}

function findByAriaLabel(keywords) {
  for (const el of queryAllDeep("input[aria-label], select[aria-label], textarea[aria-label]")) {
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (keywords.some(kw => aria.includes(kw))) return el;
  }
  return null;
}

function findByPlaceholder(keywords) {
  for (const el of queryAllDeep("input[placeholder], textarea[placeholder]")) {
    const ph = (el.getAttribute("placeholder") || "").toLowerCase();
    if (keywords.some(kw => ph.includes(kw))) return el;
  }
  return null;
}

function findField(key) {
  const cfg = FIELD_MAP[key];
  if (!cfg) return null;
  return findBySelectors(cfg.selectors) || findByLabel(cfg.keywords) ||
    findByAriaLabel(cfg.keywords) || findByPlaceholder(cfg.keywords);
}

function keysForMode(mode) {
  if (mode === "address") return ADDRESS_KEYS;
  if (mode === "card") return CARD_KEYS;
  return [...ADDRESS_KEYS, ...CARD_KEYS.filter(k => !ADDRESS_KEYS.includes(k))];
}

function detectPresentFields(mode) {
  return keysForMode(mode).filter(k => findField(k));
}

function createReport(mode) {
  return keysForMode(mode).map(key => ({
    key,
    label: FIELD_LABELS[key] || key,
    status: "pending"
  }));
}

function setReportStatus(report, key, status) {
  const item = report.find(r => r.key === key);
  if (item) item.status = status;
}

/* ───────────── Fill helpers ───────────── */

function fieldAlreadyFilled(el) {
  return el?.getAttribute("data-us-autofilled") === "true" || !!el?.value?.trim();
}

async function fillStripeStyle(el, value) {
  setNativeValue(el, "");
  for (const char of String(value)) {
    setNativeValue(el, `${el.value}${char}`);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
    await sleep(10);
  }
}

async function fillViaPaste(el, value) {
  el.focus();
  setNativeValue(el, value);
  el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: value }));
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: value }));
  dispatchEvents(el);
}

async function fillInput(el, value, options = {}) {
  if (!el || !value) return false;
  if (fieldAlreadyFilled(el)) return true;

  el.scrollIntoView({ block: "center", behavior: "auto" });
  el.focus();
  const strVal = String(value);

  if (options.stripe) {
    await fillStripeStyle(el, strVal);
  } else {
    setNativeValue(el, strVal);
    dispatchEvents(el);
    if (el.value !== strVal) await fillViaPaste(el, strVal);
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));

  const ok = el.value === strVal || el.value.replace(/\s/g, "") === strVal.replace(/\s/g, "");
  if (ok) {
    el.setAttribute("data-us-autofilled", "true");
    setTimeout(() => el.removeAttribute("data-us-autofilled"), 2500);
  }
  return ok;
}

async function fillInputIfEmpty(el, value, options = {}) {
  if (!el || !value) return false;
  if (el.value?.trim()) {
    el.setAttribute("data-us-autofilled", "true");
    return true;
  }
  return fillInput(el, value, options);
}

function selectCountry(el, countryCode) {
  if (!el || el.tagName !== "SELECT") return false;
  const cfg = COUNTRY_PATTERNS[countryCode];
  if (!cfg) return false;
  el.focus();
  for (const opt of el.options) {
    const val = opt.value.trim();
    const txt = opt.textContent.trim();
    if (cfg.patterns.some(p => p.test(val) || p.test(txt)) || cfg.values.includes(val)) {
      setNativeValue(el, opt.value);
      dispatchEvents(el);
      el.setAttribute("data-us-autofilled", "true");
      setTimeout(() => el.removeAttribute("data-us-autofilled"), 2500);
      return true;
    }
  }
  return false;
}

function selectState(el, stateName, stateAbbr) {
  if (!el || el.tagName !== "SELECT") return false;
  const lower = (stateName || "").toLowerCase();
  const abbr = (stateAbbr || "").toLowerCase();
  for (const opt of el.options) {
    const val = opt.value.trim().toLowerCase();
    const txt = opt.textContent.trim().toLowerCase();
    if (val === lower || txt === lower || val === abbr || txt === abbr ||
        txt.includes(lower) || txt.includes(abbr)) {
      setNativeValue(el, opt.value);
      dispatchEvents(el);
      el.setAttribute("data-us-autofilled", "true");
      setTimeout(() => el.removeAttribute("data-us-autofilled"), 2500);
      return true;
    }
  }
  return false;
}

async function clickCustomCountryDropdown(countryCode) {
  const searchRe = COUNTRY_SEARCH_TERMS[countryCode];
  if (!searchRe) return false;
  const patterns = [
    '[class*="country"] [role="combobox"]', '[class*="countrySelect"]',
    '[class*="billing"] [class*="country"]'
  ];
  for (const sel of patterns) {
    const el = document.querySelector(sel);
    if (!el || !isFillable(el)) continue;
    el.click();
    await sleep(400);
    for (const item of document.querySelectorAll('[role="option"], li[class*="item"]')) {
      if (searchRe.test(item.textContent.trim())) {
        item.click();
        return true;
      }
    }
    document.body.click();
  }
  return false;
}

function findClickableByText(patterns) {
  for (const el of document.querySelectorAll('button, a, [role="button"], [role="tab"], label')) {
    const text = el.textContent.trim();
    if (!text || text.length > 80) continue;
    if (patterns.some(re => re.test(text))) return el;
  }
  return null;
}

/* ───────────── Platform prep ───────────── */

async function expandBillingAddress() {
  const toggle = findClickableByText([
    /add billing address/i, /billing address/i, /enter billing/i,
    /добавить адрес/i, /адрес для счёта/i
  ]);
  if (toggle) {
    toggle.click();
    await sleep(500);
    return true;
  }
  return false;
}

async function prepareStripeCheckout() {
  if (!isStripeCheckoutPage() || stripePrepDone) return;
  const enterDetails = findClickableByText([/enter payment details/i, /ввести данные/i]);
  if (enterDetails) { enterDetails.click(); await sleep(600); }
  const cardMethod = findClickableByText([/^card$/i, /^карта$/i]);
  if (cardMethod) { cardMethod.click(); await sleep(400); }
  await expandBillingAddress();
  stripePrepDone = true;
}

async function prepareShopifyCheckout() {
  const cardRadio = document.querySelector('input[id*="payment-gateway"], input[name="payment_method"]');
  if (cardRadio && !cardRadio.checked) { cardRadio.click(); await sleep(400); }
}

async function prepareCheckout(platform) {
  if (platform === "stripe") await prepareStripeCheckout();
  else if (platform === "shopify") await prepareShopifyCheckout();
  else if (platform === "paddle" || platform === "lemon") {
    const cardTab = findClickableByText([/^card$/i, /credit card/i, /^карта$/i]);
    if (cardTab) { cardTab.click(); await sleep(400); }
    await expandBillingAddress();
  }
}

async function waitForStripeFrames(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frames = document.querySelectorAll(
      'iframe[src*="js.stripe.com"], iframe[name^="__privateStripeFrame"], iframe[src*="stripe"]'
    );
    if (frames.length > 0) return [...frames];
    await sleep(200);
  }
  return [];
}

/* ───────────── Iframe field detection ───────────── */

function detectFieldFromInput(input) {
  if (!input) return null;
  const stable = input.getAttribute("data-elements-stable-field-name") || "";
  const name = (input.name || "").toLowerCase();
  const ac = (input.autocomplete || "").toLowerCase();
  const aria = (input.getAttribute("aria-label") || "").toLowerCase();
  const id = (input.id || "").toLowerCase();
  const meta = `${stable} ${name} ${ac} ${aria} ${id}`;

  if (/cardnumber|cc-number|card.?number|номер|^number$/.test(meta)) return "cardNumber";
  if (/cardexpiry|exp-date|cc-exp|expir|mm\/yy|срок|^expiry$/.test(meta)) return "cardExpiry";
  if (/cardcvc|cvc|cvv|cc-csc|security|verification|cid/.test(meta)) return "cardCVV";
  if (/cc-name|cardholder|billingname|^name$|full.?name/.test(meta)) return "fullName";
  return null;
}

async function fillIframeFields(address, card, mode, report) {
  const fillCard = mode === "all" || mode === "card";
  if (!fillCard || !card?.number) return 0;

  let filled = 0;
  const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
  for (const input of inputs) {
    if (fieldAlreadyFilled(input)) continue;
    const key = detectFieldFromInput(input);
    if (!key) continue;
    const values = {
      cardNumber: card.number,
      cardExpiry: card.formattedExpiry,
      cardCVV: card.cvv,
      fullName: address?.fullName
    };
    const value = values[key];
    if (!value) continue;
    if (await fillInput(input, value, { stripe: true })) {
      filled++;
      if (report) setReportStatus(report, key, "filled");
      log(`iframe: ${key}`);
    }
  }
  return filled;
}

function countFilledInReport(report) {
  return report?.filter(r => r.status === "filled").length || 0;
}

/* ───────────── Broadcast (top → iframes) ───────────── */

function broadcastFill(payload) {
  const msg = { source: MSG_SOURCE, action: "fill", ...payload };
  window.postMessage(msg, "*");
  document.querySelectorAll("iframe").forEach(frame => {
    try { frame.contentWindow?.postMessage(msg, "*"); } catch (_) {}
  });
}

async function coordinatedIframeFill(address, card, mode) {
  if (!IS_TOP_FRAME) return;
  broadcastFill({ address, card, mode });
  for (const delay of IFRAME_RETRY_DELAYS) {
    await sleep(delay);
    broadcastFill({ address, card, mode });
  }
}

function finalizeIframeCardReport(report, platform) {
  if (!["stripe", "paddle", "lemon"].includes(platform)) return;
  const hasIframes = document.querySelector(
    'iframe[src*="js.stripe.com"], iframe[name^="__privateStripeFrame"], iframe[src*="paddle"]'
  );
  if (!hasIframes) return;
  for (const key of CARD_KEYS) {
    const item = report.find(r => r.key === key);
    if (item && item.status === "not_found") item.status = "iframe";
  }
}

function highlightMissedFields(report) {
  document.querySelectorAll("[data-us-missed]").forEach(el => el.removeAttribute("data-us-missed"));
  if (!report) return;
  for (const item of report) {
    if (item.status !== "not_found") continue;
    const el = findField(item.key);
    if (el) el.setAttribute("data-us-missed", "true");
  }
}

function playSuccessSound(soundMuted) {
  if (soundMuted) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 300);
  } catch (_) {}
}

/* ───────────── Main fill logic ───────────── */

async function tryFillField(key, value, report, options) {
  if (!value && key !== "address2") {
    setReportStatus(report, key, "skipped");
    return false;
  }
  const el = findField(key);
  if (!el) {
    setReportStatus(report, key, "not_found");
    return false;
  }
  if (fieldAlreadyFilled(el)) {
    setReportStatus(report, key, "filled");
    return true;
  }
  const ok = key === "email"
    ? await fillInputIfEmpty(el, value, options)
    : await fillInput(el, value, options);
  setReportStatus(report, key, ok ? "filled" : "skipped");
  return ok;
}

async function autoFill(address, card, mode = "all") {
  if (!IS_TOP_FRAME && (isStripeIframe() || location.hostname.includes("stripe"))) {
    const report = createReport(mode);
    const n = await fillIframeFields(address, card, mode, report);
    return buildResult(n, report, detectPlatform(), mode);
  }

  const platform = detectPlatform();
  const fillAddress = mode === "all" || mode === "address";
  const fillCard = mode === "all" || mode === "card";
  const stripeInput = usesStripeInput(platform);
  const opts = stripeInput ? { stripe: true } : {};
  const report = createReport(mode);

  if (fillAddress && !address && fillCard && !card?.number) {
    return buildResult(0, report, platform, mode);
  }

  await prepareCheckout(platform);
  if (platform === "stripe") await sleep(400);

  let filled = 0;
  const countryCode = address?.country || "US";

  if (fillAddress && address) {
    if (await tryFillField("email", address.email, report, opts)) filled++;

    const countryEl = findField("country");
    if (countryEl) {
      let ok = false;
      if (countryEl.tagName === "SELECT") ok = selectCountry(countryEl, countryCode);
      else ok = await clickCustomCountryDropdown(countryCode);
      setReportStatus(report, "country", ok ? "filled" : "not_found");
      if (ok) { filled++; await sleep(500); }
    } else {
      setReportStatus(report, "country", "not_found");
    }

    const firstNameEl = findField("firstName");
    const lastNameEl = findField("lastName");
    const fullNameEl = findField("fullName");

    if (fullNameEl && !firstNameEl) {
      if (await tryFillField("fullName", address.fullName, report, opts)) filled++;
    } else {
      if (await tryFillField("firstName", address.firstName, report, opts)) filled++;
      if (await tryFillField("lastName", address.lastName, report, opts)) filled++;
      if (fullNameEl && await tryFillField("fullName", address.fullName, report, opts)) filled++;
    }

    if (await tryFillField("address1", address.address1, report, opts)) filled++;
    if (address.address2 && await tryFillField("address2", address.address2, report, opts)) filled++;
    else setReportStatus(report, "address2", "skipped");
    if (await tryFillField("city", address.city, report, opts)) filled++;

    const stateEl = findField("state");
    if (stateEl) {
      let ok = false;
      if (stateEl.tagName === "SELECT") ok = selectState(stateEl, address.state, address.stateAbbr);
      else ok = await fillInput(stateEl, address.stateAbbr || address.state, opts);
      setReportStatus(report, "state", ok ? "filled" : "not_found");
      if (ok) filled++;
    } else {
      setReportStatus(report, "state", "not_found");
    }

    if (await tryFillField("zip", address.zip, report, opts)) filled++;
  } else if (fillAddress) {
    ADDRESS_KEYS.forEach(k => setReportStatus(report, k, "skipped"));
  }

  if (fillCard && card?.number) {
    if (mode === "card" && address?.fullName) {
      await tryFillField("fullName", address.fullName, report, opts);
    }
    if (await tryFillField("cardNumber", card.number, report, opts)) filled++;
    if (await tryFillField("cardExpiry", card.formattedExpiry, report, opts)) filled++;
    if (await tryFillField("cardCVV", card.cvv, report, opts)) filled++;
    log(`Карта: ${card.type || "?"} | ${card.validationMessage || "ok"}`);
  } else if (fillCard) {
    CARD_KEYS.forEach(k => setReportStatus(report, k, "skipped"));
  }

  if (IS_TOP_FRAME && fillCard && card?.number &&
      (platform === "stripe" || platform === "paddle" || platform === "lemon")) {
    if (platform === "stripe") await waitForStripeFrames(5000);
    await coordinatedIframeFill(address, card, mode);
  }

  return buildResult(filled, report, platform, mode);
}

function buildResult(filled, report, platform, mode) {
  const presentOnPage = detectPresentFields(mode);
  const filledItems = report.filter(r => r.status === "filled");
  const notFound = report.filter(r => r.status === "not_found");

  let message;
  let neutral = false;

  if (filled > 0) {
    message = `Заполнено ${filled}`;
  } else if (presentOnPage.length === 0) {
    message = "На странице нет подходящих полей";
    neutral = true;
  } else if (filledItems.length === 0 && notFound.length > 0) {
    message = `Найдено полей: 0 из ${presentOnPage.length}`;
    neutral = true;
  } else {
    message = "Нечего заполнять в этом режиме";
    neutral = true;
  }

  log(`Режим: ${mode}, платформа: ${platform}, заполнено: ${filled}`);
  return { filled, report, platform, message, neutral, success: filled > 0 || neutral };
}

/* ───────────── Run ───────────── */

function getAllData() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "getAllData" }, response => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

async function executeFillWithRetries(mode) {
  if (fillInProgress) return buildResult(0, createReport(mode), detectPlatform(), mode);
  fillInProgress = true;

  let best = null;
  let stagnant = 0;
  let lastCount = -1;
  let soundMuted = false;

  try {
    for (let i = 0; i < FILL_RETRY_DELAYS.length; i++) {
      if (FILL_RETRY_DELAYS[i]) await sleep(FILL_RETRY_DELAYS[i]);

      const data = await getAllData();
      if (!data) continue;
      devMode = !!data.devMode;
      soundMuted = !!data.soundMuted;

      if (i > 0 && isStripeCheckoutPage()) {
        await waitForStripeFrames(1500);
        broadcastFill({ address: data.address, card: data.card, mode });
        await sleep(350);
      }

      const result = await autoFill(data.address, data.card, mode);
      const filledCount = countFilledInReport(result.report);

      if (!best || filledCount > countFilledInReport(best.report)) best = result;

      if (filledCount === lastCount) stagnant++;
      else stagnant = 0;
      lastCount = filledCount;

      const present = detectPresentFields(mode);
      if (present.length > 0 && filledCount >= present.length) break;
      if (stagnant >= 2 && filledCount > 0) break;
    }

    if (best) {
      finalizeIframeCardReport(best.report, best.platform);
      highlightMissedFields(best.report);
      if (countFilledInReport(best.report) > 0) playSuccessSound(soundMuted);
    }
  } finally {
    fillInProgress = false;
  }

  return best || buildResult(0, createReport(mode), detectPlatform(), mode);
}

async function executeFill(mode) {
  return executeFillWithRetries(mode);
}

function runAutoFill() {
  chrome.storage.local.get(["autoFillEnabled", "autoFillMode"], data => {
    if (data.autoFillEnabled === false) return;
    if (!IS_TOP_FRAME) return;
    executeFillWithRetries(data.autoFillMode || "all");
  });
}

function scheduleStripeFill(delay = 800) {
  if (!IS_TOP_FRAME) return;
  clearTimeout(stripeFillDebounce);
  stripeFillDebounce = setTimeout(runAutoFill, delay);
}

function scheduleObserverFill() {
  clearTimeout(observerDebounce);
  observerDebounce = setTimeout(runAutoFill, 500);
}

/* ───────────── Message listeners ───────────── */

window.addEventListener("message", async (event) => {
  if (event.data?.source !== MSG_SOURCE || event.data?.action !== "fill") return;
  if (IS_TOP_FRAME) return;
  const { address, card, mode } = event.data;
  await fillIframeFields(address, card, mode || "all", null);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "fillNow" && msg.action !== "fillWithAddress") return;
  if (!IS_TOP_FRAME) return;

  executeFillWithRetries(msg.mode || "all")
    .then(sendResponse)
    .catch(() => sendResponse({ filled: 0, success: false, message: "Ошибка заполнения" }));
  return true;
});

/* ───────────── Stripe floating button ───────────── */

function removeStripeFab() {
  stripeFabEl?.remove();
  stripeFabEl = null;
}

function updateStripeFab() {
  if (!IS_TOP_FRAME) return;
  if (!isStripeCheckoutPage()) {
    removeStripeFab();
    return;
  }
  chrome.storage.local.get([STRIPE_FAB_KEY], d => {
    if (d[STRIPE_FAB_KEY] === false) {
      removeStripeFab();
      return;
    }
    if (stripeFabEl?.isConnected) return;

    const fab = document.createElement("button");
    fab.id = "us-autofill-fab";
    fab.type = "button";
    fab.title = "AutoFill — заполнить форму";
    fab.innerHTML = '<span class="us-af-fab-icon">⚡</span><span>Fill</span>';
    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fab.classList.add("us-af-fab--busy");
      executeFillWithRetries("all").finally(() => {
        fab.classList.remove("us-af-fab--busy");
      });
    });
    document.documentElement.appendChild(fab);
    stripeFabEl = fab;
  });
}

/* ───────────── Auto-start (top frame only) ───────────── */

if (IS_TOP_FRAME) {
  const boot = () => {
    setTimeout(runAutoFill, 1000);
    updateStripeFab();
  };

  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else window.addEventListener("DOMContentLoaded", boot);

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stripePrepDone = false;
      scheduleObserverFill();
      updateStripeFab();
      return;
    }
    if (isStripeCheckoutPage()) updateStripeFab();
    const platform = detectPlatform();
    if (platform !== "generic") {
      const hasForm = document.querySelector(
        'iframe[src*="js.stripe.com"], iframe[name^="__privateStripeFrame"], #billingAddressLine1'
      );
      if (hasForm) scheduleStripeFill(500);
    }
  });

  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.stripeFabEnabled) updateStripeFab();
  });
}