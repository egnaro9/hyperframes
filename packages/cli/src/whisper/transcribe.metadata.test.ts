import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadTranscript } from "./normalize.js";
import { encodeWav } from "./wav.test-helpers.js";
import { transcribe, type TranscribeProgress } from "./transcribe.js";

const native = vi.hoisted(() => ({
  exec: vi.fn(),
  missingLanguage: false,
  runtime: vi.fn(),
  printed: { stdout: "", stderr: "" },
}));
vi.mock("node:child_process", async () => {
  const { PassThrough } = await import("node:stream");
  return {
    execFileSync: native.exec,
    // whisper-cli: runs the same stand-in, then prints what the test set, as the real one does while it decodes.
    execFile: (
      command: string,
      args: string[],
      _options: unknown,
      done: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      const child = { stdout: new PassThrough(), stderr: new PassThrough() };
      setImmediate(() => {
        let failure: unknown = null;
        try {
          native.exec(command, args);
        } catch (err) {
          failure = err;
        }
        child.stdout.end(native.printed.stdout);
        child.stderr.end(native.printed.stderr);
        done(failure, native.printed.stdout, native.printed.stderr);
      });
      return child;
    },
  };
});
vi.mock("./manager.js", () => ({
  DEFAULT_MODEL: "small.en",
  ensureWhisper: native.runtime,
  ensureModel: async (
    model: string,
    options: { onDownloadProgress?: (received: number, total: number | null) => void },
  ) => {
    options.onDownloadProgress?.(5, null);
    return `ggml-${model}.bin`;
  },
  hasFFmpeg: () => true,
}));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFprobe: () => "ffprobe",
  findFFmpeg: () => "ffmpeg",
  getFFmpegInstallHint: () => "ffmpeg",
}));
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-language-"));
  writeFileSync(join(dir, "audio.wav"), Buffer.alloc(44));
  native.missingLanguage = false;
  native.printed = { stdout: "", stderr: "" };
  native.runtime.mockReset().mockResolvedValue({ executablePath: "whisper-cli", source: "env" });
  native.exec.mockReset().mockImplementation((command: string, args: string[]) => {
    if (command === "ffprobe")
      return JSON.stringify({
        streams: [
          { codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "16000", channels: 1 },
        ],
      });
    if (command !== "whisper-cli") throw new Error(`Unexpected executable: ${command}`);
    if (args.includes("--detect-language")) return "";
    const selected = args[args.indexOf("--language") + 1];
    let language = args.includes("--language") ? selected : "en";
    if (language === "auto") language = "es";
    const output = args[args.indexOf("--output-file") + 1];
    writeFileSync(
      `${output}.json`,
      JSON.stringify({
        result: native.missingLanguage ? {} : { language },
        transcription: [
          {
            tokens: [
              { text: language === "es" ? "Hola" : "Hello", offsets: { from: 0, to: 1000 } },
            ],
          },
        ],
      }),
    );
    return "";
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("skips a long true-silence lead and keeps native words on the original clock", async () => {
  const samples = new Float32Array(41 * 16_000);
  samples.fill(0.1, 40 * 16_000);
  writeFileSync(join(dir, "audio.wav"), encodeWav(samples, 16_000));
  const original = native.exec.getMockImplementation()!;
  native.exec.mockImplementation((command: string, args: string[]) => {
    const result = original(command, args);
    if (command === "whisper-cli" && args.includes("--output-file")) {
      const output = args[args.indexOf("--output-file") + 1];
      writeFileSync(
        `${output}.json`,
        JSON.stringify({
          result: { language: "es" },
          transcription: [
            {
              tokens: [
                { text: " Siempre", offsets: { from: 40_200, to: 40_490 } },
                { text: " que", offsets: { from: 40_490, to: 40_700 } },
              ],
            },
          ],
        }),
      );
    }
    return result;
  });

  const result = await transcribe(join(dir, "audio.wav"), dir, { model: "small", language: "es" });

  const args = native.exec.mock.calls.find(([command]) => command === "whisper-cli")![1];
  expect(args.slice(args.indexOf("--offset-t"), args.indexOf("--offset-t") + 2)).toEqual([
    "--offset-t",
    "40000",
  ]);
  expect(loadTranscript(result.transcriptPath).words).toEqual([
    { id: "w0", text: "Siempre", start: 40.2, end: 40.49 },
    { id: "w1", text: "que", start: 40.49, end: 40.7 },
  ]);
});

it("keeps a soft first word even when quiet sound lasts more than three seconds", async () => {
  const samples = new Float32Array(11 * 16_000).fill(2 / 32768);
  samples.fill(0.1, 10 * 16_000);
  writeFileSync(join(dir, "audio.wav"), encodeWav(samples, 16_000));

  const result = await transcribe(join(dir, "audio.wav"), dir, { model: "small", language: "es" });

  const args = native.exec.mock.calls.find(([command]) => command === "whisper-cli")![1];
  expect(args).not.toContain("--offset-t");
  expect(loadTranscript(result.transcriptPath).words).toEqual([
    { id: "w0", text: "Hola", start: 0, end: 1 },
  ]);
});

it("decodes multilingual audio automatically and returns the native detection", async () => {
  const result = await transcribe(join(dir, "audio.wav"), dir, { model: "small" });
  expect(result).toMatchObject({ detectedLanguage: "es", model: "small", wordCount: 1 });
  expect(native.exec.mock.calls.filter(([command]) => command === "whisper-cli")).toHaveLength(1);
});
it.each([
  ["small.en", undefined, "small.en"],
  ["small.en", "de", "small"],
  ["small", "en", "small"],
])("does not label requested %s / %s as detection", async (model, language, resolved) => {
  const result = await transcribe(join(dir, "audio.wav"), dir, { model, language });
  expect(result).toMatchObject({ detectedLanguage: null, model: resolved });
});
it("keeps an absent native language unknown", async () => {
  native.missingLanguage = true;
  expect(await transcribe(join(dir, "audio.wav"), dir, { model: "small" })).toMatchObject({
    detectedLanguage: null,
  });
});
it("reports download bytes and truthful transcription boundaries", async () => {
  const events: unknown[] = [];
  await transcribe(join(dir, "audio.wav"), dir, {
    model: "small",
    onEvent: (event) => events.push(event),
  });
  expect(events).toEqual([
    { type: "progress", phase: "download", model: "small", receivedBytes: 5, totalBytes: null },
    {
      type: "progress",
      phase: "transcription",
      model: "small",
      status: "started",
      durationSeconds: 44 / 32_000,
    },
    { type: "progress", phase: "transcription", model: "small", status: "completed" },
  ]);
});

it("carries the runtime-install policy to discovery while leaving model downloads enabled", async () => {
  const events: unknown[] = [];
  await transcribe(join(dir, "audio.wav"), dir, {
    installRuntime: false,
    onEvent: (event) => events.push(event),
  });
  expect(native.runtime).toHaveBeenCalledWith(expect.objectContaining({ installRuntime: false }));
  expect(events).toContainEqual({
    type: "progress",
    phase: "download",
    model: "small.en",
    receivedBytes: 5,
    totalBytes: null,
  });
});
it("does not claim transcription completed when decoding fails", async () => {
  const events: unknown[] = [];
  const previous = native.exec.getMockImplementation()!;
  native.exec.mockImplementation((command: string, args: string[]) => {
    if (command === "whisper-cli") throw new Error("decoder failed");
    return previous(command, args);
  });
  await expect(
    transcribe(join(dir, "audio.wav"), dir, {
      model: "small",
      onEvent: (event) => events.push(event),
    }),
  ).rejects.toThrow("decoder failed");
  expect(events).toEqual([
    { type: "progress", phase: "download", model: "small", receivedBytes: 5, totalBytes: null },
    {
      type: "progress",
      phase: "transcription",
      model: "small",
      status: "started",
      durationSeconds: 44 / 32_000,
    },
  ]);
});

async function transcribeStreaming() {
  const events: TranscribeProgress[] = [];
  const result = await transcribe(join(dir, "audio.wav"), dir, {
    model: "small",
    onEvent: (event) => events.push(event),
  });
  return { events, words: events.filter((e) => e.type === "words"), result };
}

it("streams the words of each segment whisper prints, before the final transcript", async () => {
  native.printed.stdout =
    "\n[00:00:00.000 --> 00:00:02.000]   Hello big world\n" +
    "[00:00:02.000 --> 00:00:04.000]   [BLANK_AUDIO]\n";
  const { events, words, result } = await transcribeStreaming();
  expect(words).toEqual([
    {
      type: "words",
      model: "small",
      words: [
        { text: "Hello", start: 0, end: 0.769 },
        { text: "big", start: 0.769, end: 1.231 },
        { text: "world", start: 1.231, end: 2 },
      ],
      through: 2,
    },
    { type: "words", model: "small", words: [], through: 4 },
  ]);
  expect(events.at(-1)).toMatchObject({ status: "completed" });
  expect(result).toMatchObject({ wordCount: 1, durationSeconds: 1 });
});

it("reports progress through audio where whisper prints no segment, once per step", async () => {
  writeFileSync(join(dir, "audio.wav"), Buffer.alloc(4 * 32_000));
  native.printed.stderr =
    "whisper_print_progress_callback: progress =  25%\n" +
    "whisper_print_progress_callback: progress =  25%\n" +
    "whisper_print_progress_callback: progress = 100%\n";
  expect((await transcribeStreaming()).words).toEqual([
    { type: "words", model: "small", words: [], through: 1 },
    { type: "words", model: "small", words: [], through: 4 },
  ]);
});

it("maps offset-bearing native progress to the original audio clock", async () => {
  const samples = new Float32Array(50 * 16_000);
  samples.fill(0.1, 40 * 16_000);
  writeFileSync(join(dir, "audio.wav"), encodeWav(samples, 16_000));
  native.printed.stderr = "whisper_print_progress_callback: progress =  50%\n";

  const { words } = await transcribeStreaming();

  expect(words).toHaveLength(1);
  expect(words[0]).toMatchObject({ type: "words", words: [] });
  expect(words[0]!.through).toBeCloseTo(45, 2);
});

it("asks whisper for progress only when someone streams it", async () => {
  const progressAsked = () =>
    native.exec.mock.calls
      .filter(([c]) => c === "whisper-cli")
      .map(([, a]) => a.includes("--print-progress"));
  await transcribe(join(dir, "audio.wav"), dir, { model: "small" });
  await transcribeStreaming();
  expect(progressAsked()).toEqual([false, true]);
});

it("installs the stop handling only once setup is done and whisper starts", async () => {
  const order: string[] = [];
  native.runtime.mockImplementation(async () => {
    order.push("runtime");
    return { executablePath: "whisper-cli", source: "env" };
  });
  await transcribe(join(dir, "audio.wav"), dir, {
    model: "small",
    onEvent: (e) => e.type === "progress" && e.phase === "download" && order.push("download"),
    startCancellation: () => {
      order.push("stop handling");
      return new AbortController().signal;
    },
  });
  expect(order).toEqual(["runtime", "download", "stop handling"]);
});

it("keeps whisper's log out of the error message, leaving its last lines to the command", async () => {
  const previous = native.exec.getMockImplementation()!;
  native.exec.mockImplementation((command: string, args: string[]) => {
    if (command === "whisper-cli")
      throw new Error("Command failed: whisper-cli\nload log\nbad model");
    return previous(command, args);
  });
  native.printed.stderr = "load log\nbad model\n";
  const failure = await transcribe(join(dir, "audio.wav"), dir, { model: "small" }).catch((e) => e);
  expect(failure).toMatchObject({
    message: "Command failed: whisper-cli",
    stderr: "load log\nbad model\n",
  });
});

it("names the timeout knob when whisper outlives its own timeout", async () => {
  const previous = native.exec.getMockImplementation()!;
  native.exec.mockImplementation((command: string, args: string[]) => {
    if (command === "whisper-cli")
      throw Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
    return previous(command, args);
  });
  await expect(transcribe(join(dir, "audio.wav"), dir, { model: "small" })).rejects.toThrow(
    "Whisper transcription exceeded",
  );
});
