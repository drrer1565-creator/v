'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { ReelsMediaAvailability, classifyMediaPath } = require('../electron/services/reels-media-availability');

test('file URLs, Chinese names and Windows paths are classified without destructive decoding', () => {
    const nativePath = path.join(os.tmpdir(), '农场 (1).mp4');
    const url = classifyMediaPath(pathToFileURL(nativePath).href);
    assert.equal(url.localPath, nativePath);
    assert.equal(classifyMediaPath('C:\\Video\\farm.mp4').localPath, 'C:\\Video\\farm.mp4');
    assert.equal(classifyMediaPath('blob:stale').status, 'unavailable');
    assert.equal(classifyMediaPath('https://example.org/video.mp4').status, 'available');
    assert.equal(classifyMediaPath({}).status, 'missing');
});

test('missing files return missing, access errors are not mislabeled as deletion', async () => {
    const fake = new ReelsMediaAvailability({ stat: async path => {
        if (path === '/deleted.mp4') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        if (path === '/locked.mp4') throw Object.assign(new Error('access'), { code: 'EACCES' });
        return { isFile: () => true, size: 10 };
    } });
    assert.equal((await fake.check('/deleted.mp4')).status, 'missing');
    assert.equal((await fake.check('/locked.mp4')).status, 'unavailable');
    assert.equal((await fake.check('/good.mp4')).status, 'available');
});

test('inflight duplicate checks are merged, caches apply, forced retry rechecks', async () => {
    let calls = 0;
    const fake = new ReelsMediaAvailability({ stat: async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    } });
    const statuses = await Promise.all(Array.from({ length: 10 }, () => fake.check('/same.mp4')));
    assert.ok(statuses.every(s => s.status === 'missing'));
    assert.equal(calls, 1);
    await fake.check('/same.mp4');
    assert.equal(calls, 1);
    await fake.check('/same.mp4', { force: true });
    assert.equal(calls, 2);
});

test('hung checks time out, no more than maxConcurrent underlying operations', async () => {
    let started = 0;
    const fake = new ReelsMediaAvailability({ stat: () => { started++; return new Promise(() => {}); },
        maxConcurrent: 2, maxQueued: 3, timeoutMs: 12 });
    const results = await Promise.all(['/1.mp4','/2.mp4'].map(path => fake.check(path)));
    assert.ok(results.every(s => s.status === 'unavailable' && s.reason === 'timeout'));
    assert.equal(started, 2);
    assert.equal(fake.active, 2);
    // Three more checks may queue, but cannot start another stat call.
    void fake.check('/3.mp4');
    void fake.check('/4.mp4');
    void fake.check('/5.mp4');
    const busy = await fake.check('/6.mp4');
    assert.deepEqual(busy, { status: 'unavailable', reason: 'busy' });
    assert.equal(started, 2);
});
