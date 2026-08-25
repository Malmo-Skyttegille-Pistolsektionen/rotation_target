#!/usr/bin/env python3
"""Transcode PCM16 WAV files to IMA ADPCM WAV, in place of a build dependency.

    wav_to_adpcm.py <out_dir> <in.wav> [<in.wav> ...]

Stdlib only, and deliberately so. ffmpeg was used to *measure* the codec
options for #227, but it must not be a build prerequisite: it is a large system
package and different versions are not guaranteed to emit identical bytes,
which would make builds non-reproducible. ESP-IDF already requires Python 3, so
this adds nothing.

Output is a **standard IMA ADPCM WAV** (`wFormatTag = 0x11`), not a private
container. That is worth the small extra effort: a developer can drop a staged
file into VLC and hear whether the transcode is sane, which is the check that
settles "does this sound right" without a board.

Why ADPCM at all, from the measured corpus (77 clips, 158.8 s, 7.63 MB raw):
FLAC 4.46 MB lossless, IMA ADPCM 1.96 MB, Opus@32k 0.62 MB. Size was never the
binding constraint - latency was. These are spoken range commands, and ADPCM
adds no algorithmic delay and needs about twenty lines to decode, where Opus
would cost 26 ms, a ~200 KB library and a fixed 48 kHz output rate that would
change the per-clip I2S clock.

**Sample rates are left alone.** The firmware sets the I2S clock per clip
already, so a corpus of mixed rates costs nothing, and resampling in pure
Python without a proper low-pass filter would trade real quality for tidiness.
"""

import os
import struct
import sys
import wave

# The IMA/DVI tables, from the IMA ADPCM specification. Not derived at runtime:
# they are the format, and a generated approximation of them is a different
# codec that mostly works.
STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
    3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
    10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
    29794, 32767,
]
INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]

# 256 bytes a block: 505 samples, about 21 ms at 24 kHz, and a 3.95:1 ratio
# against PCM16. Each block restarts from its own predictor, so a bad byte
# costs one block rather than the rest of the clip - which is why this is
# block-based at all rather than one continuous stream.
BLOCK_ALIGN = 256
SAMPLES_PER_BLOCK = 1 + (BLOCK_ALIGN - 4) * 2


def encode_sample(sample: int, predictor: int, index: int) -> tuple[int, int, int]:
    """Pick the nibble, then move the predictor exactly the way the decoder will."""
    step = STEP_TABLE[index]
    diff = sample - predictor

    code = 0
    if diff < 0:
        code = 8
        diff = -diff

    # Successive subtraction against step, step/2, step/4 - the standard search
    # for the closest representable magnitude.
    if diff >= step:
        code |= 4
        diff -= step
    step >>= 1
    if diff >= step:
        code |= 2
        diff -= step
    step >>= 1
    if diff >= step:
        code |= 1

    # Deliberately NOT the magnitude accumulated above. The predictor has to
    # move by whatever the *decoder* will reconstruct, or the two drift apart
    # over a block - and the decoder uses ((2n+1)*step)/8 in one multiply,
    # which truncates differently from the same expression as separate terms.
    # See rt::decode_ima_adpcm_block.
    delta = ((2 * (code & 7) + 1) * STEP_TABLE[index]) >> 3
    predictor += -delta if (code & 8) else delta
    predictor = max(-32768, min(32767, predictor))
    index = max(0, min(88, index + INDEX_TABLE[code]))
    return code, predictor, index


def encode(samples: list[int]) -> tuple[bytes, int]:
    """Returns (block data, number of blocks). The caller records the true sample count."""
    out = bytearray()
    blocks = 0

    for start in range(0, len(samples), SAMPLES_PER_BLOCK):
        chunk = samples[start : start + SAMPLES_PER_BLOCK]
        # The block header carries the first sample verbatim - it is the
        # predictor the rest of the block is coded against, so it costs two
        # bytes and is exact.
        predictor = chunk[0]
        index = 0
        out += struct.pack("<hBB", predictor, index, 0)

        nibbles = []
        for sample in chunk[1:]:
            code, predictor, index = encode_sample(sample, predictor, index)
            nibbles.append(code)

        # The last block is padded to BLOCK_ALIGN. Zero codes rather than a
        # repeat: a zero code is the smallest step available, so the padding
        # decodes to the predictor drifting almost nowhere. The true length
        # goes in the `fact` chunk and the player trims to it, so this is
        # belt and braces.
        while len(nibbles) < (BLOCK_ALIGN - 4) * 2:
            nibbles.append(0)

        for i in range(0, len(nibbles), 2):
            out.append(nibbles[i] | (nibbles[i + 1] << 4))
        blocks += 1

    return bytes(out), blocks


def build_wav(channels: int, rate: int, data: bytes, sample_count: int) -> bytes:
    fmt = struct.pack(
        "<HHIIHHH",
        0x11,  # wFormatTag: IMA ADPCM
        channels,
        rate,
        rate * BLOCK_ALIGN // SAMPLES_PER_BLOCK,  # nAvgBytesPerSec, near enough
        BLOCK_ALIGN,
        4,  # wBitsPerSample
        2,  # cbSize
    ) + struct.pack("<H", SAMPLES_PER_BLOCK)

    # `fact` carries the real sample count, which is the only place the padding
    # in the final block can be undone. Required for non-PCM WAV anyway.
    chunks = (
        b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"fact" + struct.pack("<II", 4, sample_count)
        + b"data" + struct.pack("<I", len(data)) + data
    )
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks


def transcode(path: str, out_dir: str) -> str:
    with wave.open(path, "rb") as src:
        if src.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM, got {src.getsampwidth() * 8}-bit")
        if src.getnchannels() != 1:
            # Stereo IMA ADPCM interleaves the two channels four bytes at a
            # time, and nothing in the shipped corpus needs it. Refused rather
            # than mixed down: silently changing a clip is worse than saying no.
            raise SystemExit(f"{path}: expected mono, got {src.getnchannels()} channels")
        rate = src.getframerate()
        raw = src.readframes(src.getnframes())

    samples = list(struct.unpack(f"<{len(raw) // 2}h", raw[: len(raw) // 2 * 2]))
    if not samples:
        raise SystemExit(f"{path}: no samples")

    data, _ = encode(samples)
    out_path = os.path.join(out_dir, os.path.basename(path))
    _write_if_changed(out_path, build_wav(1, rate, data, len(samples)))
    return out_path


def _write_if_changed(path: str, data: bytes) -> None:
    """The staging step runs on every build; a rewritten file would repack the image."""
    try:
        with open(path, "rb") as handle:
            if handle.read() == data:
                return
    except OSError:
        pass
    with open(path, "wb") as handle:
        handle.write(data)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)

    before = after = 0
    for path in sorted(sys.argv[2:]):
        before += os.path.getsize(path)
        after += os.path.getsize(transcode(path, out_dir))

    if before:
        print(
            f"Transcoded {len(sys.argv) - 2} clip(s) to IMA ADPCM: "
            f"{before // 1024} KB -> {after // 1024} KB ({before / after:.1f}x)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
