const hostEl = document.getElementById("host");
const muteBtn = document.getElementById("mute");

async function getActiveHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return { host: null, tabId: null };
  try {
    return { host: new URL(tab.url).hostname, tabId: tab.id };
  } catch {
    return { host: null, tabId: tab.id };
  }
}

async function refresh() {
  const { host, tabId } = await getActiveHost();
  if (!host) {
    hostEl.textContent = "No site";
    muteBtn.style.display = "none";
    return;
  }
  hostEl.textContent = host;
  const { mutedSites = {} } = await chrome.storage.local.get("mutedSites");
  const muted = !!mutedSites[host];
  muteBtn.textContent = muted ? "Unmute this site" : "Mute this site";
  muteBtn.classList.toggle("muted-tag", muted);

  muteBtn.onclick = async () => {
    const next = { ...mutedSites };
    if (muted) delete next[host];
    else next[host] = true;
    await chrome.storage.local.set({ mutedSites: next });
    // Clear badge immediately if muting
    if (!muted && tabId != null) {
      try {
        await chrome.action.setBadgeText({ tabId, text: "" });
      } catch {
        /* ignore */
      }
    }
    refresh();
  };
}

refresh();
