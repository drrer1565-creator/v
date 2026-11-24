'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
function func(source, name) {
    const start = source.search(new RegExp('(?:async )?function ' + name + '\\('));
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
const table = read('reels-batch-table.js');
const clone = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
const textTask = (id, text) => ({ id, baseName: id, audioPath: id + '.mp3', ttsText: text, overlays: [] });

function alignHarness({ concurrency = 2, count = 16, duplicate = false } = {}) {
    const tasks = Array.from({ length: count }, (_, i) => textTask('a' + i, 'Prayer ' + i));
    if (duplicate && count > 1) { tasks[1].audioPath = tasks[0].audioPath; tasks[1].ttsText = tasks[0].ttsText; }
    const tabs = [{ id: 'A', materialDir: '/original', tasks: clone(tasks) },
        { id: 'B', materialDir: '/other', tasks: tasks.map((t, i) => textTask(t.id, 'Other prayer ' + i)) }];
    const selectors = {
        'rbt-align-source': { value: 'audio' }, 'rbt-align-model': { value: 'gladia' },
        'rbt-align-txt-col': { value: 'ttsText' }, 'rbt-align-lang': { value: '英语' },
        'rbt-align-auto-detect': { checked: false },
    };
    let activeId = 'A', report, duringRequest = () => {}, requests = [], syncs = 0;
    const context = {
        console: quiet, setTimeout: fn => { queueMicrotask(fn); return 0; }, clearTimeout() {},
        window: { _reelsState: { tasks, selectedIdx: -1 } },
        document: { getElementById: id => selectors[id] }, localStorage: { getItem: () => null },
        _batchTableState: { visible: true, tabs, container: null }, API_BASE: '/api',
        _getActiveTab: () => tabs.find(t => t.id === activeId),
        _cloneBatchTasks: clone, _ensureTaskId: t => { if (!t.id) t.id = 'new-id'; },
        _applyBatchTableChanges: () => { syncs++; },
        _syncTasksToActiveTab: () => { tabs.find(t => t.id === activeId).tasks = clone(context.window._reelsState.tasks); },
        _rbtSmartLineBreak: text => String(text || ''),
        _findBatchTextCardOverlay: t => t.overlays?.find(o => o.type === 'textcard'),
        _findBatchScrollOverlay: t => t.overlays?.find(o => o.type === 'scroll'),
        _rbtApplyPendingFirstSubtitleStyle() {}, _batchAutoSave() {}, _renderTaskList() {}, _renderBatchTable() {},
        _showBatchAlignResultModal: async result => { report = result; },
        _buildBatchAlignTripleTableRow: (name, recognized, candidate) => ({ taskName: name, matchedText: candidate.sourceText, srtText: candidate.sourceText }),
        _shortName: p => p, alert: message => { throw new Error('Unexpected alert: ' + message); }, confirm: () => false,
        apiFetch: async (url, options) => {
            if (url.endsWith('/settings/transcription-providers')) {
                duringRequest('config', null);
                return { json: async () => ({ concurrency }) };
            }
            if (url.endsWith('settings/gemini-keys')) return { json: async () => ({ lbMaxChars: 16 }) };
            if (url.endsWith('/subtitle/generate')) {
                const body = JSON.parse(options.body); requests.push(body); duringRequest('generate', body);
                await Promise.resolve();
                return { ok: true, json: async () => ({ files: [body.audio_path + '.srt'], recognized_text: body.source_text, transcription_source: 'gladia_fresh' }) };
            }
            throw new Error('Unexpected API: ' + url);
        },
    };
    vm.createContext(context);
    for (const name of ['_batchAlignInputSignature', '_createBatchAlignRun', '_commitBatchAlignTask',
        '_buildBatchAlignSourceTextCandidates', '_discardTaskSrtBeforeRefind', '_batchAlignAllTasks', '_batchAlignWithMultipleKeys']) {
        vm.runInContext(func(table, name), context);
    }
    return { context, tabs, selectors, requests, get report() { return report; }, get syncs() { return syncs; },
        onRequest: fn => { duringRequest = fn; },
        switchToB: (blank = false) => {
            activeId = 'B';
            if (blank) tabs[1].tasks.forEach(t => { t.ttsText = ''; });
            context.window._reelsState.tasks = clone(tabs[1].tasks);
            selectors['rbt-align-txt-col'].value = 'txtContent';
            selectors['rbt-align-source'].value = 'video';
            selectors['rbt-align-lang'].value = '法语';
        },
    };
}

for (const blank of [false, true]) test(`parallel alignment stays in its tab after switching to ${blank ? 'blank' : 'populated'} tab`, async () => {
    const h = alignHarness();
    h.onRequest(kind => { if (kind === 'generate' && h.requests.length === 2) h.switchToB(blank); });
    await h.context._batchAlignWithMultipleKeys();
    assert.match(h.report.title, /成功 16\/16，失败 0/);
    assert.equal(h.syncs, 1, 'workers must never apply the other tab DOM');
    assert.equal(h.requests.length, 16);
    h.requests.forEach((body, i) => {
        assert.match(body.audio_path, /^\/original\/a\d+\.mp3$/);
        assert.match(body.source_text, /^Prayer /);
        assert.equal(body.language, '英语');
    });
    assert.ok(h.tabs[0].tasks.every(t => t.aligned && t.srtPath));
    assert.ok(h.tabs[1].tasks.every(t => !t.aligned && !t.srtPath));
    assert.ok(h.context.window._reelsState.tasks.every(t => !t.aligned && !t.srtPath));
});

test('tab and settings are captured before the concurrency configuration request completes', async () => {
    const h = alignHarness(); h.onRequest(kind => { if (kind === 'config') h.switchToB(); });
    await h.context._batchAlignWithMultipleKeys();
    assert.match(h.report.title, /成功 16\/16，失败 0/);
    assert.ok(h.tabs[0].tasks.every(t => t.aligned));
    assert.ok(h.tabs[1].tasks.every(t => !t.aligned));
});

test('serial fallback also keeps its originating tab', async () => {
    const h = alignHarness({ concurrency: 1, count: 3 });
    h.onRequest(kind => { if (kind === 'generate' && h.requests.length === 1) h.switchToB(); });
    await h.context._batchAlignWithMultipleKeys();
    assert.ok(h.tabs[0].tasks.every(t => t.aligned));
    assert.ok(h.tabs[1].tasks.every(t => !t.aligned));
});

test('changing source text during a request reports a conflict without overwriting it', async () => {
    const h = alignHarness({ count: 1 });
    h.onRequest(kind => { if (kind === 'generate') h.context.window._reelsState.tasks[0].ttsText = 'Edited while running'; });
    await h.context._batchAlignWithMultipleKeys();
    assert.equal(h.context.window._reelsState.tasks[0].ttsText, 'Edited while running');
    assert.equal(h.context.window._reelsState.tasks[0].aligned, undefined);
    assert.match(h.report.failDetails[0], /音频或文案已修改/);
});

test('deleted task is not recreated and a matching ID in another tab is untouched', () => {
    const h = alignHarness({ count: 1 }); const run = h.context._createBatchAlignRun(); const result = run.state.tasks[0];
    h.tabs[0].tasks = []; h.switchToB(); result.aligned = true; result.srtPath = '/result.srt';
    assert.throws(() => h.context._commitBatchAlignTask(run, result), /已删除/);
    assert.equal(h.context.window._reelsState.tasks[0].srtPath, undefined);
});

test('result commits by ID after reorder while preserving unrelated style and volume edits', () => {
    const h = alignHarness({ count: 2 }); const run = h.context._createBatchAlignRun(); const result = run.state.tasks[0];
    h.context.window._reelsState.tasks.reverse(); h.tabs[0].tasks.reverse();
    const live = h.context.window._reelsState.tasks.find(t => t.id === result.id);
    live.voiceVolume = 17; live.subtitleStyle = { color: '#ff0000' };
    result.aligned = true; result.srtPath = '/result.srt'; result.voiceVolume = 90;
    h.context._commitBatchAlignTask(run, result);
    assert.equal(live.srtPath, '/result.srt'); assert.equal(live.voiceVolume, 17);
    assert.equal(live.subtitleStyle.color, '#ff0000');
    assert.equal(h.context.window._reelsState.tasks[0].srtPath, undefined);
});

test('candidate pool ignores another tab DOM and remains unchanged after a worker writes text', () => {
    const h = alignHarness({ count: 2 }); const run = h.context._createBatchAlignRun();
    h.context._batchTableState.container = { querySelectorAll: () => { throw new Error('Other tab DOM read'); } };
    run.state.tasks[0].ttsText = 'Changed by alignment';
    const candidates = h.context._buildBatchAlignSourceTextCandidates(run.candidateTasks, 16, { includeDom: false });
    assert.equal(candidates[0].sourceText, 'Prayer 0'); assert.equal(candidates.length, 2);
});

test('failed realignment preserves the previous SRT link and does not delete its file', async () => {
    const h = alignHarness({ count: 1 });
    h.context.window._reelsState.tasks[0].srtPath = '/existing.srt';
    h.context.window._reelsState.tasks[0].aligned = true;
    h.selectors['rbt-force-realign'] = { checked: true };
    const api = h.context.apiFetch;
    h.context.apiFetch = async (url, options) => url.endsWith('/subtitle/generate')
        ? { ok: false, json: async () => ({ error: 'Provider failed' }) } : api(url, options);
    await h.context._batchAlignWithMultipleKeys();
    assert.equal(h.context.window._reelsState.tasks[0].srtPath, '/existing.srt');
    assert.equal(h.tabs[0].tasks[0].srtPath, '/existing.srt');
    assert.equal(h.context.window._reelsState.tasks[0].aligned, true);
});

test('expired healthy media emits no false change, actual deletion and recovery still emit', async () => {
    let now = 0, status = 'available'; const events = [];
    const window = { electronAPI: { checkReelsMediaStatus: async () => ({ status }) }, dispatchEvent: event => events.push(event.detail.status) };
    const context = { window, document: {}, Date: { now: () => now },
        setTimeout: () => 0, CustomEvent: class { constructor(name, options) { this.detail = options.detail; } } };
    vm.runInNewContext(read('reels-media-availability.js'), context);
    await window.ReelsMediaAvailability.check('/video.mp4');
    now = 15001; await window.ReelsMediaAvailability.check('/video.mp4');
    now = 30002; await window.ReelsMediaAvailability.check('/video.mp4');
    assert.deepEqual(events, ['available']);
    status = 'missing'; await window.ReelsMediaAvailability.check('/video.mp4', { force: true });
    status = 'available'; await window.ReelsMediaAvailability.check('/video.mp4', { force: true });
    assert.deepEqual(events, ['available', 'missing', 'available']);
});

test('rename uses an ordinary dialog input and can cancel, retry, save and recover after failure in one session', async () => {
    let input, resolve, saved = [], notices = [];
    const context = { document: { getElementById: () => input },
        _showInputDialog: () => { input = { isConnected: true, focus() {} }; return new Promise(r => { resolve = value => { input.isConnected = false; r(value); }; }); },
        showToast: message => notices.push(message) };
    vm.createContext(context);
    vm.runInContext('let _tplInlineEditing = {isConnected:false};' + func(read('reels-templates.js'), '_editNameInPlace'), context);
    const title = { textContent: 'Original' };
    let promise = context._editNameInPlace(title, name => saved.push(name)); resolve(null); await promise;
    promise = context._editNameInPlace(title, name => saved.push(name)); resolve('Renamed'); await promise;
    promise = context._editNameInPlace(title, () => { throw new Error('Save failed'); }); resolve('Retry'); await promise;
    promise = context._editNameInPlace(title, name => saved.push(name)); resolve('Recovered'); await promise;
    assert.deepEqual(saved, ['Renamed', 'Recovered']); assert.match(notices[0], /Save failed/);
});

test('automatic text matching keeps the entire originating candidate pool after switching populated tabs', async () => {
    const h = alignHarness({ count: 4 });
    h.selectors['rbt-align-auto-detect'].checked = true;
    h.context._buildBatchAlignMatchReport = () => '';
    const api = h.context.apiFetch;
    h.context.apiFetch = async (url, options) => {
        const response = await api(url, options);
        if (!url.endsWith('/subtitle/generate')) return response;
        const body = JSON.parse(options.body);
        assert.equal(body.source_text_candidates.length, 4);
        assert.ok(body.source_text_candidates.every(c => c.sourceText.startsWith('Prayer ')));
        const index = Number(body.audio_path.match(/a(\d+)\.mp3$/)[1]);
        const data = await response.json();
        return { ok: true, json: async () => ({ ...data,
            auto_matched_source: { index, source_text: 'Prayer ' + index } }) };
    };
    h.onRequest(kind => { if (kind === 'generate' && h.requests.length === 2) h.switchToB(); });
    await h.context._batchAlignWithMultipleKeys();
    assert.match(h.report.title, /成功 4\/4，失败 0/);
    assert.ok(h.tabs[0].tasks.every(t => t.aligned));
});

test('duplicate audio and text reuse actual parsed subtitle segments through guarded commits', async () => {
    const h = alignHarness({ count: 4, duplicate: true });
    h.context.window.electronAPI = { readFileText: async () => '1\n00:00:00,000 --> 00:00:01,000\nPrayer\n' };
    h.context._extractPlainTextFromSrtContent = () => 'Prayer';
    h.context.parseSRT = () => [{ start: 0, end: 1, text: 'Prayer' }];
    h.onRequest(kind => { if (kind === 'generate' && h.requests.length === 2) h.switchToB(); });
    await h.context._batchAlignWithMultipleKeys();
    assert.match(h.report.title, /成功 4\/4，失败 0/);
    assert.equal(h.requests.length, 3);
    assert.equal(h.tabs[0].tasks[1].srtPath, h.tabs[0].tasks[0].srtPath);
    assert.equal(h.tabs[0].tasks[1].segments[0].text, 'Prayer');
    assert.ok(h.tabs[1].tasks.every(t => !t.aligned));
});

test('background reload restores the same scrolling overlay; an explicit task switch still deselects', () => {
    const source = read('batch-reels.js');
    const start = source.indexOf('function reelsSelectTask(');
    const end = source.indexOf("    const video = document.getElementById('reels-preview-video');", start);
    const overlay = { id: 'scroll-1', type: 'scroll' };
    const panel = { _selectedOv: overlay, deselectOverlay() { this._selectedOv = null; },
        _refreshList() {}, selectOverlay(ov) { this._selectedOv = ov; } };
    const state = { selectedIdx: 0, tasks: [{ id: 'task-1', overlays: [overlay] }],
        overlayPanel: panel, overlayProxy: { overlayMgr: { overlays: [overlay] } } };
    const context = { _reelsState: state, window: {}, document: { getElementById: () => null },
        _flushAllPendingReelsEdits() {}, _renderTaskList() {}, _reelsSyncActiveWatermarksFromContext() {},
        _preFetchMultiBgDurations() {}, _preFetchTaskMediaDurations() {}, _resolveSubtitleStyleForTask: () => null };
    vm.createContext(context); vm.runInContext(source.slice(start, end) + '\n}', context);
    context.reelsSelectTask(0, { preserveOverlaySelection: true });
    assert.equal(panel._selectedOv, overlay);
    context.reelsSelectTask(0);
    assert.equal(panel._selectedOv, null);
});
