/** whisper.cpp hears 30 s to decide a language; it decides once, from the start of what it is given. */
export const WINDOW_SECONDS = 30;
/** A music or noise window comes back near p = 0.5; speech in a language comes back above 0.9. */
const CONFIDENT = 0.7;

/** `--language auto`, in any case, asks for detection, as no language does. */
export const requestedLanguage = (language?: string) =>
  language?.trim().toLowerCase() === "auto" ? undefined : language;

/** The starts of three windows spread over the clip after `onset`, so an intro alone cannot decide; they overlap
 * when the speech is short. None under 30 s of speech, or under a minute when no onset was found (a loud or long
 * intro hides it too): whisper's own pick stands then. */
export function detectionWindows(seconds: number, onset: number | null): number[] {
  const from = onset ?? 0;
  const span = seconds - from;
  if (span < WINDOW_SECONDS || (onset === null && span < 2 * WINDOW_SECONDS)) return [];
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
  const sure = votes.filter((vote) => vote.p >= CONFIDENT).map((vote) => vote.language);
  return sure.find((language, i) => sure.indexOf(language) !== i) ?? null;
}

/** A detection's language when it is sure; a wrong label is worse than none. */
export const confidentLanguage = (vote: LanguageVote | null) =>
  vote && vote.p >= CONFIDENT ? vote.language : null;

/** whisper-cli --detect-language prints `auto-detected language: es (p = 0.983324)`. */
export function parseDetection(line: string): LanguageVote | null {
  const match = /auto-detected language: ([a-z]+) \(p = ([\d.]+)\)/.exec(line);
  return match ? { language: match[1]!, p: Number(match[2]) } : null;
}
