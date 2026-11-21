'use strict';

/**
 * Main-process close transaction. A renderer that hangs synchronously cannot
 * run its own timeout, so the watchdog must live outside that process.
 * A late save completion never closes a window after the user has cancelled.
 */
function withDeadline(promise, timeoutMs) {
    let timer;
    return Promise.race([
        promise,
        new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs); })
    ]).finally(() => clearTimeout(timer));
}

async function guardWorkspaceClose({
    requestSave, decide, closeNormally, forceClose,
    isAlive = () => true, timeoutMs = 4000
}) {
    // Normalize rejection immediately to avoid an unhandled rejection while
    // the user is looking at the retry/force-exit dialog.
    const save = Promise.resolve().then(requestSave)
        .then(value => ({ kind: 'saved', value }), error => ({ kind: 'failed', error }));
    while (isAlive()) {
        const result = await withDeadline(save, timeoutMs);
        if (!isAlive()) return 'window-gone';
        if (result.kind === 'saved' && result.value?.ok === true) {
            closeNormally();
            return 'saved';
        }
        const failure = result.kind === 'failed' ? result.error
            : result.kind === 'saved' ? new Error(result.value?.error || '保存未完成') : null;
        const choice = await decide(result.kind === 'timeout' ? 'timeout' : 'failed', failure);
        if (!isAlive()) return 'window-gone';
        if (choice === 'wait' && result.kind === 'timeout') continue;
        if (choice === 'exit') {
            forceClose();
            return 'forced';
        }
        return 'cancelled';
    }
    return 'window-gone';
}

module.exports = { guardWorkspaceClose, withDeadline };
