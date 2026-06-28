// Passive page-context helper. Does NOT modify the page.
// Detects shopping context and extracts product title + price when possible.

(function () {
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();

  const SHOPPING_HOSTS = [
    "amazon.", "ebay.", "etsy.", "walmart.com", "target.com", "bestbuy.com",
    "shopify.com", "shop.app", "aliexpress.com", "temu.com", "shein.com",
    "wayfair.com", "ikea.com", "costco.com", "homedepot.com", "asos.com",
    "zara.com", "hm.com", "nike.com", "adidas.com", "sephora.com", "ulta.com",
    "newegg.com", "bhphotovideo.com",
  ];

  const SHOPPING_PATHS = [
    "/cart", "/checkout", "/basket", "/bag", "/dp/", "/gp/product",
    "/product/", "/products/", "/buy", "/order",
  ];

  const hostMatch = SHOPPING_HOSTS.some((h) => host.includes(h));
  const pathMatch = SHOPPING_PATHS.some((p) => path.includes(p));

  let buttonMatch = false;
  try {
    const text = document.body?.innerText?.toLowerCase() || "";
    buttonMatch =
      /\b(add to cart|add to bag|buy now|proceed to checkout|place order)\b/.test(text);
  } catch {
    /* ignore */
  }

  const shopping = hostMatch || pathMatch || buttonMatch;

  // ---------- Product extraction (best-effort, non-intrusive) ----------
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function metaContent(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const v = el?.getAttribute("content");
      if (v && v.trim()) return clean(v);
    }
    return "";
  }

  function extractTitle() {
    // 1. OpenGraph / Twitter
    const og = metaContent([
      'meta[property="og:title"]',
      'meta[name="og:title"]',
      'meta[name="twitter:title"]',
      'meta[itemprop="name"]',
    ]);
    if (og) return og;

    // 2. JSON-LD Product
    const ld = readJsonLdProduct();
    if (ld?.name) return clean(ld.name);

    // 3. Common product heading selectors
    const sel = [
      "#productTitle",                // Amazon
      "h1#title",
      'h1[itemprop="name"]',
      "h1.product-title",
      "h1.product__title",
      "h1.product-name",
      ".product-title h1",
      "h1",
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      const t = clean(el?.textContent);
      if (t && t.length > 2 && t.length < 200) return t;
    }
    return clean(document.title).slice(0, 160);
  }

  function parsePriceNumber(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/\s/g, "");
    // Find first number with optional decimal. Handle 1,299.00 / 1.299,00.
    const m = s.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    let n = m[1];
    const lastComma = n.lastIndexOf(",");
    const lastDot = n.lastIndexOf(".");
    if (lastComma > lastDot) {
      // comma is decimal sep
      n = n.replace(/\./g, "").replace(",", ".");
    } else {
      n = n.replace(/,/g, "");
    }
    const num = parseFloat(n);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  function readJsonLdProduct() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || "null");
        const arr = Array.isArray(data) ? data : [data];
        for (const node of arr) {
          const found = findProductNode(node);
          if (found) return found;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function findProductNode(node) {
    if (!node || typeof node !== "object") return null;
    const t = node["@type"];
    const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
    if (isProduct) return node;
    if (node["@graph"]) {
      for (const g of node["@graph"]) {
        const f = findProductNode(g);
        if (f) return f;
      }
    }
    return null;
  }

  function extractPrice() {
    // 1. JSON-LD
    const ld = readJsonLdProduct();
    if (ld?.offers) {
      const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
      for (const o of offers) {
        const p = parsePriceNumber(o.price ?? o.lowPrice ?? o.highPrice);
        if (p) return p;
      }
    }

    // 2. Meta tags
    const meta = metaContent([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[itemprop="price"]',
      'meta[name="twitter:data1"]',
    ]);
    const metaP = parsePriceNumber(meta);
    if (metaP) return metaP;

    // 3. Microdata / common selectors
    const sels = [
      '[itemprop="price"]',
      '[data-testid*="price" i]',
      ".a-price .a-offscreen",            // Amazon
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".price .price__current",
      ".price-current",
      ".product-price",
      ".price",
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const raw = el.getAttribute("content") || el.getAttribute("data-price") || el.textContent;
      const p = parsePriceNumber(raw);
      if (p) return p;
    }
    return null;
  }

  let title = "";
  let price = null;
  try {
    title = extractTitle();
    price = extractPrice();
  } catch {
    /* ignore */
  }

  chrome.runtime.sendMessage({
    type: "pausa:shopping-context",
    shopping,
    product: shopping ? { title, price, url: location.href } : null,
  });
})();
