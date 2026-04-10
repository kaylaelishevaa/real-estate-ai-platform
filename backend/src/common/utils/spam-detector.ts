/**
 * Heuristic spam detector for lead submissions.
 * Returns true if the lead looks like spam.
 *
 * Designed to minimize false positives on real names and messages
 * across multiple languages and character sets.
 */

const VOWELS = new Set('aeiouAEIOU');

/** Count max consecutive consonants in a string */
function maxConsecutiveConsonants(str: string): number {
  let max = 0;
  let curr = 0;
  for (const ch of str) {
    if (/[a-zA-Z]/.test(ch) && !VOWELS.has(ch)) {
      curr++;
      if (curr > max) max = curr;
    } else {
      curr = 0;
    }
  }
  return max;
}

/** Count case transitions (e.g. aB = 1, aBcD = 3) */
function caseTransitions(str: string): number {
  let count = 0;
  for (let i = 1; i < str.length; i++) {
    const prev = str[i - 1];
    const curr = str[i];
    if (/[a-z]/.test(prev) && /[A-Z]/.test(curr)) count++;
    else if (/[A-Z]/.test(prev) && /[a-z]/.test(curr)) count++;
  }
  return count;
}

/**
 * Consonant ratio: fraction of alphabetic characters that are consonants.
 * Real languages (EN/ID) typically stay below 0.65.
 */
function consonantRatio(str: string): number {
  let consonants = 0;
  let alpha = 0;
  for (const ch of str) {
    if (/[a-zA-Z]/.test(ch)) {
      alpha++;
      if (!VOWELS.has(ch)) consonants++;
    }
  }
  return alpha === 0 ? 0 : consonants / alpha;
}

/** Check if a single word looks like random gibberish */
function isGibberishWord(word: string): boolean {
  if (word.length < 6) return false;
  // 5+ consecutive consonants — never happens in real EN/ID words
  if (maxConsecutiveConsonants(word) >= 5) return true;
  // Mixed case word >= 8 chars with many transitions → random
  if (word.length >= 8 && /[a-z]/.test(word) && /[A-Z]/.test(word)) {
    if (caseTransitions(word) >= 3) return true;
  }
  // Long word with high consonant ratio (> 0.70)
  if (word.length >= 8 && consonantRatio(word) > 0.70) return true;
  // Long single word with consonant clusters
  if (word.length >= 15 && maxConsecutiveConsonants(word) >= 3) return true;
  // All uppercase and long
  if (word.length >= 12 && word === word.toUpperCase()) return true;
  return false;
}

/** Check if name looks like random gibberish */
function isGibberishName(name: string): boolean {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  for (const word of words) {
    if (isGibberishWord(word)) return true;
  }
  return false;
}

/**
 * Check if a text block (message/description) is gibberish.
 * More lenient than name checks since messages can be short and informal.
 */
export function isGibberishText(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 6) return false;

  const words = trimmed.split(/\s+/);

  // Single "word" that is long gibberish (e.g. "nzjDWkpVqrEKzSmYPMNqZ")
  if (words.length === 1 && trimmed.length >= 8) {
    if (isGibberishWord(trimmed)) return true;
    // High consonant ratio for a single long token
    if (consonantRatio(trimmed) > 0.65) return true;
  }

  // Multiple words — if most words are gibberish, flag it
  if (words.length >= 2) {
    const gibberishWords = words.filter(w => w.length >= 6 && isGibberishWord(w));
    if (gibberishWords.length > 0 && gibberishWords.length >= words.length * 0.5) return true;
  }

  // Overall consonant ratio for short texts with no spaces
  if (words.length <= 2 && trimmed.length >= 10 && consonantRatio(trimmed) > 0.65) return true;

  return false;
}

/** Check if email looks like bot-generated */
function isSuspiciousEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const local = email.split('@')[0] || '';
  const dotCount = (local.match(/\./g) || []).length;
  // e.g. "d.o.q.opupe.b.i.v69@gmail.com" — many single-char segments
  if (dotCount >= 3) {
    const segments = local.split('.');
    const singleCharSegments = segments.filter(s => s.length <= 2).length;
    if (singleCharSegments >= 3) return true;
  }
  // Very long random local part with excessive mixed case (not just a capital first letter)
  const cleanLocal = local.replace(/\./g, '');
  if (cleanLocal.length >= 20) {
    const upperCount = (cleanLocal.match(/[A-Z]/g) || []).length;
    if (upperCount >= 3 && /[a-z]/.test(cleanLocal)) return true;
  }
  return false;
}

// ── Phone validation ────────────────────────────────────────────────────────

/** Returns true if a phone number is obviously fake */
export function isFakePhone(phone: string | undefined | null): boolean {
  if (!phone) return true;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return true;
  // All same digit (e.g. 00000000, 11111111)
  if (/^(\d)\1+$/.test(digits)) return true;
  return false;
}

// ── Link / URL detection ────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

/** Returns true if text is mostly URLs or contains excessive links */
export function isLinkSpam(text: string | undefined | null): boolean {
  if (!text) return false;
  const urls = text.match(URL_REGEX) || [];
  if (urls.length >= 3) return true;
  // Message is just a URL (with maybe a word or two)
  const stripped = text.replace(URL_REGEX, '').trim();
  if (urls.length > 0 && stripped.length < 10) return true;
  return false;
}

// ── Spam keywords ───────────────────────────────────────────────────────────

const SPAM_KEYWORDS = [
  // Common spam / scam
  'togel', 'slot online', 'judi online', 'casino', 'poker online',
  'pinjaman online', 'pinjol', 'dana cair', 'tanpa jaminan',
  'bitcoin', 'crypto', 'forex trading', 'investasi bodong',
  // SEO spam
  'backlink', 'seo service', 'link building', 'buy followers',
  // Pharmaceutical spam
  'viagra', 'cialis', 'obat kuat',
  // Generic
  'click here', 'free money', 'earn money fast', 'work from home',
  'congratulations you won', 'you have been selected',
];

/** Returns true if text contains spam keywords */
export function hasSpamKeywords(text: string | undefined | null): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SPAM_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Name with special characters ────────────────────────────────────────────

/** Returns true if name contains suspicious special characters */
function hasSuspiciousChars(name: string | undefined | null): boolean {
  if (!name) return false;
  // Names shouldn't have: @, #, $, %, ^, *, {, }, <, >, |, =
  return /[@#$%^*{}|<>=\\]/.test(name);
}

// ── Main spam check (hard reject — isSpam) ──────────────────────────────────

export function isSpamLead(data: {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string;
  description?: string | null;
}): boolean {
  // Check individual name parts
  if (isGibberishName(data.firstName || '')) return true;
  if (isGibberishName(data.lastName || '')) return true;

  // Check combined name length — real full names rarely exceed 35 chars
  const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  if (fullName.length > 35 && maxConsecutiveConsonants(fullName) >= 4) return true;

  // Check email
  if (isSuspiciousEmail(data.email)) return true;

  // Check description / message for gibberish
  if (isGibberishText(data.description)) return true;

  return false;
}

// ── Spam scoring (soft flag — spamScore) ────────────────────────────────────

export interface SpamScoreInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string;
  description?: string | null;
}

/**
 * Returns a spam score from 0–100.
 * Score >= 50 should be flagged as SPAM but still stored.
 */
export function spamScore(data: SpamScoreInput): number {
  let score = 0;

  // Gibberish name
  if (isGibberishName(data.firstName || '')) score += 40;
  if (isGibberishName(data.lastName || '')) score += 30;

  // Name with special chars
  if (hasSuspiciousChars(data.firstName)) score += 25;
  if (hasSuspiciousChars(data.lastName)) score += 25;

  // Suspicious email
  if (isSuspiciousEmail(data.email)) score += 30;

  // Fake phone
  if (isFakePhone(data.phone)) score += 35;

  // Link spam in description
  if (isLinkSpam(data.description)) score += 40;

  // Spam keywords in description
  if (hasSpamKeywords(data.description)) score += 35;

  // Gibberish description / message
  if (isGibberishText(data.description)) score += 40;

  return Math.min(score, 100);
}
