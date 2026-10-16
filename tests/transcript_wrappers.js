const assert=require('assert'),S=require('../dialogue_speakers');
assert.deepEqual(S.labelledTranscriptTurns('Story brief:\nSarah wants to talk.\nClip 1 - Hook\nSarah: “Can we talk?”\nGeorge: "Yes."\nEnding message:\nCommunication matters.'),[{speaker:'Sarah',line:'Can we talk?'},{speaker:'George',line:'Yes.'}]);
assert.throws(()=>S.labelledTranscriptTurns('Sarah: Can we talk?\nAn unlabelled spoken turn.\nGeorge: Yes.'),/speaker is missing/);
assert.throws(()=>S.labelledTranscriptTurns('Transcript:\nAn unlabelled opening.\nSarah: Hello.'),/speaker is missing/);
assert(!require('../relationship_transcript').hasPastedTranscript('Story brief:\nSarah wants to talk; George listens.'));
console.log('PASS: formatted dialogue supports prose metadata and clip headings; genuinely unlabelled speech still rejected.');
