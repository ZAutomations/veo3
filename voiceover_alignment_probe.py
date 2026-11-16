"""Decode a recording locally without biasing Whisper with the expected script."""
from pathlib import Path
import json
import sys

import torch
import whisper


if __name__ == '__main__':
    audio, language, model_path, output = sys.argv[1:]
    torch.set_num_threads(min(torch.get_num_threads(), 4))
    model = whisper.load_model(model_path)
    result = model.transcribe(audio, language=language, word_timestamps=True,
                              condition_on_previous_text=False, temperature=0, beam_size=5, verbose=None)
    words = [word for segment in result['segments'] for word in segment.get('words', [])
             if word['word'].strip() and word['end'] > word['start']]
    Path(output).write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')
