'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  selected: null, worldInfo: null, character: null, publicBooks: [],
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (_) { /* */ }
    throw new Error(msg);
  }
  return res.json();
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---- capture list ----
async function loadList() {
  const ul = $('captureList');
  ul.innerHTML = `<li class="muted" style="padding:9px 11px;font-size:12px">${t('loading')}</li>`;
  const items = await api('/api/captures');
  ul.innerHTML = '';
  $('emptyHint').style.display = 'block';
  for (const it of items) {
    const li = document.createElement('li');
    if (state.selected === it.id) li.classList.add('active');
    li.dataset.id = it.id;
    li.innerHTML = `
      <div class="li-top">
        <span class="li-char">${escapeHtml(it.characterName || '(unknown)')}</span>
        <span class="li-time">${fmtTime(it.ts)}</span>
      </div>
      <div class="li-preview">${escapeHtml(it.preview || '')}</div>`;
    li.addEventListener('click', () => selectCapture(it.id));
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- inline SVG icons (sprite defined in index.html) ----
function iconSvg(name, cls) {
  return `<svg class="icon${cls ? ' ' + cls : ''}"><use href="#i-${name}"></use></svg>`;
}
// status line with a leading icon; text is escaped before injection
function setStatus(el, iconName, text, cls) {
  el.innerHTML = `${iconSvg(iconName, cls)} <span>${escapeHtml(text)}</span>`;
}

// ---- tabs ----
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === tabId));
}

// ---- raw messages rendering ----
function renderMessages(msgs) {
  const container = $('rawMessages');
  container.innerHTML = '';
  for (const m of msgs) {
    const block = document.createElement('div');
    block.className = 'msg-block msg-' + (m.role || 'unknown');
    const header = document.createElement('div');
    header.className = 'msg-role';
    header.textContent = m.role || 'unknown';
    const body = document.createElement('pre');
    body.className = 'msg-body';
    body.textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
    block.appendChild(header);
    block.appendChild(body);
    container.appendChild(block);
  }
}

// ---- detail ----
async function selectCapture(id) {
  state.selected = id;
  state.worldInfo = null;
  document.querySelectorAll('#captureList li').forEach((li) =>
    li.classList.toggle('active', li.dataset.id === id));

  $('detailBody').classList.add('hidden');
  $('detailEmpty').classList.remove('hidden');
  $('detailEmpty').textContent = t('loading');

  const rec = await api(`/api/captures/${id}`);
  $('detailEmpty').classList.add('hidden');
  $('detailBody').classList.remove('hidden');

  const charEl = $('metaChar');
  if (rec.characterId) {
    const charUrl = `https://janitorai.com/characters/${rec.characterId}`;
    charEl.innerHTML = `${t('charLabel')}: <a href="${escapeHtml(charUrl)}" target="_blank" rel="noopener">${escapeHtml(rec.characterName || rec.characterId)}</a>`;
  } else {
    charEl.textContent = rec.characterName || '(unknown)';
  }
  $('metaTime').textContent = fmtTime(rec.ts);

  // A record is "captured" once the generateAlpha payload is attached. Before
  // that it is only an inspection (metadata + anything already public).
  const captured = !!rec.payload;
  state.captured = captured;
  state.cardPublic = !!rec.cardPublic;

  const msgs = (rec.payload && rec.payload.messages) || [];
  $('msgCount').textContent = msgs.length;
  renderMessages(msgs);
  // Full, unmodified generateAlpha response body — exactly what was received.
  $('rawJson').textContent = rec.payload ? JSON.stringify(rec.payload, null, 2) : '';
  $('provBody').innerHTML = '';
  $('rawBlock').classList.toggle('hidden', !captured);
  $('provBlock').classList.toggle('hidden', !captured);

  fillCharacter(rec.character || null);

  // Card tab: a private, not-yet-captured card gets an "extract" button.
  $('cardExtractBar').classList.toggle('hidden', captured || state.cardPublic);
  $('cardExtractStatus').textContent = '';

  // reset working areas
  $('lorebookText').value = '';
  $('lorebookEntries').innerHTML = '';
  $('worldInfoPre').textContent = '';
  $('buildStatus').textContent = '';
  $('buildTimer').textContent = '';
  $('buildResult').classList.add('hidden');
  $('promptPreview').classList.add('hidden');
  $('promptPre').textContent = '';
  $('loreExtractStatus').textContent = '';
  renderPublicBooks(rec.publicLorebooks || []);

  // auto-run separation only when there's a captured payload to separate.
  if (captured) {
    try {
      const r = await api('/api/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.selected, knownCard: '' }),
      });
      $('lorebookText').value = r.lorebookText;
      renderLorebookEntries(r.entries || []);
      renderProvenance(rec, r);
    } catch (_) { /* */ }
  }
  updateLorebookEmpty();
}

// Decide which lorebook controls to show. Inspected records offer an "extract"
// block when the character has closed lorebooks; captured records show the build
// section. A plain "no lorebook" notice appears when there's nothing at all.
function updateLorebookEmpty() {
  const books = state.publicBooks || [];
  const openCount = books.filter((b) => b.accessible).length;
  const closedCount = books.filter((b) => !b.accessible).length;
  const hasEntries = $('lorebookEntries').children.length > 0;
  const captured = state.captured;
  const hasClosed = closedCount > 0;
  const empty = !books.length && !hasEntries && !captured;
  $('noLorebook').classList.toggle('hidden', !empty);

  if (!captured) {
    // Inspection: offer on-demand extraction when there's a closed lorebook.
    $('loreExtractBlock').classList.toggle('hidden', !hasClosed);
    $('buildBlock').classList.add('hidden');
  } else {
    $('loreExtractBlock').classList.add('hidden');
    // With only public lorebooks (and nothing extracted) there's nothing to build.
    const onlyPublic = openCount > 0 && closedCount === 0 && !hasEntries;
    $('buildBlock').classList.toggle('hidden', onlyPublic);
  }
}

// ---- extraction breakdown (what was pulled from which request, what was cut) ----
const RM_KEY = {
  jailbreak: 'rmJailbreak', card: 'rmCard', userPersona: 'rmUserPersona',
  scenario: 'rmScenario', example: 'rmExample', knownCard: 'rmKnownCard',
  publicLorebook: 'rmPublicLorebook',
};

function renderProvenance(rec, sep) {
  const removed = sep.removed || [];
  const entries = sep.entries || [];
  const kept = (sep.lorebookText || '').length;

  const parts = [];

  if (entries.length) {
    parts.push('<details class="prov-item">'
      + `<summary>${t('provLorebookLbl')} <span class="muted">(${entries.length} ${t('provEntries')} · ${kept} ${t('provChars')})</span></summary>`
      + `<pre class="msg-body">${escapeHtml(sep.lorebookText || '')}</pre></details>`);
  }

  if (!removed.length && !entries.length) {
    parts.push(`<div class="prov-warn">${iconSvg('warn')} ${t('provNothing')}</div>`);
  }
  for (const r of removed) {
    const label = t(RM_KEY[r.label] || r.label);
    const len = (r.text || '').length;
    parts.push('<details class="prov-item">'
      + `<summary>${escapeHtml(label)} <span class="muted">(${len} ${t('provChars')})</span></summary>`
      + `<pre class="msg-body">${escapeHtml(r.text || '')}</pre></details>`);
  }
  $('provBody').innerHTML = parts.join('');
}

// ---- lorebooks (public blocks + closed-lorebook hint) ----
// `books` is every lorebook attached to the character, each flagged `accessible`
// (a downloadable PUBLIC lorebook) or not (a CLOSED lorebook, rebuilt via the LLM).
function renderPublicBooks(books) {
  state.publicBooks = Array.isArray(books) ? books : [];
  
  // Public lorebooks
  const pubBlock = $('publicBlock');
  const pubContainer = $('publicBooks');
  pubContainer.innerHTML = '';
  const open = state.publicBooks.filter((b) => b.accessible);
  if (!open.length) {
    pubBlock.classList.add('hidden');
  } else {
    pubBlock.classList.remove('hidden');
    const closedCount = state.publicBooks.filter((b) => !b.accessible).length;
    $('publicHint').textContent = closedCount > 0 ? t('publicHint') : t('publicHintOnly');
    open.forEach((b) => {
      const i = state.publicBooks.indexOf(b);
      const row = document.createElement('div');
      row.className = 'public-book';
      const title = escapeHtml(b.title || t('publicUntitled'));
      row.innerHTML = `<div class="pb-meta"><span class="pb-title">${iconSvg('book')} ${title}</span>`
        + `<span class="muted">${b.entryCount} ${t('provEntries')}</span></div>`;
      const btn = document.createElement('button');
      btn.className = 'ghost small';
      btn.innerHTML = `${iconSvg('download')} .json`;
      btn.addEventListener('click', () => downloadPublicBook(i));
      row.appendChild(btn);
      pubContainer.appendChild(row);
    });
  }

  // Private lorebooks
  const privBlock = $('privateBlock');
  const privContainer = $('privateBooks');
  privContainer.innerHTML = '';
  const closed = state.publicBooks.filter((b) => !b.accessible);
  if (!closed.length) {
    privBlock.classList.add('hidden');
  } else {
    privBlock.classList.remove('hidden');
    $('privateHint').textContent = t('privateHint').replace('{n}', closed.length);
    closed.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'public-book';
      const title = escapeHtml(b.title || t('publicUntitled'));
      row.innerHTML = `<div class="pb-meta"><span class="pb-title">${iconSvg('lock')} ${title}</span>`
        + `<span class="muted">${t('private')}</span></div>`;
      privContainer.appendChild(row);
    });
  }
}

function downloadPublicBook(i) {
  const b = state.publicBooks[i];
  if (!b || !b.worldInfo) return;
  const blob = new Blob([JSON.stringify(b.worldInfo, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeName(b.title || 'Public Lorebook')}.json`);
}

function renderLorebookEntries(entries) {
  const container = $('lorebookEntries');
  container.innerHTML = '';
  for (let i = 0; i < entries.length; i++) {
    const details = document.createElement('details');
    details.className = 'msg-block msg-lorebook';
    const summary = document.createElement('summary');
    summary.className = 'msg-role';
    summary.textContent = `${t('provEntry')} ${i + 1}`;
    const body = document.createElement('pre');
    body.className = 'msg-body';
    body.textContent = entries[i];
    details.appendChild(summary);
    details.appendChild(body);
    container.appendChild(details);
  }
}

// Shared request body for /api/extract and /api/extract-preview — the build-with-LLM
// context selection plus the (possibly hand-edited) raw lorebook text.
function buildExtractBody() {
  return {
    id: state.selected,
    lorebookText: $('lorebookText').value,
    useCard: $('useCard').checked,
    useCatalog: $('useCatalog').checked,
    useScenario: $('useScenario').checked,
    useGreetings: $('useGreetings').checked,
    useLorebookDescs: $('useLorebookDescs').checked,
    extraContext: $('useExtra').checked ? $('extraContext').value : '',
  };
}

// Render the exact prompt sent to (or about to be sent to) the build LLM.
function showPromptPreview(messages) {
  const text = (messages || [])
    .map((m) => `### ${String(m.role || '').toUpperCase()}\n${m.content || ''}`)
    .join('\n\n');
  $('promptPre').textContent = text;
  $('promptPreview').classList.remove('hidden');
}

// ---- build generation timer (proves the request is still alive) ----
let buildTimerHandle = null;
let buildStartTs = 0;
function startBuildTimer() {
  buildStartTs = Date.now();
  $('buildTimer').textContent = '0s';
  buildTimerHandle = setInterval(() => {
    const s = Math.round((Date.now() - buildStartTs) / 1000);
    // After a minute, reassure the user it hasn't died — just a slow model.
    $('buildTimer').textContent = s >= 60 ? `${s}s · ${t('buildStillRunning')}` : `${s}s`;
  }, 1000);
}
function stopBuildTimer(label) {
  if (buildTimerHandle) { clearInterval(buildTimerHandle); buildTimerHandle = null; }
  const s = Math.round((Date.now() - buildStartTs) / 1000);
  $('buildTimer').textContent = label != null ? `${s}s · ${label}` : `${s}s`;
}

async function previewPrompt() {
  if (!state.selected) return;
  $('previewBtn').disabled = true;
  try {
    const r = await api('/api/extract-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildExtractBody()),
    });
    showPromptPreview(r.messages || []);
    $('promptPreview').open = true;
  } catch (e) {
    setStatus($('buildStatus'), 'x', e.message);
  } finally {
    $('previewBtn').disabled = false;
  }
}

async function runBuild() {
  if (!state.selected) return;
  // The lorebook build needs an OpenAI-compatible LLM. If it isn't configured,
  // don't fail with a cryptic server error — poke the user into settings.
  const cfg = await api('/api/settings').catch(() => null);
  if (!cfg || !cfg.baseUrl || !cfg.model) {
    setStatus($('buildStatus'), 'warn', t('llmNotConfigured'));
    openSettings();
    return;
  }
  $('buildStatus').textContent = t('building');
  $('buildBtn').disabled = true;
  $('previewBtn').disabled = true;
  startBuildTimer();
  try {
    const r = await api('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildExtractBody()),
    });
    state.worldInfo = r.worldInfo;
    const count = Object.keys(r.worldInfo.entries).length;
    $('worldInfoPre').textContent = JSON.stringify(r.worldInfo, null, 2);
    $('buildStatus').textContent = `${count} ${t('provEntries')}`;
    $('buildResult').classList.remove('hidden');
    if (r.messages) showPromptPreview(r.messages);
    stopBuildTimer();
  } catch (e) {
    setStatus($('buildStatus'), 'x', e.message);
    stopBuildTimer(t('buildFailed'));
  } finally {
    $('buildBtn').disabled = false;
    $('previewBtn').disabled = false;
  }
}

function lorebookFileName() {
  const custom = $('worldName').value.trim();
  if (custom) return safeName(custom);
  const charName = state.character && state.character.name;
  if (charName) return safeName(`Lorebook - ${charName}`);
  return 'Lorebook';
}

function downloadRaw() {
  const text = $('lorebookText').value.trim();
  if (!text) return;
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const entries = {};
  blocks.forEach((content, i) => {
    entries[String(i)] = {
      uid: i, key: [], keysecondary: [], comment: `Entry ${i + 1}`,
      content, constant: false, selective: false, order: 100, position: 0,
      disable: false, addMemo: true, displayIndex: i,
      probability: 100, useProbability: true, depth: 4,
      group: '', groupOverride: false, groupWeight: 100,
      sticky: 0, cooldown: 0, delay: 0, role: null, vectorized: false,
      excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false,
      scanDepth: null, caseSensitive: null, matchWholeWords: null,
      useGroupScoring: null, automationId: '', selectiveLogic: 0,
    };
  });
  const worldInfo = { entries };
  const blob = new Blob([JSON.stringify(worldInfo, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${lorebookFileName()}.json`);
}

  // ---- character card ----
function fillCharacter(ch) {
  state.character = ch || null;
  const set = (id, v) => { $(id).value = v || ''; };
  set('charName', ch && ch.name);
  set('charDesc', ch && ch.description);
  set('charPersonality', ch && ch.personality);
  set('charScenario', ch && ch.scenario);
  set('charFirst', ch && ch.firstMessage);
  renderAltGreetings(ch && ch.alternateGreetings);
  set('charExample', ch && ch.exampleMessages);
  set('charTags', ch && (Array.isArray(ch.tags) ? ch.tags.join(', ') : ch.tags));
  set('charNotes', ch && ch.creatorNotes);
  renderCardSource(ch && ch.definitionSource);
  const avatar = $('metaAvatar');
  if (ch && ch.avatarBase64) {
    avatar.src = ch.avatarBase64; avatar.classList.remove('hidden');
  } else {
    avatar.removeAttribute('src'); avatar.classList.add('hidden');
  }
  const cardPrivate = !state.cardPublic && !state.captured;
  $('cardFormBlock').classList.toggle('hidden', cardPrivate);
  if (ch && (ch.name || ch.description)) switchTab('tabCard');
}

// Show where the card came from: pulled straight from JanitorAI (open
// definition) or reconstructed from the leaked generateAlpha prompt.
function renderCardSource(source) {
  const el = $('charSource');
  if (!el) return;
  if (source === 'janitor') {
    el.textContent = t('cardSrcJanitor');
    el.className = 'card-source src-janitor';
  } else if (source === 'reconstructed') {
    el.textContent = t('cardSrcReconstructed');
    el.className = 'card-source src-reconstructed';
  } else {
    el.textContent = '';
    el.className = 'card-source hidden';
  }
}

// Render one editable textarea per alternate greeting (everything past the first
// message). Hidden entirely when a character ships only a single greeting.
function renderAltGreetings(greetings) {
  const block = $('charAltGreetingsBlock');
  const host = $('charAltGreetings');
  const list = Array.isArray(greetings) ? greetings.filter(g => g && String(g).trim()) : [];
  host.innerHTML = '';
  list.forEach((g) => {
    const ta = document.createElement('textarea');
    ta.className = 'alt-greeting';
    ta.rows = 3;
    ta.value = g;
    host.appendChild(ta);
  });
  if (block) block.classList.toggle('hidden', list.length === 0);
  const count = $('charAltCount');
  if (count) count.textContent = list.length ? `(${list.length})` : '';
}

function readAltGreetings() {
  return Array.from($('charAltGreetings').querySelectorAll('textarea.alt-greeting'))
    .map(ta => ta.value)
    .filter(v => v && v.trim());
}

function readCardFields() {
  const name = $('charName').value.trim();
  const tags = $('charTags').value.trim();
  return {
    name: name || 'character',
    description: $('charDesc').value,
    personality: $('charPersonality').value,
    scenario: $('charScenario').value,
    first_mes: $('charFirst').value,
    mes_example: $('charExample').value,
    creator_notes: $('charNotes').value,
    tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    alternate_greetings: readAltGreetings(),
  };
}

function buildCardV2(fields) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...fields,
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: fields.alternate_greetings || [],
      creator: '',
      character_version: '',
      extensions: {},
    },
  };
}

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

function safeName(name) {
  return (name || 'character').replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 60);
}

function downloadJson() {
  const fields = readCardFields();
  const card = buildCardV2(fields);
  const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeName(fields.name)}.json`);
  $('charStatus').textContent = t('jsonDl');
}

async function downloadPng() {
  const fields = readCardFields();
  const card = buildCardV2(fields);
  const avatarB64 = state.character && state.character.avatarBase64;
  if (!avatarB64) { $('charStatus').textContent = t('noAvatarEmbed'); return; }

  $('charStatus').textContent = t('buildingPng');
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = avatarB64;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    const json = JSON.stringify(card);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(json);
    const keyword = encoder.encode('chara');

    // get the raw PNG bytes
    const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const pngBuf = new Uint8Array(await pngBlob.arrayBuffer());

    // build a tEXt chunk: keyword + \0 + text (base64-encoded JSON)
    const b64 = btoa(String.fromCharCode(...jsonBytes));
    const textBytes = encoder.encode(b64);
    const chunkData = new Uint8Array(keyword.length + 1 + textBytes.length);
    chunkData.set(keyword, 0);
    chunkData[keyword.length] = 0;
    chunkData.set(textBytes, keyword.length + 1);

    const crc32 = computeCrc32(new Uint8Array([...encoder.encode('tEXt'), ...chunkData]));

    const chunk = new Uint8Array(12 + chunkData.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, chunkData.length);
    chunk.set(encoder.encode('tEXt'), 4);
    chunk.set(chunkData, 8);
    view.setUint32(8 + chunkData.length, crc32);

    // insert before IEND (last 12 bytes)
    const out = new Uint8Array(pngBuf.length + chunk.length);
    out.set(pngBuf.subarray(0, pngBuf.length - 12), 0);
    out.set(chunk, pngBuf.length - 12);
    out.set(pngBuf.subarray(pngBuf.length - 12), pngBuf.length - 12 + chunk.length);

    triggerDownload(new Blob([out], { type: 'image/png' }), `${safeName(fields.name)}.png`);
    $('charStatus').textContent = t('pngDl');
  } catch (e) {
    setStatus($('charStatus'), 'x', e.message);
  }
}

function computeCrc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function downloadImage() {
  const avatarB64 = state.character && state.character.avatarBase64;
  if (!avatarB64) { $('charStatus').textContent = t('noAvatarAvail'); return; }
  const name = safeName($('charName').value.trim());
  const m = avatarB64.match(/^data:image\/(\w+);/);
  const ext = m ? m[1].replace('jpeg', 'jpg') : 'png';
  const arr = avatarB64.split(',');
  const bstr = atob(arr[1]);
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  triggerDownload(new Blob([u8], { type: m ? `image/${m[1]}` : 'image/png' }), `${name}.${ext}`);
  $('charStatus').textContent = t('imgDl');
}

function download() {
  if (!state.worldInfo) return;
  const blob = new Blob([JSON.stringify(state.worldInfo, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${lorebookFileName()}.json`);
}

// "extract" button → INSPECT only: read the character's name, avatar, card
// visibility and lorebooks. Nothing public triggers a generateAlpha run; the
// private card / closed lorebooks are extracted later, on demand.
async function runFromUrl() {
  const url = $('charUrl').value.trim();
  if (!url) { $('autoStatus').textContent = t('pasteFirst'); return; }
  $('runBtn').disabled = true;
  $('autoStatus').textContent = t('inspecting');

  // Add a pending entry to the sidebar immediately
  const pendingId = '_pending_' + Date.now();
  state.selected = pendingId;
  const ul = $('captureList');
  const li = document.createElement('li');
  li.dataset.id = pendingId;
  li.classList.add('active');
  li.innerHTML = `
    <div class="li-top">
      <span class="li-char extracting">${t('inspecting')}</span>
      <span class="li-time">${fmtTime(Date.now())}</span>
    </div>
    <div class="li-preview">${escapeHtml(url)}</div>`;
  ul.prepend(li);
  document.querySelectorAll('#captureList li').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === pendingId));

  // Show inspecting state in the detail panel
  $('detailBody').classList.add('hidden');
  $('detailEmpty').classList.remove('hidden');
  $('detailEmpty').innerHTML = `<span class="extracting">${t('inspecting')}</span>`;

  try {
    const r = await api('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    // Remove the pending entry and load real data
    li.remove();
    await loadList();
    await selectCapture(r.id);
    $('autoStatus').textContent = t('inspectDone');
  } catch (e) {
    li.remove();
    await loadList();
    setStatus($('autoStatus'), 'x', e.message);
    $('detailBody').classList.add('hidden');
    $('detailEmpty').classList.remove('hidden');
    $('detailEmpty').textContent = t('detailEmpty');
  } finally {
    $('runBtn').disabled = false;
  }
}

// Card tab "extract": run the generateAlpha capture and reconstruct the private
// card. The same capture also yields the closed lorebook (reused if present).
async function runCardExtract() {
  if (!state.selected) return;
  $('cardExtractBtn').disabled = true;
  $('cardExtractStatus').innerHTML = `<span class="extracting">${t('extracting')}</span>`;
  try {
    await api('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.selected }),
    });
    await selectCapture(state.selected);
  } catch (e) {
    setStatus($('cardExtractStatus'), 'x', e.message);
  } finally {
    $('cardExtractBtn').disabled = false;
  }
}

// Lorebook tab "extract": run the generateAlpha capture for the closed lorebook,
// then copy the chosen context options (incl. custom text) into build-with-LLM so
// the user can build right away.
async function runLoreExtract() {
  if (!state.selected) return;
  const id = state.selected;
  const opt = {
    card: $('exCard').checked,
    catalog: $('exCatalog').checked,
    scenario: $('exScenario').checked,
    greetings: $('exGreetings').checked,
    lorebookDescs: $('exLorebookDescs').checked,
    extra: $('exExtra').checked,
    extraText: $('exExtraText').value,
  };
  $('loreExtractBtn').disabled = true;
  $('loreExtractStatus').innerHTML = `<span class="extracting">${t('extracting')}</span>`;
  try {
    await api('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await selectCapture(id); // reloads as captured → build section appears
    // Carry the selected context into build-with-LLM.
    $('useCard').checked = opt.card;
    $('useCatalog').checked = opt.catalog;
    $('useScenario').checked = opt.scenario;
    $('useGreetings').checked = opt.greetings;
    $('useLorebookDescs').checked = opt.lorebookDescs;
    $('useExtra').checked = opt.extra;
    $('extraContext').value = opt.extra ? opt.extraText : '';
    $('extraContext').classList.toggle('hidden', !opt.extra);
  } catch (e) {
    setStatus($('loreExtractStatus'), 'x', e.message);
  } finally {
    $('loreExtractBtn').disabled = false;
  }
}

async function deleteCapture() {
  if (!state.selected) return;
  if (!confirm(t('deleteConfirm'))) return;
  await api(`/api/captures/${state.selected}`, { method: 'DELETE' });
  state.selected = null;
  $('detailBody').classList.add('hidden');
  $('detailEmpty').classList.remove('hidden');
  await loadList();
}

// ---- settings ----
async function openSettings() {
  const s = await api('/api/settings');
  $('setLang').value = currentLang;
  $('setBaseUrl').value = s.baseUrl || '';
  $('setApiKey').value = s.apiKey || '';
  $('setModel').value = s.model || '';
  $('settingsDialog').showModal();
}
async function saveSettings(e) {
  e.preventDefault();
  await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: $('setBaseUrl').value.trim(),
      apiKey: $('setApiKey').value.trim(),
      model: $('setModel').value.trim(),
    }),
  });
  $('settingsDialog').close();
}

// ---- auth gate ----
function unlockUI() {
  $('mainContent').classList.remove('hidden');
  $('detail').classList.remove('hidden');
  loadList();
}

async function checkStatus() {
  $('loginStatus').textContent = t('checkingSession');
  try {
    const data = await api('/api/status');
    if (data.loggedIn) {
      setStatus($('loginStatus'), 'check', t('loggedIn'));
      unlockUI();
    } else {
      $('loginStatus').textContent = t('notLoggedIn');
    }
  } catch (_) {
    $('loginStatus').textContent = '';
  }
}

// ---- JanitorAI login ----
async function login() {
  $('loginBtn').disabled = true;
  $('loginStatus').textContent = t('openingJanitor');
  try {
    const data = await api('/api/login', { method: 'POST' });
    if (data.loggedIn) {
      setStatus($('loginStatus'), 'check', t('loggedIn'));
      unlockUI();
    } else {
      $('loginStatus').textContent = t('notSignedIn');
    }
  } catch (e) {
    setStatus($('loginStatus'), 'x', e.message);
  } finally {
    $('loginBtn').disabled = false;
  }
}

// ---- live updates ----
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('capture', () => loadList());
}

// ---- wire up ----
$('runBtn').addEventListener('click', runFromUrl);
$('charUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') runFromUrl(); });
$('dlRawBtn').addEventListener('click', downloadRaw);
$('buildBtn').addEventListener('click', runBuild);
$('previewBtn').addEventListener('click', previewPrompt);
$('cardExtractBtn').addEventListener('click', runCardExtract);
$('loreExtractBtn').addEventListener('click', runLoreExtract);
$('useExtra').addEventListener('change', () => {
  $('extraContext').classList.toggle('hidden', !$('useExtra').checked);
});
$('exExtra').addEventListener('change', () => {
  $('exExtraText').classList.toggle('hidden', !$('exExtra').checked);
});
$('rawJsonToggle').addEventListener('change', () => {
  const raw = $('rawJsonToggle').checked;
  $('rawJson').classList.toggle('hidden', !raw);
  $('rawMessages').classList.toggle('hidden', raw);
});
$('downloadBtn').addEventListener('click', download);
$('deleteBtn').addEventListener('click', deleteCapture);
$('settingsBtn').addEventListener('click', openSettings);
$('saveSettings').addEventListener('click', saveSettings);
// Manual language switch — applies immediately and persists across sessions.
$('setLang').addEventListener('change', () => setLang($('setLang').value, true));

$('loginBtn').addEventListener('click', login);
$('howBtn').addEventListener('click', () => { $('howDialog').showModal(); $('howDialog').scrollTop = 0; });
$('howClose').addEventListener('click', () => $('howDialog').close());
$('dlPngBtn').addEventListener('click', downloadPng);
$('dlJsonBtn').addEventListener('click', downloadJson);
$('dlImgBtn').addEventListener('click', downloadImage);

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

checkStatus();
connectEvents();
api('/api/version').then((d) => { $('appVersion').textContent = `v${d.version}`; }).catch(() => {});
