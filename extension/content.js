// content.js - Automation Bridge Content Script
console.log("[Auto Browser Extension] Content script loaded on:", window.location.href);

// Flag that the extension is installed
document.documentElement.setAttribute("data-auto-browser-extension-installed", "true");

// Dispatch event in case the page is already listening
window.dispatchEvent(new CustomEvent("AutoBrowserExtensionReady"));

// Handle messages from the React web app page
window.addEventListener("message", (event) => {
  // Validate sender and source
  if (event.source !== window || !event.data || event.data.source !== "auto-browser-app") {
    return;
  }

  const { requestId, action, args } = event.data;
  console.log("[Auto Browser Extension] Received request from page:", action, args);

  // Send request to background service worker
  chrome.runtime.sendMessage({ action, args }, (response) => {
    // Send response back to the page
    window.postMessage({
      source: "auto-browser-extension",
      requestId,
      success: response?.success !== false,
      result: response?.result,
      error: response?.error
    }, "*");
  });
});

// Also listen for messages from the background service worker (e.g. status updates)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Auto Browser Extension] Received message from background:", message);
  
  // Forward background events to the page
  window.postMessage({
    source: "auto-browser-extension-event",
    event: message.event,
    data: message.data
  }, "*");
  
  sendResponse({ success: true });
});

// Forward progress messages from target page to background service worker
if (window.location.host.includes("tenderboard.gov.om") || window.location.href.includes("mock-portal.html")) {
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.source === "auto-browser-target-page") {
      chrome.runtime.sendMessage({ action: "reportProgress", args: event.data.data });
    }
  });
}

// Dynamically build sandbox table based on active BOQ data stored in extension
window.addEventListener("DOMContentLoaded", () => {
  if (window.location.href.includes("mock-portal.html")) {
    console.log("[Auto Browser Extension] Sandbox page detected. Loading BOQ dataset...");
    chrome.storage.local.get(["boqData"], (data) => {
      if (data.boqData && data.boqData.length > 0) {
        const tbody = document.querySelector("table tbody");
        if (tbody) {
          tbody.innerHTML = "";
          data.boqData.forEach((item, index) => {
            const tr = document.createElement("tr");
            tr.className = "boq-row";
            tr.innerHTML = `
              <td>${item.item_code || (index + 1)}</td>
              <td>${item.description || 'Item Description'}</td>
              <td>${item.quantity || 1}</td>
              <td><input type="text" name="txtUnitRate_${index}" class="rate-input" placeholder="0.000" /></td>
              <td><input type="text" readonly placeholder="0.000" /></td>
            `;
            tbody.appendChild(tr);
          });
          console.log("[Auto Browser Extension] Sandbox table successfully populated with", data.boqData.length, "items.");
        }
      }
    });
  }
});

