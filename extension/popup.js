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

function getProduct(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "pausa:get-product", tabId }, (resp) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(resp || null);
      });
    } catch { resolve(null); }
  });
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
  const product = await getProduct(tab.id);
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
