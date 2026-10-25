// turns integer cents into unambiguous spoken words, e.g. 3499 -> "thirty-four dollars and ninety-nine cents".
// callers (checkout summary, ui) pass code-derived amounts; sonic never does arithmetic.
// keep this file free of relative imports so node --test can load it directly.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

export function integerToWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("expected a non-negative safe integer");
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [size, label] of SCALES) {
    if (n >= size) {
      parts.push(`${integerToWords(Math.floor(n / size))} ${label}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(underThousand(n));
  return parts.join(" ");
}

export function formatCentsForSpeech(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("cents must be an integer");
  const sign = cents < 0 ? "minus " : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollarWords = `${integerToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const centWords = `${integerToWords(rem)} ${rem === 1 ? "cent" : "cents"}`;
  if (rem === 0) return sign + dollarWords;
  if (dollars === 0) return sign + centWords;
  return `${sign}${dollarWords} and ${centWords}`;
}
