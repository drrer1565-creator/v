'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual preview functions, not a duplicate implementation.
const source = fs.readFileSync(path.join(__dirname, '../src/batch-reels.js'), 'utf8');
const start = source.indexOf('function _getPreviewMultiClipPool(task) {');
const end = source.indexOf('async function _preFetchMultiBgDurations(task) {', start);
assert.ok(start >= 0 && end > start, 'could not locate legacy preview segmentation');
const segmentCode = source.slice(start, end);

function preview(task, { audioDuration = 0 } = {}) {
    const sandbox = {
        __task: task,
        _reelsFileExists: p => typeof p === 'string' && !p.includes('deleted'),
        _getEffectiveBgClipPool: t => Array.isArray(t.bgClipPool) ? t.bgClipPool : [],
        _isImageFile: p => /\.(png|jpg)$/i.test(p),
        _mulberry32: () => () => 0.5,
        document: {
            getElementById: id => id === 'reels-preview-audio' && audioDuration
                ? { src: 'test-audio', duration: audioDuration }
                : null
        }
    };
    // A synchronous hang in the actual function becomes a short test failure.
    const result = vm.runInNewContext(segmentCode + '\n_calculatePreviewSegments(__task)', sandbox, { timeout: 1000 });
    return JSON.parse(JSON.stringify(result));
}

test('all deleted clips are skipped without losing source paths', () => {
    const task = { bgMode: 'multi', bgClipPool: ['deleted-a.mp4', 'deleted-b.mp4'], overlays: [{ text: 'preserve' }] };
    assert.deepEqual(preview(task), []);
    assert.deepEqual(task.bgClipPool, ['deleted-a.mp4', 'deleted-b.mp4']);
    assert.equal(task.overlays[0].text, 'preserve');
});

test('partly missing pool previews remaining clips and preserves original ordering', () => {
    const task = { bgMode: 'multi', bgClipPool: ['deleted-a.mp4', 'valid.mp4', 'deleted-b.mp4'], bgClipOrder: 'sequence' };
    const segments = preview(task);
    assert.ok(segments.length > 0);
    assert.ok(segments.every(s => s.path === 'valid.mp4'));
    assert.deepEqual(task.bgClipPool, ['deleted-a.mp4', 'valid.mp4', 'deleted-b.mp4']);
});

test('valid clip with trim keeps the original duration calculation', () => {
    const task = {
        bgMode: 'multi', bgClipPool: ['valid.mp4'], bgClipSettings: { 'valid.mp4': { trimStart: 1, trimEnd: 3 } }
    };
    const segments = preview(task);
    assert.equal(segments[0].duration, 2);
    assert.equal(segments[0].trimStart, 1);
});

test('nonsensical duration scaling and very long audio fail closed', () => {
    const task = { bgMode: 'multi', bgClipPool: ['valid.mp4'], bgDurScale: 'Infinity' };
    assert.deepEqual(preview(task), []);
    task.bgDurScale = 100;
    assert.deepEqual(preview(task, { audioDuration: 1e12 }), []);
});

test('extreme alignment settings never yield an unbounded loop', () => {
    const task = {
        bgMode: 'multi', bgClipPool: ['valid.mp4'], bgClipOrder: 'sequence_align',
        bgMinClipDur: -1, bgMaxClipDur: 0,
        segments: [{ start: 0, end: 10, text: 'A sentence.' }]
    };
    const segments = preview(task);
    assert.ok(segments.length > 0 && segments.length < 5000);
    assert.ok(segments.every(s => Number.isFinite(s.start) && Number.isFinite(s.end)));
});
