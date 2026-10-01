// Clicking the JevX button opens the side panel; the panel does the work.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.runtime.openOptionsPage(); // first install: ask for the Gemini key
});
chrome.runtime.onStartup.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}));

// a small orange dot on the button when the tab is a GitHub repo
const isRepo = (url) => /^https:\/\/github\.com\/[^/]+\/[^/#?]+/.test(url ?? "") && !/^https:\/\/github\.com\/(settings|orgs|marketplace|explore|topics|notifications|pulls|issues|search|new)\b/.test(url);
const mark = (tabId, url) => {
  chrome.action.setBadgeText({ tabId, text: isRepo(url) ? "•" : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d9784f" });
};
chrome.tabs.onUpdated.addListener((tabId, info, tab) => info.url && mark(tabId, tab.url));
chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId, (t) => mark(tabId, t?.url)));
