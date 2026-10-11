// Cache completed writing calls by exact prompt. A changed prompt never reuses old work.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function writingCall(dir, prompt, request, accept, report = () => {}) {
    const key = crypto.createHash('sha256').update(prompt).digest('hex');
    const folder = path.join(dir, 'writing_progress');
    const file = path.join(folder, key + '.json');
    if (fs.existsSync(file)) {
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved.promptHash === key && accept(saved.answer)) {
                report('restored completed writing call from disk');
                return saved.answer;
            }
        } catch { /* Corrupt/incompatible progress is not a usable answer. */ }
    }
    // Preserve the actual request for diagnosing an interrupted/blocked call.
    // Failed calls are never cached as answers and are never retried here.
    fs.mkdirSync(folder, { recursive: true });
    const requestFile = path.join(folder, key + '.request.txt');
    fs.writeFileSync(requestFile, prompt, 'utf8');
    let answer;
    try {
        answer = await request();
    } catch (error) {
        fs.writeFileSync(path.join(folder, key + '.failure.json'), JSON.stringify({
            promptHash: key, failedAt: new Date().toISOString(), requestFile,
            message: error.message, blockReason: error.blockReason || null,
        }, null, 2) + '\n');
        report(`writing request failed; diagnostics saved in ${folder}`);
        throw error;
    }
    if (accept(answer)) {
        fs.mkdirSync(folder, { recursive: true });
        const temp = file + '.' + process.pid + '.tmp';
        fs.writeFileSync(temp, JSON.stringify({ promptHash: key, savedAt: new Date().toISOString(), answer }, null, 2) + '\n');
        fs.renameSync(temp, file);
    }
    return answer;
}
module.exports = { writingCall };
