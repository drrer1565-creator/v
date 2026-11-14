'use strict';
const os = require('node:os');

function estimateExportBytes(params = {}) {
    const width = Math.max(1, Number(params.targetWidth || params.width) || 1080);
    const height = Math.max(1, Number(params.targetHeight || params.height) || 1920);
    const duration = Math.max(0, Number(params.duration) || 0);
    const bgPoolCount = Array.isArray(params.bgClipPool) ? params.bgClipPool.length : 0;
    const durationScale = duration >= 75 ? 1.45 : 1;
    const poolBytes = bgPoolCount > 4 ? Math.min(256 * 1024 * 1024, (bgPoolCount - 4) * 24 * 1024 * 1024) : 0;
    // Decoded frame cache, in-flight snapshots, compositing surfaces and decoder overhead.
    return Math.ceil((width * height * 4 * 25 + 96 * 1024 * 1024) * durationScale + poolBytes);
}

class ReelsExportScheduler {
    constructor({ maxActive, maxBytes } = {}) {
        this.maxActive = maxActive || Math.max(1, Math.min(3, Math.floor((os.availableParallelism?.() || os.cpus().length) / 2)));
        this.maxBytes = maxBytes || Math.max(256 * 1024 * 1024, Math.min(1024 * 1024 * 1024, os.totalmem() * .15));
        this.active = 0; this.bytes = 0; this.queue = [];
    }
    acquire(params, { signal, onQueue } = {}) {
        if (signal?.aborted) return Promise.reject(new Error('__CANCELLED__'));
        return new Promise((resolve, reject) => {
            const job = { bytes: estimateExportBytes(params), signal, resolve, reject };
            job.abort = () => {
                const index = this.queue.indexOf(job);
                if (index < 0) return;
                this.queue.splice(index, 1); signal.removeEventListener('abort', job.abort);
                reject(new Error('__CANCELLED__')); this.drain();
            };
            signal?.addEventListener('abort', job.abort, { once: true });
            this.queue.push(job); this.drain();
            if (this.queue.includes(job)) onQueue?.({ active: this.active, waiting: this.queue.length, maxActive: this.maxActive });
        });
    }
    drain() {
        while (this.queue.length && this.active < this.maxActive) {
            const job = this.queue[0];
            if (this.active && this.bytes + job.bytes > this.maxBytes) break;
            if (this.active >= 1 && typeof os.freemem === 'function' && os.freemem() < 1200 * 1024 * 1024) break;
            this.queue.shift(); job.signal?.removeEventListener('abort', job.abort);
            this.active++; this.bytes += job.bytes;
            let released = false;
            job.resolve(() => {
                if (released) return; released = true;
                this.active--; this.bytes -= job.bytes; this.drain();
            });
        }
    }
}
module.exports = { ReelsExportScheduler, estimateExportBytes };
