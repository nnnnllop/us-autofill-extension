/* ═══════════════════════════════════════════════════════
   AutoFill — Background Service Worker
   — Адрес: пул реальных адресов + имя (randomuser.me)
   — Карты: локальная генерация (Лун), внешняя проверка с MV3-восстановлением
   ═══════════════════════════════════════════════════════ */

const SELECTED_COUNTRY_KEY = "selectedCountry";
const PREFERRED_CURRENCY_KEY = "preferredCurrency";
const DEFAULT_COUNTRY = "US";
const DEFAULT_CURRENCY = "USD";
const CACHE_TTL_MS = 30 * 60 * 1000;

const CARD_CACHE_KEY = "cached_card";
const CARD_TS_KEY = "cached_card_ts";
const CARD_CHECK_JOB_KEY = "card_check_job";
const CARD_CHECK_ALARM_NAME = "autofill-card-check";
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
const DEV_LOGS_KEY = "devLogs";
const MAX_PROFILES = 50;
const MAX_DEV_LOGS = 500;
const EXT_VERSION = "2.5.0";

const DEFAULT_BIN = "5154620022";
const BIN_STORAGE_KEY = "user_bin";
const IBAN_CACHE_KEY = "cached_iban";
const IBAN_COUNTRY_KEY = "ibanCountry";
const DEFAULT_IBAN_COUNTRY = "DE";

const BIN_PRESETS = [
  { id: "mc", label: "Mastercard", short: "MC", bin: "5154620022", type: "mastercard" },
  { id: "visa", label: "Visa", short: "Visa", bin: "4532015112", type: "visa" },
  { id: "amex", label: "Amex", short: "Amex", bin: "3782822463", type: "amex", length: 15 }
];

function addrCacheKey(country) { return `cached_address_${country}`; }
function addrTsKey(country) { return `cached_address_ts_${country}`; }

function cleanLogValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

async function appendDevLog(entry = {}) {
  const data = await chrome.storage.local.get(DEV_LOGS_KEY);
  const logs = Array.isArray(data[DEV_LOGS_KEY]) ? data[DEV_LOGS_KEY] : [];
  const next = logs.concat({
    ts: entry.ts || new Date().toISOString(),
    level: String(entry.level || "info").slice(0, 16),
    source: String(entry.source || "background").slice(0, 80),
    message: cleanLogValue(entry.message).slice(0, 1200),
    url: cleanLogValue(entry.url).slice(0, 500),
    details: cleanLogValue(entry.details).slice(0, 1200)
  }).slice(-MAX_DEV_LOGS);
  await chrome.storage.local.set({ [DEV_LOGS_KEY]: next });
  return next.length;
}

async function addDevLog(level, message, details = "") {
  try {
    const data = await chrome.storage.local.get(DEV_MODE_KEY);
    if (!data[DEV_MODE_KEY]) return;
    await appendDevLog({ level, source: "background", message, details });
  } catch (_) {}
}

const COUNTRY_DEFAULT_CURRENCY = {
  US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", CA: "CAD", AU: "AUD",
  NL: "EUR", IT: "EUR", ES: "EUR", PL: "PLN"
};

const CURRENCY_CONFIG = {
  USD: { code: "USD", symbol: "$", name: "US Dollar", flag: "🇺🇸" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", flag: "🇪🇺" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", flag: "🇬🇧" },
  CAD: { code: "CAD", symbol: "C$", name: "Canadian Dollar", flag: "🇨🇦" },
  AUD: { code: "AUD", symbol: "A$", name: "Australian Dollar", flag: "🇦🇺" },
  PLN: { code: "PLN", symbol: "zł", name: "Polish Złoty", flag: "🇵🇱" },
  SEK: { code: "SEK", symbol: "kr", name: "Swedish Krona", flag: "🇸🇪" },
  CHF: { code: "CHF", symbol: "Fr", name: "Swiss Franc", flag: "🇨🇭" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen", flag: "🇯🇵" }
};

function currencyForCountry(countryCode) {
  return COUNTRY_DEFAULT_CURRENCY[countryCode] || DEFAULT_CURRENCY;
}

function normalizeCurrency(code, countryCode) {
  const upper = (code || "").toUpperCase();
  if (CURRENCY_CONFIG[upper]) return upper;
  return currencyForCountry(countryCode || DEFAULT_COUNTRY);
}

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
      currency: DEFAULT_CURRENCY,
      bin: DEFAULT_BIN,
      email: ""
    }];
    await chrome.storage.local.set({ [PROFILES_KEY]: profiles, [ACTIVE_PROFILE_KEY]: "default" });
  } else {
    let migrated = false;
    profiles = profiles.map(p => {
      if (p.currency && CURRENCY_CONFIG[p.currency]) return p;
      migrated = true;
      return {
        ...p,
        currency: normalizeCurrency(p.currency, p.country || DEFAULT_COUNTRY)
      };
    });
    if (migrated) await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
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
  const prev = await getActiveProfile();
  const country = profile.country || DEFAULT_COUNTRY;
  const updates = {
    [SELECTED_COUNTRY_KEY]: country,
    [PREFERRED_CURRENCY_KEY]: normalizeCurrency(profile.currency, country)
  };
  const newBin = (profile.bin || DEFAULT_BIN).replace(/\D/g, "");
  updates[BIN_STORAGE_KEY] = newBin;
  updates[USER_EMAIL_KEY] = (profile.email || "").trim();
  await chrome.storage.local.set(updates);
  await chrome.storage.local.set({ [ACTIVE_PROFILE_KEY]: profile.id });
  if (prev?.id !== profile.id || prev?.bin !== newBin) {
    await clearCachedCard();
  }
}

async function saveProfile(profileData) {
  const { profiles, activeId } = await getProfiles();
  const idx = profiles.findIndex(p => p.id === profileData.id);
  const entry = {
    id: profileData.id || profileId(),
    name: (profileData.name || "Профиль").trim().slice(0, 24),
    country: COUNTRY_CONFIG[profileData.country] ? profileData.country : DEFAULT_COUNTRY,
    currency: normalizeCurrency(profileData.currency, profileData.country),
    bin: (profileData.bin || DEFAULT_BIN).replace(/\D/g, ""),
    email: (profileData.email || "").trim()
  };
  if (idx >= 0) profiles[idx] = entry;
  else if (profiles.length < MAX_PROFILES) profiles.push(entry);
  else return { error: "max_profiles" };

  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });

  if (profileData.setActive) {
    await applyProfile(entry);
    return { profile: entry, profiles, activeId: entry.id };
  }

  if (entry.id === activeId) {
    const prev = await getActiveProfile();
    await chrome.storage.local.set({
      [USER_EMAIL_KEY]: entry.email,
      [SELECTED_COUNTRY_KEY]: entry.country,
      [PREFERRED_CURRENCY_KEY]: entry.currency,
      [BIN_STORAGE_KEY]: entry.bin
    });
    if (prev?.bin !== entry.bin || prev?.country !== entry.country) {
      await clearCachedCard();
    }
  }

  return { profile: entry, profiles, activeId };
}

async function deleteProfile(id) {
  const { profiles, activeId } = await getProfiles();
  if (profiles.length <= 1) return { error: "last_profile" };
  const next = profiles.filter(p => p.id !== id);
  await chrome.storage.local.set({ [PROFILES_KEY]: next });
  if (activeId === id) {
    await clearCachedCard();
    await applyProfile(next[0]);
  }
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

async function getSelectedCurrency() {
  const active = await getActiveProfile();
  if (active?.currency && CURRENCY_CONFIG[active.currency]) return active.currency;
  const data = await chrome.storage.local.get(PREFERRED_CURRENCY_KEY);
  const stored = data[PREFERRED_CURRENCY_KEY];
  if (stored && CURRENCY_CONFIG[stored]) return stored;
  return currencyForCountry(await getSelectedCountry());
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
    const res = await fetchWithTimeout(
      `https://randomuser.me/api/?nat=${nat}`,
      {},
      NAME_FETCH_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    const user = data.results?.[0];
    if (!user?.name) throw new Error("Invalid name response");
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

async function readStoredAddress(countryCode) {
  const country = countryCode || await getSelectedCountry();
  const cacheKey = addrCacheKey(country);
  const pinned = await getPinnedAddress();

  if (pinned && pinned.pinnedCountry === country) {
    return mergeAddressEmail(pinned);
  }

  const cached = await chrome.storage.local.get(cacheKey);
  return cached[cacheKey] || null;
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
  return raw.slice(0, MAX_PROFILES).map((p, i) => {
    const country = COUNTRY_CONFIG[p.country] ? p.country : DEFAULT_COUNTRY;
    return {
      id: p.id || profileId(),
      name: String(p.name || `Профиль ${i + 1}`).trim().slice(0, 32),
      country,
      currency: normalizeCurrency(p.currency, country),
      bin: String(p.bin || DEFAULT_BIN).replace(/\D/g, "").slice(0, 15) || DEFAULT_BIN,
      email: String(p.email || "").trim().slice(0, 120)
    };
  });
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
  await clearCachedCard();
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
   IBAN GENERATOR (ISO 13616 / MOD-97)
   ═══════════════════════════════════════════════════════ */

const IBAN_CONFIG = {
  DE: {
    code: "DE", name: "Germany", flag: "🇩🇪", length: 22,
    bban: () => randomDigits(8) + randomDigits(10)
  },
  FR: {
    code: "FR", name: "France", flag: "🇫🇷", length: 27,
    bban: () => randomDigits(5) + randomDigits(5) + randomDigits(11) + randomDigits(2)
  },
  NL: {
    code: "NL", name: "Netherlands", flag: "🇳🇱", length: 18,
    bban: () => randomLetters(4) + randomDigits(10)
  },
  IT: {
    code: "IT", name: "Italy", flag: "🇮🇹", length: 27,
    bban: () => randomLetters(1) + randomDigits(5) + randomDigits(5) + randomDigits(12)
  },
  ES: {
    code: "ES", name: "Spain", flag: "🇪🇸", length: 24,
    bban: () => randomDigits(4) + randomDigits(4) + randomDigits(2) + randomDigits(10)
  },
  PL: {
    code: "PL", name: "Poland", flag: "🇵🇱", length: 28,
    bban: () => randomDigits(8) + randomDigits(16)
  },
  GB: {
    code: "GB", name: "United Kingdom", flag: "🇬🇧", length: 22,
    bban: () => randomLetters(4) + randomDigits(6) + randomDigits(8)
  },
  AT: {
    code: "AT", name: "Austria", flag: "🇦🇹", length: 20,
    bban: () => randomDigits(5) + randomDigits(11)
  },
  BE: {
    code: "BE", name: "Belgium", flag: "🇧🇪", length: 16,
    bban: () => randomDigits(3) + randomDigits(7) + randomDigits(2)
  },
  CH: {
    code: "CH", name: "Switzerland", flag: "🇨🇭", length: 21,
    bban: () => randomDigits(5) + randomDigits(12)
  },
  SE: {
    code: "SE", name: "Sweden", flag: "🇸🇪", length: 24,
    bban: () => randomDigits(3) + randomDigits(17)
  }
};

const IBAN_COUNTRY_FROM_ADDRESS = {
  DE: "DE", FR: "FR", NL: "NL", IT: "IT", ES: "ES", PL: "PL", GB: "GB"
};

function randomDigits(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function randomLetters(n) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * 26)];
  return s;
}

function ibanCharToDigits(ch) {
  if (ch >= "0" && ch <= "9") return ch;
  return String(ch.toUpperCase().charCodeAt(0) - 55);
}

function mod97(numericStr) {
  let remainder = 0;
  for (let i = 0; i < numericStr.length; i++) {
    remainder = (remainder * 10 + (numericStr.charCodeAt(i) - 48)) % 97;
  }
  return remainder;
}

function ibanToNumeric(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) out += ibanCharToDigits(str[i]);
  return out;
}

function computeIbanCheckDigits(countryCode, bban) {
  const rearranged = bban + countryCode + "00";
  const rem = mod97(ibanToNumeric(rearranged));
  return String(98 - rem).padStart(2, "0");
}

function validateIban(iban) {
  const clean = String(iban || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;
  const cfg = IBAN_CONFIG[clean.slice(0, 2)];
  if (cfg && clean.length !== cfg.length) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  return mod97(ibanToNumeric(rearranged)) === 1;
}

function formatIban(iban) {
  return String(iban || "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function getIbanCountriesList() {
  return Object.values(IBAN_CONFIG).map(c => ({
    code: c.code,
    name: c.name,
    flag: c.flag,
    length: c.length
  }));
}

async function getIbanCountry() {
  const data = await chrome.storage.local.get(IBAN_COUNTRY_KEY);
  const stored = data[IBAN_COUNTRY_KEY];
  if (stored && IBAN_CONFIG[stored]) return stored;
  const addressCountry = await getSelectedCountry();
  return IBAN_COUNTRY_FROM_ADDRESS[addressCountry] || DEFAULT_IBAN_COUNTRY;
}

async function setIbanCountry(code) {
  const upper = String(code || "").toUpperCase();
  if (!IBAN_CONFIG[upper]) return getIbanCountry();
  await chrome.storage.local.set({ [IBAN_COUNTRY_KEY]: upper });
  return upper;
}

function generateIbanForCountry(countryCode) {
  const cfg = IBAN_CONFIG[countryCode] || IBAN_CONFIG[DEFAULT_IBAN_COUNTRY];
  const bban = cfg.bban();
  const check = computeIbanCheckDigits(cfg.code, bban);
  const iban = `${cfg.code}${check}${bban}`;
  return {
    iban,
    formatted: formatIban(iban),
    country: cfg.code,
    countryName: cfg.name,
    flag: cfg.flag,
    length: iban.length,
    valid: validateIban(iban),
    bban
  };
}

async function getCachedIban() {
  const data = await chrome.storage.local.get(IBAN_CACHE_KEY);
  const cached = data[IBAN_CACHE_KEY];
  if (cached?.iban && validateIban(cached.iban)) return cached;
  return null;
}

async function generateAndCacheIban(countryCode) {
  const code = countryCode && IBAN_CONFIG[countryCode]
    ? countryCode
    : await getIbanCountry();
  await setIbanCountry(code);
  const result = generateIbanForCountry(code);
  await chrome.storage.local.set({ [IBAN_CACHE_KEY]: result });
  await addDevLog("info", "Сгенерирован IBAN", `${result.country} ${result.formatted}`);
  return result;
}

async function getOrCreateIban() {
  const cached = await getCachedIban();
  if (cached) return cached;
  return generateAndCacheIban();
}

/* ═══════════════════════════════════════════════════════
   ВАЛИДАЦИЯ КАРТ
   ═══════════════════════════════════════════════════════ */

const API_TIMEOUT_MS = 8000;
const NAME_FETCH_TIMEOUT_MS = 6000;
const CARD_CHECK_STALE_MS = 180000;

const CHECK_APIS = Object.freeze([
  { id: "namso", name: "namso.live", url: "https://namso.live/api/v1/check.php" },
  { id: "chkr", name: "chkr.cc", url: "https://api.chkr.cc/" }
]);
const CARD_CHECK_MAX_ATTEMPTS = 5;
const CARD_CHECK_LEASE_MS = API_TIMEOUT_MS * CHECK_APIS.length + 5000;
const API_COOLDOWN_MS = 60000;

const checkApiHealth = new Map(CHECK_APIS.map(api => [api.id, {
  consecutiveFailures: 0,
  disabledUntil: 0
}]));

// Восстановление здоровья API из хранилища
chrome.storage.local.get(["api_health_data"], data => {
  if (data.api_health_data) {
    for (const [id, val] of Object.entries(data.api_health_data)) {
      if (checkApiHealth.has(id)) {
        const h = checkApiHealth.get(id);
        h.consecutiveFailures = Number(val.consecutiveFailures) || 0;
        h.disabledUntil = Number(val.disabledUntil) || 0;
      }
    }
  }
});

async function saveApiHealthToStorage() {
  const data = {};
  for (const [id, val] of checkApiHealth.entries()) {
    data[id] = val;
  }
  await chrome.storage.local.set({ "api_health_data": data });
}

let activeCardCheckJobId = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function getCheckApiOrder() {
  const now = Date.now();
  return [...CHECK_APIS].sort((a, b) => {
    const healthA = checkApiHealth.get(a.id);
    const healthB = checkApiHealth.get(b.id);
    const disabledA = healthA.disabledUntil > now ? 1 : 0;
    const disabledB = healthB.disabledUntil > now ? 1 : 0;
    return disabledA - disabledB ||
      healthA.disabledUntil - healthB.disabledUntil ||
      healthA.consecutiveFailures - healthB.consecutiveFailures;
  });
}

function markCheckApiSuccess(api) {
  const health = checkApiHealth.get(api.id);
  health.consecutiveFailures = 0;
  health.disabledUntil = 0;
  saveApiHealthToStorage().catch(() => {});
}

function markCheckApiFailure(api, result) {
  const health = checkApiHealth.get(api.id);
  health.consecutiveFailures++;
  if (result?.status === "rate_limited" || health.consecutiveFailures >= 2) {
    health.disabledUntil = Date.now() + API_COOLDOWN_MS;
  }
  saveApiHealthToStorage().catch(() => {});
}

async function checkWithNamso(api, cardRaw) {
  const [cc, mes, ano, cvv] = cardRaw.split("|");
  const startTime = Date.now();
  try {
    const res = await fetchWithTimeout(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cc, mes, ano, cvv })
    }, API_TIMEOUT_MS);
    const duration = Date.now() - startTime;

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }

    const apiStatus = String(data?.status || "").trim();
    const apiMessage = String(data?.message || data?.msg || "").trim();
    const apiCode = String(data?.code || "").trim();

    const isLimited =
      res.status === 429 ||
      /^limit(?:ed)?$/i.test(apiStatus) ||
      /limit exceeded|rate.?limit/i.test(apiMessage);

    if (isLimited) {
      return {
        api: api.name,
        code: -1,
        status: "rate_limited",
        message: apiMessage || "Limit exceeded",
        time: duration
      };
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    if (apiStatus === "APPROVED" || apiCode === "85") {
      return {
        api: api.name,
        code: 1,
        status: "APPROVED",
        message: apiMessage || "Approved",
        time: duration,
        card: {
          type: (data.card_info?.brand || "").toLowerCase(),
          category: (data.card_info?.type || "").toLowerCase(),
          bank: data.card_info?.bank || "",
          country: null
        }
      };
    }

    if (apiStatus === "DECLINED" || apiStatus === "Die" || apiStatus === "Die!" || apiStatus === "FAIL") {
      return {
        api: api.name,
        code: 0,
        status: "DECLINED",
        message: apiMessage || "Declined",
        time: duration
      };
    }

    return {
      api: api.name,
      code: 0,
      status: "DECLINED",
      message: apiMessage || "Declined",
      time: duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const isTimeout = err.name === "AbortError";
    return {
      api: api.name,
      code: -1,
      status: isTimeout ? "timeout" : "unavailable",
      message: err.message || (isTimeout ? "Timeout" : "Unavailable"),
      time: duration
    };
  }
}

function normalizeChkrResult(data) {
  if (!data || typeof data !== "object") return null;
  if (data.code !== undefined && data.code !== null) {
    const numericCode = Number(data.code);
    if (Number.isFinite(numericCode)) return { ...data, code: numericCode };
  }

  const status = String(data.status || "").trim();
  if (/^(live|approved)$/i.test(status)) return { ...data, code: 1, status: "Live" };
  if (/^(die|dead|declined|invalid)$/i.test(status)) return { ...data, code: 0, status: "Die" };
  return { ...data, code: -1, status: status || "unavailable" };
}

async function checkWithChkr(api, cardRaw) {
  const startTime = Date.now();
  try {
    const res = await fetchWithTimeout(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: cardRaw })
    }, API_TIMEOUT_MS);
    const duration = Date.now() - startTime;

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }

    const apiStatus = String(data?.status || "").trim();
    const apiMessage = String(data?.message || data?.msg || "").trim();
    const apiCode = data?.code !== undefined && data?.code !== null ? Number(data.code) : -1;

    const isLimited =
      res.status === 429 ||
      /^limit(?:ed)?$/i.test(apiStatus) ||
      /limit exceeded|rate.?limit/i.test(apiMessage);

    if (isLimited) {
      return {
        api: api.name,
        code: -1,
        status: "rate_limited",
        message: apiMessage || "Limit exceeded",
        time: duration
      };
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    if (apiCode === 1 || /^(live|approved)$/i.test(apiStatus)) {
      return {
        api: api.name,
        code: 1,
        status: "APPROVED",
        message: apiMessage || "Approved",
        time: duration,
        card: data.card ? {
          type: (data.card.type || "").toLowerCase(),
          category: (data.card.category || "").toLowerCase(),
          bank: data.card.bank || "",
          country: data.card.country?.name || null
        } : null
      };
    }

    if (apiCode === 0 || /^(die|dead|declined|invalid)$/i.test(apiStatus)) {
      return {
        api: api.name,
        code: 0,
        status: "DECLINED",
        message: apiMessage || "Declined",
        time: duration
      };
    }

    return {
      api: api.name,
      code: -1,
      status: "unavailable",
      message: apiMessage || "Unknown response",
      time: duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const isTimeout = err.name === "AbortError";
    return {
      api: api.name,
      code: -1,
      status: isTimeout ? "timeout" : "unavailable",
      message: err.message || (isTimeout ? "Timeout" : "Unavailable"),
      time: duration
    };
  }
}

async function singleCheck(cardRaw) {
  const apis = CHECK_APIS;

  const checkPromises = apis.map(async (api) => {
    const health = checkApiHealth.get(api.id);
    const now = Date.now();
    if (health && health.disabledUntil > now) {
      return {
        api: api.name,
        code: -1,
        status: "rate_limited",
        message: "Ожидание лимита",
        time: 0
      };
    }

    const result = api.id === "namso"
      ? await checkWithNamso(api, cardRaw)
      : await checkWithChkr(api, cardRaw);

    if (result && result.code !== -1) {
      markCheckApiSuccess(api);
    } else {
      markCheckApiFailure(api, result || { code: -1, status: "unavailable" });
    }
    return result;
  });

  const results = await Promise.all(checkPromises);

  // Определение общего кода по гибкой логике:
  // Карта APPROVED (1) если хотя бы один одобрил и никто не отклонил.
  // Карта DECLINED (0) если хотя бы один отклонил.
  // Иначе (ошибки/таймауты) -1.
  let overallCode = -1;
  const codes = results.map(r => r.code);

  if (codes.includes(0)) {
    overallCode = 0; // Хотя бы один отклонил
  } else if (codes.includes(1)) {
    overallCode = 1; // Хотя бы один одобрил и никто не отклонил
  }

  // Сбор информации о банке/типе карты из успешных ответов
  let combinedCardInfo = {};
  for (const r of results) {
    if (r.card) {
      combinedCardInfo = {
        ...combinedCardInfo,
        ...r.card
      };
    }
  }

  // Формирование общего статуса и текстового сообщения
  let overallStatus = "failed";
  let overallMessage = "Declined";

  if (overallCode === 1) {
    const allApproved = codes.every(c => c === 1);
    overallStatus = allApproved ? "live" : "live_partial";
    overallMessage = results.map(r => `${r.api}: ${r.message}`).join(" | ");
  } else if (overallCode === 0) {
    overallStatus = "failed";
    overallMessage = results.map(r => `${r.api}: ${r.message}`).join(" | ");
  } else {
    overallStatus = "unavailable";
    const statusSet = new Set(results.map(r => r.status));
    if (statusSet.has("rate_limited")) {
      overallStatus = "rate_limited";
      overallMessage = "Лимит запросов";
    } else if (statusSet.has("timeout")) {
      overallStatus = "timeout";
      overallMessage = "API таймаут";
    } else {
      overallMessage = "API недоступно";
    }
  }

  return {
    code: overallCode,
    status: overallStatus,
    message: overallMessage,
    checks: results,
    card: combinedCardInfo
  };
}

async function generateCardInstant() {
  const card = await generateFullCard();
  return {
    ...card,
    validated: false,
    validationStatus: "checking",
    validationMessage: "Проверяется..."
  };
}

function cardCheckId() {
  return `check_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function scheduleCardCheckAlarm(delayMs = CARD_CHECK_LEASE_MS) {
  try {
    await chrome.alarms.clear(CARD_CHECK_ALARM_NAME);
    await chrome.alarms.create(CARD_CHECK_ALARM_NAME, {
      when: Date.now() + Math.max(250, delayMs)
    });
  } catch (err) {
    await addDevLog("warn", "Не удалось запланировать восстановление проверки карты", String(err?.message || err));
  }
}

async function clearCardCheckAlarm() {
  try {
    await chrome.alarms.clear(CARD_CHECK_ALARM_NAME);
  } catch (_) {}
}

async function clearCachedCard() {
  await chrome.storage.local.remove([CARD_CACHE_KEY, CARD_TS_KEY, CARD_CHECK_JOB_KEY]);
  await clearCardCheckAlarm();
}

async function getCardCheckJob() {
  const data = await chrome.storage.local.get(CARD_CHECK_JOB_KEY);
  return data[CARD_CHECK_JOB_KEY] || null;
}

async function finishCardCheck(jobId, card) {
  const current = await getCardCheckJob();
  if (!current || current.id !== jobId || current.card?.raw !== card.raw) return false;

  const completedAt = Date.now();
  await chrome.storage.local.set({
    [CARD_CACHE_KEY]: card,
    [CARD_TS_KEY]: completedAt,
    [CARD_CHECK_JOB_KEY]: {
      ...current,
      state: "complete",
      card,
      leaseUntil: 0,
      updatedAt: completedAt,
      completedAt
    }
  });
  await chrome.storage.local.remove(CARD_CHECK_JOB_KEY);
  await clearCardCheckAlarm();
  return true;
}

async function runCardCheckJob(expectedJobId = null) {
  if (activeCardCheckJobId) {
    if (!expectedJobId || activeCardCheckJobId !== expectedJobId) {
      await scheduleCardCheckAlarm(1000);
    }
    return;
  }

  const initialJob = await getCardCheckJob();
  if (!initialJob || (expectedJobId && initialJob.id !== expectedJobId)) return;
  if (initialJob.state === "complete") {
    await chrome.storage.local.remove(CARD_CHECK_JOB_KEY);
    await clearCardCheckAlarm();
    return;
  }
  activeCardCheckJobId = initialJob.id;

  try {
    while (true) {
      const job = await getCardCheckJob();
      if (!job || job.id !== activeCardCheckJobId) return;
      if (job.state === "complete") {
        await chrome.storage.local.remove(CARD_CHECK_JOB_KEY);
        await clearCardCheckAlarm();
        return;
      }

      const now = Date.now();
      if (now - job.createdAt >= CARD_CHECK_STALE_MS) {
        await finishCardCheck(job.id, {
          ...job.card,
          validated: false,
          validationStatus: "unavailable",
          validationMessage: "Проверка прервана — нажмите «Новая»"
        });
        return;
      }

      if (job.leaseUntil > now) {
        await scheduleCardCheckAlarm(job.leaseUntil - now + 500);
        return;
      }

      const runningJob = {
        ...job,
        state: "running",
        leaseUntil: now + CARD_CHECK_LEASE_MS,
        updatedAt: now
      };
      const checkingCard = {
        ...job.card,
        validationStatus: "checking",
        validationMessage: `Проверка ${job.attempt + 1}/${CARD_CHECK_MAX_ATTEMPTS}...`
      };
      runningJob.card = checkingCard;
      await chrome.storage.local.set({
        [CARD_CHECK_JOB_KEY]: runningJob,
        [CARD_CACHE_KEY]: checkingCard,
        [CARD_TS_KEY]: now
      });
      await scheduleCardCheckAlarm(CARD_CHECK_LEASE_MS + 1000);

      const result = await singleCheck(checkingCard.raw);
      const latest = await getCardCheckJob();
      if (!latest || latest.id !== runningJob.id || latest.card?.raw !== checkingCard.raw) return;

      if (!result || result.code === -1) {
        const reason = result?.message || (result?.status === "rate_limited" ? "Лимит запросов"
          : result?.status === "timeout" ? "API таймаут" : "API недоступно");
        await finishCardCheck(latest.id, {
          ...checkingCard,
          validated: false,
          validationStatus: result?.status === "rate_limited" ? "rate_limited" : "unavailable",
          validationMessage: reason,
          checks: result?.checks || []
        });
        return;
      }

      if (result.code === 1) {
        await finishCardCheck(latest.id, {
          ...checkingCard,
          type: result.card?.type || checkingCard.type,
          category: result.card?.category || "",
          bank: result.card?.bank || "",
          country: result.card?.country || null,
          validated: true,
          validationStatus: result.status,
          validationMessage: result.message || "Approved",
          checks: result.checks || []
        });
        return;
      }

      const nextAttempt = latest.attempt + 1;
      if (nextAttempt >= CARD_CHECK_MAX_ATTEMPTS) {
        await finishCardCheck(latest.id, {
          ...checkingCard,
          validated: false,
          validationStatus: "failed",
          validationMessage: "Лун-валидна (Live не подтверждена)",
          checks: result.checks || []
        });
        return;
      }

      const nextCard = {
        ...await generateFullCard(),
        validated: false,
        validationStatus: "checking",
        validationMessage: `Новая карта, проверка ${nextAttempt + 1}/${CARD_CHECK_MAX_ATTEMPTS}...`
      };
      await chrome.storage.local.set({
        [CARD_CHECK_JOB_KEY]: {
          ...latest,
          state: "pending",
          attempt: nextAttempt,
          card: nextCard,
          leaseUntil: 0,
          updatedAt: Date.now()
        },
        [CARD_CACHE_KEY]: nextCard,
        [CARD_TS_KEY]: Date.now()
      });
      await scheduleCardCheckAlarm(1000);
      await sleep(2000);
    }
  } catch (err) {
    await addDevLog("error", "Ошибка фоновой проверки карты", String(err?.message || err));
    const job = await getCardCheckJob();
    if (job?.id === activeCardCheckJobId) {
      await chrome.storage.local.set({
        [CARD_CHECK_JOB_KEY]: { ...job, leaseUntil: 0, updatedAt: Date.now() }
      });
      await scheduleCardCheckAlarm(1000);
    }
  } finally {
    activeCardCheckJobId = null;
  }
}

async function resumeStoredCardCheck() {
  const job = await getCardCheckJob();
  if (job) await runCardCheckJob(job.id);
}

async function startCardCheck() {
  const card = await generateCardInstant();
  const now = Date.now();
  const job = {
    id: cardCheckId(),
    state: "pending",
    attempt: 0,
    card,
    createdAt: now,
    updatedAt: now,
    leaseUntil: 0
  };
  await chrome.storage.local.set({
    [CARD_CACHE_KEY]: card,
    [CARD_TS_KEY]: now,
    [CARD_CHECK_JOB_KEY]: job
  });
  await scheduleCardCheckAlarm(CARD_CHECK_LEASE_MS + 1000);
  runCardCheckJob(job.id).catch(err => {
    addDevLog("error", "Не удалось запустить проверку карты", String(err?.message || err));
  });
  return { started: true, checking: true, card };
}

async function recoverStaleCard(card) {
  if (!card || card.validationStatus !== "checking") return card;
  const data = await chrome.storage.local.get(CARD_TS_KEY);
  const ts = data[CARD_TS_KEY] || 0;
  if (Date.now() - ts < CARD_CHECK_STALE_MS) return card;
  const recovered = {
    ...card,
    validated: false,
    validationStatus: "unavailable",
    validationMessage: "Проверка прервана — нажмите «Новая»"
  };
  await chrome.storage.local.set({ [CARD_CACHE_KEY]: recovered, [CARD_TS_KEY]: Date.now() });
  await chrome.storage.local.remove(CARD_CHECK_JOB_KEY);
  await clearCardCheckAlarm();
  return recovered;
}

async function getCachedCard() {
  const data = await chrome.storage.local.get(CARD_CACHE_KEY);
  const card = await recoverStaleCard(data[CARD_CACHE_KEY] || null);
  if (card?.validationStatus === "checking") {
    resumeStoredCardCheck().catch(() => {});
  }
  return card;
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== CARD_CHECK_ALARM_NAME) return;
  resumeStoredCardCheck().catch(err => {
    addDevLog("error", "Не удалось восстановить проверку карты", String(err?.message || err));
  });
});

chrome.runtime.onStartup.addListener(() => {
  resumeStoredCardCheck().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  resumeStoredCardCheck().catch(() => {});
});

async function getPopupBootstrap() {
  const [{ profiles, activeId }, country, currency, email, bin, ibanCountry, settingsData, devLogsData] = await Promise.all([
    getProfiles(),
    getSelectedCountry(),
    getSelectedCurrency(),
    getUserEmail(),
    getBin(),
    getIbanCountry(),
    chrome.storage.local.get([
      DEV_MODE_KEY, SOUND_MUTED_KEY, COMPACT_MODE_KEY,
      SHOW_PROFILE_SUMMARY_KEY, STRIPE_FAB_KEY, ONBOARDING_DONE_KEY
    ]),
    chrome.storage.local.get(DEV_LOGS_KEY)
  ]);

  const [addr, card, pinned, iban] = await Promise.all([
    readStoredAddress(country),
    getCachedCard(),
    getPinnedAddress(),
    getOrCreateIban()
  ]);

  const shortcut = await new Promise(resolve => {
    chrome.commands.getAll(commands => {
      const cmd = commands.find(c => c.name === "fill-page");
      resolve(cmd?.shortcut || "Ctrl+Shift+Z");
    });
  });

  return {
    version: EXT_VERSION,
    profiles,
    activeId,
    country,
    currency,
    currencies: getCurrenciesList(),
    address: await mergeAddressEmail(addr),
    card,
    iban,
    ibanCountry,
    ibanCountries: getIbanCountriesList(),
    pinned: !!(pinned && pinned.pinnedCountry === country),
    email,
    bin,
    countries: getCountriesList(),
    presets: BIN_PRESETS,
    shortcut,
    browser: detectBrowser(),
    devMode: !!settingsData[DEV_MODE_KEY],
    devLogCount: Array.isArray(devLogsData[DEV_LOGS_KEY]) ? devLogsData[DEV_LOGS_KEY].length : 0,
    settings: {
      soundMuted: !!settingsData[SOUND_MUTED_KEY],
      compactMode: !!settingsData[COMPACT_MODE_KEY],
      showProfileSummary: settingsData[SHOW_PROFILE_SUMMARY_KEY] !== false,
      stripeFabEnabled: settingsData[STRIPE_FAB_KEY] !== false,
      onboardingDone: !!settingsData[ONBOARDING_DONE_KEY]
    }
  };
}

function detectBrowser() {
  try {
    const ua = (globalThis.navigator && navigator.userAgent) || "";
    if (/Firefox\//i.test(ua)) return "firefox";
    if (/Edg\//i.test(ua)) return "edge";
    if (/OPR\//i.test(ua) || /Opera\//i.test(ua)) return "opera";
    if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) return "chrome";
  } catch (_) {}
  return "chrome";
}

function getCountriesList() {
  return Object.entries(COUNTRY_CONFIG).map(([code, cfg]) => ({
    code,
    name: cfg.name,
    flag: cfg.flag
  }));
}

function getCurrenciesList() {
  return Object.values(CURRENCY_CONFIG).map(cfg => ({
    code: cfg.code,
    name: cfg.name,
    symbol: cfg.symbol,
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

  if (msg.action === "getCurrencies") {
    sendResponse({ currencies: getCurrenciesList() });
    return true;
  }

  if (msg.action === "getSelectedCurrency") {
    getSelectedCurrency().then(code => {
      const cfg = CURRENCY_CONFIG[code];
      sendResponse({ code, name: cfg?.name, symbol: cfg?.symbol, flag: cfg?.flag });
    });
    return true;
  }

  if (msg.action === "setCurrency") {
    const code = normalizeCurrency(msg.currency);
    if (!CURRENCY_CONFIG[code]) {
      sendResponse({ error: "Unknown currency" });
      return true;
    }
    chrome.storage.local.set({ [PREFERRED_CURRENCY_KEY]: code }).then(() => {
      const cfg = CURRENCY_CONFIG[code];
      sendResponse({ code, name: cfg.name, symbol: cfg.symbol, flag: cfg.flag });
    });
    return true;
  }

  if (msg.action === "getAddress") {
    const load = msg.cacheOnly ? readStoredAddress : getCachedAddress;
    load(msg.country).then(addr => sendResponse({ address: addr }));
    return true;
  }

  if (msg.action === "refreshAddress") {
    const country = msg.country || null;
    (async () => {
      try {
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
      } catch (err) {
        console.error("[BG] refreshAddress error:", err);
        sendResponse({ address: null, error: String(err?.message || err) });
      }
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
      clearCachedCard().then(() => {
        sendResponse({ bin: newBin });
      });
    });
    return true;
  }

  if (msg.action === "getCard" || msg.action === "getCardCache") {
    getCachedCard().then(card => sendResponse({ card }));
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
      try {
        const { profiles } = await getProfiles();
        const profile = profiles.find(p => p.id === msg.id);
        if (!profile) { sendResponse({ error: "not_found" }); return; }
        await applyProfile(profile);
        sendResponse({ profile, profiles, activeId: profile.id });
      } catch (err) {
        console.error("[BG] setActiveProfile error:", err);
        sendResponse({ error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg.action === "getBinPresets") {
    sendResponse({ presets: BIN_PRESETS });
    return true;
  }

  if (msg.action === "getIbanCountries") {
    sendResponse({ countries: getIbanCountriesList() });
    return true;
  }

  if (msg.action === "getIbanCountry") {
    getIbanCountry().then(code => {
      const cfg = IBAN_CONFIG[code];
      sendResponse({ code, name: cfg?.name, flag: cfg?.flag });
    });
    return true;
  }

  if (msg.action === "setIbanCountry") {
    setIbanCountry(msg.country).then(code => {
      const cfg = IBAN_CONFIG[code];
      sendResponse({ code, name: cfg?.name, flag: cfg?.flag });
    });
    return true;
  }

  if (msg.action === "getIban") {
    getOrCreateIban().then(iban => sendResponse({ iban }));
    return true;
  }

  if (msg.action === "generateIban") {
    generateAndCacheIban(msg.country).then(iban => sendResponse({ iban }));
    return true;
  }

  if (msg.action === "getBrowser") {
    sendResponse({ browser: detectBrowser() });
    return true;
  }

  if (msg.action === "getDevMode") {
    chrome.storage.local.get(DEV_MODE_KEY, d => sendResponse({ devMode: !!d[DEV_MODE_KEY] }));
    return true;
  }

  if (msg.action === "setDevMode") {
    chrome.storage.local.set({ [DEV_MODE_KEY]: !!msg.devMode }).then(() => {
      if (msg.devMode) appendDevLog({ level: "info", source: "background", message: "Dev-логи включены" }).catch(() => {});
      sendResponse({ devMode: !!msg.devMode });
    });
    return true;
  }

  if (msg.action === "appendDevLog") {
    chrome.storage.local.get(DEV_MODE_KEY, d => {
      if (!d[DEV_MODE_KEY]) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      appendDevLog(msg.entry || {})
        .then(count => sendResponse({ ok: true, count }))
        .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    });
    return true;
  }

  if (msg.action === "getDevLogs") {
    chrome.storage.local.get(DEV_LOGS_KEY, d => {
      sendResponse({ logs: Array.isArray(d[DEV_LOGS_KEY]) ? d[DEV_LOGS_KEY] : [] });
    });
    return true;
  }

  if (msg.action === "clearDevLogs") {
    chrome.storage.local.remove(DEV_LOGS_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === "getVersion") {
    sendResponse({ version: EXT_VERSION });
    return true;
  }

  if (msg.action === "getPopupBootstrap") {
    getPopupBootstrap()
      .then(data => sendResponse(data))
      .catch(err => {
        console.error("[BG] getPopupBootstrap error:", err);
        sendResponse({ error: String(err?.message || err) });
      });
    return true;
  }

  if (msg.action === "fillAllFrames") {
    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ error: "no_tab", filled: 0, success: false });
      return true;
    }
    fillTabAllFrames(tabId, msg.mode || "all")
      .then(data => sendResponse(data))
      .catch(err => {
        console.error("[BG] fillAllFrames error:", err);
        sendResponse({ error: String(err?.message || err), filled: 0, success: false });
      });
    return true;
  }

  if (msg.action === "getAllData") {
    (async () => {
      try {
        const country = await getSelectedCountry();
        const currency = await getSelectedCurrency();
        const [addr, card, pinned, iban] = await Promise.all([
          getCachedAddress(country), getCachedCard(), getPinnedAddress(), getOrCreateIban()
        ]);
        const address = await mergeAddressEmail(addr);
        const d = await chrome.storage.local.get([DEV_MODE_KEY, SOUND_MUTED_KEY]);
        sendResponse({
          address,
          card,
          iban,
          country,
          currency,
          devMode: !!d[DEV_MODE_KEY],
          soundMuted: !!d[SOUND_MUTED_KEY],
          pinned: !!(pinned && pinned.pinnedCountry === country)
        });
      } catch (err) {
        console.error("[BG] getAllData error:", err);
        sendResponse({ error: String(err?.message || err) });
      }
    })();
    return true;
  }
});

function mergeFillResults(results) {
  const valid = results.filter(r => r && !r.error && typeof r.filled === "number");
  if (!valid.length) {
    return { filled: 0, success: false, message: "Ошибка заполнения", report: [] };
  }
  const best = valid.reduce((a, b) => ((b.filled || 0) > (a.filled || 0) ? b : a));
  const filled = valid.reduce((sum, r) => sum + (r.filled || 0), 0);
  return {
    ...best,
    filled,
    message: filled > 0 ? `Заполнено ${filled}` : (best.message || "Нечего заполнять"),
    success: filled > 0 || !!best.success
  };
}

async function getFillPayload() {
  const country = await getSelectedCountry();
  const currency = await getSelectedCurrency();
  const [addr, card, pinned, iban] = await Promise.all([
    getCachedAddress(country),
    getCachedCard(),
    getPinnedAddress(),
    getOrCreateIban()
  ]);
  const address = await mergeAddressEmail(addr);
  const d = await chrome.storage.local.get([DEV_MODE_KEY, SOUND_MUTED_KEY]);
  return {
    address,
    card,
    iban,
    country,
    currency,
    devMode: !!d[DEV_MODE_KEY],
    soundMuted: !!d[SOUND_MUTED_KEY],
    pinned: !!(pinned && pinned.pinnedCountry === country)
  };
}

function scriptTarget(tabId, frameIds = null) {
  return Array.isArray(frameIds) && frameIds.length
    ? { tabId, frameIds }
    : { tabId, allFrames: true };
}

async function resetFillScriptGuards(tabId, frameIds = null) {
  try {
    await chrome.scripting.executeScript({
      target: scriptTarget(tabId, frameIds),
      func: () => {
        try { delete globalThis.__US_AUTOFILL_V2_READY__; } catch (_) {}
        try { document.documentElement?.removeAttribute("data-us-autofill-active"); } catch (_) {}
      }
    });
  } catch (err) {
    await addDevLog("warn", "Не удалось сбросить guard content script", String(err?.message || err));
  }
}

async function ensureFillScripts(tabId, frameIds = null) {
  await resetFillScriptGuards(tabId, frameIds);

  try {
    await chrome.scripting.insertCSS({
      target: scriptTarget(tabId, frameIds),
      files: ["content.css"]
    });
  } catch (err) {
    await addDevLog("warn", "Не удалось вставить CSS перед заполнением", String(err?.message || err));
  }

  try {
    await chrome.scripting.executeScript({
      target: scriptTarget(tabId, frameIds),
      files: ["content.js"]
    });
    return true;
  } catch (err) {
    await addDevLog("warn", "Не удалось вставить content.js перед заполнением", String(err?.message || err));
    return false;
  }
}

async function sendFillToFrame(tabId, frameId, mode, fillData, retries = 1) {
  for (let i = 0; i < retries; i++) {
    const res = await new Promise(resolve => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "fillNow", mode, fillData },
        { frameId },
        response => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response ?? null);
        }
      );
    });
    if (res) return res;
    if (i < retries - 1) await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

function isRelevantFillFrame(f) {
  const h = `${f.host} ${f.href}`;
  if (f.frameId === 0) return true;
  if (/embedded-checkout|js\.stripe\.com|elements\.stripe|stripe/.test(h)) return true;
  return false;
}

async function fillTabAllFrames(tabId, mode = "all") {
  await addDevLog("info", "Запуск ручного заполнения", { tabId, mode });

  const fillData = await getFillPayload();
  let main = await sendFillToFrame(tabId, 0, mode, fillData, 1);
  if (!main) {
    await addDevLog("warn", "Основной фрейм не ответил, выполняю доинжект content script", { tabId, mode });
    await ensureFillScripts(tabId);
    main = await sendFillToFrame(tabId, 0, mode, fillData, 2);
  }
  if (main?.filled > 0) {
    await addDevLog("info", "Основной фрейм заполнил поля, проверяю iframe", { filled: main.filled, success: main.success });
  } else if (main) {
    await addDevLog("info", "Основной фрейм не заполнил поля, проверяю iframe", { filled: main.filled || 0, success: main.success });
  }

  let iframeFrames = [];
  try {
    const hosts = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({ host: location.hostname, href: location.href })
    });
    if (hosts.length) {
      iframeFrames = hosts
        .map(p => ({ frameId: p.frameId, host: p.result?.host || "", href: p.result?.href || "" }))
        .filter(f => f.frameId !== 0 && isRelevantFillFrame(f));
    }
  } catch (_) {}

  if (!iframeFrames.length) {
    await addDevLog("warn", "Нет доступных iframe для дополнительного заполнения", { main });
    return main || { filled: 0, success: false, message: "Ошибка заполнения", report: [] };
  }

  await addDevLog("info", "Найдены iframe для заполнения", iframeFrames.map(f => `${f.frameId}:${f.host}`).join(", "));

  const frameScore = f => {
    const h = `${f.host} ${f.href}`;
    if (/embedded-checkout-inner|embedded-checkout/.test(h)) return 0;
    if (f.host === "js.stripe.com") return 1;
    if (/stripe/.test(h)) return 2;
    return 3;
  };
  iframeFrames.sort((a, b) => frameScore(a) - frameScore(b));

  let extras = await Promise.all(
    iframeFrames.map(({ frameId }) => sendFillToFrame(tabId, frameId, mode, fillData, 1))
  );

  if (!extras.some(Boolean)) {
    const frameIds = iframeFrames.map(f => f.frameId);
    await addDevLog("warn", "iframe не ответили, выполняю доинжект в iframe", frameIds.join(", "));
    await ensureFillScripts(tabId, frameIds);
    extras = await Promise.all(
      iframeFrames.map(({ frameId }) => sendFillToFrame(tabId, frameId, mode, fillData, 2))
    );
  }

  const merged = mergeFillResults([main, ...extras].filter(Boolean));
  await addDevLog("info", "Итог заполнения", { filled: merged.filled, success: merged.success, message: merged.message });
  return merged;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await fillTabAllFrames(tab.id, "all");
  } catch (err) {
    console.error("[BG] fill-page error:", err);
  }
});
