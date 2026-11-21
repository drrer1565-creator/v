/* Runtime-only media status. Never mutate saved task paths or source clip pools. */
(function () {
    'use strict';
    const records = new Map();
    const pending = new Map();
    const TTL = { available: 15000, missing: 30000, unavailable: 4000, failed: 4000 };
    let generation = 0;

    const pathsForTask = task => {
        if (!task) return [];
        const paths = task.bgMode === 'multi' && Array.isArray(task.bgClipPool)
            ? task.bgClipPool : [task.bgPath || task.videoPath || ''];
        return [...new Set(paths.filter(p => typeof p === 'string' && p.trim()))];
    };
    const get = path => {
        const item = records.get(path);
        return item && item.expiry > Date.now() ? item.result : { status: 'unchecked' };
    };

    async function check(path, { force = false } = {}) {
        if (typeof path !== 'string' || !path.trim()) return { status: 'missing', reason: 'empty' };
        if (!force && get(path).status !== 'unchecked') return get(path);
        if (pending.has(path)) return pending.get(path);
        const serial = generation;
        const request = (async () => {
            let result = { status: 'available', reason: 'browser-mode-not-verified' };
            if (typeof window.electronAPI?.checkReelsMediaStatus === 'function') {
                try {
                    result = await Promise.race([
                        window.electronAPI.checkReelsMediaStatus(path, force),
                        new Promise(resolve => setTimeout(() => resolve({ status: 'unavailable', reason: 'ipc-timeout' }), 2800))
                    ]);
                } catch (_) { result = { status: 'unavailable', reason: 'ipc-error' }; }
            }
            if (!result || !['available', 'missing', 'unavailable', 'failed'].includes(result.status))
                result = { status: 'failed', reason: 'invalid-result' };
            if (serial === generation) {
                const old = get(path).status;
                records.set(path, { result, expiry: Date.now() + (TTL[result.status] || 4000) });
                if (records.size > 1000) records.delete(records.keys().next().value);
                if (old !== result.status) window.dispatchEvent(new CustomEvent('reels-media-availability-changed', { detail: { path, status: result.status } }));
            }
            return result;
        })().finally(() => { if (pending.get(path) === request) pending.delete(path); });
        pending.set(path, request);
        return request;
    }
    function isUsable(path) {
        if (typeof path !== 'string' || !path.trim()) return false;
        if (window._reelsSafeRestoreNoMedia) return false;
        if (/^blob:/i.test(path)) return false; // persisted blob URLs cannot survive a restart
        const result = get(path);
        if (result.status === 'unchecked') void check(path);
        return !['missing', 'unavailable', 'failed'].includes(result.status);
    }
    async function preflightTask(task) {
        const paths = pathsForTask(task);
        // Only preflight the active task, with small bounded batches; don't block
        // opening a large template on thousands of unused assets.
        await Promise.all(paths.slice(0, 12).map(path => check(path)));
        for (const path of paths.slice(12)) void check(path);
        return getTaskProblems(task);
    }
    async function preflightProject(project) {
        const root = project?.projectData || project;
        const first = root?.tasks?.[0] || root?.tabs?.find(tab => tab?.tasks?.length)?.tasks[0];
        return first ? preflightTask(first) : [];
    }
    function getTaskProblems(task) {
        return pathsForTask(task).map(path => ({ path, ...get(path) }))
            .filter(item => ['missing', 'unavailable', 'failed'].includes(item.status));
    }
    function invalidate(path) {
        generation++;
        if (path) records.delete(path);
        else records.clear();
    }
    function markFailed(path, reason = 'decode-error') {
        if (typeof path !== 'string' || !path.trim()) return;
        const old = get(path).status;
        records.set(path, { result: { status: 'failed', reason }, expiry: Date.now() + TTL.failed });
        if (old !== 'failed') window.dispatchEvent(new CustomEvent('reels-media-availability-changed', { detail: { path, status: 'failed' } }));
    }
    async function retryTask(task) {
        const paths = pathsForTask(task);
        for (const path of paths) records.delete(path);
        await Promise.all(paths.map(path => check(path, { force: true })));
        return getTaskProblems(task);
    }
    function updateWarning(task) {
        let host = document.getElementById('reels-missing-background-notice');
        const problems = getTaskProblems(task);
        if (!problems.length) { if (host) host.remove(); return; }
        const anchor = document.getElementById('reels-preview-placeholder');
        if (!anchor?.parentNode) return;
        if (!host) {
            host = document.createElement('div');
            host.id = 'reels-missing-background-notice';
            host.style.cssText = 'padding:8px 12px;margin:6px 0;background:#37271b;color:#fff4df;border:1px solid #94623a;border-radius:6px;font-size:12px;z-index:12;position:relative;';
            anchor.parentNode.appendChild(host);
        }
        host.replaceChildren();
        const count = document.createElement('span');
        const missing = problems.filter(p => p.status === 'missing').length;
        count.textContent = `背景素材异常：${missing} 个缺失，${problems.length - missing} 个不可读取。原路径和剪辑设置已保留。 `;
        host.appendChild(count);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重新检查';
        retry.style.marginLeft = '8px';
        retry.onclick = async () => {
            retry.disabled = true;
            await retryTask(task);
            if (window._reelsState?.tasks?.[window._reelsState?.selectedIdx] === task) {
                updateWarning(task);
                window.reelsSelectTask?.(window._reelsState.selectedIdx, { preserveScroll: true });
            }
        };
        host.appendChild(retry);
        const paths = document.createElement('details');
        paths.style.marginTop = '4px';
        const summary = document.createElement('summary');
        summary.textContent = '查看失效路径';
        paths.appendChild(summary);
        for (const problem of problems) {
            const line = document.createElement('div');
            line.style.cssText = 'overflow-wrap:anywhere;margin-top:4px;';
            line.textContent = `[${problem.status}] ${problem.path}`;
            paths.appendChild(line);
        }
        host.appendChild(paths);
    }
    window.ReelsMediaAvailability = {
        get, check, isUsable, preflightTask, preflightProject,
        getTaskProblems, invalidate, markFailed, retryTask, updateWarning
    };
})();
