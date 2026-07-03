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
      
    default:
      return { success: false, error: `Unknown action: ${action}` };
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
