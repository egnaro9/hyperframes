/** A 16-bit mono PCM WAV of `samples` (-1..1), as prepareWav writes one. */
export function encodeWav(samples: ArrayLike<number>, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32768))), 2 * i);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function encodeExtensibleWav(samples: ArrayLike<number>, sampleRate: number): Buffer {
  const pcm = encodeWav(samples, sampleRate);
  const fmt = Buffer.alloc(48);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(40, 4);
  pcm.copy(fmt, 8, 20, 36);
  fmt.writeUInt16LE(0xfffe, 8);
  fmt.writeUInt16LE(22, 24);
  fmt.writeUInt16LE(16, 26);
  fmt.writeUInt32LE(4, 28);
  Buffer.from("0100000000001000800000aa00389b71", "hex").copy(fmt, 32);
  const wav = Buffer.concat([pcm.subarray(0, 12), fmt, pcm.subarray(36)]);
  wav.writeUInt32LE(wav.length - 8, 4);
  return wav;
}
