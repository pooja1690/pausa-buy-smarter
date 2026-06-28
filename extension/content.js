// Detects shopping context passively. Does NOT modify the page.
// Only sends a single message to the background script.

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

  // Generic signal: a "Buy now" / "Add to cart" / "Checkout" button somewhere.
  let buttonMatch = false;
  try {
    const text = document.body?.innerText?.toLowerCase() || "";
    buttonMatch =
      /\b(add to cart|add to bag|buy now|proceed to checkout|place order)\b/.test(text);
  } catch {
    /* ignore */
  }

  const shopping = hostMatch || pathMatch || buttonMatch;
  chrome.runtime.sendMessage({ type: "pausa:shopping-context", shopping });
})();
