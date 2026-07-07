/* ═══════════════════════════════════════════════════════
   AutoFill — Background Service Worker
   — Адрес: пул реальных адресов + имя (randomuser.me)
   — Карты: генерация (Лун) + валидация (namso / chkr)
   ═══════════════════════════════════════════════════════ */

const SELECTED_COUNTRY_KEY = "selectedCountry";
const DEFAULT_COUNTRY = "US";
const CACHE_TTL_MS = 30 * 60 * 1000;

const CARD_CACHE_KEY = "cached_card";
const CARD_TS_KEY = "cached_card_ts";
const USER_EMAIL_KEY = "userEmail";
const PROFILES_KEY = "profiles";
const ACTIVE_PROFILE_KEY = "activeProfileId";
const DEV_MODE_KEY = "devMode";
const PINNED_ADDRESS_KEY = "pinnedAddress";
const SOUND_MUTED_KEY = "soundMuted";
const COMPACT_MODE_KEY = "compactMode";
const SHOW_PROFILE_SUMMARY_KEY = "showProfileSummary";
const STRIPE_FAB_KEY = "stripeFabEnabled";
const ONBOARDING_DONE_KEY = "onboardingDone";
const MAX_PROFILES = 50;
const EXT_VERSION = "2.1.1";

const DEFAULT_BIN = "5154620022";
const BIN_STORAGE_KEY = "user_bin";

const BIN_PRESETS = [
  { id: "mc", label: "Mastercard", short: "MC", bin: "5154620022", type: "mastercard" },
  { id: "visa", label: "Visa", short: "Visa", bin: "4532015112", type: "visa" },
  { id: "amex", label: "Amex", short: "Amex", bin: "3782822463", type: "amex", length: 15 }
];

function addrCacheKey(country) { return `cached_address_${country}`; }
function addrTsKey(country) { return `cached_address_ts_${country}`; }

/* ═══════════════════════════════════════════════════════
   СТРАНЫ — пулы адресов и настройки
   ═══════════════════════════════════════════════════════ */

const STATE_ABBR_US = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
  "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
  "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME",
  "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
  "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
  "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
  "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
  "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
  "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY"
};

const COUNTRY_CONFIG = {
  US: {
    nat: "us", code: "US", name: "United States", flag: "🇺🇸",
    stateAbbr: STATE_ABBR_US,
    addresses: [
      { address1: "350 5th Ave", city: "New York", state: "New York", zip: "10118" },
      { address1: "1600 Pennsylvania Ave NW", city: "Washington", state: "District of Columbia", zip: "20500" },
      { address1: "1 Infinite Loop", city: "Cupertino", state: "California", zip: "95014" },
      { address1: "600 Montgomery St", city: "San Francisco", state: "California", zip: "94111" },
      { address1: "233 S Wacker Dr", city: "Chicago", state: "Illinois", zip: "60606" },
      { address1: "470 Atlantic Ave", city: "Boston", state: "Massachusetts", zip: "02210" },
      { address1: "1411 4th Ave", city: "Seattle", state: "Washington", zip: "98101" },
      { address1: "1000 Peachtree St NE", city: "Atlanta", state: "Georgia", zip: "30309" },
      { address1: "600 Congress Ave", city: "Austin", state: "Texas", zip: "78701" },
      { address1: "1001 17th St", city: "Denver", state: "Colorado", zip: "80202" }
    ]
  },
  GB: {
    nat: "gb", code: "GB", name: "United Kingdom", flag: "🇬🇧",
    addresses: [
      { address1: "10 Downing Street", city: "London", state: "Greater London", zip: "SW1A 2AA" },
      { address1: "221B Baker Street", city: "London", state: "Greater London", zip: "NW1 6XE" },
      { address1: "1 Piccadilly", city: "London", state: "Greater London", zip: "W1J 0DA" },
      { address1: "76 Deansgate", city: "Manchester", state: "Greater Manchester", zip: "M3 2FW" },
      { address1: "1 Princes Street", city: "Edinburgh", state: "Scotland", zip: "EH2 2QP" },
      { address1: "24 Corn Street", city: "Bristol", state: "England", zip: "BS1 1HT" }
    ]
  },
  DE: {
    nat: "de", code: "DE", name: "Germany", flag: "🇩🇪",
    addresses: [
      { address1: "Unter den Linden 77", city: "Berlin", state: "Berlin", zip: "10117" },
      { address1: "Marienplatz 8", city: "Munich", state: "Bavaria", zip: "80331" },
      { address1: "Zeil 106", city: "Frankfurt", state: "Hesse", zip: "60313" },
      { address1: "Neumarkt 2", city: "Cologne", state: "North Rhine-Westphalia", zip: "50667" },
      { address1: "Mönckebergstraße 11", city: "Hamburg", state: "Hamburg", zip: "20095" }
    ]
  },
  FR: {
    nat: "fr", code: "FR", name: "France", flag: "🇫🇷",
    addresses: [
      { address1: "55 Rue du Faubourg Saint-Honoré", city: "Paris", state: "Île-de-France", zip: "75008" },
      { address1: "1 Place Bellecour", city: "Lyon", state: "Auvergne-Rhône-Alpes", zip: "69002" },
      { address1: "1 Rue Sainte-Catherine", city: "Bordeaux", state: "Nouvelle-Aquitaine", zip: "33000" },
      { address1: "2 Rue de la République", city: "Marseille", state: "Provence-Alpes-Côte d'Azur", zip: "13001" },
      { address1: "1 Place du Capitole", city: "Toulouse", state: "Occitanie", zip: "31000" }
    ]
  },
  CA: {
    nat: "ca", code: "CA", name: "Canada", flag: "🇨🇦",
    addresses: [
      { address1: "100 Queen St W", city: "Toronto", state: "Ontario", zip: "M5H 2N2" },
      { address1: "1055 Canada Pl", city: "Vancouver", state: "British Columbia", zip: "V6C 0C3" },
      { address1: "360 Albert St", city: "Ottawa", state: "Ontario", zip: "K1R 7X7" },
      { address1: "1000 de la Gauchetière St W", city: "Montreal", state: "Quebec", zip: "H3B 4W5" },
      { address1: "800 Rue Saint-Jacques", city: "Montreal", state: "Quebec", zip: "H3C 1A3" }
    ]
  },
  AU: {
    nat: "au", code: "AU", name: "Australia", flag: "🇦🇺",
    addresses: [
      { address1: "1 Macquarie St", city: "Sydney", state: "New South Wales", zip: "2000" },
      { address1: "180 Flinders St", city: "Melbourne", state: "Victoria", zip: "3000" },
      { address1: "1 William St", city: "Brisbane", state: "Queensland", zip: "4000" },
      { address1: "2 King William St", city: "Adelaide", state: "South Australia", zip: "5000" },
      { address1: "1 St Georges Terrace", city: "Perth", state: "Western Australia", zip: "6000" }
    ]
  },
  NL: {
    nat: "nl", code: "NL", name: "Netherlands", flag: "🇳🇱",
    addresses: [
      { address1: "Dam 1", city: "Amsterdam", state: "North Holland", zip: "1012 JS" },
      { address1: "Coolsingel 40", city: "Rotterdam", state: "South Holland", zip: "3011 AD" },
      { address1: "Lange Voorhout 74", city: "The Hague", state: "South Holland", zip: "2514 EH" },
      { address1: "Oudegracht 1", city: "Utrecht", state: "Utrecht", zip: "3511 AA" }
    ]
  },
  IT: {
    nat: "it", code: "IT", name: "Italy", flag: "🇮🇹",
    addresses: [
      { address1: "Via del Corso 1", city: "Rome", state: "Lazio", zip: "00186" },
      { address1: "Via Montenapoleone 1", city: "Milan", state: "Lombardy", zip: "20121" },
      { address1: "Via de' Tornabuoni 1", city: "Florence", state: "Tuscany", zip: "50123" },
      { address1: "Via Toledo 1", city: "Naples", state: "Campania", zip: "80134" }
    ]
  },
  ES: {
    nat: "es", code: "ES", name: "Spain", flag: "🇪🇸",
    addresses: [
      { address1: "Calle de Alcalá 1", city: "Madrid", state: "Madrid", zip: "28014" },
      { address1: "Passeig de Gràcia 43", city: "Barcelona", state: "Catalonia", zip: "08007" },
      { address1: "Avenida de la Constitución 1", city: "Seville", state: "Andalusia", zip: "41004" },
      { address1: "Gran Vía 1", city: "Bilbao", state: "Basque Country", zip: "48001" }
    ]
  },
  PL: {
    nat: "pl", code: "PL", name: "Poland", flag: "🇵🇱",
    addresses: [
      { address1: "ul. Krakowskie Przedmieście 1", city: "Warsaw", state: "Mazovia", zip: "00-071" },
      { address1: "ul. Floriańska 1", city: "Krakow", state: "Lesser Poland", zip: "31-019" },
      { address1: "ul. Długa 1", city: "Gdansk", state: "Pomerania", zip: "80-831" },
      { address1: "ul. Piotrkowska 1", city: "Lodz", state: "Lodz Voivodeship", zip: "90-001" }
    ]
  }
};

const FALLBACK_NAMES = {
  US: { firstName: "John", lastName: "Smith" },
  GB: { firstName: "James", lastName: "Wilson" },
  DE: { firstName: "Hans", lastName: "Müller" },
  FR: { firstName: "Pierre", lastName: "Dupont" },
  CA: { firstName: "Michael", lastName: "Brown" },
  AU: { firstName: "Jack", lastName: "Taylor" },
  NL: { firstName: "Jan", lastName: "de Vries" },
  IT: { firstName: "Marco", lastName: "Rossi" },
  ES: { firstName: "Carlos", lastName: "García" },
  PL: { firstName: "Jan", lastName: "Kowalski" }
};

function profileId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function getProfiles() {
  const data = await chrome.storage.local.get([PROFILES_KEY, ACTIVE_PROFILE_KEY]);
  let profiles = data[PROFILES_KEY];
  if (!Array.isArray(profiles) || profiles.length === 0) {
    profiles = [{
      id: "default",
      name: "Основной",
      country: DEFAULT_COUNTRY,
      bin: DEFAULT_BIN,
      email: ""
    }];
    await chrome.storage.local.set({ [PROFILES_KEY]: profiles, [ACTIVE_PROFILE_KEY]: "default" });
  }
  const activeId = data[ACTIVE_PROFILE_KEY] || profiles[0].id;
  return { profiles, activeId };
}

async function getActiveProfile() {
  const { profiles, activeId } = await getProfiles();
  return profiles.find(p => p.id === activeId) || profiles[0];
}

async function applyProfile(profile) {
  if (!profile) return;
  const updates = { [SELECTED_COUNTRY_KEY]: profile.country || DEFAULT_COUNTRY };
  if (profile.bin) updates[BIN_STORAGE_KEY] = profile.bin.replace(/\D/g, "");
  updates[USER_EMAIL_KEY] = (profile.email || "").trim();
  await chrome.storage.local.set(updates);
  await chrome.storage.local.set({ [ACTIVE_PROFILE_KEY]: profile.id });
}

async function saveProfile(profileData) {
  const { profiles } = await getProfiles();
  const idx = profiles.findIndex(p => p.id === profileData.id);
  const entry = {
    id: profileData.id || profileId(),
    name: (profileData.name || "Профиль").trim().slice(0, 24),
    country: COUNTRY_CONFIG[profileData.country] ? profileData.country : DEFAULT_COUNTRY,
    bin: (profileData.bin || DEFAULT_BIN).replace(/\D/g, ""),
    email: (profileData.email || "").trim()
  };
  if (idx >= 0) profiles[idx] = entry;
  else if (profiles.length < MAX_PROFILES) profiles.push(entry);
  else return { error: "max_profiles" };
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  return { profile: entry, profiles };
}

async function deleteProfile(id) {
  const { profiles, activeId } = await getProfiles();
  if (profiles.length <= 1) return { error: "last_profile" };
  const next = profiles.filter(p => p.id !== id);
  await chrome.storage.local.set({ [PROFILES_KEY]: next });
  if (activeId === id) await applyProfile(next[0]);
  return { profiles: next, activeId: activeId === id ? next[0].id : activeId };
}

async function getUserEmail() {
  const data = await chrome.storage.local.get(USER_EMAIL_KEY);
  return (data[USER_EMAIL_KEY] || "").trim();
}

async function setUserEmail(email) {
  const trimmed = (email || "").trim();
  await chrome.storage.local.set({ [USER_EMAIL_KEY]: trimmed });
  const active = await getActiveProfile();
  if (active) {
    const { profiles } = await getProfiles();
    const idx = profiles.findIndex(p => p.id === active.id);
    if (idx >= 0) {
      profiles[idx].email = trimmed;
      await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
    }
  }
  return trimmed;
}

async function mergeAddressEmail(addr) {
  if (!addr) return addr;
  const custom = await getUserEmail();
  if (custom) return { ...addr, email: custom };
  return addr;
}

async function getSelectedCountry() {
  const active = await getActiveProfile();
  if (active?.country && COUNTRY_CONFIG[active.country]) return active.country;
  const data = await chrome.storage.local.get(SELECTED_COUNTRY_KEY);
  const code = data[SELECTED_COUNTRY_KEY] || DEFAULT_COUNTRY;
  return COUNTRY_CONFIG[code] ? code : DEFAULT_COUNTRY;
}

function makeEmail(firstName, lastName) {
  const base = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `${base}${suffix}@gmail.com`;
}

function getRandomAddress(countryCode) {
  const config = COUNTRY_CONFIG[countryCode];
  const pool = config.addresses;
  const addr = pool[Math.floor(Math.random() * pool.length)];
  const stateAbbr = config.stateAbbr
    ? (config.stateAbbr[addr.state.toLowerCase()] || addr.state)
    : addr.state;
  return { ...addr, stateFull: addr.state, stateAbbr };
}

async function fetchName(nat, countryCode) {
  try {
    const res = await fetch(`https://randomuser.me/api/?nat=${nat}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    const user = data.results[0];
    return { firstName: user.name.first, lastName: user.name.last };
  } catch (err) {
    console.warn("[BG] Name fetch error, using fallback:", err);
    return FALLBACK_NAMES[countryCode] || FALLBACK_NAMES.US;
  }
}

async function getPinnedAddress() {
  const data = await chrome.storage.local.get(PINNED_ADDRESS_KEY);
  return data[PINNED_ADDRESS_KEY] || null;
}

async function pinAddress(countryCode) {
  const country = countryCode || await getSelectedCountry();
  const cacheKey = addrCacheKey(country);
  const cached = await chrome.storage.local.get(cacheKey);
  const base = cached[cacheKey] || await fetchAddress(country, { forceNew: true });
  if (!base) return null;
  const pinned = { ...base, pinned: true, pinnedCountry: country, pinnedAt: Date.now() };
  await chrome.storage.local.set({ [PINNED_ADDRESS_KEY]: pinned });
  await chrome.storage.local.set({ [cacheKey]: pinned, [addrTsKey(country)]: Date.now() });
  return pinned;
}

async function unpinAddress() {
  await chrome.storage.local.remove(PINNED_ADDRESS_KEY);
}

async function fetchAddress(countryCode, options = {}) {
  const config = COUNTRY_CONFIG[countryCode];
  if (!config) return null;

  const pinned = options.forceNew ? null : await getPinnedAddress();
  const usePinned = pinned && pinned.pinnedCountry === countryCode;

  const name = await fetchName(config.nat, countryCode);

  if (usePinned) {
    return {
      ...pinned,
      firstName: name.firstName,
      lastName: name.lastName,
      fullName: `${name.firstName} ${name.lastName}`,
      email: makeEmail(name.firstName, name.lastName),
      pinned: true,
      pinnedCountry: countryCode
    };
  }

  const addr = getRandomAddress(countryCode);
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    fullName: `${name.firstName} ${name.lastName}`,
    email: makeEmail(name.firstName, name.lastName),
    address1: addr.address1,
    address2: "",
    city: addr.city,
    state: addr.stateFull,
    stateAbbr: addr.stateAbbr,
    zip: addr.zip,
    country: config.code,
    countryName: config.name,
    pinned: false
  };
}

async function getCachedAddress(countryCode) {
  const country = countryCode || await getSelectedCountry();
  const cacheKey = addrCacheKey(country);
  const tsKey = addrTsKey(country);
  const pinned = await getPinnedAddress();

  if (pinned && pinned.pinnedCountry === country) {
    const merged = await mergeAddressEmail(pinned);
    return merged;
  }

  const ts = await chrome.storage.local.get(tsKey);
  const cached = await chrome.storage.local.get(cacheKey);

  if (cached[cacheKey] && ts[tsKey] && Date.now() - ts[tsKey] < CACHE_TTL_MS) {
    return cached[cacheKey];
  }

  const addr = await fetchAddress(country);
  if (addr) {
    await chrome.storage.local.set({ [cacheKey]: addr, [tsKey]: Date.now() });
  }
  return addr;
}

function sanitizeImportedProfiles(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.slice(0, MAX_PROFILES).map((p, i) => ({
    id: p.id || profileId(),
    name: String(p.name || `Профиль ${i + 1}`).trim().slice(0, 32),
    country: COUNTRY_CONFIG[p.country] ? p.country : DEFAULT_COUNTRY,
    bin: String(p.bin || DEFAULT_BIN).replace(/\D/g, "").slice(0, 15) || DEFAULT_BIN,
    email: String(p.email || "").trim().slice(0, 120)
  }));
}

async function exportProfilesData() {
  const { profiles, activeId } = await getProfiles();
  return {
    version: EXT_VERSION,
    exportedAt: new Date().toISOString(),
    activeProfileId: activeId,
    profiles
  };
}

async function importProfilesData(payload) {
  const list = sanitizeImportedProfiles(payload?.profiles);
  if (!list || list.length === 0) return { error: "invalid_data" };
  const activeId = list.find(p => p.id === payload.activeProfileId)?.id || list[0].id;
  await chrome.storage.local.set({ [PROFILES_KEY]: list, [ACTIVE_PROFILE_KEY]: activeId });
  const active = list.find(p => p.id === activeId);
  if (active) await applyProfile(active);
  return { profiles: list, activeId };
}

/* ═══════════════════════════════════════════════════════
   ГЕНЕРАЦИЯ КАРТ
   ═══════════════════════════════════════════════════════ */

function cardLengthForBin(bin) {
  const b = (bin || "").replace(/\D/g, "");
  if (/^3[47]/.test(b)) return 15;
  return 16;
}

function luhnCheckDigit(digits) {
  let sum = 0;
  let alt = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return (9 * sum) % 10;
}

async function getBin() {
  const active = await getActiveProfile();
  if (active?.bin) return active.bin.replace(/\D/g, "") || DEFAULT_BIN;
  const data = await chrome.storage.local.get(BIN_STORAGE_KEY);
  return data[BIN_STORAGE_KEY] || DEFAULT_BIN;
}

function generateCardNumber(bin) {
  const cardLen = cardLengthForBin(bin);
  const digits = bin.replace(/\D/g, "").split("").map(Number);
  while (digits.length < cardLen - 1) digits.push(Math.floor(Math.random() * 10));
  if (digits.length > cardLen - 1) digits.length = cardLen - 1;
  digits.push(luhnCheckDigit(digits));
  return digits.join("");
}

function cardTypeForBin(bin) {
  const b = (bin || "").replace(/\D/g, "");
  if (/^4/.test(b)) return "visa";
  if (/^3[47]/.test(b)) return "amex";
  if (/^5[1-5]/.test(b)) return "mastercard";
  return "mastercard";
}

function generateExpiry() {
  const now = new Date();
  const month = Math.floor(Math.random() * 12) + 1;
  const year = now.getFullYear() + Math.floor(Math.random() * 5) + 2;
  return {
    month: String(month).padStart(2, "0"),
    year: String(year),
    yearShort: String(year).slice(-2),
    formatted: `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`
  };
}

function generateCVV() {
  let cvv = "";
  for (let i = 0; i < 3; i++) cvv += Math.floor(Math.random() * 10);
  return cvv;
}

function generateCVVForBin(bin) {
  const len = /^3[47]/.test((bin || "").replace(/\D/g, "")) ? 4 : 3;
  let cvv = "";
  for (let i = 0; i < len; i++) cvv += Math.floor(Math.random() * 10);
  return cvv;
}

async function generateFullCard() {
  const bin = await getBin();
  const number = generateCardNumber(bin);
  const expiry = generateExpiry();
  const cvv = generateCVVForBin(bin);
  return {
    number,
    month: expiry.month,
    year: expiry.yearShort,
    formattedExpiry: expiry.formatted,
    cvv,
    type: cardTypeForBin(bin),
    bin,
    raw: `${number}|${expiry.month}|${expiry.year}|${cvv}`
  };
}

/* ═══════════════════════════════════════════════════════
   ВАЛИДАЦИЯ КАРТ
   ═══════════════════════════════════════════════════════ */

const API_TIMEOUT_MS = 8000;

const CHECK_APIS = [
  { name: "namso.live", url: "https://namso.live/api/v1/check.php", consecutive429: 0, disabledUntil: 0 },
  { name: "chkr.cc", url: "https://api.chkr.cc/", consecutive429: 0, disabledUntil: 0 }
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function getActiveAPI() {
  const now = Date.now();
  for (const api of CHECK_APIS) {
    if (now >= api.disabledUntil) { api.consecutive429 = 0; return api; }
  }
  CHECK_APIS.sort((a, b) => a.disabledUntil - b.disabledUntil);
  return CHECK_APIS[0];
}

async function checkWithNamso(cardRaw) {
  const [cc, mes, ano, cvv] = cardRaw.split("|");
  try {
    const res = await fetchWithTimeout(CHECK_APIS[0].url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cc, mes, ano, cvv })
    }, API_TIMEOUT_MS);
    if (res.status === 429) return { code: -1, status: "rate_limited" };
    if (!res.ok) throw new Error(`namso ${res.status}`);
    const data = await res.json();
    if (data.status === "APPROVED" || data.code === "85") {
      return {
        code: 1, status: "Live", message: data.message || "Approved",
        card: {
          type: (data.card_info?.brand || "").toLowerCase(),
          category: (data.card_info?.type || "").toLowerCase(),
          bank: data.card_info?.bank || "",
          country: null
        }
      };
    }
    return { code: 0, status: "Die", message: data.message || data.status || "Declined" };
  } catch (err) {
    if (err.name === "AbortError") return { code: -1, status: "timeout" };
    return null;
  }
}

async function checkWithChkr(cardRaw) {
  try {
    const res = await fetchWithTimeout(CHECK_APIS[1].url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: cardRaw })
    }, API_TIMEOUT_MS);
    if (res.status === 429) return { code: -1, status: "rate_limited" };
    if (!res.ok) throw new Error(`chkr ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") return { code: -1, status: "timeout" };
    return null;
  }
}

async function singleCheck(cardRaw) {
  const api = getActiveAPI();
  let result = api.name === "namso.live" ? await checkWithNamso(cardRaw) : await checkWithChkr(cardRaw);

  if (result && result.code === -1) {
    api.consecutive429++;
    if (api.consecutive429 >= 2) api.disabledUntil = Date.now() + 60000;
    const other = getActiveAPI();
    if (other.name !== api.name) {
      result = other.name === "namso.live" ? await checkWithNamso(cardRaw) : await checkWithChkr(cardRaw);
    }
  }

  if (result && result.code !== -1) api.consecutive429 = 0;
  return result;
}

let currentCheckId = 0;

async function generateCardInstant() {
  const card = await generateFullCard();
  return {
    ...card,
    validated: false,
    validationStatus: "checking",
    validationMessage: "Проверяется..."
  };
}

async function backgroundCheck(checkId) {
  for (let i = 0; i < 2; i++) {
    if (checkId !== currentCheckId) return;

    const cached = await chrome.storage.local.get(CARD_CACHE_KEY);
    const card = cached[CARD_CACHE_KEY];
    if (!card) return;

    await chrome.storage.local.set({
      [CARD_CACHE_KEY]: { ...card, validationMessage: `Проверка ${i + 1}/2...` }
    });

    const result = await singleCheck(card.raw);
    if (checkId !== currentCheckId) return;

    if (!result || result.code === -1) {
      const reason = result?.status === "rate_limited" ? "Лимит запросов"
        : result?.status === "timeout" ? "API таймаут" : "API недоступно";
      await chrome.storage.local.set({
        [CARD_CACHE_KEY]: {
          ...card,
          validated: false,
          validationStatus: result?.status === "rate_limited" ? "rate_limited" : "unavailable",
          validationMessage: reason
        },
        [CARD_TS_KEY]: Date.now()
      });
      return;
    }

    if (result.code === 1) {
      await chrome.storage.local.set({
        [CARD_CACHE_KEY]: {
          ...card,
          type: result.card?.type || card.type,
          category: result.card?.category || "",
          bank: result.card?.bank || "",
          country: result.card?.country || null,
          validated: true,
          validationStatus: "live",
          validationMessage: result.message || "Approved"
        },
        [CARD_TS_KEY]: Date.now()
      });
      return;
    }

    const newCard = await generateFullCard();
    await chrome.storage.local.set({
      [CARD_CACHE_KEY]: {
        ...newCard,
        validated: false,
        validationStatus: "checking",
        validationMessage: `Новая карта, проверка ${i + 2}/2...`
      }
    });
    await sleep(500);
  }

  const final = await chrome.storage.local.get(CARD_CACHE_KEY);
  const finalCard = final[CARD_CACHE_KEY];
  if (finalCard && checkId === currentCheckId) {
    await chrome.storage.local.set({
      [CARD_CACHE_KEY]: {
        ...finalCard,
        validated: false,
        validationStatus: "failed",
        validationMessage: "Лун-валидна (Live не подтверждена)"
      },
      [CARD_TS_KEY]: Date.now()
    });
  }
}

async function startCardCheck() {
  currentCheckId++;
  const checkId = currentCheckId;
  const card = await generateCardInstant();
  await chrome.storage.local.set({ [CARD_CACHE_KEY]: card });
  backgroundCheck(checkId);
  return { started: true };
}

async function getCachedCard() {
  const data = await chrome.storage.local.get(CARD_CACHE_KEY);
  return data[CARD_CACHE_KEY] || null;
}

function getCountriesList() {
  return Object.entries(COUNTRY_CONFIG).map(([code, cfg]) => ({
    code,
    name: cfg.name,
    flag: cfg.flag
  }));
}

/* ═══════════════════════════════════════════════════════
   MESSAGE HANDLER
   ═══════════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getCountries") {
    sendResponse({ countries: getCountriesList() });
    return true;
  }

  if (msg.action === "getSelectedCountry") {
    getSelectedCountry().then(code => {
      const cfg = COUNTRY_CONFIG[code];
      sendResponse({ code, name: cfg?.name, flag: cfg?.flag });
    });
    return true;
  }

  if (msg.action === "setCountry") {
    const code = msg.country;
    if (!COUNTRY_CONFIG[code]) {
      sendResponse({ error: "Unknown country" });
      return true;
    }
    chrome.storage.local.set({ [SELECTED_COUNTRY_KEY]: code }).then(() => {
      sendResponse({ code, name: COUNTRY_CONFIG[code].name });
    });
    return true;
  }

  if (msg.action === "getAddress") {
    getCachedAddress(msg.country).then(addr => sendResponse({ address: addr }));
    return true;
  }

  if (msg.action === "refreshAddress") {
    const country = msg.country || null;
    (async () => {
      const code = country || await getSelectedCountry();
      const addr = await fetchAddress(code);
      if (addr) {
        const merged = await mergeAddressEmail(addr);
        await chrome.storage.local.set({
          [addrCacheKey(code)]: merged,
          [addrTsKey(code)]: Date.now()
        });
        sendResponse({ address: merged, pinned: !!merged.pinned });
        return;
      }
      sendResponse({ address: null });
    })();
    return true;
  }

  if (msg.action === "pinAddress") {
    pinAddress(msg.country).then(async addr => {
      const merged = await mergeAddressEmail(addr);
      sendResponse({ address: merged, pinned: true });
    });
    return true;
  }

  if (msg.action === "unpinAddress") {
    unpinAddress().then(() => sendResponse({ pinned: false }));
    return true;
  }

  if (msg.action === "getPinnedStatus") {
    getPinnedAddress().then(p => sendResponse({ pinned: !!p, address: p }));
    return true;
  }

  if (msg.action === "exportProfiles") {
    exportProfilesData().then(data => sendResponse({ data }));
    return true;
  }

  if (msg.action === "importProfiles") {
    importProfilesData(msg.payload).then(res => sendResponse(res));
    return true;
  }

  if (msg.action === "getSettings") {
    chrome.storage.local.get([
      SOUND_MUTED_KEY, COMPACT_MODE_KEY, SHOW_PROFILE_SUMMARY_KEY,
      STRIPE_FAB_KEY, ONBOARDING_DONE_KEY
    ], d => {
      sendResponse({
        soundMuted: !!d[SOUND_MUTED_KEY],
        compactMode: !!d[COMPACT_MODE_KEY],
        showProfileSummary: d[SHOW_PROFILE_SUMMARY_KEY] !== false,
        stripeFabEnabled: d[STRIPE_FAB_KEY] !== false,
        onboardingDone: !!d[ONBOARDING_DONE_KEY]
      });
    });
    return true;
  }

  if (msg.action === "setSettings") {
    const updates = {};
    if (msg.soundMuted !== undefined) updates[SOUND_MUTED_KEY] = !!msg.soundMuted;
    if (msg.compactMode !== undefined) updates[COMPACT_MODE_KEY] = !!msg.compactMode;
    if (msg.showProfileSummary !== undefined) updates[SHOW_PROFILE_SUMMARY_KEY] = !!msg.showProfileSummary;
    if (msg.stripeFabEnabled !== undefined) updates[STRIPE_FAB_KEY] = !!msg.stripeFabEnabled;
    if (msg.onboardingDone !== undefined) updates[ONBOARDING_DONE_KEY] = !!msg.onboardingDone;
    chrome.storage.local.set(updates).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === "getShortcut") {
    chrome.commands.getAll(commands => {
      const cmd = commands.find(c => c.name === "fill-page");
      sendResponse({ shortcut: cmd?.shortcut || "Ctrl+Shift+Z" });
    });
    return true;
  }

  if (msg.action === "getBin") {
    getBin().then(bin => sendResponse({ bin }));
    return true;
  }

  if (msg.action === "setBin") {
    const newBin = msg.bin?.replace(/\D/g, "") || DEFAULT_BIN;
    chrome.storage.local.set({ [BIN_STORAGE_KEY]: newBin }).then(() => {
      chrome.storage.local.remove([CARD_CACHE_KEY, CARD_TS_KEY]).then(() => {
        sendResponse({ bin: newBin });
      });
    });
    return true;
  }

  if (msg.action === "getCard" || msg.action === "getCardCache") {
    chrome.storage.local.get(CARD_CACHE_KEY, (data) => {
      sendResponse({ card: data[CARD_CACHE_KEY] || null });
    });
    return true;
  }

  if (msg.action === "startCardCheck") {
    startCardCheck().then(res => sendResponse(res));
    return true;
  }

  if (msg.action === "getUserEmail") {
    getUserEmail().then(email => sendResponse({ email }));
    return true;
  }

  if (msg.action === "setUserEmail") {
    setUserEmail(msg.email).then(email => sendResponse({ email }));
    return true;
  }

  if (msg.action === "getProfiles") {
    getProfiles().then(data => sendResponse(data));
    return true;
  }

  if (msg.action === "saveProfile") {
    saveProfile(msg.profile || {}).then(res => sendResponse(res));
    return true;
  }

  if (msg.action === "deleteProfile") {
    deleteProfile(msg.id).then(res => sendResponse(res));
    return true;
  }

  if (msg.action === "setActiveProfile") {
    (async () => {
      const { profiles } = await getProfiles();
      const profile = profiles.find(p => p.id === msg.id);
      if (!profile) { sendResponse({ error: "not_found" }); return; }
      await applyProfile(profile);
      sendResponse({ profile });
    })();
    return true;
  }

  if (msg.action === "getBinPresets") {
    sendResponse({ presets: BIN_PRESETS });
    return true;
  }

  if (msg.action === "getDevMode") {
    chrome.storage.local.get(DEV_MODE_KEY, d => sendResponse({ devMode: !!d[DEV_MODE_KEY] }));
    return true;
  }

  if (msg.action === "setDevMode") {
    chrome.storage.local.set({ [DEV_MODE_KEY]: !!msg.devMode }).then(() => {
      sendResponse({ devMode: !!msg.devMode });
    });
    return true;
  }

  if (msg.action === "getVersion") {
    sendResponse({ version: EXT_VERSION });
    return true;
  }

  if (msg.action === "getAllData") {
    getSelectedCountry().then(async country => {
      const [addr, card, pinned] = await Promise.all([
        getCachedAddress(country), getCachedCard(), getPinnedAddress()
      ]);
      const address = await mergeAddressEmail(addr);
      const d = await chrome.storage.local.get([DEV_MODE_KEY, SOUND_MUTED_KEY]);
      sendResponse({
        address,
        card,
        country,
        devMode: !!d[DEV_MODE_KEY],
        soundMuted: !!d[SOUND_MUTED_KEY],
        pinned: !!(pinned && pinned.pinnedCountry === country)
      });
    });
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "fillNow", mode: "all" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { action: "fillNow", mode: "all" });
    }, 800);
  }
});