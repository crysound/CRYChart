"""Generate an original, deterministic stereo PCM WAV for offline STFT examples."""
from pathlib import Path
import array
import hashlib
import json
import math
import random
import sys
import wave

root = Path(__file__).resolve().parents[1]
destination = root / 'examples' / 'data' / 'crychart-stereo.wav'
rate, duration = 24000, 13
rng = random.Random(20802)
pcm = array.array('h')
for index in range(rate * duration):
    t = index / rate
    envelope = min(1., t * 2, (duration - t) * 2) * (.5 + .5 * math.sin(t * 1.3)**2)
    for channel in range(2):
        base = (180 + channel * 90) * t + 28 * t * t
        chirp = 1700 * t + (130 + 55 * channel) * t * t
        value = envelope * (.019 * math.sin(math.tau * base) + .006 * math.sin(math.tau * chirp) + .002 * (rng.random() * 2 - 1))
        pcm.append(round(value * 32767))
if sys.byteorder != 'little':
    pcm.byteswap()
destination.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(destination), 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(pcm.tobytes())
metadata = {'kind': 'independent-synthetic', 'generator': 'scripts/generate-audio-fixture.py', 'sampleRate': rate, 'channels': 2, 'seconds': duration, 'pcmBits': 16, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'description': 'Original chirps and deterministic noise. No upstream recording, code, or media used.'}
destination.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata))
