'use strict';

// background.js — Ark Abroad Edition
// Multi-provider AI (Gemini, OpenAI, Anthropic, Smart Local Engine)
// Real 3-Layer Pipeline, Candidate Background Alignment, and LinkedIn 300-Char Limit Enforcement

const PROVIDER_CONFIGS = {
  gemini: {
    name: 'Google Gemini',
    endpoint: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    model: 'gemini-2.5-flash'
  },
  openai: {
    name: 'OpenAI',
    endpoint: () => 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini'
  },
  anthropic: {
    name: 'Anthropic Claude',
    endpoint: () => 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-haiku-20241022'
  }
};

// ─── Router ───────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'scrapeProfile') {
    handleScrapeProfile(sendResponse);
    return true;
  }

  if (message.action === 'generateMessage') {
    handleQuickGenerate(message.data, sendResponse);
    return true;
  }

  if (message.type === 'TEST_API_KEY') {
    handleTestKey(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'RUN_ENRICH') {
    handleEnrich(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'RUN_GENERATE') {
    handleDeepGenerate(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'SAVE_RECENT') {
    chrome.storage.local.get(['recentContacts'], (result) => {
      const recent = result.recentContacts || [];
      const updated = [message.payload, ...recent.filter(c => c.profileUrl !== message.payload.profileUrl)].slice(0, 100);
      chrome.storage.local.set({ recentContacts: updated });
      sendResponse({ status: 'saved' });
    });
    return true;
  }

  if (message.type === 'GET_RECENT') {
    chrome.storage.local.get(['recentContacts'], (result) => {
      sendResponse({ contacts: result.recentContacts || [] });
    });
    return true;
  }
});

// ─── Scrape profile from active tab ───────────────────────────────────────────
async function handleScrapeProfile(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error('No active browser tab found.');
    if (!tab.url || !tab.url.includes('linkedin.com/in/')) {
      throw new Error('Please navigate to a LinkedIn profile page first (e.g. linkedin.com/in/username).');
    }

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      await delay(400);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    }

    if (!result?.success) throw new Error(result?.error || 'Profile scrape failed.');
    sendResponse({ success: true, data: result.data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Test user's API key ──────────────────────────────────────────────────────
async function handleTestKey({ apiKey, provider }, sendResponse) {
  try {
    const targetProvider = provider || detectProviderFromKey(apiKey);
    await callAIProvider(targetProvider, apiKey, 'Reply with the single word: OK', 150);
    sendResponse({ valid: true, provider: targetProvider });
  } catch (err) {
    sendResponse({ valid: false, reason: err.message });
  }
}

function detectProviderFromKey(key = '') {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-')) return 'openai';
  if (k.startsWith('AIza')) return 'gemini';
  return 'gemini';
}

// ─── Quick Mode generate ──────────────────────────────────────────────────────
async function handleQuickGenerate(data, sendResponse) {
  try {
    const { profileData, settings: overrideSettings, messageType, tone, formatConstraint } = data || {};
    const p = normalizeProfile(profileData);
    const hooks = buildHooks(p);
    const stored = await getStoredConfig();
    const settings = { ...stored, ...(overrideSettings || {}) };

    const format = formatConstraint || settings.preferredFormat || 'connection_note';
    let message = '';

    if (settings.userApiKey) {
      const provider = settings.aiProvider || detectProviderFromKey(settings.userApiKey);
      message = await generateAIMessage(provider, settings.userApiKey, p, hooks, messageType, tone, format, settings);
    } else {
      message = localMessage(p, hooks, messageType, tone, format, settings);
    }

    if (format === 'connection_note') {
      message = enforceCharLimit(message, 300);
    }

    sendResponse({ success: true, generatedMessage: message });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Deep Mode enrich (L1 + L2) ───────────────────────────────────────────────
async function handleEnrich({ rawProfileData }, sendResponse) {
  try {
    const p = normalizeProfile(rawProfileData);
    const settings = await getStoredConfig();

    const seniority = detectSeniority(p.currentTitle, p.experienceEntries);
    const domain = detectDomain(p.headline, p.currentTitle, p.skills);
    const isAussieMarket = /australia|sydney|melbourne|brisbane|perth|adelaide|au\b/i.test(p.location);

    const profileJSON = {
      ...p,
      intelligence: {
        seniority,
        domain,
        isAussieMarket,
        targetAngle: seniority === 'Executive' || seniority === 'Leader'
          ? 'Leadership perspective & industry evolution'
          : 'Technical practice & career trajectory advice'
      }
    };

    const topHooks = buildStrategicHooks(profileJSON, settings);

    await delay(350);
    sendResponse({
      status: 'enrich_complete',
      profileJSON,
      enrichmentJSON: {
        topHooks,
        seniority,
        domain,
        market: isAussieMarket ? 'Australian Corporate Market' : 'Global'
      }
    });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

// ─── Deep Mode generate (L3) ──────────────────────────────────────────────────
async function handleDeepGenerate({ profileJSON, enrichmentJSON, messageType, tone, chosenHookIndex, formatConstraint }, sendResponse) {
  try {
    const settings = await getStoredConfig();
    const hooks = enrichmentJSON?.topHooks || buildHooks(profileJSON);
    const selectedHook = (chosenHookIndex !== undefined && hooks[chosenHookIndex]) ? hooks[chosenHookIndex] : hooks[0];
    const format = formatConstraint || settings.preferredFormat || 'connection_note';

    let message = '';
    if (settings.userApiKey) {
      const provider = settings.aiProvider || detectProviderFromKey(settings.userApiKey);
      message = await generateAIMessage(provider, settings.userApiKey, profileJSON, [selectedHook, ...hooks], messageType, tone, format, settings);
    } else {
      message = localMessage(profileJSON, [selectedHook, ...hooks], messageType, tone, format, settings);
    }

    if (format === 'connection_note') {
      message = enforceCharLimit(message, 300);
    }

    sendResponse({ status: 'generate_complete', generatedMessage: message });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

// ─── Profile Intelligence Helpers ─────────────────────────────────────────────
function normalizeProfile(raw = {}) {
  const rawName = (raw.name || '').trim();
  const firstName = rawName.split(/\s+/)[0] || 'there';
  return {
    name: rawName,
    firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
    headline: raw.headline || '',
    currentTitle: raw.currentTitle || '',
    currentCompany: raw.currentCompany || '',
    location: raw.location || '',
    about: raw.about || '',
    recentPosts: raw.recentPosts || [],
    experienceEntries: raw.experienceEntries || [],
    pastCompanies: raw.pastCompanies || [],
    educationEntries: raw.educationEntries || [],
    skills: raw.skills || [],
    profileUrl: raw.profileUrl || ''
  };
}

function detectSeniority(title = '', exp = []) {
  const t = title.toLowerCase();
  if (/founder|co-founder|ceo|cto|cpo|vp|vice president|partner|managing director|head of/i.test(t)) return 'Executive';
  if (/director|lead|principal|staff|manager|supervisor/i.test(t)) return 'Leader';
  if (/senior|sr\./i.test(t)) return 'Senior';
  if (/intern|graduate|junior|associate|trainee/i.test(t)) return 'Junior';
  return 'Practitioner';
}

function detectDomain(headline = '', title = '', skills = []) {
  const combined = `${headline} ${title} ${skills.join(' ')}`.toLowerCase();
  if (/software|engineer|frontend|backend|fullstack|developer|python|javascript|react/i.test(combined)) return 'Software Engineering';
  if (/product manager|product management|growth|agile|scrum/i.test(combined)) return 'Product Management';
  if (/data analyst|data science|machine learning|ai|bi|analytics/i.test(combined)) return 'Data & AI';
  if (/finance|accountant|audit|banking/i.test(combined)) return 'Finance & Accounting';
  if (/marketing|content|brand|seo/i.test(combined)) return 'Marketing';
  return 'Professional';
}

function buildStrategicHooks(p, settings) {
  const hooks = [];

  if (p.recentPosts && p.recentPosts.length) {
    hooks.push(`Post Insight: Loved your commentary on "${truncate(p.recentPosts[0], 75)}"`);
  }

  if (p.currentTitle && p.currentCompany) {
    hooks.push(`Company Role: Noticed your impact as ${p.currentTitle} at ${p.currentCompany}`);
  } else if (p.currentCompany) {
    hooks.push(`Company Momentum: Following ${p.currentCompany}'s growth in the Australian market`);
  }

  if (settings.targetRole && p.currentTitle) {
    hooks.push(`Career Bridge: Aligning with your work in ${p.currentTitle} as an aspiring ${settings.targetRole.trim()}`);
  } else if (p.skills && p.skills.length) {
    hooks.push(`Skill Synergy: Impressed by your focus on ${p.skills.slice(0, 3).join(', ')}`);
  }

  if (p.pastCompanies && p.pastCompanies.length) {
    hooks.push(`Career Path: Saw your progression from ${p.pastCompanies[0]} to ${p.currentCompany || 'your current role'}`);
  }

  if (!hooks.length && p.headline) {
    hooks.push(`Headline: ${p.headline}`);
  }

  return hooks.slice(0, 3);
}

function buildHooks(p) {
  return buildStrategicHooks(p, {});
}

// ─── Local (Free) Message Generator — Ark Abroad Tuned ─────────────────────────
let localVariantCounter = 0;
function localMessage(p, hooks, messageType, tone, format, settings = {}) {
  const v = localVariantCounter++;
  const senderName = (settings.userName || '').trim();
  const targetRole = (settings.targetRole || settings.userBio || '').trim();
  const isCoffeeChat = /coffee|network/i.test(String(messageType || ''));
  const role = p.currentTitle || 'your role';
  const co = p.currentCompany ? ` at ${p.currentCompany}` : '';

  const greet = {
    Formal: `Dear ${p.firstName},`,
    Neutral: `Hi ${p.firstName},`,
    Casual: `Hey ${p.firstName},`
  }[tone] || `Hi ${p.firstName},`;

  const signoff = {
    Formal: 'Kind regards,',
    Neutral: 'Best regards,',
    Casual: 'Cheers,'
  }[tone] || 'Best,';

  if (format === 'connection_note') {
    if (isCoffeeChat) {
      const variants = [
        `${greet} Impressed by your work as ${role}${co}. Would love to connect and hear a quick insight on your journey at ${p.currentCompany || 'your team'}.`,
        `${greet} Admire your path${co}. Would value connecting to learn a quick tip from your experience in ${role}.`,
        `${greet} Following ${p.currentCompany || 'your space'} and really value your perspective as ${role}. Open to connecting?`
      ];
      let note = variants[v % variants.length];
      if (note.length > 295) {
        note = `${greet} Impressed by your path at ${p.currentCompany || 'your team'}. Would love to connect and learn from your experience!`;
      }
      return enforceCharLimit(note, 300);
    }

    if (messageType === 'Job') {
      const note = `${greet} Following ${p.currentCompany || 'your team'}'s growth. As an aspiring ${targetRole || 'professional'}, I'd love to connect and follow your team's work.`;
      return enforceCharLimit(note, 300);
    }

    if (messageType === 'Referral') {
      const note = `${greet} Inspiring background in ${role}. I'm exploring roles at ${p.currentCompany || 'your company'} and would value connecting!`;
      return enforceCharLimit(note, 300);
    }

    const note = `${greet} Came across your profile while researching leaders in ${p.currentCompany || role}. Would love to connect and follow your work!`;
    return enforceCharLimit(note, 300);
  }

  const openings = [
    `I came across your profile and was really impressed by your background as ${role}${co}.`,
    `I've been following ${p.currentCompany || 'your industry'} closely and stood out by your experience as ${role}${co}.`,
    `Your career trajectory as ${role}${co} caught my attention while researching leaders in the space.`
  ];
  let opening = openings[v % openings.length];
  if (p.recentPosts && p.recentPosts.length && v % 2 === 0) {
    opening = `I recently came across your post about "${truncate(p.recentPosts[0], 55)}" and really appreciated your perspective.`;
  }

  let bridge = '';
  if (targetRole) {
    bridge = `\n\nI am currently positioning myself as a ${targetRole} within the corporate market and have been following ${p.currentCompany || 'your industry'}'s developments closely.`;
  }

  let bodyAsk = '';
  if (isCoffeeChat) {
    const coffeeAsks = [
      `\n\nIf you have 10-15 minutes in the coming weeks, I would be incredibly grateful for a virtual coffee chat to hear your perspective on the space. No pitch at all—just eager to learn from your journey.`,
      `\n\nWould you be open to a brief 15-minute virtual chat sometime soon? I'd love to hear your insights on navigating ${p.currentCompany || 'the industry'}—strictly looking to learn, no pitch.`,
      `\n\nIf your schedule allows for a quick 10-minute coffee chat over the next couple of weeks, I'd really value hearing your take on the field and any advice for someone following a similar path.`
    ];
    bodyAsk = coffeeAsks[v % coffeeAsks.length];
  } else if (messageType === 'Job') {
    const jobAsks = [
      `\n\nI'm actively exploring opportunities where I can contribute to teams doing high-impact work like yours. Would you be open to a brief chat or pointing me toward the right team lead?`,
      `\n\nI'd love to learn more about how your team operates at ${p.currentCompany || 'your organization'} and whether there are upcoming opportunities that align with my background.`
    ];
    bodyAsk = jobAsks[v % jobAsks.length];
  } else if (messageType === 'Referral') {
    const referralAsks = [
      `\n\nI noticed an opening aligning with ${p.currentCompany || 'your department'}. If you are open to it, I'd value 5 minutes to introduce my background and see if you feel comfortable providing a referral or guidance.`,
      `\n\nI'm preparing an application for a role at ${p.currentCompany || 'your company'} and would be grateful for 5 minutes of your perspective—or guidance on the best way to put my best foot forward.`
    ];
    bodyAsk = referralAsks[v % referralAsks.length];
  } else {
    const collabAsks = [
      `\n\nI would love to connect to exchange ideas and follow your journey in the field.`,
      `\n\nI'd welcome the chance to stay in touch, swap notes on the industry, and follow your ongoing work.`
    ];
    bodyAsk = collabAsks[v % collabAsks.length];
  }

  const signature = senderName ? `\n\n${signoff}\n${senderName}` : `\n\n${signoff}`;
  return `${greet}\n\n${opening}${bridge}${bodyAsk}${signature}`;
}

// ─── Multi-Provider AI Caller ─────────────────────────────────────────────────
async function generateAIMessage(provider, apiKey, p, hooks, messageType, tone, format, settings) {
  const isNote = format === 'connection_note';

  const prompt = `
You are an expert career networking assistant for Ark Abroad specializing in LinkedIn outreach messages for corporate professionals and job seekers.
Task: Write a personalized, natural, engaging LinkedIn ${isNote ? 'Connection Request Note' : 'Outreach Message'}.

STRICT CONSTRAINTS:
1. MAX LENGTH: ${isNote ? 'STRICTLY under 285 characters (hard limit for LinkedIn invitation note)' : 'Target 400-650 characters, complete with greeting, body, and sign-off'}.
2. Do NOT sound like generic AI spam. Avoid cliches like "I hope this finds you well", "I was blown away by", "deep dive", "synergy".
3. Sound warm, humble, respectful, and natural.
4. Purpose: ${messageType || 'Networking'}. Tone: ${tone || 'Warm & Professional'}.

RECIPIENT:
- Name: ${p.name} (Address as "${p.firstName}")
- Headline: ${p.headline}
- Current Title & Company: ${p.currentTitle || 'N/A'} at ${p.currentCompany || 'N/A'}
- Location: ${p.location || 'N/A'}
- Recent Activity / Context: ${hooks.join(' | ')}

SENDER CONTEXT:
- Name: ${(settings.userName || '').trim() || '(Sender)'}
- Target Role: ${(settings.targetRole || '').trim() || 'Professional'}
- Background: ${(settings.userBio || '').trim() || '(Ambitious professional expanding corporate network)'}

OUTPUT RULES:
- Output ONLY the complete message text. No quotes, no markdown fences, no preamble, no explanations.
${isNote ? '- MUST be fewer than 290 characters so it fits the 300-char LinkedIn note limit!' : '- Write the FULL message from greeting to sign-off without cutting off.'}
`.trim();

  let resultText = await callAIProvider(provider, apiKey, prompt, isNote ? 800 : 1500);
  resultText = resultText.replace(/^["']|["']$/g, '').trim();

  if (isNote) {
    resultText = enforceCharLimit(resultText, 300);
  }
  return resultText;
}

async function callAIProvider(provider, apiKey, prompt, maxTokens) {
  if (provider === 'gemini') {
    const url = PROVIDER_CONFIGS.gemini.endpoint(apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error (${res.status})`);
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'openai') {
    const res = await fetch(PROVIDER_CONFIGS.openai.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: PROVIDER_CONFIGS.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI API error (${res.status})`);
    return data?.choices?.[0]?.message?.content || '';
  }

  // Anthropic Claude
  const res = await fetch(PROVIDER_CONFIGS.anthropic.endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: PROVIDER_CONFIGS.anthropic.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error (${res.status})`);
  return (data.content || []).map(c => c.text || '').join('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function enforceCharLimit(text, limit = 300) {
  if (!text || text.length <= limit) return text;
  const trimmed = text.slice(0, limit);
  const lastPeriod = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
  if (lastPeriod > limit - 60) {
    return trimmed.slice(0, lastPeriod + 1).trim();
  }
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed).trim() + '…';
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getStoredConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'userApiKey',
      'aiProvider',
      'userName',
      'userBio',
      'targetRole',
      'preferredFormat'
    ], r => resolve(r || {}));
  });
}