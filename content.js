/* ═══════════════════════════════════════════════════════
   AutoFill — Content Script v2.3.0
   ═══════════════════════════════════════════════════════ */

(() => {
  if (globalThis.__US_AUTOFILL_V2_READY__) return;
  globalThis.__US_AUTOFILL_V2_READY__ = true;

const FILL_RETRY_DELAYS = [0, 400, 800, 1500];
const IFRAME_RETRY_DELAYS = [600, 1200];
const STRIPE_FAB_KEY = "stripeFabEnabled";

const MSG_SOURCE = "US_AUTOFILL_V2";
const IS_TOP_FRAME = window === window.top;

const STRIPE_HOST_RE = /(?:^|\.)stripe\.com$/i;
const STRIPE_CHECKOUT_RE = /^checkout\.stripe\.(com|dev)$|^buy\.stripe\.com$/i;
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
  cardCountry: "Регион карты",
  cardZip: "ZIP карты",
  currency: "Валюта",
  cardNumber: "Номер карты",
  cardExpiry: "Срок",
  cardCVV: "CVV"
};

const ADDRESS_KEYS = ["email", "firstName", "lastName", "fullName", "address1", "address2", "city", "state", "zip", "country"];
const CARD_KEYS = ["currency", "fullName", "cardNumber", "cardExpiry", "cardCVV", "cardCountry", "cardZip"];

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
      'input[placeholder*="email" i]', 'input#email', 'input.Input[name="email"]'
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
      'input[name="billingAddressLine1"]', 'input#billingAddressLine1',
      'input[name="checkout[shipping_address][address1]"]',
      'input[name="checkout[billing_address][address1]"]'
    ],
    keywords: ["address 1", "street", "улица", "billing address", "адрес", "address line"]
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
      'input[name="billingLocality"]', 'input#billingLocality',
      'input[name="checkout[shipping_address][city]"]',
      'input[name="checkout[billing_address][city]"]'
    ],
    keywords: ["city", "город", "town"]
  },
  state: {
    selectors: [
      'select[autocomplete="address-level1"]', 'select[name*="state" i]',
      'input[name*="state" i]', 'select[name="billingAdministrativeArea"]',
      'select#billingAdministrativeArea', 'input#billingAdministrativeArea',
      'select[name="checkout[shipping_address][province]"]',
      'select[name="checkout[billing_address][province]"]'
    ],
    keywords: ["state", "region", "province", "штат"]
  },
  zip: {
    selectors: [
      'input[autocomplete="postal-code"]', 'input[name*="zip" i]',
      'input[name*="postal" i]', 'input[name="billingPostalCode"]',
      'input#billingPostalCode',
      'input[name="checkout[shipping_address][zip]"]',
      'input[name="checkout[billing_address][zip]"]'
    ],
    keywords: ["zip", "postal", "postcode", "индекс"]
  },
  cardZip: {
    selectors: [
      'input[autocomplete="postal-code"]', 'input[name*="zip" i]',
      'input[name*="postal" i]', 'input[name="billingPostalCode"]',
      'input#billingPostalCode'
    ],
    keywords: ["zip", "postal", "postcode", "card zip", "billing zip"]
  },
  country: {
    selectors: [
      'select[autocomplete="country"]', 'select[name*="country" i]',
      'select[name="billingCountry"]', 'select#billingCountry',
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
let stripeCurrencyDone = false;
let observerDebounce = null;
let stripeFillDebounce = null;
let fillInProgress = false;
let stripeFabEl = null;
let lastAutoFillAt = 0;
let fastFillMode = false;
const AUTO_FILL_MIN_INTERVAL_MS = 5000;
const GET_DATA_TIMEOUT_MS = 8000;

function fillPause(ms) {
  const scaled = fastFillMode ? Math.min(ms, Math.max(60, Math.floor(ms * 0.28))) : ms;
  return sleep(scaled);
}

/* ───────────── Utils ───────────── */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(...args) {
  if (!devMode) return;
  console.log("[AutoFill]", ...args);
  pushDevLog("info", args);
}

function warn(...args) {
  if (!devMode) return;
  console.warn("[AutoFill]", ...args);
  pushDevLog("warn", args);
}

function stringifyLogArg(arg) {
  if (arg == null) return "";
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch (_) {
    return String(arg);
  }
}

function pushDevLog(level, args) {
  if (!devMode || !isExtAlive()) return;
  try {
    chrome.runtime.sendMessage({
      action: "appendDevLog",
      entry: {
        level,
        source: IS_TOP_FRAME ? "content:top" : "content:frame",
        message: args.map(stringifyLogArg).join(" "),
        url: location.href
      }
    }, () => {});
  } catch (_) {}
}

const US_AF_INIT_ATTR = "data-us-autofill-active";

function isExtAlive() {
  try {
    return !!chrome.runtime?.id;
  } catch (_) {
    return false;
  }
}

function loadDevMode() {
  if (!isExtAlive()) return;
  try {
    chrome.storage.local.get(["devMode"], d => { devMode = !!d.devMode; });
  } catch (_) {}
}

function isScriptInitialized() {
  try {
    return document.documentElement.hasAttribute(US_AF_INIT_ATTR);
  } catch (_) {
    return false;
  }
}

function isFillable(el) {
  try {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.offsetParent !== null) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch (_) {
    return false;
  }
}

function collectShadowRoots(root, depth, out) {
  if (depth > 5 || !root?.querySelectorAll) return;
  try {
    root.querySelectorAll("*").forEach(el => {
      try {
        if (el.shadowRoot) {
          out.push(el.shadowRoot);
          collectShadowRoots(el.shadowRoot, depth + 1, out);
        }
      } catch (_) {}
    });
  } catch (_) {}
}

function queryAllDeep(selector, root = document) {
  const out = [];
  const roots = [root];
  collectShadowRoots(root, 0, roots);
  for (const r of roots) {
    try {
      r.querySelectorAll(selector).forEach(el => {
        try { if (isFillable(el)) out.push(el); } catch (_) {}
      });
    } catch (_) {}
  }
  return out;
}

function queryAllDeepRaw(selector, root = document) {
  const out = [];
  const roots = [root];
  collectShadowRoots(root, 0, roots);
  for (const r of roots) {
    try { r.querySelectorAll(selector).forEach(el => out.push(el)); } catch (_) {}
  }
  return out;
}

function shouldUseDeepSearch() {
  if (isStripeIframe()) return true;
  return !isStripeCheckoutPage();
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
    'iframe[src*="js.stripe.com"], iframe[src*="embedded-checkout-inner"], ' +
    'iframe[name^="__privateStripeFrame"], ' +
    '[data-testid="hosted-payment-submit-button"], button[class*="SubmitButton"]'
  );
}

function hasEmbeddedStripeCheckout() {
  return IS_TOP_FRAME && !!document.querySelector(
    'iframe[src*="embedded-checkout-inner"], iframe[src*="embedded-checkout"]'
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
      const el = document.querySelector(sel);
      if (el && isFillable(el)) return el;
      if (shouldUseDeepSearch()) {
        const found = queryAllDeep(sel);
        if (found.length) return found[0];
      }
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
  const selector = "input[aria-label], select[aria-label], textarea[aria-label]";
  const elements = shouldUseDeepSearch()
    ? queryAllDeep(selector)
    : [...document.querySelectorAll(selector)];
  for (const el of elements) {
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (keywords.some(kw => aria.includes(kw))) return el;
  }
  return null;
}

function findByPlaceholder(keywords) {
  const selector = "input[placeholder], textarea[placeholder]";
  const elements = shouldUseDeepSearch()
    ? queryAllDeep(selector)
    : [...document.querySelectorAll(selector)];
  for (const el of elements) {
    const ph = (el.getAttribute("placeholder") || "").toLowerCase();
    if (keywords.some(kw => ph.includes(kw))) return el;
  }
  return null;
}

const STRIPE_BILLING_IDS = {
  email: ["email"],
  firstName: ["billingFirstName"],
  lastName: ["billingLastName"],
  address1: ["billingAddressLine1"],
  address2: ["billingAddressLine2"],
  city: ["billingLocality"],
  zip: ["billingPostalCode"],
  state: ["billingAdministrativeArea"],
  country: ["billingCountry"]
};

const COUNTRY_DISPLAY_NAMES = {
  US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France",
  CA: "Canada", AU: "Australia", NL: "Netherlands", IT: "Italy", ES: "Spain", PL: "Poland"
};

const CURRENCY_STRIPE_MATCH = {
  USD: { labels: [/^US$/i, /^USD$/i, /\$/], data: "usd", names: [/united states/i, /us dollar/i] },
  EUR: { labels: [/^EUR$/i, /^EU$/i, /€/], data: "eur", names: [/euro/i, /eur\b/i] },
  GBP: { labels: [/^GB$/i, /^GBP$/i, /£/], data: "gbp", names: [/united kingdom/i, /british pound/i] },
  CAD: { labels: [/^CA$/i, /^CAD$/i, /C\$/], data: "cad", names: [/canada/i, /canadian dollar/i] },
  AUD: { labels: [/^AU$/i, /^AUD$/i, /A\$/], data: "aud", names: [/australia/i, /australian dollar/i] },
  PLN: { labels: [/^PL$/i, /^PLN$/i, /zł/i], data: "pln", names: [/poland/i, /polish/i, /złot/i] },
  SEK: { labels: [/^SE$/i, /^SEK$/i, /kr\b/i], data: "sek", names: [/sweden/i, /swedish/i, /krona/i] },
  CHF: { labels: [/^CH$/i, /^CHF$/i], data: "chf", names: [/switzerland/i, /swiss/i] },
  JPY: { labels: [/^JP$/i, /^JPY$/i, /¥/], data: "jpy", names: [/japan/i, /yen/i] }
};

function currencyStripeMatch(currencyCode) {
  const code = (currencyCode || "USD").toUpperCase();
  return CURRENCY_STRIPE_MATCH[code] || {
    labels: [new RegExp(`^${code}$`, "i")],
    data: code.toLowerCase(),
    names: []
  };
}

function lineMatchesCurrency(line, currencyCode) {
  const trimmed = (line || "").trim();
  if (!trimmed || trimmed.length > 24) return false;
  const { labels } = currencyStripeMatch(currencyCode);
  return labels.some(re => re.test(trimmed));
}

function textMatchesCurrency(text, currencyCode) {
  const raw = (text || "").trim();
  if (!raw || raw.length > 120) return false;
  const code = (currencyCode || "USD").toUpperCase();
  const match = currencyStripeMatch(code);
  if (raw.split("\n").some(l => lineMatchesCurrency(l, code))) return true;
  if (match.names?.some(re => re.test(raw))) return true;
  if (new RegExp(`\\b${code}\\b`, "i").test(raw)) return true;
  if ((raw.toLowerCase().includes(match.data))) return true;
  return false;
}

function currencyControlLabel(el) {
  if (!el) return "";
  const aria = el.getAttribute("aria-label") || "";
  const val = el.value || el.getAttribute("data-value") || el.getAttribute("data-currency") || "";
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent) return `${label.textContent} ${aria} ${val}`;
  }
  const parentLabel = el.closest("label");
  if (parentLabel?.textContent) return parentLabel.textContent;
  return `${el.textContent || ""} ${aria} ${val}`;
}

function isCurrencyAlreadySelected(currencyCode) {
  const code = (currencyCode || "USD").toUpperCase();
  const match = currencyStripeMatch(code);
  const checked = queryAllDeepRaw(
    'input[type="radio"]:checked, [role="radio"][aria-checked="true"], [aria-checked="true"][role="radio"]'
  );
  for (const el of checked) {
    const val = (el.value || el.getAttribute("data-value") || el.getAttribute("data-currency") || "").toLowerCase();
    if (val === match.data) return true;
    if (textMatchesCurrency(currencyControlLabel(el), code)) return true;
  }
  const selected = queryAllDeepRaw('[data-currency][aria-checked="true"], [data-currency].is-selected, [data-currency][class*="selected"]');
  for (const el of selected) {
    const val = (el.getAttribute("data-currency") || "").toLowerCase();
    if (val === match.data) return true;
  }
  return false;
}

function findStripeCurrencySection() {
  const headingRe = /choose a currency|choose your currency|select a currency|pay in/i;
  for (const el of queryAllDeepRaw("div, section, fieldset, form")) {
    const t = (el.textContent || "").slice(0, 240);
    if (!headingRe.test(t)) continue;
    if (el.querySelector('button, [role="button"], [role="radio"], input[type="radio"]')) return el;
  }
  return null;
}

function hasBillingAddressFields() {
  return !!(
    findStripeBillingField("address1") || findField("address1") ||
    findStripeBillingField("city") || findField("city") ||
    document.querySelector("#billingAddressLine1, input[autocomplete='address-line1']")
  );
}

function queryAllInputsDeep(root = document) {
  const out = [];
  const walk = (r, depth = 0) => {
    if (depth > 6 || !r?.querySelectorAll) return;
    try {
      r.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => out.push(el));
      r.querySelectorAll("*").forEach(el => {
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      });
    } catch (_) {}
  };
  walk(root);
  return out;
}

function findStripeBillingField(key) {
  const ids = STRIPE_BILLING_IDS[key];
  if (!ids) return null;
  for (const id of ids) {
    try {
      const safeId = CSS.escape(id);
      const candidates = [
        document.getElementById(id),
        document.querySelector(`input#${safeId}, select#${safeId}, textarea#${safeId}`),
        document.querySelector(`[name="${safeId}"]`),
        document.querySelector(`[autocomplete="${safeId}"]`),
        ...queryAllDeep(`#${safeId}, [name="${safeId}"]`)
      ].filter(Boolean);
      for (const el of candidates) {
        if (isFillable(el)) return el;
      }
    } catch (_) {}
  }
  if (key === "country") {
    const combo = document.querySelector(
      '#billingCountry, [name="billingCountry"], [autocomplete="country"], [role="combobox"][aria-label*="country" i]'
    );
    if (combo && isFillable(combo)) return combo;
  }
  return null;
}

function findField(key) {
  if (key === "cardZip") {
    for (const input of queryAllInputsDeep()) {
      if (detectFieldFromInput(input) === "cardZip") return input;
    }
    return null;
  }

  if (isStripeCheckoutPage()) {
    const stripeEl = findStripeBillingField(key);
    if (stripeEl) return stripeEl;
  }
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
  if (!Array.isArray(report)) return;
  const item = report.find(r => r.key === key);
  if (item) item.status = status;
}

/* ───────────── Fill helpers ───────────── */

function fieldAlreadyFilled(el, options = {}) {
  if (!el) return false;
  if (options.force) return false;
  if (el.getAttribute("data-us-autofilled") === "true") return true;
  return !!el.value?.trim();
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
  if (fieldAlreadyFilled(el, options)) return true;

  if (options.scroll !== false && !fastFillMode) {
    el.scrollIntoView({ block: "center", behavior: "auto" });
  }
  el.focus();
  const strVal = String(value);

  if (options.stripe) {
    if (fastFillMode) {
      await fillViaPaste(el, strVal);
      if (el.value !== strVal && el.value.replace(/\s/g, "") !== strVal.replace(/\s/g, "")) {
        setNativeValue(el, strVal);
        dispatchEvents(el);
      }
    } else {
      await fillStripeStyle(el, strVal);
      if (el.value !== strVal && el.value.replace(/\s/g, "") !== strVal.replace(/\s/g, "")) {
        await fillViaPaste(el, strVal);
      }
    }
  } else {
    setNativeValue(el, strVal);
    dispatchEvents(el);
    if (el.value !== strVal) await fillViaPaste(el, strVal);
    if (el.value !== strVal) await fillStripeStyle(el, strVal);
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

function getAssociatedLabel(el) {
  if (!el) return "";
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return label.textContent.trim();
  }
  const parentLabel = el.closest("label");
  if (parentLabel) return parentLabel.textContent.trim();
  const prev = el.previousElementSibling;
  if (prev) return (prev.textContent || "").trim();
  return "";
}

function findSectionRoot(pattern) {
  for (const el of document.querySelectorAll("h2, h3, h4, legend, div, section, fieldset")) {
    const t = (el.textContent || "").trim();
    if (t.length > 50) continue;
    if (pattern.test(t)) {
      return el.closest("section, fieldset, form, [class*='Payment'], [class*='payment']") ||
        el.parentElement?.parentElement || el.parentElement;
    }
  }
  return null;
}

function getElementSectionContext(el) {
  let node = el;
  for (let i = 0; i < 16 && node; i++) {
    const text = (node.getAttribute?.("aria-label") || node.textContent || "").slice(0, 500).toLowerCase();
    if (/payment method|card information|cardholder|country or region/.test(text)) return "card";
    if (/shipping address|shipping information/.test(text)) return "shipping";
    node = node.parentElement;
  }
  return "unknown";
}

function findControlNearLabel(labelPatterns) {
  for (const label of document.querySelectorAll("label, span, div, p, legend")) {
    const text = (label.textContent || "").trim();
    if (!text || text.length > 80) continue;
    if (!labelPatterns.some(p => p.test(text))) continue;
    const parent = label.parentElement;
    if (parent) {
      for (const c of parent.querySelectorAll(
        'select, [role="combobox"], [role="listbox"], button, [role="button"], [tabindex="0"]'
      )) {
        if (c !== label && !label.contains(c)) return c;
      }
    }
    let sib = label.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++) {
      if (sib.matches?.("select, [role='combobox'], button, [role='button']")) return sib;
      const inner = sib.querySelector?.("select, [role='combobox'], button, [role='button']");
      if (inner) return inner;
      sib = sib.nextElementSibling;
    }
  }
  return null;
}

function countryValueMatches(el, countryCode) {
  const displayName = COUNTRY_DISPLAY_NAMES[countryCode] || countryCode;
  const searchRe = COUNTRY_SEARCH_TERMS[countryCode];
  const val = (el.value || el.textContent || "").trim();
  if (!val) return false;
  return searchRe?.test(val) || val === displayName ||
    (countryCode === "US" && /^united states$/i.test(val));
}

function findAllCountryControls() {
  const seen = new Set();
  const out = [];
  const add = el => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    out.push(el);
  };
  for (const sel of document.querySelectorAll("select")) {
    const meta = `${sel.name} ${sel.id} ${sel.autocomplete} ${sel.getAttribute("aria-label")} ${getAssociatedLabel(sel)}`.toLowerCase();
    if (/country|region/.test(meta)) add(sel);
  }
  const shipping = findSectionRoot(/shipping/i);
  if (shipping) shipping.querySelectorAll("select, [role='combobox']").forEach(add);
  const payment = findSectionRoot(/payment method/i);
  if (payment) payment.querySelectorAll("select, [role='combobox'], button, [role='button']").forEach(add);
  for (const el of queryAllDeep('[role="combobox"], input[aria-label*="country" i], [aria-label*="Country or region" i]')) {
    add(el);
  }
  return out;
}

function findShippingCountryField() {
  const near = findControlNearLabel([/^shipping address$/i, /shipping.*country/i]);
  if (near && getElementSectionContext(near) !== "card") return near;
  const all = findAllCountryControls();
  return all.find(el => getElementSectionContext(el) === "shipping")
    || all.find(el => !/country or region/i.test(`${el.getAttribute("aria-label")} ${getAssociatedLabel(el)}`))
    || all[0] || null;
}

function findCardCountryField() {
  const nearLabel = findControlNearLabel([/^country or region$/i, /country or region/i]);
  if (nearLabel) return nearLabel;

  for (const el of queryAllDeep('select, [role="combobox"], button, [role="button"]')) {
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const label = getAssociatedLabel(el).toLowerCase();
    if (/country or region/i.test(aria) || /country or region/i.test(label)) return el;
  }

  const payment = findSectionRoot(/^payment method$/i);
  if (payment) {
    const selects = [...payment.querySelectorAll("select")];
    if (selects.length) return selects[selects.length - 1];
    for (const el of payment.querySelectorAll('[role="combobox"], button, [role="button"]')) {
      const t = (el.textContent || "").trim();
      if (t.length > 40) continue;
      if (/^(sweden|united states|germany|france|canada|poland|norway|denmark|finland)/i.test(t)) return el;
    }
  }

  const all = findAllCountryControls().filter(el => getElementSectionContext(el) === "card");
  if (all.length) return all[all.length - 1];
  const every = findAllCountryControls();
  return every.length >= 2 ? every[every.length - 1] : null;
}

async function pickCountryFromList(countryCode) {
  const displayName = COUNTRY_DISPLAY_NAMES[countryCode] || countryCode;
  const searchRe = COUNTRY_SEARCH_TERMS[countryCode];
  const selectors = [
    '[role="option"]', '[role="menuitem"]', '[role="menuitemradio"]',
    'li[role="option"]', '[class*="Menu"] li', '[class*="menu"] li', '[class*="Select"] li'
  ];
  for (const sel of selectors) {
    for (const item of document.querySelectorAll(sel)) {
      const text = item.textContent.trim();
      if (!text || text.length > 80) continue;
      if (searchRe?.test(text) || text === displayName ||
          (countryCode === "US" && /^united states$/i.test(text))) {
        item.click();
        await sleep(450);
        return true;
      }
    }
  }
  return false;
}

async function fillCountryOnControl(el, countryCode) {
  if (!el) return false;
  if (countryValueMatches(el, countryCode)) return true;
  const displayName = COUNTRY_DISPLAY_NAMES[countryCode] || countryCode;
  if (el.tagName === "SELECT") return selectCountry(el, countryCode);

  el.scrollIntoView?.({ block: "center", behavior: "auto" });
  el.focus?.();
  el.click();
  await sleep(500);

  if (el.tagName === "INPUT") {
    await fillInput(el, displayName, { force: true });
    await sleep(400);
  }

  if (await pickCountryFromList(countryCode)) return true;

  const filterInput = document.querySelector(
    '[role="combobox"] input:focus, input[aria-autocomplete="list"], input[placeholder*="Search" i]'
  );
  if (filterInput) {
    await fillInput(filterInput, displayName, { force: true });
    await sleep(450);
    if (await pickCountryFromList(countryCode)) return true;
  }

  document.body.click();
  await sleep(200);
  return false;
}

async function fillShippingCountry(countryCode) {
  const el = findShippingCountryField();
  if (el) return fillCountryOnControl(el, countryCode);
  return fillStripeCountryLegacy(countryCode);
}

async function fillCardCountryRegion(countryCode, report) {
  const displayName = COUNTRY_DISPLAY_NAMES[countryCode] || countryCode;
  const maxAttempts = fastFillMode ? 2 : 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const el = findCardCountryField();
    if (!el) {
      await fillPause(400);
      continue;
    }
    if (countryValueMatches(el, countryCode)) {
      setReportStatus(report, "cardCountry", "filled");
      return true;
    }
    if (await fillCountryOnControl(el, countryCode)) {
      await fillPause(400);
      const el2 = findCardCountryField();
      if (!el2 || countryValueMatches(el2, countryCode)) {
        setReportStatus(report, "cardCountry", "filled");
        return true;
      }
    }
    await fillPause(300);
  }
  setReportStatus(report, "cardCountry", "not_found");
  log("cardCountry not set to", displayName);
  return false;
}

async function fillCardZip(address, report, opts = {}) {
  if (!address?.zip) return false;
  let found = false;
  for (const input of queryAllInputsDeep()) {
    if (detectFieldFromInput(input) !== "cardZip") continue;
    found = true;
    if (fieldAlreadyFilled(input)) {
      setReportStatus(report, "cardZip", "filled");
      return false;
    }
    if (await fillInput(input, address.zip, { ...opts, scroll: false })) {
      setReportStatus(report, "cardZip", "filled");
      log("cardZip");
      return true;
    }
  }
  if (found) setReportStatus(report, "cardZip", "not_found");
  return false;
}

async function clickCurrencyControl(el) {
  if (!el) return false;
  try {
    let target = el;
    if (el.tagName === "INPUT" && el.type === "radio") {
      const label = el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        : null;
      target = label || el.closest("label") || el;
    }
    target.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    target.click();
    await fillPause(120);
    return true;
  } catch (_) {
    return false;
  }
}

async function fillStripeCurrency(currencyCode, report) {
  const code = (currencyCode || "USD").toUpperCase();
  const match = currencyStripeMatch(code);
  if (isCurrencyAlreadySelected(code)) {
    setReportStatus(report, "currency", "filled");
    return true;
  }

  const section = findStripeCurrencySection();
  const roots = section ? [section, document] : [document];

  for (const root of roots) {
    const dataSel = `[data-currency="${match.data}"], [data-value="${match.data}"], [value="${match.data}"]`;
    for (const el of (root === document ? queryAllDeepRaw(dataSel) : [...root.querySelectorAll(dataSel)])) {
      if (await clickCurrencyControl(el)) {
        setReportStatus(report, "currency", "filled");
        return true;
      }
    }
  }

  for (const root of roots) {
    for (const input of (root === document ? queryAllDeepRaw('input[type="radio"]') : [...root.querySelectorAll('input[type="radio"]')])) {
      const val = (input.value || input.getAttribute("data-value") || "").toLowerCase();
      if (val === match.data || textMatchesCurrency(currencyControlLabel(input), code)) {
        if (await clickCurrencyControl(input)) {
          setReportStatus(report, "currency", "filled");
          return true;
        }
      }
    }
  }

  for (const root of roots) {
    for (const el of (root === document
      ? queryAllDeep('button, [role="button"], [role="radio"], label, div[tabindex="0"], span[tabindex="0"]')
      : [...root.querySelectorAll('button, [role="button"], [role="radio"], label, div[tabindex="0"], span[tabindex="0"]')])) {
      const labelText = currencyControlLabel(el);
      if (!textMatchesCurrency(labelText, code)) continue;
      if (await clickCurrencyControl(el)) {
        setReportStatus(report, "currency", "filled");
        return true;
      }
    }
  }

  for (const el of queryAllDeepRaw(`[aria-label*="${code}" i], [aria-label*="${match.data}" i]`)) {
    if (await clickCurrencyControl(el)) {
      setReportStatus(report, "currency", "filled");
      return true;
    }
  }

  setReportStatus(report, "currency", "not_found");
  return false;
}

async function clickCustomCountryDropdown(countryCode, rootEl = null) {
  const searchRe = COUNTRY_SEARCH_TERMS[countryCode];
  if (!searchRe) return false;
  const displayName = COUNTRY_DISPLAY_NAMES[countryCode] || countryCode;
  const patterns = [
    '#billingCountry', '[id*="billingCountry"]', '[name="billingCountry"]',
    '[class*="country"] [role="combobox"]', '[class*="countrySelect"]',
    '[class*="billing"] [class*="country"]', '[role="combobox"][aria-label*="country" i]'
  ];
  const seen = new Set();
  const roots = rootEl ? [rootEl] : [document];
  for (const sel of patterns) {
    for (const root of roots) {
    for (const el of (root === document ? queryAllDeep(sel) : [...root.querySelectorAll(sel)])) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (!isFillable(el) && el.tagName !== "SELECT") continue;
      el.click();
      await sleep(500);
      if (el.tagName === "INPUT") {
        await fillInput(el, displayName, { force: true });
        await sleep(400);
      }
      for (const item of document.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="menuitemradio"], li[class*="item"], li[role="option"]'
      )) {
        const text = item.textContent.trim();
        if (searchRe.test(text) || text === displayName) {
          item.click();
          await sleep(400);
          return true;
        }
      }
      document.body.click();
      await sleep(200);
    }
    }
  }
  return false;
}

async function fillStripeCountryLegacy(countryCode) {
  const countryEl = findStripeBillingField("country") || findField("country");
  if (countryEl?.tagName === "SELECT") {
    if (selectCountry(countryEl, countryCode)) return true;
    const cfg = COUNTRY_PATTERNS[countryCode];
    for (const opt of countryEl.options) {
      const val = opt.value.trim();
      const txt = opt.textContent.trim();
      if (cfg?.values.includes(val) || cfg?.patterns.some(p => p.test(val) || p.test(txt))) {
        setNativeValue(countryEl, opt.value);
        dispatchEvents(countryEl);
        countryEl.dispatchEvent(new Event("change", { bubbles: true }));
        if (countryEl.value === opt.value) return true;
      }
    }
  }
  return clickCustomCountryDropdown(countryCode);
}

async function fillStripeCountry(countryCode) {
  return fillShippingCountry(countryCode);
}

async function fillStripeBillingField(key, value, report, opts) {
  if (!value && key !== "address2") {
    setReportStatus(report, key, "skipped");
    return false;
  }
  const el = findStripeBillingField(key) || findField(key);
  if (!el) {
    setReportStatus(report, key, "not_found");
    return false;
  }
  if (fieldAlreadyFilled(el) && key !== "country") {
    setReportStatus(report, key, "filled");
    return true;
  }
  const ok = key === "email"
    ? await fillInputIfEmpty(el, value, opts)
    : await fillInput(el, value, { ...opts, force: key === "country" });
  setReportStatus(report, key, ok ? "filled" : "not_found");
  return ok;
}

async function fillStripeBillingAddress(address, countryCode, report, currencyCode) {
  const billingOpts = { stripe: false };
  let filled = 0;

  await fillStripeCurrency(currencyCode, report);
  stripeCurrencyDone = true;

  if (await fillStripeBillingField("email", address.email, report, billingOpts)) filled++;

  const countryOk = await fillStripeCountry(countryCode);
  setReportStatus(report, "country", countryOk ? "filled" : "not_found");
  if (countryOk) filled++;

  if (!hasBillingAddressFields()) {
    await quickStripeFormPrep();
    await waitForBillingFields(fastFillMode ? 600 : 1800);
  }

  const firstEl = findStripeBillingField("firstName") || findField("firstName");
  const lastEl = findStripeBillingField("lastName") || findField("lastName");
  const fullEl = findField("fullName");

  if (fullEl && !firstEl) {
    if (await fillStripeBillingField("fullName", address.fullName, report, billingOpts)) filled++;
  } else {
    if (await fillStripeBillingField("firstName", address.firstName, report, billingOpts)) filled++;
    if (await fillStripeBillingField("lastName", address.lastName, report, billingOpts)) filled++;
  }

  if (await fillStripeBillingField("address1", address.address1, report, billingOpts)) filled++;
  if (address.address2) {
    if (await fillStripeBillingField("address2", address.address2, report, billingOpts)) filled++;
  } else {
    setReportStatus(report, "address2", "skipped");
  }
  if (await fillStripeBillingField("city", address.city, report, billingOpts)) filled++;

  const stateEl = findStripeBillingField("state") || findField("state");
  if (stateEl) {
    let ok = false;
    if (stateEl.tagName === "SELECT") {
      ok = selectState(stateEl, address.state, address.stateAbbr);
    } else {
      ok = await fillInput(stateEl, address.stateAbbr || address.state, billingOpts);
    }
    setReportStatus(report, "state", ok ? "filled" : "not_found");
    if (ok) filled++;
  } else {
    setReportStatus(report, "state", "not_found");
  }

  if (await fillStripeBillingField("zip", address.zip, report, billingOpts)) filled++;

  return filled;
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

async function uncheckBillingSameAsShipping() {
  for (const el of document.querySelectorAll('label, [role="checkbox"], input[type="checkbox"]')) {
    const text = (el.textContent || el.getAttribute("aria-label") || "").trim();
    if (!/billing info is same as shipping|same as shipping|совпадает с адресом доставки/i.test(text)) continue;
    const input = el.tagName === "INPUT" ? el : (
      el.querySelector('input[type="checkbox"]') ||
      (el.getAttribute("for") ? document.getElementById(el.getAttribute("for")) : null)
    );
    if (input?.checked) {
      input.click();
      await fillPause(150);
      return true;
    }
  }
  return false;
}

async function clickEnterAddressManually() {
  const patterns = [/enter address manually/i, /ввести адрес вручную/i, /add address manually/i];
  const btn = findClickableByText(patterns);
  if (btn) {
    btn.click();
    await fillPause(fastFillMode ? 180 : 400);
    return true;
  }
  for (const el of document.querySelectorAll("button, a, span, div")) {
    const text = (el.textContent || "").trim();
    if (text.length > 60) continue;
    if (/enter address manually/i.test(text)) {
      el.click();
      await fillPause(fastFillMode ? 180 : 400);
      return true;
    }
  }
  return false;
}

async function expandBillingAddress() {
  await clickEnterAddressManually();
  const patterns = [
    /add billing address/i, /billing address/i, /enter billing/i,
    /enter address manually/i, /add address/i, /use a different address/i,
    /shipping address/i, /add shipping address/i,
    /добавить адрес/i, /адрес для счёта/i, /ввести адрес/i
  ];
  const toggle = findClickableByText(patterns);
  if (toggle) {
    toggle.click();
    await fillPause(200);
    return true;
  }
  const billingToggle = document.querySelector(
    '[data-testid="billing-address-panel"] button, ' +
    '[data-testid="billing-address-collection"] button, ' +
    '[class*="BillingAddress"] button, ' +
    'button[aria-expanded="false"][class*="Address"], ' +
    'button[aria-controls*="billing" i]'
  );
  if (billingToggle) {
    billingToggle.click();
    await fillPause(200);
    return true;
  }
  return false;
}

async function waitForBillingFields(timeout = 6000) {
  const maxMs = fastFillMode ? Math.min(timeout, 800) : timeout;
  const pollMs = fastFillMode ? 60 : 120;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (hasBillingAddressFields()) return true;
    if (Date.now() - start > 150) await clickEnterAddressManually();
    await fillPause(pollMs);
  }
  return hasBillingAddressFields();
}

async function quickStripeFormPrep() {
  const enterDetails = findClickableByText([
    /enter payment details/i, /ввести данные/i,
    /pay without link/i, /оплатить без link/i,
    /pay with card/i, /use a card/i, /enter card details manually/i,
    /pay another way/i, /manual card entry/i
  ]);
  if (enterDetails) {
    enterDetails.click();
    await fillPause(200);
  }

  const cardTab = document.querySelector(
    '[data-testid="payment-method-card"], [data-testid="card-tab"], ' +
    'button[aria-label*="card" i], input[value="card"]'
  );
  if (cardTab) {
    cardTab.click();
    await fillPause(150);
  }

  await uncheckBillingSameAsShipping();
  await expandBillingAddress();
}

async function fillKnownStripeFields(address, card, mode, report, billingOpts) {
  let filled = 0;
  const fillAddress = mode === "all" || mode === "address";
  const fillCard = mode === "all" || mode === "card";
  const countryCode = address?.country || "US";

  if (fillAddress && address) {
    const ordered = [
      ["email", address.email],
      ["firstName", address.firstName],
      ["lastName", address.lastName],
      ["fullName", address.fullName],
      ["address1", address.address1],
      ["address2", address.address2],
      ["city", address.city],
      ["zip", address.zip]
    ];
    for (const [key, value] of ordered) {
      if (!value) continue;
      let el = findStripeBillingField(key) || findField(key);
      if (!el) {
        for (const input of queryAllInputsDeep()) {
          if (detectFieldFromInput(input) === key) { el = input; break; }
        }
      }
      if (!el) continue;
      if (fieldAlreadyFilled(el)) continue;
      let ok = false;
      if (key === "email") ok = await fillInputIfEmpty(el, value, billingOpts);
      else ok = await fillInput(el, value, billingOpts);
      if (ok) { filled++; setReportStatus(report, key, "filled"); }
    }

    for (const sel of document.querySelectorAll("select")) {
      if (detectFieldFromInput(sel) !== "state") continue;
      if (selectState(sel, address.state, address.stateAbbr)) {
        filled++;
        setReportStatus(report, "state", "filled");
      }
    }
  }

  if (fillCard && card?.number) {
    const cardFields = [
      ["cardNumber", card.number, true],
      ["cardExpiry", card.formattedExpiry, true],
      ["cardCVV", card.cvv, true],
      ["fullName", address?.fullName, true],
      ["cardZip", address?.zip, true]
    ];
    for (const [key, value, stripe] of cardFields) {
      if (!value) continue;
      for (const input of queryAllInputsDeep()) {
        if (detectFieldFromInput(input) !== key) continue;
        if (fieldAlreadyFilled(input)) continue;
        if (await fillInput(input, value, { stripe, scroll: false })) {
          filled++;
          setReportStatus(report, key, "filled");
        }
        break;
      }
    }
    await sleep(400);
    if (await fillCardCountryRegion(countryCode, report)) filled++;
    if (await fillCardZip(address, report, { stripe: true })) filled++;
  }

  return filled;
}

async function prepareStripeCheckout(currencyCode, report) {
  if (!isStripeCheckoutPage() && !isStripeIframe()) return;
  if (stripePrepDone) return;

  if (currencyCode && !stripeCurrencyDone) {
    await fillStripeCurrency(currencyCode, report);
    stripeCurrencyDone = true;
  }

  await quickStripeFormPrep();

  if (!hasBillingAddressFields()) {
    await waitForBillingFields(fastFillMode ? 500 : 1500);
  }

  stripePrepDone = true;
}

async function prepareShopifyCheckout() {
  const cardRadio = document.querySelector('input[id*="payment-gateway"], input[name="payment_method"]');
  if (cardRadio && !cardRadio.checked) { cardRadio.click(); await sleep(400); }
}

async function prepareCheckout(platform) {
  if (platform === "stripe") {
    await prepareStripeCheckout();
    stripePrepDone = true;
  } else if (platform === "shopify") {
    await prepareShopifyCheckout();
  } else if (platform === "paddle" || platform === "lemon") {
    const cardTab = findClickableByText([/^card$/i, /credit card/i, /^карта$/i]);
    if (cardTab) { cardTab.click(); await sleep(400); }
    await expandBillingAddress();
    await waitForBillingFields(3000);
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
  if (/given.?name|first.?name|firstname|billingfirstname/.test(meta)) return "firstName";
  if (/family.?name|last.?name|lastname|billinglastname/.test(meta)) return "lastName";
  if (/^email$|e-mail/.test(meta)) return "email";
  if (/country or region|card.?country|issuer.?country|funding/i.test(meta)) return "cardCountry";
  if (/^country$|billingcountry|shipping.*country/.test(meta)) return "country";
  if (/address-line1|street|address1|billingaddressline1/.test(meta)) return "address1";
  if (/address-line2|address2|billingaddressline2/.test(meta)) return "address2";
  if (/address-level2|locality|city|billinglocality/.test(meta)) return "city";
  if (/postal|zip|postcode|billingpostalcode/.test(meta)) {
    return getElementSectionContext(input) === "card" ? "cardZip" : "zip";
  }
  if (/address-level1|administrative|state|province|billingadministrativearea/.test(meta)) return "state";
  return null;
}

async function fillIframeFields(address, card, mode, report, currencyCode) {
  const fillAddress = mode === "all" || mode === "address";
  const fillCard = mode === "all" || mode === "card";
  const inStripeFrame = isStripeIframe() || /stripe/i.test(location.hostname);
  let filled = 0;
  let stripeFieldsDone = false;
  const countryCode = address?.country || "US";
  const currency = currencyCode || "USD";
  const billingOpts = { stripe: false, scroll: false };

  if (inStripeFrame && !stripePrepDone) {
    if (!stripeCurrencyDone) {
      await fillStripeCurrency(currency, report);
      stripeCurrencyDone = true;
    }
    await quickStripeFormPrep();
    stripePrepDone = true;
  }

  if (fillAddress && address) {
    const emailEl = document.querySelector(
      'input[type="email"], input[name="email"], input[autocomplete="email"], #email'
    );
    if (emailEl && !fieldAlreadyFilled(emailEl)) {
      const ok = await fillInputIfEmpty(emailEl, address.email, billingOpts);
      if (ok) {
        filled++;
        setReportStatus(report, "email", "filled");
        log("iframe: email");
      }
    }

    const shipCountryEl = findShippingCountryField();
    let countryDone = false;
    if (shipCountryEl && await fillCountryOnControl(shipCountryEl, countryCode)) {
      filled++;
      countryDone = true;
      setReportStatus(report, "country", "filled");
      log("iframe: shipping country");
      await fillPause(700);
    }
    if (!countryDone) {
      const countryOk = await fillShippingCountry(countryCode);
      if (countryOk) {
        filled++;
        setReportStatus(report, "country", "filled");
        log("iframe: country");
        await fillPause(700);
      } else {
        setReportStatus(report, "country", "not_found");
      }
    }

    if (inStripeFrame) {
      if (!hasBillingAddressFields()) {
        await expandBillingAddress();
        await waitForBillingFields(fastFillMode ? 600 : 1800);
      }
      filled += await fillKnownStripeFields(address, card, mode, report, billingOpts);
      stripeFieldsDone = true;
    }
  }

  if (stripeFieldsDone && fastFillMode) {
    if (fillCard && card?.number && (mode === "all" || mode === "card")) {
      if (await fillCardCountryRegion(countryCode, report)) filled++;
      if (await fillCardZip(address, report, { stripe: true })) filled++;
    }
    return filled;
  }

  const inputs = inStripeFrame
    ? queryAllInputsDeep()
    : [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
  const values = {
    email: address?.email,
    firstName: address?.firstName,
    lastName: address?.lastName,
    fullName: address?.fullName,
    address1: address?.address1,
    address2: address?.address2,
    city: address?.city,
    zip: address?.zip,
    state: address?.stateAbbr || address?.state,
    cardZip: address?.zip,
    cardNumber: card?.number,
    cardExpiry: card?.formattedExpiry,
    cardCVV: card?.cvv
  };

  for (const input of inputs) {
    if (fieldAlreadyFilled(input)) continue;
    const key = detectFieldFromInput(input);
    if (!key) continue;
    if (!fillAddress && ADDRESS_KEYS.includes(key)) continue;
    if (!fillCard && CARD_KEYS.includes(key)) continue;
    if (key === "email" || key === "country" || key === "cardCountry") continue;
    const value = values[key];
    if (!value && key !== "address2") continue;

    let ok = false;
    if (key === "state" && input.tagName === "SELECT" && address) {
      ok = selectState(input, address.state, address.stateAbbr);
    } else {
      ok = await fillInput(input, value, { stripe: CARD_KEYS.includes(key) });
    }

    if (ok) {
      filled++;
      setReportStatus(report, key, "filled");
      log(`iframe: ${key}`);
    }
  }

  if (fillCard && card?.number && (mode === "all" || mode === "card")) {
    if (await fillCardCountryRegion(countryCode, report)) filled++;
    if (await fillCardZip(address, report, { stripe: true })) filled++;
  }

  return filled;
}

function countFilledInReport(report) {
  if (!Array.isArray(report)) return 0;
  return report.filter(r => r.status === "filled").length;
}

/* ───────────── Broadcast (top → iframes) ───────────── */

function broadcastFill(payload) {
  try {
    const msg = { source: MSG_SOURCE, action: "fill", ...payload };
    try { window.postMessage(msg, "*"); } catch (_) {}
    let frames;
    try { frames = document.querySelectorAll("iframe"); } catch (_) { return; }
    for (const frame of frames) {
      try {
        const win = frame.contentWindow;
        if (win) win.postMessage(msg, "*");
      } catch (_) {}
    }
  } catch (err) {
    warn("broadcastFill:", err);
  }
}

async function coordinatedIframeFill(address, card, mode, currencyCode) {
  if (!IS_TOP_FRAME) return;
  const payload = { address, card, mode, currency: currencyCode || "USD" };
  broadcastFill(payload);
  const delays = fastFillMode ? [450] : IFRAME_RETRY_DELAYS;
  for (const delay of delays) {
    await fillPause(delay);
    broadcastFill(payload);
  }
}

function finalizeIframeCardReport(report, platform) {
  try {
    if (!Array.isArray(report)) return;
    if (!["stripe", "paddle", "lemon"].includes(platform)) return;
    const hasIframes = document.querySelector(
      'iframe[src*="js.stripe.com"], iframe[src*="embedded-checkout"], ' +
      'iframe[name^="__privateStripeFrame"], iframe[src*="paddle"]'
    );
    if (!hasIframes) return;
    const iframeKeys = hasEmbeddedStripeCheckout()
      ? [...ADDRESS_KEYS, ...CARD_KEYS]
      : CARD_KEYS;
    for (const key of iframeKeys) {
      const item = report.find(r => r.key === key);
      if (item && item.status === "not_found") item.status = "iframe";
    }
  } catch (err) {
    warn("finalizeIframeCardReport:", err);
  }
}

function highlightMissedFields(report) {
  try {
    document.querySelectorAll("[data-us-missed]").forEach(el => el.removeAttribute("data-us-missed"));
    if (!Array.isArray(report)) return;
    for (const item of report) {
      if (item.status !== "not_found") continue;
      const el = findField(item.key);
      if (el) el.setAttribute("data-us-missed", "true");
    }
  } catch (err) {
    warn("highlightMissedFields:", err);
  }
}

function playSuccessSound(soundMuted) {
  if (soundMuted) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
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

async function autoFill(address, card, mode = "all", options = {}) {
  const currencyCode = options.currency || "USD";
  if (!IS_TOP_FRAME && (isStripeIframe() || location.hostname.includes("stripe"))) {
    const report = createReport(mode);
    const n = await fillIframeFields(address, card, mode, report, currencyCode);
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

  let filled = 0;
  const countryCode = address?.country || "US";

  if (fillAddress && address) {
    if (platform === "stripe") {
      if (!hasEmbeddedStripeCheckout()) {
        filled += await fillStripeBillingAddress(address, countryCode, report, currencyCode);
      }
    } else {
      await prepareCheckout(platform);

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
    }
  } else if (fillAddress) {
    ADDRESS_KEYS.forEach(k => setReportStatus(report, k, "skipped"));
  }

  if (fillCard && card?.number) {
    if (platform === "stripe" && !fillAddress) await prepareStripeCheckout(currencyCode, report);
    if (mode === "card" && address?.fullName) {
      await tryFillField("fullName", address.fullName, report, opts);
    }
    if (await tryFillField("cardNumber", card.number, report, opts)) filled++;
    if (await tryFillField("cardExpiry", card.formattedExpiry, report, opts)) filled++;
    if (await tryFillField("cardCVV", card.cvv, report, opts)) filled++;
    if (platform === "stripe") {
      if (await fillCardCountryRegion(countryCode, report)) filled++;
      if (await fillCardZip(address, report, opts)) filled++;
    }
    log(`Карта: ${card.type || "?"} | ${card.validationMessage || "ok"}`);
  } else if (fillCard) {
    CARD_KEYS.forEach(k => setReportStatus(report, k, "skipped"));
  }

  if (IS_TOP_FRAME &&
      (platform === "stripe" || platform === "paddle" || platform === "lemon") &&
      ((fillCard && card?.number) || (fillAddress && address && hasEmbeddedStripeCheckout()))) {
    if (fastFillMode) {
      broadcastFill({ address, card, mode, currency: currencyCode });
    } else {
      if (platform === "stripe") await waitForStripeFrames(1500);
      await coordinatedIframeFill(address, card, mode, currencyCode);
    }
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
    if (!isExtAlive()) {
      resolve({ _ctxDead: true });
      return;
    }
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), GET_DATA_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage({ action: "getAllData" }, response => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || "";
          finish(/invalidated/i.test(err) ? { _ctxDead: true } : null);
          return;
        }
        finish(response ?? null);
      });
    } catch (err) {
      finish(/invalidated/i.test(String(err?.message || err)) ? { _ctxDead: true } : null);
    }
  });
}

function retryDelaysForFrame(fillData) {
  if (fillData) {
    if (!IS_TOP_FRAME || isStripeIframe()) return [0];
    if (isStripeCheckoutPage() && hasEmbeddedStripeCheckout()) return [0];
    return [0, 280];
  }
  return FILL_RETRY_DELAYS;
}

async function executeFillWithRetries(mode, fillData = null) {
  if (fillInProgress) return buildResult(0, createReport(mode), detectPlatform(), mode);
  fillInProgress = true;
  fastFillMode = !!fillData;
  stripePrepDone = false;
  stripeCurrencyDone = false;

  let best = null;
  let stagnant = 0;
  let lastCount = -1;
  let soundMuted = false;
  let ctxDead = false;
  const delays = retryDelaysForFrame(fillData);

  try {
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await fillPause(delays[i]);

      const data = fillData || await getAllData();
      if (!data) continue;
      if (data._ctxDead) {
        ctxDead = true;
        break;
      }
      devMode = !!data.devMode;
      soundMuted = !!data.soundMuted;

      if (!fillData && isStripeCheckoutPage()) {
        stripePrepDone = false;
        stripeCurrencyDone = false;
        await waitForStripeFrames(i === 0 ? 1200 : 600);
        if (data.address || data.card) {
          broadcastFill({
            address: data.address,
            card: data.card,
            mode,
            currency: data.currency || "USD"
          });
          await fillPause(150);
        }
      }

      if (fastFillMode && IS_TOP_FRAME && hasEmbeddedStripeCheckout()) {
        const quick = buildResult(0, createReport(mode), "stripe", mode);
        if (!best) best = quick;
        break;
      }

      let result;
      try {
        result = await autoFill(data.address, data.card, mode, { currency: data.currency });
      } catch (err) {
        warn("autoFill error:", err);
        result = buildResult(0, createReport(mode), detectPlatform(), mode);
      }
      if (!result?.report) result = buildResult(0, createReport(mode), detectPlatform(), mode);
      const filledCount = countFilledInReport(result.report);

      if (!best || filledCount > countFilledInReport(best.report)) best = result;

      if (filledCount === lastCount) stagnant++;
      else stagnant = 0;
      lastCount = filledCount;

      if (fastFillMode) break;

      if (!isStripeCheckoutPage()) {
        const present = detectPresentFields(mode);
        if (present.length > 0 && filledCount >= present.length) break;
        if (stagnant >= 2 && filledCount > 0) break;
      }
    }

    if (best) {
      finalizeIframeCardReport(best.report, best.platform);
      if (!fastFillMode) highlightMissedFields(best.report);
      if (countFilledInReport(best.report) > 0) playSuccessSound(soundMuted);
    }
    if (ctxDead && !best) {
      best = buildResult(0, createReport(mode), detectPlatform(), mode);
      best.message = "Обновите страницу (F5) после обновления расширения";
      best.success = false;
      best.neutral = false;
    }
  } finally {
    fillInProgress = false;
    fastFillMode = false;
    lastAutoFillAt = Date.now();
  }

  return best || buildResult(0, createReport(mode), detectPlatform(), mode);
}

async function executeFill(mode) {
  return executeFillWithRetries(mode);
}

function canAutoFillNow() {
  if (fillInProgress) return false;
  return Date.now() - lastAutoFillAt >= AUTO_FILL_MIN_INTERVAL_MS;
}

function runAutoFill() {
  if (!IS_TOP_FRAME || !canAutoFillNow() || !isExtAlive()) return;
  try {
    chrome.storage.local.get(["autoFillEnabled", "autoFillMode"], data => {
      if (data.autoFillEnabled !== true) return;
      if (!canAutoFillNow()) return;
      lastAutoFillAt = Date.now();
      executeFillWithRetries(data.autoFillMode || "all").catch(() => {});
    });
  } catch (_) {}
}

function scheduleStripeFill(delay = 2000) {
  if (!IS_TOP_FRAME || isStripeCheckoutPage()) return;
  clearTimeout(stripeFillDebounce);
  stripeFillDebounce = setTimeout(runAutoFill, delay);
}

function scheduleObserverFill() {
  if (!IS_TOP_FRAME || isStripeCheckoutPage()) return;
  clearTimeout(observerDebounce);
  observerDebounce = setTimeout(runAutoFill, 2000);
}

/* ───────────── Init (once per frame) ───────────── */

function initContentScript() {
  if (isScriptInitialized()) return;
  document.documentElement.setAttribute(US_AF_INIT_ATTR, "1");

  loadDevMode();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.devMode) devMode = !!changes.devMode.newValue;
    if (area === "local" && changes.stripeFabEnabled) updateStripeFab();
  });

  window.addEventListener("message", async (event) => {
    if (event.data?.source !== MSG_SOURCE || event.data?.action !== "fill") return;
    if (IS_TOP_FRAME) return;
    try {
      const { address, card, mode, currency } = event.data;
      await fillIframeFields(address, card, mode || "all", null, currency);
    } catch (err) {
      warn("iframe message fill:", err);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "fillNow" && msg.action !== "fillWithAddress") return;

    executeFillWithRetries(msg.mode || "all", msg.fillData || null)
      .then(sendResponse)
      .catch(err => {
        const text = String(err?.message || err);
        sendResponse({
          filled: 0,
          success: false,
          message: /invalidated/i.test(text)
            ? "Обновите страницу (F5)"
            : "Ошибка заполнения"
        });
      });
    return true;
  });

  bootContentScript();
}

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
  if (!isExtAlive()) return;
  try {
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
      fab.innerHTML = '<span class="us-af-fab-icon">⚡</span><span>Заполнить</span>';
      fab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fab.classList.add("us-af-fab--busy");
        if (!isExtAlive()) {
          fab.classList.remove("us-af-fab--busy");
          return;
        }
        chrome.runtime.sendMessage({ action: "fillAllFrames", mode: "all" }, res => {
          fab.classList.remove("us-af-fab--busy");
          if (chrome.runtime.lastError) return;
          if (res?.filled > 0) playSuccessSound(false);
        });
      });
      document.documentElement.appendChild(fab);
      stripeFabEl = fab;
    });
  } catch (_) {}
}

function bootContentScript() {
  if (!IS_TOP_FRAME) return;

  const boot = () => {
    if (!isStripeCheckoutPage()) setTimeout(runAutoFill, 1000);
    updateStripeFab();
  };

  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else window.addEventListener("DOMContentLoaded", boot);

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stripePrepDone = false;
      stripeCurrencyDone = false;
      if (!isStripeCheckoutPage()) scheduleObserverFill();
      updateStripeFab();
      return;
    }
    if (isStripeCheckoutPage()) {
      updateStripeFab();
      return;
    }
    const platform = detectPlatform();
    if (platform !== "generic") {
      const hasForm = document.querySelector(
        'iframe[src*="js.stripe.com"], iframe[name^="__privateStripeFrame"], #billingAddressLine1'
      );
      if (hasForm) scheduleStripeFill(2000);
    }
  });

  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);
}

initContentScript();

})();
