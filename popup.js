'use strict';

// popup.js — Ark Abroad Edition
// Multi-provider AI, Real-time LinkedIn Character Guard, Dynamic Hook Selection, and CRM Pipeline Tracking

// ─── State ────────────────────────────────────────────────────────────────────
let currentProfile       = null;
let isGenerating         = false;
let currentMode          = 'simple'; // 'simple' | 'deep'
let currentFormat        = 'connection_note'; // 'connection_note' | 'full'
let deepProfileJSON      = null;
let deepEnrichmentJSON   = null;
let isEnriching          = false;
let selectedHookIndex    = 0;
let pendingResume        = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  initFormatToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  await checkCurrentPage();
  await loadSettings();
  await renderRecentContacts();
  await checkLicenseStatus();
});

// ─── License / Provider status in header ─────────────────────────────────────
async function checkLicenseStatus() {
  const s = await loadStoredSettings();
  const el = document.getElementById('key-status');
  const provider = s.aiProvider || (s.userApiKey ? 'gemini' : 'local');

  if (provider === 'local' || !s.userApiKey) {
    el.textContent = '● Free Engine';
    el.className = 'key-status free';
  } else {
    const names = { gemini: 'Gemini AI', openai: 'GPT-4o-mini', anthropic: 'Claude AI' };
    el.textContent = `● ${names[provider] || 'AI Active'}`;
    el.className = 'key-status active';
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Format Toggle (Note <300 vs Full) ────────────────────────────────────────
function initFormatToggle() {
  const noteBtn = document.getElementById('format-note');
  const fullBtn = document.getElementById('format-full');

  noteBtn.addEventListener('click', () => setFormat('connection_note'));
  fullBtn.addEventListener('click', () => setFormat('full'));
}

function setFormat(format) {
  currentFormat = format;
  document.getElementById('format-note').classList.toggle('active', format === 'connection_note');
  document.getElementById('format-full').classList.toggle('active', format === 'full');
  updateCharCount();
  // If a message is already displayed, adapt its display
  const ta = document.getElementById('generated-message');
  if (ta.value && currentProfile) {
    // Offer quick regeneration in the new format
    showCurrentStatus(`Format set to ${format === 'connection_note' ? 'Connection Note (<300 chars)' : 'InMail / Message'}. Hit Regenerate to adjust.`, 'warning');
  }
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
  document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
  document.getElementById('mode-deep').addEventListener('click', () => setMode('deep'));
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-simple').classList.toggle('active', mode === 'simple');
  document.getElementById('mode-deep').classList.toggle('active', mode === 'deep');
  document.getElementById('simple-mode-ui').classList.toggle('hidden', mode === 'deep');
  document.getElementById('deep-mode-ui').classList.toggle('hidden', mode === 'simple');
  hideMessage();
  clearCurrentStatus();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  document.getElementById('scrape-btn').disabled = !onProfile;
  document.getElementById('enrich-btn').disabled = !onProfile;
  if (!onProfile) {
    document.getElementById('page-warning').classList.remove('hidden');
  } else {
    document.getElementById('page-warning').classList.add('hidden');
  }
  return onProfile;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('enrich-btn').addEventListener('click', handleEnrich);
  document.getElementById('deep-generate-btn').addEventListener('click', handleDeepGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', handleRegenerate);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('auto-trim-btn').addEventListener('click', handleAutoTrim);
  document.getElementById('generated-message').addEventListener('input', updateCharCount);
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('ai-provider').addEventListener('change', handleProviderChange);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });

  // Resume upload
  const dropArea = document.getElementById('file-upload-area');
  dropArea.addEventListener('click', () => document.getElementById('resume-upload').click());
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processResumeFile(file);
  });
  document.getElementById('resume-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processResumeFile(file);
  });
}

function handleProviderChange() {
  const provider = document.getElementById('ai-provider').value;
  const inputWrap = document.getElementById('api-key-wrap');
  const input = document.getElementById('api-key');
  const hint = document.getElementById('provider-hint');

  if (provider === 'local') {
    inputWrap.classList.add('hidden');
    hint.textContent = 'Smart Free Engine active: Generates high-converting outreach using Ark Abroad proven templates. No API key required!';
  } else {
    inputWrap.classList.remove('hidden');
    if (provider === 'gemini') {
      input.placeholder = 'AIzaSy… (Google Gemini API key)';
      hint.textContent = 'Gemini 1.5/2.0 Flash: Get a free API key at aistudio.google.com.';
    } else if (provider === 'openai') {
      input.placeholder = 'sk-proj-… (OpenAI API key)';
      hint.textContent = 'OpenAI GPT-4o-mini: Fast and reliable.';
    } else if (provider === 'anthropic') {
      input.placeholder = 'sk-ant-… (Anthropic Claude key)';
      hint.textContent = 'Anthropic Claude 3.5 Haiku: Nuanced, high-empathy corporate writing.';
    }
  }
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    if (confirm('Clear all saved outreach history?')) {
      await Cache.clearContacts();
      renderRecentContacts();
    }
  });

  document.getElementById('recent-search').addEventListener('input', (e) => {
    renderRecentContacts(e.target.value.trim());
  });

  document.getElementById('export-csv-btn').addEventListener('click', handleExportCSV);
}

// ─── Simple Mode ──────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (isGenerating) return;

  isGenerating = true;
  hideMessage();
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Scraping profile…');
  clearCurrentStatus();

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    currentProfile = profile;
    renderProfileCard(profile);
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Crafting outreach…');

    const message = await callQuickGenerate(profile);
    renderMessage(message);

    await Cache.addContact({
      profileUrl:  profile.profileUrl || '',
      name:        profile.name || 'Unknown',
      headline:    profile.headline || '',
      company:     profile.currentCompany || '',
      message,
      messageType: document.getElementById('message-type').value,
      status:      'Generated',
      timestamp:   Date.now()
    });

    updateRecentBadge();
    showCurrentStatus('Outreach message ready! Review & copy below.', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape Profile &amp; Generate');
  }
}

async function callQuickGenerate(profile) {
  const settings = await loadStoredSettings();
  const messageType = document.getElementById('message-type').value;
  const tone = document.getElementById('tone').value;
  return sendToBackground({
    action: 'generateMessage',
    data: {
      profileData: profile,
      settings,
      messageType,
      tone,
      formatConstraint: currentFormat
    }
  });
}

async function handleRegenerate() {
  if (isGenerating) return;
  if (currentMode === 'deep') { handleDeepGenerate(true); return; }
  if (!currentProfile) return;

  isGenerating = true;
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Regenerating…');

  try {
    const message = await callQuickGenerate(currentProfile);
    renderMessage(message);
    showCurrentStatus('New variation generated!', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape Profile &amp; Generate');
  }
}

// ─── Deep Mode (3-Layer Pipeline) ─────────────────────────────────────────────
async function handleEnrich() {
  if (isEnriching) return;

  deepProfileJSON = null;
  deepEnrichmentJSON = null;
  resetLayerStatuses();
  document.getElementById('hooks-panel').classList.add('hidden');
  document.getElementById('deep-generate-btn').disabled = true;
  hideMessage();
  clearCurrentStatus();

  isEnriching = true;
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Scraping profile…');
  setLayerStatus(1, 'running', 'Analyzing Profile…');

  let rawProfileData;
  try {
    rawProfileData = await sendToBackground({ action: 'scrapeProfile' });
  } catch (err) {
    setLayerStatus(1, 'error', 'Failed');
    showCurrentStatus('Could not scrape. Please open a LinkedIn profile tab.', 'error');
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Synthesize Hooks (L1 + L2)');
    return;
  }

  currentProfile = rawProfileData;
  renderProfileCard(rawProfileData);
  setLayerStatus(1, 'running', 'Seniority & Domain…');
  setLayerStatus(2, 'running', 'Synthesizing Hooks…');
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Running L1 + L2 AI…');

  chrome.runtime.sendMessage({ type: 'RUN_ENRICH', payload: { rawProfileData } }, (response) => {
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Synthesize Hooks (L1 + L2)');

    if (chrome.runtime.lastError || !response || response.status === 'error') {
      setLayerStatus(1, 'error', 'Error');
      setLayerStatus(2, 'error', 'Error');
      showCurrentStatus(response?.error || 'Enrichment pipeline error.', 'error');
      return;
    }

    setLayerStatus(1, 'done', `${response.enrichmentJSON.seniority || 'Analyzed'}`);
    setLayerStatus(2, 'done', '3 Angles Ready');
    deepProfileJSON = response.profileJSON;
    deepEnrichmentJSON = response.enrichmentJSON;

    renderHooks(deepEnrichmentJSON);
    setLayerStatus(3, '', 'Ready');
    document.getElementById('deep-generate-btn').disabled = false;
    showCurrentStatus('Angles synthesized! Select an angle or click Generate Message.', 'success');
  });
}

let deepRegenCounter = 0;
async function handleDeepGenerate(isRegenerate = false) {
  if (isGenerating || !deepProfileJSON || !deepEnrichmentJSON) return;
  const hookCount = (deepEnrichmentJSON.topHooks && deepEnrichmentJSON.topHooks.length) || 1;
  const activeHookIndex = isRegenerate
    ? ((selectedHookIndex + (++deepRegenCounter)) % hookCount)
    : selectedHookIndex;

  isGenerating = true;
  setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', true, 'Synthesizing Message (L3)…');
  setLayerStatus(3, 'running', 'Writing…');
  showCurrentStatus('Layer 3: Synthesizing targeted outreach…');
  hideMessage();

  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;

  chrome.runtime.sendMessage(
    {
      type: 'RUN_GENERATE',
      payload: {
        profileJSON: deepProfileJSON,
        enrichmentJSON: deepEnrichmentJSON,
        messageType,
        tone,
        chosenHookIndex: selectedHookIndex,
        formatConstraint: currentFormat
      }
    },
    async (response) => {
      isGenerating = false;
      setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', false, 'Generate Outreach Message (L3)');

      if (chrome.runtime.lastError || !response || response.status === 'error') {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus(response?.error || 'Generation failed.', 'error');
        return;
      }

      setLayerStatus(3, 'done', 'Complete');
      renderMessage(response.generatedMessage);
      showCurrentStatus('Personalized message ready!', 'success');

      await Cache.addContact({
        profileUrl:  deepProfileJSON.profileUrl || '',
        name:        deepProfileJSON.name || 'Unknown',
        headline:    deepProfileJSON.headline || '',
        company:     deepProfileJSON.currentCompany || '',
        message:     response.generatedMessage,
        messageType,
        status:      'Generated',
        timestamp:   Date.now()
      });
      updateRecentBadge();
    }
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await loadStoredSettings();
  if (s.aiProvider) {
    document.getElementById('ai-provider').value = s.aiProvider;
  }
  handleProviderChange();

  if (s.userApiKey)      document.getElementById('api-key').value     = s.userApiKey;
  if (s.userName)        document.getElementById('user-name').value   = s.userName;
  if (s.targetRole)      document.getElementById('target-role').value = s.targetRole;
  if (s.userBio)         document.getElementById('user-bio').value    = s.userBio;
  if (s.preferredFormat) setFormat(s.preferredFormat);

  if (s.resumeFileName) {
    document.getElementById('file-label').textContent = s.resumeFileName;
    document.getElementById('file-upload-area').classList.add('has-file');
    const statusEl = document.getElementById('resume-status');
    statusEl.textContent = `✓ ${s.resumeFileName} saved`;
    statusEl.className   = 'resume-status success';
    statusEl.classList.remove('hidden');
  }
}

async function handleSaveSettings() {
  const aiProvider   = document.getElementById('ai-provider').value;
  const userApiKey   = document.getElementById('api-key').value.trim();
  const userName     = document.getElementById('user-name').value.trim();
  const targetRole   = document.getElementById('target-role').value.trim();
  const userBio      = document.getElementById('user-bio').value.trim();
  const preferredFormat = currentFormat;

  const savePayload = { aiProvider, userApiKey, userName, targetRole, userBio, preferredFormat };
  if (pendingResume) {
    savePayload.resumeBase64   = pendingResume.base64;
    savePayload.resumeFileName = pendingResume.fileName;
    pendingResume = null;
    const statusEl = document.getElementById('resume-status');
    statusEl.textContent = 'Resume saved ✓';
    statusEl.className   = 'resume-status success';
  }
  await new Promise(resolve => chrome.storage.local.set(savePayload, resolve));
  showSettingsStatus('Settings & candidate profile saved!', 'success');
  await checkLicenseStatus();
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  const provider = document.getElementById('ai-provider').value;
  if (!apiKey && provider !== 'local') return;

  const btn = document.getElementById('validate-btn');
  btn.textContent = 'Testing…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey, provider } }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ valid: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });

  btn.textContent = 'Test Key';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    el.textContent = `✓ Key verified! ${result.provider.toUpperCase()} AI active.`;
    el.className   = 'key-validation-status valid';
    const s = await loadStoredSettings();
    await new Promise(resolve => chrome.storage.local.set({ ...s, userApiKey: apiKey, aiProvider: result.provider }, resolve));
    await checkLicenseStatus();
  } else {
    el.textContent = `✗ Verification failed: ${result?.reason || 'Invalid key'}`;
    el.className   = 'key-validation-status invalid';
  }
}

// ─── Pipeline UI ──────────────────────────────────────────────────────────────
function setLayerStatus(layer, status, text) {
  document.getElementById(`l${layer}-dot`).className = `status-dot ${status}`;
  document.getElementById(`l${layer}-text`).textContent = text;
}

function resetLayerStatuses() {
  [1, 2].forEach(n => setLayerStatus(n, '', 'Ready'));
  setLayerStatus(3, '', 'Waiting');
}

function renderHooks(enrichmentJSON) {
  const panel = document.getElementById('hooks-panel');
  const list  = document.getElementById('hooks-list');
  list.innerHTML = '';
  const hooks = enrichmentJSON.topHooks || [];
  if (!hooks.length) return;

  selectedHookIndex = 0;
  hooks.forEach((hook, idx) => {
    const d = document.createElement('div');
    d.className = `hook-item ${idx === 0 ? 'selected' : ''}`;
    d.textContent = hook;
    d.addEventListener('click', () => {
      document.querySelectorAll('.hook-item').forEach(item => item.classList.remove('selected'));
      d.classList.add('selected');
      selectedHookIndex = idx;
      showCurrentStatus(`Selected angle: ${hook.split(':')[0]}`, 'warning');
    });
    list.appendChild(d);
  });
  panel.classList.remove('hidden');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');
  const name = data.name || 'Candidate';
  document.getElementById('profile-avatar').textContent   = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent     = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';
  document.getElementById('profile-location').textContent = data.location ? `• ${data.location}` : '';
}

function renderMessage(text) {
  document.getElementById('generated-message').value = text;
  document.getElementById('message-section').classList.remove('hidden');
  updateCharCount();
}

function hideMessage() {
  document.getElementById('message-section').classList.add('hidden');
}

function updateCharCount() {
  const text = document.getElementById('generated-message').value;
  const count = text.length;
  document.getElementById('char-count').textContent = `${count} chars`;

  const badge = document.getElementById('char-limit-badge');
  const trimBtn = document.getElementById('auto-trim-btn');

  if (currentFormat === 'connection_note') {
    if (count <= 285) {
      badge.textContent = `✓ ${count}/300 (Safe)`;
      badge.className   = 'char-limit-badge';
      trimBtn.classList.add('hidden');
    } else if (count <= 300) {
      badge.textContent = `⚠️ ${count}/300 (Near Limit)`;
      badge.className   = 'char-limit-badge warning';
      trimBtn.classList.add('hidden');
    } else {
      badge.textContent = `✕ ${count}/300 (Over Limit!)`;
      badge.className   = 'char-limit-badge over';
      trimBtn.classList.remove('hidden');
    }
  } else {
    badge.textContent = 'InMail / Full';
    badge.className   = 'char-limit-badge';
    trimBtn.classList.add('hidden');
  }
}

function handleAutoTrim() {
  const ta = document.getElementById('generated-message');
  let text = ta.value;
  if (text.length <= 300) return;

  const trimmed = text.slice(0, 295);
  const lastPeriod = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
  if (lastPeriod > 240) {
    ta.value = trimmed.slice(0, lastPeriod + 1).trim();
  } else {
    const lastSpace = trimmed.lastIndexOf(' ');
    ta.value = (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed).trim() + '…';
  }
  updateCharCount();
  showCurrentStatus('Trimmed cleanly to fit LinkedIn 300-char note limit!', 'success');
}

async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.getElementById('generated-message');
    ta.select();
    document.execCommand('copy');
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary');
  btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  }, 2000);
}

function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(labelId).innerHTML = labelText;
  document.getElementById(spinnerId).classList.toggle('hidden', !loading);
}

// ─── Recent contacts & CRM Tracking ──────────────────────────────────────────
async function updateRecentBadge() {
  const contacts = await Cache.getContacts();
  const badge = document.getElementById('recent-count');
  if (badge) badge.textContent = contacts.length;
}

async function renderRecentContacts(searchQuery = '') {
  const contacts = await Cache.getContacts();
  updateRecentBadge();
  const listEl = document.getElementById('recent-list');
  const emptyEl = document.getElementById('no-recent');
  listEl.innerHTML = '';

  const filtered = contacts.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) ||
           (c.company || '').toLowerCase().includes(q) ||
           (c.headline || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  filtered.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const date = new Date(contact.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  const statusOptions = ['Generated', 'Sent', 'Connected', 'Coffee Chat', 'Replied'];

  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name || 'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline || contact.company || '')}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-status-bar">
      <span style="font-size:11px; color:var(--text-2);">Status:</span>
      <select class="contact-status-select" id="status-sel-${idx}">
        ${statusOptions.map(opt => `<option value="${opt}" ${contact.status === opt ? 'selected' : ''}>${opt}</option>`).join('')}
      </select>
      <span style="font-size:11px; color:var(--text-2); margin-left:auto;">${esc(contact.messageType || 'Networking')}</span>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message || '')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show message</button>
      <div style="display:flex; gap:6px;">
        <button class="btn-ghost" id="del-c-${idx}" title="Remove contact">🗑</button>
        <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
      </div>
    </div>`;

  card.querySelector(`#status-sel-${idx}`).addEventListener('change', async (e) => {
    await Cache.updateContactStatus(contact.profileUrl, e.target.value);
  });

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show message';
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  });

  card.querySelector(`#del-c-${idx}`).addEventListener('click', async () => {
    await Cache.deleteContact(contact.profileUrl);
    renderRecentContacts();
  });

  return card;
}

async function handleExportCSV() {
  const contacts = await Cache.getContacts();
  if (!contacts.length) {
    alert('No contacts saved yet to export.');
    return;
  }
  const csvContent = Cache.exportToCSV(contacts);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ark_outreach_contacts_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background extension worker.'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || 'Background returned an error.'));
        return;
      }
      if (response.data !== undefined) {
        resolve(response.data);
        return;
      }
      if (response.generatedMessage !== undefined) {
        resolve(response.generatedMessage);
        return;
      }
      reject(new Error('Unexpected response format from background.'));
    });
  });
}

// ─── Resume upload ────────────────────────────────────────────────────────────
function processResumeFile(file) {
  const statusEl = document.getElementById('resume-status');
  const dropArea = document.getElementById('file-upload-area');
  const fileLabel = document.getElementById('file-label');

  if (file.type !== 'application/pdf') {
    statusEl.textContent = 'Please upload a PDF file.';
    statusEl.className = 'resume-status error';
    statusEl.classList.remove('hidden');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    statusEl.textContent = 'File too large — max 5MB.';
    statusEl.className = 'resume-status error';
    statusEl.classList.remove('hidden');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1];
    pendingResume = { base64, fileName: file.name };
    fileLabel.textContent = file.name;
    dropArea.classList.add('has-file');
    statusEl.textContent = `✓ ${file.name} ready — click Save Settings to confirm.`;
    statusEl.className = 'resume-status pending';
    statusEl.classList.remove('hidden');
  };
  reader.onerror = () => {
    statusEl.textContent = 'Error reading PDF file.';
    statusEl.className = 'resume-status error';
    statusEl.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'aiProvider',
      'userApiKey',
      'userName',
      'targetRole',
      'userBio',
      'preferredFormat',
      'resumeBase64',
      'resumeFileName'
    ], resolve);
  });
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
