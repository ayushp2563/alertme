/**
 * HTML normalization, content hashing, and diff summary utilities.
 */

const DiffUtil = (() => {
  const NOISE_PATTERNS = [
    /\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?\b/g,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d+\s*(views?|likes?|comments?|shares?|followers?|subscribers?)\b/gi,
    /\b(updated|posted|published|last modified)\s*:?\s*\d+/gi,
    /session[_-]?id[=:]\S+/gi,
    /csrf[_-]?token[=:]\S+/gi,
    /nonce[=:]\S+/gi,
    /\b\d+\s*(minutes?|hours?|days?|seconds?)\s+ago\b/gi,
  ];

  function stripNoiseFromText(text) {
    let cleaned = text;
    for (const pattern of NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  /**
   * Regex-based extraction for service worker context (no DOMParser).
   */
  function extractTextFromHtml(html, selector = null) {
    let cleaned = html;

    // Remove script/style blocks and HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ' ');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    cleaned = cleaned.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

    if (selector) {
      const extracted = extractBySelector(cleaned, selector);
      if (extracted) cleaned = extracted;
    }

    // Strip remaining tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    cleaned = cleaned.replace(/&nbsp;/g, ' ');
    cleaned = cleaned.replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/&lt;/g, '<');
    cleaned = cleaned.replace(/&gt;/g, '>');
    cleaned = cleaned.replace(/&quot;/g, '"');
    cleaned = cleaned.replace(/&#39;/g, "'");

    return stripNoiseFromText(cleaned);
  }

  function extractBySelector(html, selector) {
    // Simple ID selector: #my-id
    const idMatch = selector.match(/^#([\w-]+)$/);
    if (idMatch) {
      const re = new RegExp(`<[^>]+id=["']${idMatch[1]}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
      const m = html.match(re);
      return m ? m[1] : null;
    }

    // Simple class selector: .my-class
    const classMatch = selector.match(/^\.([\w-]+)$/);
    if (classMatch) {
      const re = new RegExp(`<[^>]+class=["'][^"']*\\b${classMatch[1]}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
      const m = html.match(re);
      return m ? m[1] : null;
    }

    return null;
  }

  async function computeHash(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Simple word-level diff returning added/removed lines and change percentage.
   */
  function computeDiff(oldText, newText) {
    const oldWords = oldText.split(/\s+/).filter(Boolean);
    const newWords = newText.split(/\s+/).filter(Boolean);

    const oldSet = new Set(oldWords);
    const newSet = new Set(newWords);

    const added = newWords.filter((w) => !oldSet.has(w));
    const removed = oldWords.filter((w) => !newSet.has(w));

    const totalWords = Math.max(oldWords.length, newWords.length, 1);
    const changedWords = added.length + removed.length;
    const changePercent = (changedWords / totalWords) * 100;

    const snippetParts = [];
    if (removed.length > 0) {
      snippetParts.push(`− ${removed.slice(0, 15).join(' ')}`);
    }
    if (added.length > 0) {
      snippetParts.push(`+ ${added.slice(0, 15).join(' ')}`);
    }

    const summary = buildSummary(added, removed, changePercent);

    return {
      changePercent,
      summary,
      diffSnippet: snippetParts.join('\n') || 'Content changed',
      addedCount: added.length,
      removedCount: removed.length,
    };
  }

  function buildSummary(added, removed, changePercent) {
    if (added.length === 0 && removed.length === 0) {
      return 'Minor formatting change detected';
    }
    if (added.length > removed.length) {
      return `New content added (${changePercent.toFixed(1)}% changed)`;
    }
    if (removed.length > added.length) {
      return `Content removed (${changePercent.toFixed(1)}% changed)`;
    }
    return `Content updated (${changePercent.toFixed(1)}% changed)`;
  }

  function isSignificant(changePercent, threshold) {
    return changePercent >= threshold;
  }

  return {
    stripNoiseFromText,
    extractTextFromHtml,
    computeHash,
    computeDiff,
    isSignificant,
  };
})();
