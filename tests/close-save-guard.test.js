'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { guardWorkspaceClose } = require('../electron/services/close-save-guard');

test('successful close saves first', async () => {
    const events = [];
    const r = await guardWorkspaceClose({
        requestSave: async () => { events.push('save'); return { ok: true }; },
        decide: async () => { throw new Error('must not ask'); },
        closeNormally: () => events.push('close'),
        forceClose: () => events.push('force'),
    });
    assert.equal(r, 'saved');
    assert.deepEqual(events, ['save','close']);
});

test('hung renderer offers a forced-exit path', async () => {
    const events = [];
    const r = await guardWorkspaceClose({
        requestSave: () => new Promise(() => {}),
        decide: async reason => { events.push(reason); return 'exit'; },
        closeNormally: () => events.push('close'),
        forceClose: () => events.push('force'),
        timeoutMs: 10,
    });
    assert.equal(r, 'forced');
    assert.deepEqual(events, ['timeout','force']);
});

test('a late success cannot close a window after cancellation', async () => {
    let finish;
    let closeCount = 0;
    const save = new Promise(resolve => { finish = resolve; });
    const r = await guardWorkspaceClose({
        requestSave: () => save,
        decide: async () => 'cancel',
        closeNormally: () => closeCount++,
        forceClose: () => closeCount++,
        timeoutMs: 10
    });
    assert.equal(r, 'cancelled');
    finish({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closeCount, 0);
});

test('continue waiting can complete normal close', async () => {
    let complete;
    let calls = 0;
    const save = new Promise(resolve => { complete = resolve; });
    const r = await guardWorkspaceClose({
        requestSave: () => save,
        decide: async () => { calls++; complete({ ok: true }); return 'wait'; },
        closeNormally: () => { calls++; },
        forceClose: () => { throw new Error('unexpected force'); },
        timeoutMs: 10
    });
    assert.equal(r, 'saved');
    assert.equal(calls, 2);
});

test('failed save keeps window open when cancelled', async () => {
    let closed = false;
    const r = await guardWorkspaceClose({
        requestSave: async () => ({ ok: false, error: 'disk full' }),
        decide: async (reason, error) => {
            assert.equal(reason, 'failed'); assert.match(error.message, /disk full/); return 'cancel';
        },
        closeNormally: () => { closed = true; },
        forceClose: () => { closed = true; }
    });
    assert.equal(r, 'cancelled');
    assert.equal(closed, false);
});
