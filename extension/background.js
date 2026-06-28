// Manages the subtle toolbar badge + per-tab product context.

const BADGE_COLOR = "#55614b";
const tabProduct = new Map(); // tabId -> { title, price, url }

async function isMuted(hostname) {
  const { mutedSites = {} } = await chrome.storage.local.get("mutedSites");
  return !!mutedSites[hostname];
}

async function setBadge(tabId, on) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    await chrome.action.setBadgeText({ tabId, text: on ? "•" : "" });
  } catch {
    /* tab may have closed */
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "pausa:get-product") {
    sendResponse(tabProduct.get(msg.tabId) || null);
    return true;
  }
  if (!sender.tab || msg?.type !== "pausa:shopping-context") return;
  const tabId = sender.tab.id;
  if (msg.product) {
    tabProduct.set(tabId, msg.product);
  } else {
    tabProduct.delete(tabId);
  }
  const url = new URL(sender.tab.url || "about:blank");
  isMuted(url.hostname).then((muted) => {
    setBadge(tabId, !!msg.shopping && !muted);
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await setBadge(tabId, false);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "loading") {
    tabProduct.delete(tabId);
    await setBadge(tabId, false);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabProduct.delete(tabId);
});
