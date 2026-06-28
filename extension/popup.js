const hostEl = document.getElementById("host");
const tagEl = document.getElementById("tag");
const ctxEl = document.getElementById("ctx");
const muteBtn = document.getElementById("mute");
const openBtn = document.getElementById("open");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function hostnameFrom(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

async function refresh() {
  const tab = await getActiveTab();
  const host = tab?.url ? hostnameFrom(tab.url) : null;

  // Always open in a new tab so the full app + AI work normally
  openBtn.href = "https://askpausa.com/?utm_source=ext";

  if (!host || host.startsWith("chrome") || host === "newtab") {
    ctxEl.hidden = true;
    muteBtn.hidden = true;
    return;
  }
  ctxEl.hidden = false;
  hostEl.textContent = host;

  // Show "Shopping" tag if the badge is currently lit (means content script flagged it)
  try {
    const badge = await chrome.action.getBadgeText({ tabId: tab.id });
    tagEl.hidden = !badge;
  } catch {
    tagEl.hidden = true;
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
