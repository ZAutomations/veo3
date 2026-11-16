'use strict';
const fs = require('fs');
const path = require('path');

const VIEWS = ['writer', 'agent', 'ingredients', 'omni', 'reverse', 'manual'];
const MAX_LOG_BYTES = 48 * 1024;

function readCheckpoint(folder, view) {
    const file = path.join(folder, `last_${view}_job.json`);
    try {
        const record = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (!/^[a-f0-9]{32}$/.test(record?.id)) return null;
        return { record, view, modified: fs.statSync(file).mtimeMs };
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function logTail(file) {
    let descriptor;
    try {
        descriptor = fs.openSync(file, 'r');
        const size = fs.fstatSync(descriptor).size;
        const buffer = Buffer.alloc(Math.min(size, MAX_LOG_BYTES));
        const start = size - buffer.length;
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, start);
        const lines = buffer.subarray(0, count).toString('utf8').trimEnd().split(/\r?\n/);
        return start > 0 ? lines.slice(1) : lines;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

function redact(value) {
    return String(value ?? '')
        .replace(/AIza[\w-]{35}|\bsk-[\w-]{16,}|\beyJ[\w.-]{20,}|\bBearer\s+[\w.+=/-]+/gi, '[credential hidden]')
        .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/gi, '$1?[query hidden]');
}

function diagnoseWorkspaceJob(root, { view, job_id } = {}) {
    if (view !== undefined && !VIEWS.includes(view)) throw new Error('Choose a saved workflow tab.');
    if (job_id !== undefined && !/^[a-f0-9]{32}$/.test(job_id)) throw new Error('Invalid Studio job ID.');
    const folder = path.join(root, 'logs', 'desktop');
    const checkpoints = (view ? [view] : VIEWS).map(tab => readCheckpoint(folder, tab))
        .filter(item => item && (!job_id || item.record.id === job_id));
    let latest = checkpoints.sort((a, b) => b.modified - a.modified)[0];
    if (!latest && job_id && !view) {
        const result = path.join(folder, `${job_id}.result.json`);
        if (fs.existsSync(result)) {
            const record = JSON.parse(fs.readFileSync(result, 'utf8'));
            if (record.id === job_id) latest = { record, view: null };
        }
    }
    if (!latest) return { message: 'No saved Studio checkpoint for this selection.' };
    const { record } = latest;
    const logPath = path.join(folder, `${record.id}.log`);
    const lines = logTail(logPath).slice(-60);
    const errors = lines.filter(line => /RECOVERY_REVIEW_REQUIRED|FLOW_REVIEW_REQUIRED|IMPORT VALIDATION FAILED|\bFAILED\b|\bError:|exited with code [1-9]/i.test(line));
    const review = errors.some(line => /RECOVERY_REVIEW_REQUIRED|FLOW_REVIEW_REQUIRED|IMPORT VALIDATION FAILED/.test(line));
    const safeLines = rows => rows.map(line => /api[\s_-]*key|authorization|private[\s_-]*key|x-session-token|cookie|password|sign[- ]?in/i.test(line)
        ? '[credential-related line hidden]' : redact(line).slice(0, 750));
    return {
        jobId: record.id,
        view: latest.view,
        action: redact(record.action),
        status: redact(record.status),
        phase: redact(record.phase),
        operation: Number.isInteger(record.operation_index) ? record.operation_index + 1 : record.operation ?? null,
        story: redact(record.current_story || record.payload?.story),
        latestErrors: safeLines(errors.slice(-8)),
        logTail: safeLines(lines.slice(-24)),
        nextStep: record.status === 'running' ? 'Checkpoint says running. Verify live Studio state before taking any recovery action.'
            : record.status === 'completed' ? 'This checkpoint completed. Select another tab to inspect a different job.'
            : review ? 'Resolve the review condition before using Studio Retry / Continue.'
            : 'Verify the failure and use the saved Studio Retry / Continue path if it is safe to resume.',
    };
}

module.exports = { diagnoseWorkspaceJob };
