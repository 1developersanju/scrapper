chrome.action.onClicked.addListener((tab) => {
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html") + "?tabId=" + tab.id, // Pass tabId as a query parameter
    type: "popup",
    width: 400,
    height: 600
  });
}); 