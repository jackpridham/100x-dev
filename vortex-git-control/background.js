chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "vortex-open-options") return;
  chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});
