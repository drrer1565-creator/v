'use strict';

// Main-process, bounded stat checks. Never scan folders to "repair" deleted template paths.
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

function classifyMediaPath(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192)
        return { status: 'missing', reason: 'invalid-path' };
    const raw = value.trim();
    if (/^(https?:|data:)/i.test(raw)) return { status: 'available', reason: 'external-not-verified' };
    if (/^blob:/i.test(raw)) return { status: 'unavailable', reason: 'expired-blob-url' };
    let native = raw;
    if (/^(file|local-media):\/\//i.test(raw)) {
        try { native = fileURLToPath(raw.replace(/^local-media:/i, 'file:')); }
        catch (_) { return { status: 'failed', reason: 'invalid-file-url' }; }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
        return { status: 'failed', reason: 'unsupported-scheme' };
    }
    return { localPath: native };
}

class ReelsMediaAvailability {
    constructor({ stat = fs.promises.stat.bind(fs.promises), resolvePath = p => p,
        maxConcurrent = 4, maxQueued = 128, timeoutMs = 2000, now = () => Date.now() } = {}) {
        this.stat = stat;
        this.resolvePath = resolvePath;
        this.maxConcurrent = maxConcurrent;
        this.maxQueued = maxQueued;
        this.timeoutMs = timeoutMs;
        this.now = now;
        this.active = 0;
        this.queue = [];
        this.inflight = new Map();
        this.cache = new Map();
    }

    async check(value, { force = false } = {}) {
        const info = classifyMediaPath(value);
        if (!info.localPath) return { status: info.status, reason: info.reason };
        let native;
        try {
            native = this.resolvePath(info.localPath);
            if (typeof native !== 'string' || !native) throw new Error('invalid path');
        } catch (_) { return { status: 'failed', reason: 'invalid-path' }; }
        const key = process.platform === 'win32' ? native.toLowerCase() : native;
        if (force) this.cache.delete(key);
        const cached = this.cache.get(key);
        if (cached && cached.expires > this.now()) return cached.result;
        if (this.inflight.has(key)) return this.inflight.get(key);
        if (this.queue.length >= this.maxQueued) return { status: 'unavailable', reason: 'busy' };
        const request = new Promise(resolve => this.queue.push({ key, native, resolve }));
        this.inflight.set(key, request);
        this.pump();
        return request;
    }

    pump() {
        while (this.active < this.maxConcurrent && this.queue.length) {
            const item = this.queue.shift();
            this.active++;
            let settled = false;
            let timer;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const ttl = result.status === 'available' ? 15000 :
                    result.status === 'missing' ? 30000 : 4000;
                this.cache.set(item.key, { result, expires: this.now() + ttl });
                if (this.cache.size > 1024) this.cache.delete(this.cache.keys().next().value);
                item.resolve(result);
            };
            timer = setTimeout(() => finish({ status: 'unavailable', reason: 'timeout' }), this.timeoutMs);
            // A timed-out filesystem call may still be running in libuv. Keep its
            // concurrency slot until it really settles, to prevent an IO storm.
            Promise.resolve().then(() => this.stat(item.native))
                .then(stats => finish(stats.isFile() && stats.size > 0
                    ? { status: 'available', reason: 'ok' }
                    : { status: 'failed', reason: 'not-readable-media-file' }))
                .catch(error => finish({
                    status: error && (error.code === 'ENOENT' || error.code === 'ENOTDIR') ? 'missing' :
                        error && (error.code === 'EACCES' || error.code === 'EPERM') ? 'unavailable' : 'failed',
                    reason: String(error?.code || 'stat-error')
                }))
                .finally(() => {
                    this.active--;
                    this.inflight.delete(item.key);
                    this.pump();
                });
        }
    }
}

module.exports = { ReelsMediaAvailability, classifyMediaPath };
