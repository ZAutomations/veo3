"""Compare spoken audio timing in a joined video with its source clips."""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np

clips, output = Path(sys.argv[1]), Path(sys.argv[2])

def audio(file, start, duration):
    data = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(file), '-ss', str(start), '-t', str(duration),
        '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'])
    return np.frombuffer(data, dtype='<f4').astype(float)

report = []
offset = 0.0
for file in sorted(clips.glob('scene-*.mp4')):
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(file)]))
    duration = float(next(s for s in info['streams'] if s['codec_type'] == 'video')['duration'])
    source = audio(file, 1.5, 3)
    joined = audio(output, offset + 1.4, 3.2)
    scores = np.correlate(joined, source, mode='valid')
    best = int(np.argmax(scores))
    lag = best / 8000 - 0.1
    match = joined[best:best + len(source)]
    correlation = float(np.dot(source, match) / np.sqrt(np.dot(source, source) * np.dot(match, match)))
    report.append({'clip': file.name, 'timing_error_ms': round(lag * 1000, 3), 'correlation': round(correlation, 5)})
    if abs(lag) > 0.025 or correlation < 0.90:
        raise RuntimeError(f'Audio timing check failed: {report[-1]}')
    offset += duration
print(json.dumps(report, indent=2))
