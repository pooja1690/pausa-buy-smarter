const hostEl = document.getElementById("host");
const tagEl = document.getElementById("tag");
const ctxEl = document.getElementById("ctx");
const muteBtn = document.getElementById("mute");
const openBtn = document.getElementById("open");
const itemEl = document.getElementById("item");
const priceEl = document.getElementById("price");
const detectedEl = document.getElementById("detected");

const APP_URL = "https://askpausa.com/";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function hostnameFrom(url) {
  try { return new URL(url).hostname; } catch { return null; }
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

// Runs in the page context — pure function, no closure deps.
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
  // Try cached (content script may have already run)
  const cached = await getCachedProduct(tab.id);
  if (cached?.title) return cached;
  // Fall back to on-demand extraction
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

function buildOpenUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("utm_source", "ext");
  const item = itemEl.value.trim();
  const price = priceEl.value.trim();
  if (item) url.searchParams.set("item", item);
  if (price) url.searchParams.set("price", price);
  return url.toString();
}

openBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: buildOpenUrl() });
});

async function refresh() {
  const tab = await getActiveTab();
  const host = tab?.url ? hostnameFrom(tab.url) : null;

  if (!host || host.startsWith("chrome") || host === "newtab") {
    ctxEl.hidden = true;
    muteBtn.hidden = true;
    return;
  }
  ctxEl.hidden = false;
  hostEl.textContent = host;

  let isShopping = false;
  try {
    const badge = await chrome.action.getBadgeText({ tabId: tab.id });
    isShopping = !!badge;
    tagEl.hidden = !badge;
  } catch {
    tagEl.hidden = true;
  }

  // Prefill from the page (best-effort)
  const product = await getProduct(tab);
  if (product?.title && !itemEl.value) {
    itemEl.value = product.title.slice(0, 120);
    detectedEl.hidden = false;
  }
  if (product?.price != null && !priceEl.value) {
    priceEl.value = String(product.price);
  }

  const { mutedSites = {} } = await chrome.storage.local.get("mutedSites");
  const muted = !!mutedSites[host];
  muteBtn.hidden = false;
  muteBtn.textContent = muted ? "Unmute this site" : "Mute this site";
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
