# FSB5 to WAV converter for Minecraft Bedrock Edition sounds
# Converts FSB5 IMA ADPCM files to playable WAV files
# Usage: python fsb2wav.py input.fsb [output.wav]

import struct
import sys
import os

# IMA ADPCM decoder constants
IMA_INDEX_TABLE = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
]

IMA_STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
    19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
    130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
    876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
    5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
]

def decode_ima_adpcm(data, channels=1, block_size=256):
    """Decode IMA ADPCM data to 16-bit PCM samples"""
    samples_per_block = (block_size - 4 * channels) * 2 // channels
    total_blocks = len(data) // block_size
    pcm = bytearray()

    for block_idx in range(total_blocks):
        block_start = block_idx * block_size
        block = data[block_start:block_start + block_size]

        for ch in range(channels):
            # Read initial predictor and step index
            pred = struct.unpack_from('<h', block, ch * 4)[0]
            step_idx = block[ch * 4 + 2]
            step = IMA_STEP_TABLE[step_idx] if 0 <= step_idx < len(IMA_STEP_TABLE) else 7

            # Output first sample
            pcm += struct.pack('<h', pred)

            # Decode ADPCM nibbles
            nibble_pos = 4 * channels
            for i in range(samples_per_block - 1):
                byte_offset = nibble_pos + i // 2
                if byte_offset >= block_size:
                    break
                if i % 2 == 0:
                    nibble = block[byte_offset] & 0x0f
                else:
                    nibble = (block[byte_offset] >> 4) & 0x0f

                # IMA decode
                diff = 0
                step = IMA_STEP_TABLE[step_idx] if 0 <= step_idx < len(IMA_STEP_TABLE) else 7
                if nibble & 4: diff += step
                if nibble & 2: diff += step >> 1
                if nibble & 1: diff += step >> 2
                diff += step >> 3

                if nibble & 8:
                    pred -= diff
                else:
                    pred += diff

                # Clamp
                if pred > 32767: pred = 32767
                elif pred < -32768: pred = -32768

                # Update step index
                step_idx += IMA_INDEX_TABLE[nibble & 7]
                if step_idx < 0: step_idx = 0
                if step_idx > 88: step_idx = 88

                pcm += struct.pack('<h', pred)

    return pcm

def parse_fsb5(data):
    """Parse FSB5 file and extract audio parameters"""
    magic = data[:4]
    if magic != b'FSB5':
        raise ValueError(f"Not an FSB5 file: {magic}")

    num_samples = struct.unpack_from('<I', data, 4)[0]

    # FSB5 header parsing - try common layouts
    # Layout 1: 0x08=num sub, 0x0c=header_size, 0x10=version
    # Layout 2 (Wwise): 0x08=?, 0x0c=?, 0x10=data_offset, 0x14=data_size

    # Try to find sample name 'harp', 'bell' etc in binary
    sample_entries = []
    pos = 0x1c

    for i in range(num_samples):
        # Each FSB5 sample entry has variable format
        # We'll look for the structured metadata
        if pos + 64 > len(data):
            break

        # Try to find name using heuristic
        name_bytes = data[pos:pos+4]

        # Check known offsets for name
        name = ""
        for name_offset in range(0, 64):
            if pos + name_offset + 4 > len(data):
                break
            potential_name = data[pos+name_offset:pos+name_offset+4]
            # Look for common instrument name patterns
            if potential_name.isascii() and potential_name.replace(b'.', b'').isalnum():
                # Find null-terminated string
                end = data.find(b'\x00', pos+name_offset)
                if end > 0 and end - (pos+name_offset) < 32:
                    name = data[pos+name_offset:end].decode('ascii', errors='replace')
                    if len(name) > 2:
                        break

        # Parse sample-specific metadata
        freq = 44100
        channels = 1
        num_samples_audio = 0
        audio_offset = 0
        audio_size = 0
        codec = 2  # Default to IMA ADPCM for MC BE

        # Try various metadata positions
        # At offset 0x40 from file start (0x24 from entry start): freq info
        # At offset 0x50: sample count, channels
        if pos + 0x34 < len(data):
            freq = struct.unpack_from('<I', data, pos + 0x24)[0]
            if freq < 8000 or freq > 48000:
                freq = 44100
            val_at_38 = struct.unpack_from('<I', data, pos + 0x38)[0]
            if val_at_38 > 0 and val_at_38 < 100000:
                num_samples_audio = val_at_38
            channels_val = struct.unpack_from('<I', data, pos + 0x3c)[0]
            if 0 < channels_val < 8:
                channels = channels_val

        audio_offset_default = 0x80
        audio_size_default = len(data) - audio_offset_default

        sample_entries.append({
            'name': name or f"sample_{i}",
            'freq': freq or 44100,
            'channels': channels or 1,
            'samples': num_samples_audio,
            'codec': codec,
            'audio_offset': audio_offset or audio_offset_default,
            'audio_size': audio_size or audio_size_default,
        })

        # Move to next entry (variable length)
        pos += 0x40  # approximate

    if not sample_entries:
        raise ValueError("Could not parse sample entries")

    return sample_entries

def write_wav(pcm_data, freq, channels, output_path):
    """Write PCM data as WAV file"""
    num_samples = len(pcm_data) // 2 // channels
    data_size = len(pcm_data)

    with open(output_path, 'wb') as f:
        # RIFF header
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + data_size))
        f.write(b'WAVE')

        # fmt chunk
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))  # chunk size
        f.write(struct.pack('<H', 1))   # PCM format
        f.write(struct.pack('<H', channels))
        f.write(struct.pack('<I', freq))
        f.write(struct.pack('<I', freq * channels * 2))  # byte rate
        f.write(struct.pack('<H', channels * 2))  # block align
        f.write(struct.pack('<H', 16))  # bits per sample

        # data chunk
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        f.write(pcm_data)

def convert_fsb_to_wav(fsb_path, wav_path=None):
    """Convert FSB5 file to WAV"""
    with open(fsb_path, 'rb') as f:
        data = f.read()

    entries = parse_fsb5(data)
    entry = entries[0]

    audio_data = data[0x80:]  # FSB5 with audio at offset 0x80
    if entry['channels'] == 1:
        pcm = decode_ima_adpcm(audio_data, 1, 256)
    else:
        # For multi-channel, decode interleaved blocks
        pcm = decode_ima_adpcm(audio_data, entry['channels'], 256 * entry['channels'])

    if not wav_path:
        wav_path = os.path.splitext(fsb_path)[0] + '.wav'

    write_wav(pcm, entry['freq'], entry['channels'], wav_path)
    print(f"Converted: {fsb_path} -> {wav_path}")
    print(f"  Format: {entry['freq']}Hz, {entry['channels']}ch, IMA ADPCM")
    return wav_path

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python fsb2wav.py input.fsb [output.wav]")
        sys.exit(1)

    fsb_path = sys.argv[1]
    wav_path = sys.argv[2] if len(sys.argv) > 2 else None
    convert_fsb_to_wav(fsb_path, wav_path)
