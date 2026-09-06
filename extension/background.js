// background.js - Automation Bridge Background Service Worker
const EXT_VERSION = '1.2.8'; // must match manifest.json — bump together
console.log(`[Auto Browser Extension] Background service worker started (v${EXT_VERSION}).`);

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
  const { imageUrl, itemId, description, brand, model } = args || {};
  if (!imageUrl) return { success: false, error: "Missing image URL for Google Lens search" };

  // Text anchor: exact specified brand + model focuses Lens beyond pure pixels.
  // Plus generic product-type nouns mined from the spec description, so Lens
  // gets maker + model + type ("Moonako Lobby bench") instead of maker alone.
  // Pure English vocabulary — no brand data, works for any item.
  const TYPE_NOUNS = ['bench','benches','chair','chairs','armchair','sofa','couch','table','tables','desk','desks','stool','stools','ottoman','pouf','lamp','lamps','pendant','chandelier','sconce','shelf','shelves','shelving','bookcase','cabinet','cabinets','cupboard','wardrobe','drawer','drawers','bed','beds','headboard','mirror','mirrors','rug','carpet','curtain','curtains','workstation','counter','sideboard','credenza','lounge','daybed','seat','seats','seating','theatre','theater','auditorium','recliner','chaise'];
  const singularOf = (hit) => {
    if (hit.endsWith('es') && TYPE_NOUNS.includes(hit.slice(0, -2))) return hit.slice(0, -2);
    if (hit.endsWith('s') && TYPE_NOUNS.includes(hit.slice(0, -1))) return hit.slice(0, -1);
    return hit;
  };
  const mineTypeNouns = (text) => {
    const found = [];
    for (const w of String(text || '').toLowerCase().split(/[^a-z]+/)) {
      let hit = TYPE_NOUNS.includes(w) ? w : null;
      if (!hit && w.endsWith('s') && w.length > 4) {
        const b = w.slice(0, -1);
        if (TYPE_NOUNS.includes(b)) hit = b;
      }
      hit = hit ? singularOf(hit) : null;
      if (hit && !found.includes(hit)) found.push(hit);
      if (found.length >= 2) break;
    }
    return found;
  };
  // Category leads, maker + model follow ("theatre seat Figueras Scala"):
  // Lens weighs early words most, and BOQ codes ("LF-019") actively confuse
  // it, so codes never enter the query — only maker, model, type nouns.
  // Maker hostname trial: when the spec text carries a URL on the maker's own
  // domain (host contains the brand), append the host to the typed query —
  // Google weighs it as a domain signal. Dealer/marketplace URLs are skipped
  // (they would steer to dealers), as is the raw "https://…" string, whose
  // https/www/com tokens only dilute the query.
  const makerHostOf = (text, brandName) => {
    const bt = String(brandName || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)[0] || '';
    if (!bt) return '';
    const urls = String(text || '').match(/https?:\/\/[^\s"'<>|]+/gi) || [];
    for (const u of urls) {
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        if (/amazon|noon|ebay|alibaba|aliexpress/i.test(host)) continue;
        if (host.replace(/[^a-z0-9]/g, '').includes(bt.replace(/[^a-z0-9]/g, ''))) return host;
      } catch { /* malformed URL — ignore */ }
    }
    return '';
  };
  const textQuery = [...mineTypeNouns(description), brand, model, makerHostOf(description, brand)].filter((s) => s && String(s).trim().length > 1).join(' ').trim();

  const targetUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
  console.log(`[Auto Browser Extension] Launching Google Lens visual match for: ${imageUrl}${textQuery ? ` (anchor: "${textQuery}")` : ''}`);

  let tabId = null;
  // MV3 keep-alive: the run below sleeps ~16s across waits, and Chrome kills
  // an idle service worker mid-sleep — the page then gets exactly
  // "message channel closed before a response was received". A storage write
  // every 15s resets the idle timer until the run finishes.
  const keepAlive = setInterval(() => {
    try { chrome.storage.local.set({ _lensAlive: Date.now() }).catch(() => {}); } catch (_) { /* worker going away */ }
  }, 15000);
  try {
    // Silent background tab (inactive): no window bounds involved, no flash,
    // no popup-blocker conflict. Off-screen popup windows are rejected by
    // Chrome ("Bounds must be at least 50% within visible screen space").
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });
    tabId = tab?.id;

    if (!tabId) throw new Error("Lens background tab could not be opened (popup blocked?)");

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

    // ── Text-anchor: type exact brand + model into Lens's search box so results
    // are image-anchored AND text-anchored. Best-effort: any failure falls back
    // to the pure-visual scrape below.
    let textAnchored = false;
    if (textQuery) {
      try {
        const anchorResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: (query) => {
            try {
              const selectors = ['textarea[name="q"]', 'input[name="q"]', 'textarea[aria-label*="earch"]', 'input[aria-label*="earch"]'];
              let box = null;
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) { box = el; break; }
              }
              if (!box) return { anchored: false, reason: 'no-search-box' };
              box.focus();
              try { document.execCommand('selectAll', false, null); } catch (e) {}
              try { document.execCommand('insertText', false, query); } catch (e) { box.value = query; }
              box.dispatchEvent(new Event('input', { bubbles: true }));
              box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              return { anchored: true };
            } catch (e) {
              return { anchored: false, reason: e.message };
            }
          },
          args: [textQuery]
        });
        textAnchored = anchorResults[0]?.result?.anchored === true;
        console.log(`[Auto Browser Extension] Lens text anchor "${textQuery}": ${textAnchored ? 'applied' : 'unavailable (' + (anchorResults[0]?.result?.reason || 'unknown') + '), visual-only'}`);
        if (textAnchored) {
          await new Promise((r) => setTimeout(r, 4000)); // let text-refined results render
        }
      } catch (anchorErr) {
        console.warn('[Auto Browser Extension] Lens text anchor failed, continuing visual-only:', anchorErr.message);
      }
    }

    // Extract visual matches from the Google Lens DOM (double pass: Lens is an
    // SPA and merchant tiles render late — scrape, wait, scrape, merge).
    const scrapeOnce = () => chrome.scripting.executeScript({
      target: { tabId },
      func: (query) => {
        try {
          const cards = [];
          const seen = new Set();
          const toks = String(query || '').toLowerCase().split(/[\s&/]+/).filter((t) => t.length > 2);

          // Collect search result links
          const links = Array.from(document.querySelectorAll('a[href]'));
          const NOISE = /(facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|twitter\.com|x\.com)(\/|$)/i;
          const unwrap = (href) => {
            // Google wraps merchant links as /url?q=<real-url> — the old code
            // saw "google.com" and threw the maker away. Unwrap first.
            try {
              const u = new URL(href, location.origin);
              if ((u.hostname.includes('google.') || u.hostname.includes('googleusercontent.')) && u.pathname === '/url') {
                const real = u.searchParams.get('q') || u.searchParams.get('url');
                if (real && /^https?:\/\//i.test(real)) return real;
                return null; // pure-google redirect with no target — skip
              }
              return href;
            } catch { return href; }
          };
          for (const a of links) {
            const raw = a.getAttribute('href') || '';
            if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
            const href = unwrap(a.href);
            if (!href || href.includes('google.com') || href.includes('gstatic.com') || seen.has(href)) continue;
            if (NOISE.test(href)) continue; // social junk never names the maker

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
              source: (() => { try { return new URL(href).hostname.replace(/^www\./i, ''); } catch { return ''; } })()
            });

            if (cards.length >= 12) break;
          }

          // Mentioned-keyword boost in-page: maker/model hits float above the
          // 8-card cut so the modal sort actually receives them.
          const hitCount = (c) => {
            const hay = `${c.title} ${c.url} ${c.source}`.toLowerCase();
            return toks.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
          };
          cards.sort((a, b) => hitCount(b) - hitCount(a));
          return { success: true, cards: cards.slice(0, 8) };
        } catch (e) {
          return { success: false, error: e.message, cards: [] };
        }
      },
      args: [textQuery]
    });
    const first = await scrapeOnce();
    await new Promise((r) => setTimeout(r, 3000)); // late SPA tiles
    const second = await scrapeOnce();
    const merged = new Map();
    for (const run of [first, second]) {
      for (const c of (run[0]?.result?.cards || [])) {
        if (!merged.has(c.url)) merged.set(c.url, c);
      }
    }
    const results = [{ result: { success: true, cards: [...merged.values()].slice(0, 8) } }];

    // Close the background tab silently
    if (tabId) {
      await chrome.tabs.remove(tabId).catch(() => {});
    }

    const scriptResult = results[0]?.result;
    const cards = scriptResult?.cards || [];

    console.log(`[Auto Browser Extension] Google Lens extracted ${cards.length} visual matches.`);

    clearInterval(keepAlive);
    return {
      success: true,
      result: {
        itemId,
        visualMatches: cards,
        source: 'Google Lens (1:1 Exact Visual Match)',
        topMatch: cards[0] || null,
        textQuery: textQuery || null,
        textAnchored,
        extVersion: EXT_VERSION
      }
    };
  } catch (err) {
    clearInterval(keepAlive);
    if (tabId) {
      await chrome.tabs.remove(tabId).catch(() => {});
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
