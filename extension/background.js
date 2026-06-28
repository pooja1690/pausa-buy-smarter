// Manages the subtle toolbar badge. No popups, no page injection.

const BADGE_COLOR = "#55614b";

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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || msg?.type !== "pausa:shopping-context") return;
  const url = new URL(sender.tab.url || "about:blank");
  isMuted(url.hostname).then((muted) => {
    setBadge(sender.tab.id, !!msg.shopping && !muted);
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Reset badge on tab switch; content script will re-signal if applicable.
  await setBadge(tabId, false);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "loading") {
    await setBadge(tabId, false);
  }
});
