/** whisper.cpp hears 30 s to decide a language; it decides once, from the start of what it is given. */
export const WINDOW_SECONDS = 30;
/** A music or noise window comes back near p = 0.5; speech in a language comes back above 0.9. */
const CONFIDENT = 0.7;

/** The starts of up to three windows spread over the clip after `onset`, so an intro alone cannot decide. A clip
 * with under two windows of sound after it gets none: whisper's own pick already hears all of it. */
export function detectionWindows(seconds: number, onset: number | null): number[] {
  const from = onset ?? 0;
  const span = seconds - from;
  if (span < 2 * WINDOW_SECONDS) return [];
  return [1 / 6, 1 / 2, 5 / 6].map((at) => {
    const start = from + span * at - WINDOW_SECONDS / 2;
    return Math.min(Math.max(start, from), seconds - WINDOW_SECONDS);
  });
}

export interface LanguageVote {
  language: string;
  p: number;
}

/** The language at least two confident windows agree on, else null (whisper's own pick stands). */
export function pickLanguage(votes: readonly LanguageVote[]): string | null {
  const counts = new Map<string, number>();
  for (const { language, p } of votes)
    if (p >= CONFIDENT) counts.set(language, (counts.get(language) ?? 0) + 1);
  for (const [language, count] of counts) if (count >= 2) return language;
  return null;
}

/** whisper-cli --detect-language prints `auto-detected language: es (p = 0.983324)`. */
export function parseDetection(line: string): LanguageVote | null {
  const match = /auto-detected language: ([a-z]+) \(p = ([\d.]+)\)/.exec(line);
  return match ? { language: match[1]!, p: Number(match[2]) } : null;
}
