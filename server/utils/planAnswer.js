/**
 * Plan analysis: reduce whatever a vision model sends back to the one shape the app reads,
 *   { zones: [...], items: [...], planSummary: '...' }.
 *
 * The prompt asks for exactly that object, but models do not always comply: some wrap it in a
 * list (one entry per sheet), some send the list of items alone, some nest it under another key
 * or call the list something else, and now and then one item is written with a syntax slip that
 * makes the whole answer unparseable. Each of those used to be read as "0 items" and the model
 * was dropped, although the items were all there.
 *
 * Pure functions: no network, no database, no AI.
 */

const ITEM_TEXT_KEYS = ['description', 'name', 'item', 'title', 'itemName', 'item_name'];
const ITEM_MARK_KEYS = ['qty', 'quantity', 'unit', 'scope', 'location', 'code', 'dimensions', 'categoryHint', 'category_hint'];
const LIST_KEYS = ['items', 'boqItems', 'boq_items', 'boq', 'lineItems', 'line_items', 'furniture', 'furnitureItems', 'furniture_items', 'schedule', 'rows', 'elements'];
const ZONE_KEYS = ['zones', 'rooms', 'areas', 'spaces'];
const LIST_KEY_RX = new RegExp(`"(?:${LIST_KEYS.join('|')})"\\s*:\\s*\\[`);

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const hasItemText = (v) => isPlainObject(v) && ITEM_TEXT_KEYS.some((k) => typeof v[k] === 'string' && v[k].trim());

/** A BOQ line: it has a text (name or description) and at least one field only a line has. */
export function isPlanItemLike(v) {
  return hasItemText(v) && ITEM_MARK_KEYS.some((k) => v[k] !== undefined && v[k] !== null && v[k] !== '');
}

/** The same line with the field names the rest of the pipeline uses. */
function normalizeItem(item) {
  const out = { ...item };
  if (out.qty === undefined && out.quantity !== undefined) out.qty = out.quantity;
  if (!out.name) out.name = out.itemName || out.item_name || out.title || (typeof out.item === 'string' ? out.item : '') || '';
  if (out.materialSpec === undefined && out.material_spec !== undefined) out.materialSpec = out.material_spec;
  if (out.categoryHint === undefined && out.category_hint !== undefined) out.categoryHint = out.category_hint;
  return out;
}

/**
 * The BOQ lines in a value: a list of them, or an object that keys them by tag
 * ({ "CH-01": {...}, "TB-01": {...} }), in which case the key becomes the line's code.
 */
function itemArray(v) {
  if (Array.isArray(v)) return v.filter(isPlanItemLike);
  if (!isPlainObject(v)) return [];
  const entries = Object.entries(v);
  const lines = entries.filter(([, line]) => isPlanItemLike(line));
  if (lines.length === 0 || lines.length < entries.length / 2) return [];
  return lines.map(([key, line]) => (line.code ? line : { ...line, code: key }));
}

/** Items directly on an object: under "items" or one of the other names models use for the list. */
function ownItems(obj) {
  if (!isPlainObject(obj)) return [];
  for (const key of LIST_KEYS) {
    const found = itemArray(obj[key]);
    if (found.length > 0) return found;
  }
  return [];
}

function ownZones(obj) {
  if (!isPlainObject(obj)) return [];
  for (const key of ZONE_KEYS) {
    if (Array.isArray(obj[key]) && obj[key].some(isPlainObject)) return obj[key].filter(isPlainObject);
  }
  return [];
}

/** Every object that carries items, down to three levels, outermost first. */
function collectHolders(node, depth, out) {
  if (depth > 3 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const el of node.slice(0, 60)) collectHolders(el, depth + 1, out);
    return;
  }
  if (ownItems(node).length > 0) {
    out.push(node);
    return; // its own list is the answer; do not also read lists nested inside its items
  }
  for (const value of Object.values(node)) collectHolders(value, depth + 1, out);
}

/**
 * Read the lines of the "items" list one at a time, straight from the text. Used when the answer
 * as a whole does not parse: one bad line then costs that line, not the whole plan.
 *
 * The usual slip is a quote the model forgot to escape inside a text (a 24" screen). Such a quote
 * is recognised by what follows it: after the end of a text JSON allows only , } ] or : and when
 * something else follows, or turns up later where only JSON punctuation may stand, the quote
 * belonged to the text and is escaped.
 */
export function salvagePlanItemsFromText(rawText = '') {
  const text = String(rawText || '');
  const keyAt = text.search(LIST_KEY_RX);
  if (keyAt >= 0) return readLinesOfListAt(text, text.indexOf('[', keyAt)).items;
  // No recognisable list key: the answer may be the bare list itself, or the lines may sit in a
  // list under a name not seen before. Try the lists of the text in turn.
  let from = text.indexOf('[');
  for (let tries = 0; from >= 0 && tries < 6; tries++) {
    const read = readLinesOfListAt(text, from);
    if (read.items.length > 0) return read.items;
    from = text.indexOf('[', Math.max(read.end, from) + 1);
  }
  return [];
}

/** The BOQ lines of the list that opens at `from`, and where that list ends. */
function readLinesOfListAt(text, from) {
  const items = [];
  const closers = []; // open { and [ inside the current line; empty = between two lines
  let out = []; // the current line, rewritten so that it parses
  let inString = false;
  let lastCloseAt = -1; // where in `out` the last closing quote was written

  const nextSignificant = (i) => {
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    return j < text.length ? text[j] : '';
  };
  const keep = (chunk) => {
    let parsed = null;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      try {
        parsed = JSON.parse(chunk.replace(/,\s*([}\]])/g, '$1'));
      } catch { /* this line is lost; the next one may be fine */ }
    }
    if (isPlanItemLike(parsed)) items.push(parsed);
  };

  for (let i = Math.max(0, from) + 1; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === '\\') {
        out.push(ch, text[i + 1] ?? '');
        i++;
      } else if (ch === '"') {
        const next = nextSignificant(i + 1);
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
          inString = false;
          lastCloseAt = out.length;
          out.push('"');
        } else {
          out.push('\\"');
        }
      } else {
        out.push(ch < ' ' ? ' ' : ch); // a raw line break or tab inside a text
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      if (closers.length > 0) out.push(ch);
    } else if (ch === '{' || ch === '[') {
      if (closers.length === 0) {
        out = [];
        lastCloseAt = -1;
      }
      closers.push(ch === '{' ? '}' : ']');
      out.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (closers.length === 0) {
        if (ch === ']') return { items, end: i }; // end of the list
        continue;
      }
      closers.pop();
      out.push(ch);
      if (closers.length === 0) {
        if (out[0] === '{') keep(out.join(''));
        out = [];
      }
    } else if (closers.length > 0) {
      const literal = /^(?:true|false|null)(?![A-Za-z0-9_])/.exec(text.slice(i, i + 6));
      if (literal) {
        out.push(literal[0]);
        i += literal[0].length - 1;
      } else if (/[\s,:0-9.+-]/.test(ch) || (/[eE]/.test(ch) && /[0-9]/.test(out[out.length - 1] || ''))) {
        out.push(ch);
      } else if (lastCloseAt >= 0) {
        // Something that cannot stand here in JSON: the quote before it did not end the text.
        out[lastCloseAt] = '\\"';
        lastCloseAt = -1;
        inString = true;
        out.push(ch);
      } else {
        out.push(ch);
      }
    }
  }
  return { items, end: text.length };
}

/**
 * Reduce a parsed model answer (and, as a last resort, its raw text) to { zones, items, planSummary }.
 * Returns { answer, how }: `how` names the route taken, 'object' being the shape that was asked for.
 * `answer.items` is [] when no BOQ line can be found anywhere.
 */
export function coercePlanAnswer(parsed, rawText = '') {
  let value = parsed;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch { /* keep the string; the raw text is tried below */ }
  }

  const build = (holders, how) => {
    // Lines grouped under a room ({ name: "Lounge", items: [...] }) take the room as their location.
    const items = holders.flatMap((h) => {
      const place = [h.name, h.zone, h.room, h.location].find((n) => typeof n === 'string' && n.trim());
      return ownItems(h).map((line) => (place && !line.location ? { ...line, location: place } : line));
    }).map(normalizeItem);
    const zones = holders.flatMap((h) => ownZones(h));
    const summary = holders.map((h) => h.planSummary || h.plan_summary || h.summary).find((s) => typeof s === 'string' && s.trim());
    return { answer: { zones, items, planSummary: summary || '' }, how };
  };

  // 1. The shape that was asked for. Its lines are taken as they are (anything with a name or a
  //    description), exactly as before; the stricter "looks like a BOQ line" test is only for
  //    finding lines in shapes that were not asked for.
  if (isPlainObject(value) && Array.isArray(value.items) && value.items.some(hasItemText)) {
    return { answer: { ...value, items: value.items.filter(hasItemText).map(normalizeItem) }, how: 'object' };
  }

  // 2. The list of lines alone.
  if (Array.isArray(value) && itemArray(value).length > 0 && itemArray(value).length >= value.length / 2) {
    return { answer: { zones: [], items: itemArray(value).map(normalizeItem), planSummary: '' }, how: 'list-of-items' };
  }

  // 3. A list of answers (one per sheet), a wrapper object, or the list under another name.
  const holders = [];
  collectHolders(value, 0, holders);
  if (holders.length > 0) {
    let how = 'nested';
    if (Array.isArray(value)) how = 'list-of-answers';
    else if (isPlainObject(value.items) && ownItems(value).length > 0) how = 'lines-keyed-by-tag';
    else if (ownItems(value).length > 0) how = 'other-list-name';
    return build(holders, how);
  }

  // 4. The answer did not parse as a whole (or parsed to something without lines): read the
  //    lines one by one from the text.
  const salvaged = salvagePlanItemsFromText(rawText);
  if (salvaged.length > 0) {
    const zones = isPlainObject(value) ? ownZones(value) : (Array.isArray(value) && value.every(isPlainObject) && !value.some(isPlanItemLike) ? value : []);
    return { answer: { zones, items: salvaged.map(normalizeItem), planSummary: '' }, how: 'line-by-line' };
  }

  return { answer: { zones: isPlainObject(value) ? ownZones(value) : [], items: [], planSummary: '' }, how: 'none' };
}

/**
 * A short, log-safe description of an answer nothing could be read from: its outer shape, where
 * JSON parsing stops, and how the text begins and ends.
 */
export function describePlanAnswer(parsed, rawText = '') {
  const text = String(rawText || '');
  let shape = parsed === null || parsed === undefined ? 'nothing' : typeof parsed;
  let keys = [];
  if (Array.isArray(parsed)) {
    shape = `list of ${parsed.length}`;
    if (isPlainObject(parsed[0])) keys = Object.keys(parsed[0]).slice(0, 12);
  } else if (isPlainObject(parsed)) {
    shape = 'object';
    keys = Object.keys(parsed).slice(0, 12);
  }
  let parseError = '';
  let around = '';
  try {
    JSON.parse(text);
  } catch (err) {
    parseError = String(err?.message || err).slice(0, 140);
    const at = /position (\d+)/.exec(parseError);
    if (at) around = text.slice(Math.max(0, Number(at[1]) - 70), Number(at[1]) + 70);
  }
  const itemsField = isPlainObject(parsed) && 'items' in parsed
    ? (Array.isArray(parsed.items) ? `list of ${parsed.items.length}` : typeof parsed.items)
    : 'absent';
  return {
    chars: text.length,
    shape,
    keys,
    itemsField,
    parseError,
    around,
    head: text.slice(0, 260),
    tail: text.slice(-160),
  };
}
