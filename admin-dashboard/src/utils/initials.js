/**
 * Extract up to 2 capital letters from a name for avatar / chip use.
 *
 *   "Customer Name"  → "CN"
 *   "Vishal Sharma"  → "VS"
 *   "sharma"         → "SH" (single word → first 2 chars uppercased)
 *   "A B C"          → "AC" (first + last word initials)
 *   ""               → "??"
 *   null/undefined   → "??"
 */
export function getInitials(name) {
  if (name == null) return '??';
  const s = String(name).trim();
  if (s.length === 0) return '??';

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  // First + last word initials
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
