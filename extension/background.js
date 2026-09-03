// background.js - Automation Bridge Background Service Worker
console.log("[Auto Browser Extension] Background service worker started.");

let automationTabId = null;

// Track when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get(["automationTabId"]);
  const activeTabId = data.automationTabId || automationTabId;

  if (tabId === activeTabId) {
    console.log("[Auto Browser Extension] Automation tab was closed by user.");
    automationTabId = null;
    chrome.storage.local.set({ automationTabId: null, targetUrl: null }).catch(() => {});
    
    // Notify all content scripts that the tab was closed
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && !tab.url.includes("tenderboard.gov.om") && !tab.url.includes("mock-portal.html")) {
          chrome.tabs.sendMessage(tab.id, { event: "tabClosed", data: { tabId } }).catch(() => {});
        }
      }
    });
  }
});

// Listen for messages from content scripts
let reactTabId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, args } = request;
  
  // Dynamically identify the React App tab (any sender tab that isn't the target portal or sandbox)
  if (sender.tab && !sender.tab.url.includes("tenderboard.gov.om") && !sender.tab.url.includes("mock-portal.html")) {
    reactTabId = sender.tab.id;
    chrome.storage.local.set({ reactTabId }).catch(() => {});
  }
  
  handleAction(action, args, sender)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));
    
  return true; // Keep message channel open for async response
});

async function handleAction(action, args, sender) {
  // Restore automationTabId from storage if service worker was inactive/restarted
  if (automationTabId === null) {
    try {
      const data = await chrome.storage.local.get(["automationTabId"]);
      if (data.automationTabId) {
        automationTabId = data.automationTabId;
        console.log("[Auto Browser Extension] Restored automationTabId from storage:", automationTabId);
      }
    } catch (e) {
      console.warn("[Auto Browser Extension] Failed to restore tab ID from storage:", e);
    }
  }

  // Restore reactTabId from storage if service worker was inactive/restarted
  if (reactTabId === null) {
    try {
      const data = await chrome.storage.local.get(["reactTabId"]);
      if (data.reactTabId) {
        reactTabId = data.reactTabId;
        console.log("[Auto Browser Extension] Restored reactTabId from storage:", reactTabId);
      }
    } catch (e) {
      console.warn("[Auto Browser Extension] Failed to restore reactTabId from storage:", e);
    }
  }

  switch (action) {
    case "connect":
      return await connectToPortal(args);
      
    case "getStatus":
      return await getStatus();
      
    case "executeScript":
      return await executeScriptInTab(args);

    case "saveBoqData":
      await chrome.storage.local.set({
        boqData: args.boqData,
        currentPage: args.currentPage,
        totalPages: args.totalPages,
        globalFields: args.globalFields,
        domainName: args.domainName,
        apiBase: args.apiBase
      });
      return { success: true };

    case "saveAiSettings":
      await chrome.storage.local.set({ aiSettings: args.aiSettings });
      return { success: true };

    case "saveBlueprint":
      await chrome.storage.local.set({ blueprint: args.blueprint });
      return { success: true };

    case "reportProgress":
      if (reactTabId) {
        chrome.tabs.sendMessage(reactTabId, { event: "progress", data: args }).catch(() => {});
      }
      return { success: true };

    case "lensVisualMatch":
      return await handleLensVisualMatch(args);
      
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

async function handleLensVisualMatch(args) {
  const { imageUrl, itemId, description } = args || {};
  if (!imageUrl) return { success: false, error: "Missing image URL for Google Lens search" };

  const targetUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
  console.log(`[Auto Browser Extension] Launching Google Lens visual match for: ${imageUrl}`);

  let winId = null;
  let tabId = null;
  try {
    // Open in a minimized popup window — never flashes in the user's face
    const win = await chrome.windows.create({
      url: targetUrl,
      type: 'popup',
      state: 'minimized',
      width: 1,
      height: 1,
      left: -2000,  // off-screen extra safety
      top: -2000
    });
    winId = win.id;
    tabId = win.tabs?.[0]?.id;

    if (!tabId) throw new Error("Failed to get tab ID from minimized window");

    // Wait for page to fully load
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 9000);
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          setTimeout(resolve, 2500); // Allow Lens visual cards to render
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Extract visual matches from the Google Lens DOM
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const cards = [];
          const seen = new Set();

          // Collect search result links
          const links = Array.from(document.querySelectorAll('a[href^="http"]'));
          for (const a of links) {
            const href = a.href;
            if (!href || href.includes('google.com') || href.includes('gstatic.com') || seen.has(href)) continue;

            const text = (a.innerText || a.textContent || '').trim();
            if (text.length < 4 || /^(privacy|terms|feedback|about|sign in|google)/i.test(text)) continue;

            const img = a.querySelector('img') || a.closest('div')?.querySelector('img');
            const imgSrc = img?.src || '';

            seen.add(href);
            const firstLine = text.split('\n')[0].trim();
            cards.push({
              title: firstLine,
              url: href,
              imageUrl: imgSrc,
              source: new URL(href).hostname.replace(/^www\./i, '')
            });

            if (cards.length >= 6) break;
          }

          return { success: true, cards };
        } catch (e) {
          return { success: false, error: e.message, cards: [] };
        }
      }
    });

    // Close the minimized window silently
    if (winId) {
      await chrome.windows.remove(winId).catch(() => {});
    }

    const scriptResult = results[0]?.result;
    const cards = scriptResult?.cards || [];

    console.log(`[Auto Browser Extension] Google Lens extracted ${cards.length} visual matches.`);

    return {
      success: true,
      result: {
        itemId,
        visualMatches: cards,
        source: 'Google Lens (1:1 Exact Visual Match)',
        topMatch: cards[0] || null
      }
    };
  } catch (err) {
    if (winId) {
      await chrome.windows.remove(winId).catch(() => {});
    }
    console.error('[Auto Browser Extension] Google Lens automation error:', err.message);
    return { success: false, error: err.message };
  }
}

async function connectToPortal(args) {
  const targetUrl = args?.url || "https://etendering.tenderboard.gov.om/product/publicDash?CTRL_STRDIRECTION=LTR";
  
  if (automationTabId) {
    try {
      const tab = await chrome.tabs.get(automationTabId);
      await chrome.tabs.update(automationTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      
      if (args?.forceNavigate) {
        await chrome.tabs.update(automationTabId, { url: targetUrl });
      }
      await chrome.storage.local.set({ automationTabId, targetUrl });
      return { success: true, result: { tabId: automationTabId, status: "reconnected" } };
    } catch (err) {
      automationTabId = null;
      await chrome.storage.local.set({ automationTabId: null, targetUrl: null });
    }
  }
  
  const tab = await chrome.tabs.create({ url: targetUrl });
  automationTabId = tab.id;
  await chrome.storage.local.set({ automationTabId, targetUrl });
  return { success: true, result: { tabId: tab.id, status: "connected" } };
}

async function getStatus() {
  if (!automationTabId) {
    return { success: true, result: { connected: false } };
  }
  
  try {
    const tab = await chrome.tabs.get(automationTabId);
    return { 
      success: true, 
      result: { 
        connected: true, 
        tabId: automationTabId, 
        url: tab.url, 
        title: tab.title,
        status: tab.status
      } 
    };
  } catch (err) {
    automationTabId = null;
    return { success: true, result: { connected: false } };
  }
}

async function executeScriptInTab(args) {
  if (!automationTabId) {
    return { success: false, error: "No active browser session connected. Click 'Connect Browser' first." };
  }
  
  if (!args || !args.code) {
    return { success: false, error: "No script code provided to execute." };
  }
  
  try {
    // Ensure the tab still exists
    await chrome.tabs.get(automationTabId);
    
    // Execute the script on the target tab
    const results = await chrome.scripting.executeScript({
      target: { tabId: automationTabId },
      world: "MAIN", // Execute in page context so we can interact with DOM and JS variables/APIs
      func: async (codeString) => {
        try {
          // Wrap in an async function to support await in custom scripts
          const asyncEval = new Function(`return (async () => { ${codeString} })()`);
          const res = await asyncEval();
          
          // Ensure result is JSON-serializable
          if (res === undefined) return null;
          return res;
        } catch (err) {
          return { __isError: true, name: err.name, message: err.message, stack: err.stack };
        }
      },
      args: [args.code]
    });
    
    const executionResult = results[0]?.result;
    
    if (executionResult && executionResult.__isError) {
      return { 
        success: false, 
        error: `${executionResult.name}: ${executionResult.message}`,
        details: executionResult.stack 
      };
    }
    
    return { success: true, result: executionResult };
  } catch (err) {
    return { success: false, error: `Script execution failed: ${err.message}` };
  }
}
