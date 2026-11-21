'use strict';

// Cache utility — stores contacts in chrome.storage.local with status tracking & CSV export

const Cache = (() => {
  const KEY = 'recentContacts';
  const MAX = 100;

  async function getContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.get([KEY], (result) => {
        resolve(result[KEY] || []);
      });
    });
  }

  async function addContact(contact) {
    const contacts = await getContacts();
    // Normalize contact data
    const item = {
      profileUrl: contact.profileUrl || '',
      name: contact.name || 'Unknown',
      headline: contact.headline || '',
      company: contact.company || '',
      message: contact.message || '',
      messageType: contact.messageType || 'Networking',
      status: contact.status || 'Generated',
      timestamp: contact.timestamp || Date.now()
    };
    // Remove duplicate by profileUrl if present
    const filtered = contacts.filter(c => c.profileUrl !== item.profileUrl);
    const updated = [item, ...filtered].slice(0, MAX);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: updated }, () => resolve(updated));
    });
  }

  async function updateContactStatus(profileUrl, newStatus) {
    const contacts = await getContacts();
    const updated = contacts.map(c => {
      if (c.profileUrl === profileUrl) {
        return { ...c, status: newStatus };
      }
      return c;
    });
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: updated }, () => resolve(updated));
    });
  }

  async function deleteContact(profileUrl) {
    const contacts = await getContacts();
    const updated = contacts.filter(c => c.profileUrl !== profileUrl);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: updated }, () => resolve(updated));
    });
  }

  async function clearContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: [] }, () => resolve([]));
    });
  }

  function exportToCSV(contacts) {
    if (!contacts || !contacts.length) return '';
    const headers = ['Name', 'Headline', 'Company', 'Status', 'Message Type', 'Date', 'Profile URL', 'Generated Message'];
    const rows = contacts.map(c => {
      const date = new Date(c.timestamp).toISOString().split('T')[0];
      const cleanField = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
      return [
        cleanField(c.name),
        cleanField(c.headline),
        cleanField(c.company),
        cleanField(c.status || 'Generated'),
        cleanField(c.messageType || 'Networking'),
        cleanField(date),
        cleanField(c.profileUrl),
        cleanField(c.message)
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\r\n');
  }

  return {
    getContacts,
    addContact,
    updateContactStatus,
    deleteContact,
    clearContacts,
    exportToCSV
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cache;
}
