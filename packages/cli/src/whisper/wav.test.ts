import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readWav, leadingSilenceOffsetMs } from "./wav.js";
import { encodeWav, encodeExtensibleWav } from "./wav.test-helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-wav-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, bytes: Buffer) => {
  writeFileSync(join(dir, name), bytes);
  return join(dir, name);
};

it("reads a 16-bit mono WAV's samples and rate in JS", () => {
  const wav = readWav(file("a.wav", encodeWav([0, 0.5, -0.5, -1], 16_000)));
  expect(wav.sampleRate).toBe(16_000);
  expect([...wav.samples]).toEqual([0, 0.5, -0.5, -1]);
});

it("reads a WAV with no samples as silence, as ffmpeg writes for empty audio", () => {
  expect(readWav(file("empty.wav", encodeWav([], 16_000))).samples).toHaveLength(0);
});

it("names a file that is not a 16-bit mono WAV", () => {
  const stereo = encodeWav([0, 0], 16_000);
  stereo.writeUInt16LE(2, 22);
  expect(() => readWav(file("text.wav", Buffer.from("not audio")))).toThrow(
    "text.wav is not a 16-bit mono PCM WAV",
  );
  expect(() => readWav(file("stereo.wav", stereo))).toThrow("is not a 16-bit mono PCM WAV");
});

it.each([0, 1, -1])(
  "skips three seconds of near-digital silence at PCM amplitude %s",
  (amplitude) => {
    const samples = new Float32Array(4 * 16_000).fill(amplitude / 32768);
    samples.fill(0.1, 3 * 16_000);
    expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(3000);
  },
);

it("keeps sound above the absolute threshold even below the inherited threshold", () => {
  const samples = new Float32Array(4 * 16_000).fill(2 / 32768);
  samples.fill(0.1, 3 * 16_000);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});

it("keeps a quiet prefix shorter than three seconds", () => {
  const samples = new Float32Array(4 * 16_000);
  samples.fill(0.1, 29 * 1600);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});

it("stops at the first non-quiet window instead of counting later silence", () => {
  const samples = new Float32Array(8 * 16_000);
  samples[1600] = 0.1;
  samples.fill(0.1, 7 * 16_000);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});

it("keeps audio when the remaining incomplete window is too short to decode", () => {
  const samples = new Float32Array(3 * 16_000 + 800);
  samples.fill(0.1, 3 * 16_000);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});

it("keeps all-silent audio instead of seeking past the end", () => {
  expect(leadingSilenceOffsetMs(encodeWav(new Float32Array(5 * 16_000), 16_000))).toBe(0);
});

it.each(["text", "stereo", "rate", "byte-rate", "alignment", "truncated", "odd", "data-truncated"])(
  "keeps audio when its PCM shape is uncertain: %s",
  (kind) => {
    const samples = new Float32Array(4 * 16_000);
    samples.fill(0.1, 3 * 16_000);
    const wav = encodeWav(samples, 16_000);
    if (kind === "text") wav.write("nope");
    if (kind === "stereo") wav.writeUInt16LE(2, 22);
    if (kind === "rate") wav.writeUInt32LE(48_000, 24);
    if (kind === "byte-rate") wav.writeUInt32LE(1, 28);
    if (kind === "alignment") wav.writeUInt16LE(1, 32);
    if (kind === "truncated") wav.writeUInt32LE(4, 16);
    if (kind === "odd") wav.writeUInt32LE(127999, 40);
    if (kind === "data-truncated") wav.writeUInt32LE(160000, 40);
    expect(leadingSilenceOffsetMs(wav)).toBe(0);
  },
);

it("keeps the exact three-second silence plus 100 ms speech tail instead of bypassing decode", () => {
  const samples = new Float32Array(49_600);
  samples.fill(0.1, 48_000);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});

it("skips silence in a validated extensible PCM16 WAV", () => {
  const samples = new Float32Array(4 * 16_000);
  samples.fill(0.1, 3 * 16_000);
  expect(leadingSilenceOffsetMs(encodeExtensibleWav(samples, 16_000))).toBe(3000);
});

it("reads validated extensible PCM16 samples", () => {
  const wav = readWav(file("extensible.wav", encodeExtensibleWav([0, 0.5, -0.5], 16_000)));
  expect([...wav.samples]).toEqual([0, 0.5, -0.5]);
});

it.each(["float", "guid", "valid-bits", "extension-size"])(
  "rejects uncertain extensible PCM: %s",
  (kind) => {
    const samples = new Float32Array(4 * 16_000);
    samples.fill(0.1, 3 * 16_000);
    const wav = encodeExtensibleWav(samples, 16_000);
    if (kind === "float") wav.writeUInt16LE(3, 44);
    if (kind === "guid") wav[59] = 0;
    if (kind === "valid-bits") wav.writeUInt16LE(8, 38);
    if (kind === "extension-size") wav.writeUInt16LE(23, 36);
    expect(leadingSilenceOffsetMs(wav)).toBe(0);
    expect(() => readWav(file("uncertain.wav", wav))).toThrow("is not a 16-bit mono PCM WAV");
  },
);

it("keeps audio when less than one second remains after a qualifying prefix", () => {
  const samples = new Float32Array(48_000 + 15_999);
  samples.fill(0.1, 48_000);
  expect(leadingSilenceOffsetMs(encodeWav(samples, 16_000))).toBe(0);
});
