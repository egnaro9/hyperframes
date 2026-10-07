import { readFileSync } from "node:fs";

/** Where a RIFF chunk's bytes start and how many there are, or null when the file has none. */
export function findWavChunk(buf: Buffer, want: string): { offset: number; size: number } | null {
  if (buf.length < 12) return null;
  let pos = 12; // skip RIFF header
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === want) return { offset: pos + 8, size: Math.min(size, buf.length - pos - 8) };
    pos += 8 + size;
    if (size % 2 !== 0) pos++; // RIFF chunks are word-aligned
  }
  return null;
}

const PCM = 1;
const EXTENSIBLE = 0xfffe;

function isMonoPcm16Format(buf: Buffer, fmt: { offset: number; size: number } | null): boolean {
  if (
    !fmt ||
    fmt.size < 16 ||
    buf.readUInt32LE(fmt.offset - 4) !== fmt.size ||
    buf.readUInt16LE(fmt.offset + 2) !== 1 ||
    buf.readUInt16LE(fmt.offset + 14) !== 16 ||
    buf.readUInt16LE(fmt.offset + 12) !== 2 ||
    buf.readUInt32LE(fmt.offset + 4) === 0 ||
    buf.readUInt32LE(fmt.offset + 8) !== buf.readUInt32LE(fmt.offset + 4) * 2
  )
    return false;
  const format = buf.readUInt16LE(fmt.offset);
  if (format === PCM) return true;
  if (format !== EXTENSIBLE || fmt.size < 40) return false;
  return (
    buf.readUInt16LE(fmt.offset + 16) >= 22 &&
    buf.readUInt16LE(fmt.offset + 16) <= fmt.size - 18 &&
    buf.readUInt16LE(fmt.offset + 18) === 16 &&
    buf
      .subarray(fmt.offset + 24, fmt.offset + 40)
      .equals(Buffer.from("0100000000001000800000aa00389b71", "hex"))
  );
}

/** A prepared 16-bit mono WAV, read in JS: sherpa's readWave returns memory Electron refuses. */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path);
  const riff = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
  const fmt = riff ? findWavChunk(buf, "fmt ") : null;
  const data = fmt && findWavChunk(buf, "data");
  if (!fmt || !data || data.size % 2 !== 0 || !isMonoPcm16Format(buf, fmt)) {
    throw new Error(`${path} is not a 16-bit mono PCM WAV`);
  }
  const samples = new Float32Array(data.size >> 1);
  for (let i = 0; i < samples.length; i++)
    samples[i] = buf.readInt16LE(data.offset + 2 * i) / 32768;
  return { samples, sampleRate: buf.readUInt32LE(fmt.offset + 4) };
}

export function leadingSilenceOffsetMs(buf: Buffer): number {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return 0;
  const fmt = findWavChunk(buf, "fmt ");
  const data = findWavChunk(buf, "data");
  if (
    !fmt ||
    !data ||
    data.size % 2 !== 0 ||
    buf.readUInt32LE(data.offset - 4) !== data.size ||
    !isMonoPcm16Format(buf, fmt) ||
    buf.readUInt32LE(fmt.offset + 4) !== 16_000
  )
    return 0;

  const windowSamples = 1_600;
  const end = data.offset + data.size;
  let windows = 0;
  for (let at = data.offset; at + 2 * windowSamples <= end; at += 2 * windowSamples) {
    let sumSquared = 0;
    for (let i = 0; i < windowSamples; i++) {
      const sample = buf.readInt16LE(at + 2 * i);
      sumSquared += sample * sample;
    }
    if (sumSquared > windowSamples) {
      const remainingSamples = (end - at) / 2;
      return windows >= 30 && remainingSamples >= 16_000 ? windows * 100 : 0;
    }
    windows++;
  }
  return 0;
}
