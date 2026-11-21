'use strict';

// content_script.js — Ark Abroad Edition
// Scrapes LinkedIn profile details with robust selectors, name cleaning, and provides in-page quick outreach widget

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrapeProfile') {
    scrapeWithScroll().then(profile => {
      sendResponse({ success: true, data: profile });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function scrapeWithScroll() {
  const originalY = window.scrollY;
  // Smoothly scroll down to trigger lazy loading of About, Experience, and Activity
  window.scrollTo({ top: 700, behavior: 'instant' });
  await wait(400);
  window.scrollTo({ top: 1400, behavior: 'instant' });
  await wait(400);
  window.scrollTo({ top: 2100, behavior: 'instant' });
  await wait(450);
  window.scrollTo({ top: originalY, behavior: 'instant' });
  await wait(250);
  return scrapeProfile();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanPersonName(rawName) {
  if (!rawName) return '';
  let name = clean(rawName);
  // Remove connection degree markers like · 1st, · 2nd, · 3rd, (1st), etc.
  name = name.replace(/[·•]\s*(?:1st|2nd|3rd|\d+th)(?:\s*degree\s*connection)?/gi, '');
  name = name.replace(/\((?:1st|2nd|3rd)\)/gi, '');
  // Remove pronouns in parentheses or brackets e.g. (He/Him), (She/Her), [They/Them]
  name = name.replace(/[\(\[](?:he\/him|she\/her|they\/them|he\/they|she\/they)[^\)\]]*[\)\]]/gi, '');
  // Remove trailing certifications or emoji status if separated by comma or pipe (e.g. "John Doe, PMP")
  name = name.replace(/,(?:\s*(?:PMP|CPA|MD|PhD|MBA|Esq|PE|SHRM[^\s,]*))\b/gi, '');
  // Remove common verification symbols/emojis
  name = name.replace(/[\u2705\u2714\uFE0F\uD83C-\uDBFF\uDC00-\uDFFF]/g, '');
  return clean(name);
}

function scrapeProfile() {
  // Find section by h2 heading text or id
  function getSection(heading) {
    const byId = document.getElementById(heading.toLowerCase());
    if (byId) {
      const parentSection = byId.closest('section');
      if (parentSection) return parentSection;
    }
    return Array.from(document.querySelectorAll('section')).find(s => {
      const h2 = s.querySelector('h2');
      return h2 && h2.innerText && h2.innerText.trim().toLowerCase().includes(heading.toLowerCase());
    }) || null;
  }

  // Get all leaf text nodes from a section
  function getTexts(section) {
    if (!section) return [];
    return Array.from(section.querySelectorAll('p, span, div'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText))
      .filter(t => t.length > 2 && !/^[·•\s]+$/.test(t));
  }

  // ── NAME ──────────────────────────────────────────────────────────────────
  const h1El = document.querySelector('h1.text-heading-xlarge') ||
               document.querySelector('h1') ||
               document.querySelector('.pv-top-card--list li') ||
               document.querySelector('div[data-anonymize="person-name"]');
  
  const rawName = h1El ? h1El.innerText : document.title.split('|')[0];
  const name = cleanPersonName(rawName);

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  let headline = '';
  const headlineEl = document.querySelector('.text-body-medium.break-words') ||
                     document.querySelector('div.text-body-medium[data-generated-suggestion-target]') ||
                     document.querySelector('.pv-text-details__left-panel .text-body-medium');
  if (headlineEl) {
    headline = clean(headlineEl.innerText);
  } else {
    // Fallback: search within top-card section
    const topCard = document.querySelector('.pv-top-card') || document.querySelector('section');
    if (topCard) {
      const pTags = Array.from(topCard.querySelectorAll('div, p'))
        .filter(el => el.children.length === 0)
        .map(el => clean(el.innerText))
        .filter(t => t.length > 5 && t !== name && !t.includes('connections') && !t.includes('Contact info'));
      headline = pTags.find(t =>
        t.includes('|') || t.includes('@') || t.includes('·') ||
        /manager|engineer|analyst|developer|designer|founder|director|lead|specialist|consultant|intern|fellow|head|vp/i.test(t)
      ) || pTags[0] || '';
    }
  }

  // ── CURRENT COMPANY ───────────────────────────────────────────────────────
  let currentCompany = '';
  const currentCompanyBtn = document.querySelector('button[aria-label*="Current company"]') ||
                            document.querySelector('.pv-text-details__right-panel .inline-show-more-text') ||
                            document.querySelector('.pv-top-card--experience-list-item');
  if (currentCompanyBtn) {
    currentCompany = clean(currentCompanyBtn.innerText);
  }

  // ── LOCATION ──────────────────────────────────────────────────────────────
  let location = '';
  const locEl = document.querySelector('.pv-text-details__left-panel .text-body-small.inline.t-black--light') ||
                document.querySelector('.pv-top-card--list-bullet li') ||
                document.querySelector('span.text-body-small[inline]');
  if (locEl) {
    location = clean(locEl.innerText).replace(/Contact info.*/i, '').trim();
  }
  if (!location) {
    const topSection = document.querySelector('.pv-top-card') || document.querySelector('section');
    if (topSection) {
      const texts = getTexts(topSection);
      const found = texts.find(t => (t.includes(',') || /sydney|melbourne|brisbane|perth|adelaide|australia|au\b|united states|uk|canada|india/i.test(t)) && t.length < 60 && !t.includes(name));
      if (found) location = found;
    }
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  let about = '';
  const aboutSection = getSection('About');
  if (aboutSection) {
    const fullTextEl = aboutSection.querySelector('.inline-show-more-text') ||
                       aboutSection.querySelector('.pv-shared-text-with-see-more');
    if (fullTextEl) {
      about = clean(fullTextEl.innerText);
    } else {
      const texts = getTexts(aboutSection);
      const longText = texts.find(t => t.length > 70 && !t.includes('Experience') && !t.includes('Skills'));
      if (longText) about = longText;
    }
  }

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const experienceEntries = [];
  const expSection = getSection('Experience');
  if (expSection) {
    const listItems = expSection.querySelectorAll('li.artdeco-list__item, li.pvs-list__item--line-separated');
    if (listItems.length > 0) {
      listItems.forEach(li => {
        const textElements = Array.from(li.querySelectorAll('span[aria-hidden="true"]'))
          .map(el => clean(el.innerText))
          .filter(t => t.length > 1 && !/^[·•\s]+$/.test(t));
        if (textElements.length >= 2) {
          const title = textElements[0];
          const companyRaw = textElements[1];
          const duration = textElements[2] || '';
          experienceEntries.push({
            title,
            company: companyRaw.split('·')[0].trim(),
            duration: /\d{4}|present|yr|mos|mo\b/i.test(duration) ? duration : null,
            isCurrent: experienceEntries.length === 0
          });
        }
      });
    }

    // Fallback if list items selector changed
    if (experienceEntries.length === 0) {
      const pTags = Array.from(expSection.querySelectorAll('p, span'))
        .filter(p => p.children.length === 0)
        .map(p => clean(p.innerText))
        .filter(t => t.length > 2 && t.toLowerCase() !== 'experience');
      let i = 0;
      while (i < pTags.length) {
        const title = pTags[i];
        const company = pTags[i+1] || null;
        const dur = pTags[i+2] || null;
        if (/^\d{4}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(title)) {
          i++; continue;
        }
        experienceEntries.push({
          title,
          company: company ? company.split('·')[0].trim() : null,
          duration: dur && /\d{4}|present|yr|mos|mo\b/i.test(dur) ? dur : null,
          isCurrent: experienceEntries.length === 0
        });
        i += 3;
      }
    }
  }

  const currentEntry = experienceEntries[0] || null;
  const currentTitle = currentEntry?.title || extractFromHeadline(headline, 'title');
  if (!currentCompany) {
    currentCompany = currentEntry?.company || extractFromHeadline(headline, 'company');
  }
  const pastCompanies = [...new Set(
    experienceEntries.slice(1).map(e => e.company).filter(Boolean)
  )];

  // ── SKILLS ────────────────────────────────────────────────────────────────
  const skills = [];
  const skillsSection = getSection('Skills');
  if (skillsSection) {
    const skillItems = skillsSection.querySelectorAll('.artdeco-list__item span[aria-hidden="true"], span.hoverable-link-text');
    if (skillItems.length > 0) {
      skillItems.forEach(el => {
        const text = clean(el.innerText);
        if (text && text.length < 50 && text.length > 1 && !skills.includes(text) && !/endorse|show all|skill/i.test(text)) {
          skills.push(text);
        }
      });
    }
    if (skills.length === 0) {
      const texts = getTexts(skillsSection);
      texts.filter(t =>
        t !== 'Skills' &&
        t.length < 60 &&
        t.length > 2 &&
        !/\d{4}|follower|connection|endorsement|endorse|show all|see all|dialog|window|escape/i.test(t)
      ).forEach(t => { if (!skills.includes(t)) skills.push(t); });
    }
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const educationEntries = [];
  const eduSection = getSection('Education');
  if (eduSection) {
    const eduItems = eduSection.querySelectorAll('li.artdeco-list__item, li.pvs-list__item--line-separated');
    if (eduItems.length > 0) {
      eduItems.forEach(li => {
        const texts = Array.from(li.querySelectorAll('span[aria-hidden="true"]'))
          .map(el => clean(el.innerText))
          .filter(t => t.length > 2);
        if (texts.length > 0) {
          educationEntries.push(texts.slice(0, 2).join(' — '));
        }
      });
    }
  }

  // ── RECENT POSTS / ACTIVITY ───────────────────────────────────────────────
  const recentPosts = [];
  const activitySection = getSection('Activity');
  const isEmptyPostPlaceholder = (t) =>
    /posts you share will be displayed here|no posts yet|hasn't posted|nothing to see for now|show all posts|all activity|posts\s+comments\s+videos\s+images/i.test(t);

  if (activitySection) {
    const primaryPostEls = activitySection.querySelectorAll(
      '.feed-shared-update-v2__description, .update-components-text, .occludable-update .break-words'
    );
    const candidates = primaryPostEls.length > 0
      ? Array.from(primaryPostEls)
      : Array.from(activitySection.querySelectorAll('p, span[aria-hidden="true"]'));

    candidates
      .map(el => clean(el.innerText))
      .filter(t =>
        t.length > 30 && t.length < 400 &&
        !isEmptyPostPlaceholder(t) &&
        !/dialog|window|escape|cancel|close|beginning|notifications|premium|people you may|you might|reactions?|comments?/i.test(t)
      )
      .forEach(t => { if (!recentPosts.includes(t)) recentPosts.push(t); });
  }

  return {
    name,
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    recentPosts: recentPosts.slice(0, 3),
    experienceEntries: experienceEntries.slice(0, 5),
    pastCompanies: pastCompanies.slice(0, 4),
    educationEntries: educationEntries.slice(0, 3),
    skills: skills.slice(0, 10),
    profileUrl: window.location.href.split('?')[0],
    rawTitle: document.title
  };
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
  if (pipeMatch) return field === 'title' ? pipeMatch[1].trim() : pipeMatch[2].trim();
  return null;
}

// ── In-page Floating Outreach Widget ─────────────────────────────────────────
function injectFloatingButton() {
  if (document.getElementById('ark-outreach-root')) return;
  if (!window.location.href.includes('/in/')) return;

  const root = document.createElement('div');
  root.id = 'ark-outreach-root';
  root.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const btn = document.createElement('button');
  btn.id = 'ark-floating-btn';
  btn.innerHTML = `
    <span style="font-weight:700; font-size:14px; margin-right:4px;">⚡</span>
    <span style="font-weight:600; font-size:12.5px;">Ark Outreach</span>
  `;
  btn.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 15px;
    background: #1A56DB;
    color: #ffffff;
    border: none;
    border-radius: 30px;
    box-shadow: 0 4px 14px rgba(26, 86, 219, 0.35);
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 6px 18px rgba(26, 86, 219, 0.45)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateY(0)';
    btn.style.boxShadow = '0 4px 14px rgba(26, 86, 219, 0.35)';
  });

  btn.addEventListener('click', async () => {
    btn.innerHTML = `<span style="font-size:12px;">Scraping…</span>`;
    try {
      const profile = await scrapeWithScroll();
      btn.innerHTML = `<span style="font-size:12px;">Opening…</span>`;
      // Open modal or notify
      showInPageModal(profile);
    } catch (e) {
      btn.innerHTML = `<span style="font-size:12px;">Error: ${e.message}</span>`;
    } finally {
      setTimeout(() => {
        btn.innerHTML = `
          <span style="font-weight:700; font-size:14px; margin-right:4px;">⚡</span>
          <span style="font-weight:600; font-size:12.5px;">Ark Outreach</span>
        `;
      }, 2000);
    }
  });

  root.appendChild(btn);
  document.body.appendChild(root);
}

function showInPageModal(profile) {
  let modal = document.getElementById('ark-outreach-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'ark-outreach-modal';
  modal.style.cssText = `
    position: fixed;
    bottom: 74px;
    right: 24px;
    width: 360px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
    border: 1px solid #E0D8CC;
    z-index: 999999;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1A1712;
    animation: arkFadeIn 0.2s ease-out;
  `;

  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #ECE6DB; padding-bottom:8px;">
      <div style="font-weight:700; font-size:13px; color:#1A56DB; display:flex; align-items:center; gap:5px;">
        <span>⚡ Ark Outreach AI</span>
      </div>
      <button id="ark-modal-close" style="background:none; border:none; font-size:16px; cursor:pointer; color:#888;">✕</button>
    </div>
    <div style="font-size:12px; color:#555;">
      Target: <strong>${escapeHtml(profile.name || 'Candidate')}</strong> — ${escapeHtml(profile.currentCompany || profile.headline || 'LinkedIn Member')}
    </div>
    <div style="display:flex; gap:6px;">
      <select id="ark-modal-type" style="flex:1; padding:6px; font-size:11.5px; border:1px solid #CCD; border-radius:6px;">
        <option value="Networking">☕ 15-min Coffee Chat</option>
        <option value="Job">💼 Job Inquiry</option>
        <option value="Hiring">🤝 Referral / Hiring</option>
        <option value="Collaboration">💡 Collaboration</option>
      </select>
      <select id="ark-modal-format" style="width:130px; padding:6px; font-size:11.5px; border:1px solid #CCD; border-radius:6px;">
        <option value="note">Note (&lt;300 ch)</option>
        <option value="full">InMail / Message</option>
      </select>
    </div>
    <button id="ark-modal-gen-btn" style="background:#1A56DB; color:#fff; padding:8px; border:none; border-radius:6px; font-weight:600; font-size:12px; cursor:pointer;">
      Generate Message
    </button>
    <div id="ark-modal-result-wrap" style="display:none; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; font-size:11px; color:#666;">
        <span>Preview</span>
        <span id="ark-modal-char-count">0 chars</span>
      </div>
      <textarea id="ark-modal-textarea" rows="5" style="width:100%; box-sizing:border-box; border:1px solid #CCD; border-radius:6px; padding:8px; font-size:12px; line-height:1.45;"></textarea>
      <div style="display:flex; gap:6px;">
        <button id="ark-modal-copy" style="flex:1; background:#057A55; color:#fff; border:none; border-radius:6px; padding:7px; font-size:11.5px; font-weight:600; cursor:pointer;">
          Copy to Clipboard
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#ark-modal-close').addEventListener('click', () => modal.remove());

  const genBtn = modal.querySelector('#ark-modal-gen-btn');
  const resWrap = modal.querySelector('#ark-modal-result-wrap');
  const ta = modal.querySelector('#ark-modal-textarea');
  const cc = modal.querySelector('#ark-modal-char-count');
  const copyBtn = modal.querySelector('#ark-modal-copy');
  let modalVariation = 0;

  genBtn.addEventListener('click', async () => {
    genBtn.textContent = 'Generating…';
    genBtn.disabled = true;
    try {
      const type = modal.querySelector('#ark-modal-type').value;
      const format = modal.querySelector('#ark-modal-format').value;
      chrome.runtime.sendMessage({
        action: 'generateMessage',
        data: {
          profileData: profile,
          messageType: type,
          tone: 'Neutral',
          formatConstraint: format === 'note' ? 'connection_note' : 'full',
          variation: modalVariation++
        }
      }, (resp) => {
        if (chrome.runtime.lastError) {
          genBtn.textContent = 'Generate Message';
          genBtn.disabled = false;
          alert('Extension background worker is waking up. Please try again.');
          return;
        }
        genBtn.textContent = 'Regenerate';
        genBtn.disabled = false;
        if (resp && resp.success) {
          resWrap.style.display = 'flex';
          ta.value = resp.generatedMessage;
          cc.textContent = `${ta.value.length} chars`;
          if (format === 'note' && ta.value.length > 300) {
            cc.style.color = '#C81E1E';
            cc.textContent += ' (Over 300!)';
          } else {
            cc.style.color = '#057A55';
          }
        } else {
          alert('Could not generate message: ' + (resp?.error || 'Unknown error'));
        }
      });
    } catch (e) {
      genBtn.textContent = 'Generate Message';
      genBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(ta.value).catch(() => {});
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
  });
}

// Inject on load if on LinkedIn profile
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  injectFloatingButton();
} else {
  window.addEventListener('DOMContentLoaded', injectFloatingButton);
}
// Handle SPA page navigation within LinkedIn
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    if (currentUrl.includes('/in/')) {
      setTimeout(injectFloatingButton, 1000);
    }
  }
}).observe(document, { subtree: true, childList: true });