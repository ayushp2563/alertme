/**
 * Extract OINP / RCIP / FCIP draw records from official draw pages (HTML or text).
 */

const DrawParser = (() => {
  const DRAW_PAGE_PATTERNS = [
    /ontario\.ca\/page\/2026-ontario-immigrant-nominee-program-updates/i,
    /ontario\.ca\/page\/oinp-program-updates/i,
    /ontario\.ca\/document\/oinp/i,
    /canada\.ca\/.*(rcip|fcip)/i,
  ];

  const MONTHS = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  function isDrawPageUrl(url) {
    return DRAW_PAGE_PATTERNS.some((re) => re.test(url || ''));
  }

  function htmlToText(html) {
    let text = html || '';
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/\r/g, '');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  function detectProgram(url, text) {
    const combined = `${url || ''} ${(text || '').slice(0, 5000)}`.toUpperCase();
    if (/\bFCIP\b/.test(combined) && !/\bOINP\b/.test(combined.slice(0, 2000))) return 'FCIP';
    if (/\bRCIP\b/.test(combined) && !/\bOINP\b/.test(combined.slice(0, 2000))) return 'RCIP';
    return 'OINP';
  }

  function parseOnDate(line) {
    const iso = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];

    const m = line.match(/On\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${month}-${String(m[2]).padStart(2, '0')}`;
  }

  function parseInvitations(line) {
    const m = line.match(/issued\s+([\d,]+)\s+invitations?\s+to\s+apply/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function parseRegion(textBefore) {
    const regionPatterns = [
      /candidates invited in the ([^(.\n]+(?:\([^)]+\))?)/i,
      /invited in ([^(.\n]+(?:\([^)]+\))?)/i,
      /job offer in (Eastern Ontario|Northern Ontario|Southwestern Ontario|Central Ontario[^.\n]*|the Greater Toronto Area \(GTA\)|Greater Toronto Area \(GTA\))/i,
      /(Greater Toronto Area \(GTA\)|Eastern Ontario|Northern Ontario|Southwestern Ontario|Central Ontario)/i,
    ];
    for (const re of regionPatterns) {
      const m = textBefore.match(re);
      if (m) return m[1].trim().replace(/\s+/g, ' ');
    }
    return null;
  }

  function normalizeStream(raw) {
    if (!raw) return null;
    const s = raw.trim().replace(/\s+/g, ' ');
    if (/foreign worker/i.test(s)) return 'Employer Job Offer: Foreign Worker stream';
    if (/international student/i.test(s)) return 'Employer Job Offer: International Student stream';
    if (/in-demand skills/i.test(s)) return 'Employer Job Offer: In-Demand Skills stream';
    if (/masters graduate/i.test(s)) return 'Masters Graduate stream';
    if (/phd graduate/i.test(s)) return 'PhD Graduate stream';
    if (/human capital priorities/i.test(s)) return 'Human Capital Priorities stream';
    if (/french-speaking/i.test(s)) return 'French-Speaking Skilled Worker stream';
    if (/skilled trades/i.test(s)) return 'Skilled Trades stream';
    return s.endsWith('stream') ? s : `${s} stream`;
  }

  function extractNocCodes(block) {
    const codes = new Set();
    const re = /NOC\s+(\d{5})\b/gi;
    let m;
    while ((m = re.exec(block)) !== null) {
      codes.add(m[1]);
    }
    return [...codes];
  }

  function nullIfEmpty(val) {
    if (val === undefined || val === null || val === '') return null;
    return val;
  }

  function normalizeDraw(raw) {
    const program = ['OINP', 'RCIP', 'FCIP'].includes(raw.program) ? raw.program : 'OINP';
    const noc_codes = (raw.noc_codes || [])
      .map(String)
      .filter((c) => /^\d{5}$/.test(c));

    return {
      draw_date: nullIfEmpty(raw.draw_date),
      program,
      stream: nullIfEmpty(raw.stream),
      region: nullIfEmpty(raw.region),
      invitations_count: typeof raw.invitations_count === 'number' && !Number.isNaN(raw.invitations_count)
        ? raw.invitations_count
        : null,
      cutoff_score: typeof raw.cutoff_score === 'number' && !Number.isNaN(raw.cutoff_score)
        ? raw.cutoff_score
        : null,
      cutoff_score_max: raw.cutoff_score_max ?? null,
      notes: nullIfEmpty(raw.notes),
      noc_codes: noc_codes.length ? noc_codes : [],
    };
  }

  function extractDrawsFromText(text, url) {
    const program = detectProgram(url, text);
    const draws = [];

    const announcementRe = /On\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}[^.\n]*issued\s+[\d,]+\s+invitations?\s+to\s+apply[^.\n]*(?:\.[^.\n]*)*/gi;
    const announcements = [...text.matchAll(announcementRe)];

    const scoreRe = /Candidates with a score of (\d+) and above received an invitation under the ([^.]+?)\./gi;

    for (const ann of announcements) {
      const annText = ann[0];
      const annIndex = ann.index ?? 0;
      const contextStart = Math.max(0, annIndex - 800);
      const contextBefore = text.slice(contextStart, annIndex);

      const draw_date = parseOnDate(annText);
      const invitations_count = parseInvitations(annText);
      const region = parseRegion(contextBefore + annText);
      const notes = annText.replace(/\s+/g, ' ').trim().slice(0, 500);

      const afterStart = annIndex + annText.length;
      const afterEnd = Math.min(text.length, afterStart + 12000);
      const afterBlock = text.slice(afterStart, afterEnd);

      const nextAnnIdx = afterBlock.search(/On\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}[^.\n]*issued\s+[\d,]+\s+invitations/i);
      const section = nextAnnIdx === -1 ? afterBlock : afterBlock.slice(0, nextAnnIdx);

      const scoreMatches = [...section.matchAll(scoreRe)];
      if (scoreMatches.length === 0) {
        draws.push(normalizeDraw({
          draw_date,
          program,
          stream: null,
          region,
          invitations_count,
          cutoff_score: null,
          cutoff_score_max: null,
          notes,
          noc_codes: extractNocCodes(section),
        }));
        continue;
      }

      for (let i = 0; i < scoreMatches.length; i++) {
        const sm = scoreMatches[i];
        const scoreStart = sm.index ?? 0;
        const scoreEnd = i + 1 < scoreMatches.length
          ? (scoreMatches[i + 1].index ?? section.length)
          : section.length;
        const subBlock = section.slice(scoreStart, scoreEnd);

        draws.push(normalizeDraw({
          draw_date,
          program,
          stream: normalizeStream(sm[2]),
          region,
          invitations_count,
          cutoff_score: parseInt(sm[1], 10),
          cutoff_score_max: null,
          notes,
          noc_codes: extractNocCodes(subBlock),
        }));
      }
    }

    return dedupeDraws(draws);
  }

  function dedupeDraws(draws) {
    const seen = new Set();
    return draws.filter((d) => {
      const key = [d.draw_date, d.program, d.stream, d.region, d.cutoff_score, d.noc_codes.join(',')].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return d.draw_date && d.program;
    });
  }

  function extractDrawsFromHtml(html, url) {
    const text = htmlToText(html);
    return extractDrawsFromText(text, url);
  }

  return {
    isDrawPageUrl,
    extractDrawsFromHtml,
    extractDrawsFromText,
    normalizeDraw,
    htmlToText,
  };
})();
