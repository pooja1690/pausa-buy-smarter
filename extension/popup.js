const sourcePill = document.getElementById("sourcePill");
const sourceHost = document.getElementById("sourceHost");
const muteBtn = document.getElementById("mute");
const openBtn = document.getElementById("open");
const itemEl = document.getElementById("item");
const priceEl = document.getElementById("price");
const detectedEl = document.getElementById("detected");
const formView = document.getElementById("formView");
const verdictView = document.getElementById("verdictView");
const vItem = document.getElementById("vItem");
const vBack = document.getElementById("vBack");
const vDeep = document.getElementById("vDeep");

const APP_URL = "https://askpausa.com/";

let fullItemTitle = "";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function hostnameFrom(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function prettyHost(host) {
  if (!host) return "";
  const h = host.replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return parts[0];
  // amazon.co.uk → amazon
  return parts[0];
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getCachedProduct(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "pausa:get-product", tabId }, (resp) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(resp || null);
      });
    } catch { resolve(null); }
  });
}

function extractInPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const metaContent = (sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      const v = el?.getAttribute("content");
      if (v && v.trim()) return clean(v);
    }
    return "";
  };
  const parsePriceNumber = (raw) => {
    if (raw == null) return null;
    const s = String(raw).replace(/\s/g, "");
    const m = s.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    let n = m[1];
    const lc = n.lastIndexOf(","), ld = n.lastIndexOf(".");
    if (lc > ld) n = n.replace(/\./g, "").replace(",", ".");
    else n = n.replace(/,/g, "");
    const num = parseFloat(n);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const findProductNode = (node) => {
    if (!node || typeof node !== "object") return null;
    const t = node["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
    if (node["@graph"]) for (const g of node["@graph"]) { const f = findProductNode(g); if (f) return f; }
    return null;
  };
  const readJsonLdProduct = () => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || "null");
        const arr = Array.isArray(data) ? data : [data];
        for (const node of arr) { const f = findProductNode(node); if (f) return f; }
      } catch { /* ignore */ }
    }
    return null;
  };
  let title = metaContent([
    'meta[property="og:title"]','meta[name="og:title"]',
    'meta[name="twitter:title"]','meta[itemprop="name"]',
  ]);
  const ld = readJsonLdProduct();
  if (!title && ld?.name) title = clean(ld.name);
  if (!title) {
    for (const s of ["#productTitle","h1#title",'h1[itemprop="name"]',
      "h1.product-title","h1.product__title","h1.product-name",".product-title h1","h1"]) {
      const el = document.querySelector(s);
      const t = clean(el?.textContent);
      if (t && t.length > 2 && t.length < 200) { title = t; break; }
    }
  }
  if (!title) title = clean(document.title).slice(0, 160);

  let price = null;
  if (ld?.offers) {
    const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
    for (const o of offers) { const p = parsePriceNumber(o.price ?? o.lowPrice ?? o.highPrice); if (p) { price = p; break; } }
  }
  if (price == null) {
    const meta = metaContent([
      'meta[property="product:price:amount"]','meta[property="og:price:amount"]',
      'meta[itemprop="price"]','meta[name="twitter:data1"]',
    ]);
    price = parsePriceNumber(meta);
  }
  if (price == null) {
    for (const s of ['[itemprop="price"]','[data-testid*="price" i]',
      '.a-price .a-offscreen','#priceblock_ourprice','#priceblock_dealprice',
      '.price .price__current','.price-current','.product-price','.price']) {
      const el = document.querySelector(s);
      if (!el) continue;
      const raw = el.getAttribute("content") || el.getAttribute("data-price") || el.textContent;
      const p = parsePriceNumber(raw);
      if (p) { price = p; break; }
    }
  }
  return { title, price, url: location.href };
}

async function getProduct(tab) {
  const cached = await getCachedProduct(tab.id);
  if (cached?.title) return cached;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractInPage,
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

/* ---------- Fast-lane classifier (mirrors web app heuristic) ---------- */
function localClassify(input, priceNum) {
  const t = (input || "").trim();
  if (t.length < 3) return "uncertain";
  const lower = t.toLowerCase();

  const luxuryHints = ["luxury","premium","designer","imported","gift set","dyson","fancy","artisan","limited edition","clinique","la mer","chanel","dior","gucci","prada","kiehl","drunk elephant","sk-ii"];
  if (luxuryHints.some((h) => lower.includes(h))) return "discretionary";

  // Budget / drugstore brands that signal routine restock when price is modest
  const budgetBrands = ["aveeno","dove","suave","pantene","head & shoulders","head and shoulders","herbal essences","tresemme","garnier","cerave","cetaphil","neutrogena","colgate","crest","oral-b","oral b","gillette","bic","scott","charmin","cottonelle","bounty","tide","gain","persil","arm & hammer","seventh generation","huggies","pampers"];
  const isBudgetBrand = budgetBrands.some((b) => lower.includes(b));

  const routine = [
    { kw: "toothpaste", cap: 15 },
    { kw: "toothbrush", cap: 20 },
    { kw: "toilet paper", cap: 40 },
    { kw: "paper towel", cap: 30 },
    { kw: "dish soap", cap: 15 },
    { kw: "dishwashing", cap: 20 },
    { kw: "dishwasher detergent", cap: 25 },
    { kw: "laundry detergent", cap: 35 },
    { kw: "diapers", cap: 60 },
    { kw: "baby wipes", cap: 30 },
    { kw: "milk", cap: 15 },
    { kw: "bread", cap: 10 },
    { kw: "eggs", cap: 15 },
    { kw: "first aid", cap: 30 },
    { kw: "band-aid", cap: 15 },
    { kw: "bandaid", cap: 15 },
    { kw: "tylenol", cap: 20 },
    { kw: "advil", cap: 20 },
    { kw: "ibuprofen", cap: 20 },
    { kw: "school supplies", cap: 50 },
    // ambiguous categories — only fast-lane when paired with a budget brand
    { kw: "shampoo", cap: 25, requiresBudget: true },
    { kw: "conditioner", cap: 25, requiresBudget: true },
    { kw: "body wash", cap: 20, requiresBudget: true },
    { kw: "soap", cap: 15, requiresBudget: true },
    { kw: "deodorant", cap: 20, requiresBudget: true },
    { kw: "razor", cap: 25, requiresBudget: true },
    { kw: "moisturizer", cap: 20, requiresBudget: true },
    { kw: "lotion", cap: 20, requiresBudget: true },
    { kw: "face wash", cap: 20, requiresBudget: true },
  ];
  const matched = routine.find((r) => lower.includes(r.kw));
  if (matched) {
    if (matched.requiresBudget && !isBudgetBrand) return "uncertain";
    if (priceNum != null && priceNum > matched.cap) return "discretionary";
    return "routine_essential";
  }
  if (/^basic\s+/.test(lower) && (priceNum == null || priceNum <= 25)) return "routine_essential";
  return "uncertain";
}

function setSource(host) {
  if (!host) { sourcePill.hidden = true; return; }
  sourcePill.hidden = false;
  sourceHost.textContent = host.replace(/^www\./, "");
}

function setItem(title) {
  fullItemTitle = title || "";
  itemEl.value = fullItemTitle;
  itemEl.title = fullItemTitle;
  detectedEl.hidden = !fullItemTitle;
}

function buildOpenUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("utm_source", "ext");
  const item = itemEl.value.trim();
  const price = priceEl.value.trim();
  if (item) {
    url.searchParams.set("item", item);
    url.searchParams.set("autostart", "1");
  }
  if (price) url.searchParams.set("price", price);
  return url.toString();
}

function showVerdict(title) {
  vItem.textContent = title;
  formView.hidden = true;
  verdictView.hidden = false;
}

function showForm() {
  verdictView.hidden = true;
  formView.hidden = false;
}

openBtn.addEventListener("click", async () => {
  const item = itemEl.value.trim();
  const priceRaw = priceEl.value.trim();
  const priceNum = priceRaw ? parseFloat(priceRaw) : undefined;
  const label = localClassify(item, priceNum);
  if (label === "routine_essential") {
    showVerdict(item);
    return;
  }
  await chrome.tabs.create({ url: buildOpenUrl() });
  window.close();
});

vBack.addEventListener("click", showForm);
vDeep.addEventListener("click", async () => {
  await chrome.tabs.create({ url: buildOpenUrl() });
  window.close();
});

async function refresh() {
  const tab = await getActiveTab();
  const host = tab?.url ? hostnameFrom(tab.url) : null;

  if (!host || host.startsWith("chrome") || host === "newtab") {
    sourcePill.hidden = true;
    muteBtn.hidden = true;
    return;
  }
  setSource(host);

  const product = await getProduct(tab);
  if (product?.title && !itemEl.value) setItem(product.title.slice(0, 200));
  if (product?.price != null && !priceEl.value) priceEl.value = String(product.price);

  const { mutedSites = {} } = await chrome.storage.local.get("mutedSites");
  const muted = !!mutedSites[host];
  const pretty = titleCase(prettyHost(host));
  muteBtn.hidden = false;
  muteBtn.textContent = muted
    ? `Show on ${pretty} again`
    : `Don't show on ${pretty}`;
  muteBtn.classList.toggle("active", muted);

  muteBtn.onclick = async () => {
    const next = { ...mutedSites };
    if (muted) delete next[host];
    else next[host] = true;
    await chrome.storage.local.set({ mutedSites: next });
    if (!muted && tab?.id != null) {
      try { await chrome.action.setBadgeText({ tabId: tab.id, text: "" }); } catch {}
    }
    refresh();
  };
}

refresh();
