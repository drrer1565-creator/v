/**
 * templates.js — 封存模板库 & 实时工程项目库 CRUD 服务
 *
 * 两个独立存储区共用同一原子读写、备份恢复与多级文件夹引擎：
 *   1. templateStore    -> userData/videokit-templates/       (📂 模板库：封存快照，不会因工作区编辑自动覆写)
 *   2. liveProjectStore -> userData/videokit-live-projects/   (🗂️ 工程项目：实时读写、新建文件夹与新建空白标签)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const sharedProfile = require('./sharedProfile');

function _safeId(id, label = '项目') {
    const clean = path.basename(String(id || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!clean || clean === '.' || clean === '..') {
        throw new Error(`无效的${label} ID`);
    }
    return clean;
}

function _atomicWriteTextSync(targetFile, text) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    const tmp = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, targetFile);
}

function _collectDescendantFolderIds(folders, rootId) {
    const result = new Set();
    const queue = [rootId];
    while (queue.length) {
        const cur = queue.shift();
        for (const f of folders) {
            if ((f.parentId || '') === cur && !result.has(f.id)) {
                result.add(f.id);
                queue.push(f.id);
            }
        }
    }
    return result;
}

function _normalizeFoldersData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    if (!Array.isArray(data.folders) || !data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) {
        throw new Error('文件夹数据无效');
    }
    const folderIds = new Set(data.folders.map(f => f && f.id).filter(Boolean));
    data.folders = data.folders.map(f => {
        const pid = String(f.parentId || '');
        const cleanParent = (pid && pid !== f.id && folderIds.has(pid)) ? pid : '';
        return { ...f, parentId: cleanParent };
    });
    if (!data.folderOrders || typeof data.folderOrders !== 'object' || Array.isArray(data.folderOrders)) {
        data.folderOrders = {};
    }
    if (Array.isArray(data.libraryOrder) && !Array.isArray(data.folderOrders[''])) {
        data.folderOrders[''] = [...data.libraryOrder];
    }
    return data;
}

function createLibraryStore({ dirName, idPrefix = 'tpl_', entityLabel = '模板', getCandidateDirs }) {
    const safeItemId = (id) => _safeId(id, entityLabel);
    const metadataCache = new Map();
    const itemFileRegex = new RegExp(`^${idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-zA-Z0-9._-]+\\.json$`);

    function getDir() {
        const dir = path.join(app.getPath('userData'), dirName);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    function getAllDirs() {
        const dirs = typeof getCandidateDirs === 'function' ? getCandidateDirs() : [];
        return (Array.isArray(dirs) && dirs.length) ? dirs : [getDir()];
    }

    function getIndexPath() {
        return path.join(getDir(), 'index.json');
    }

    function readIndex() {
        const byId = new Map();
        for (const dir of [...getAllDirs()].reverse()) {
            const p = path.join(dir, 'index.json');
            try {
                let arr;
                try {
                    arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    if (!Array.isArray(arr)) throw new Error('Invalid index');
                } catch (_) {
                    arr = [];
                    if (fs.existsSync(dir)) {
                        for (const filename of fs.readdirSync(dir)) {
                            if (!itemFileRegex.test(filename) && !/^tpl_[a-zA-Z0-9._-]+\.json$/.test(filename)) continue;
                            try {
                                const data = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
                                if (!data.id || `${safeItemId(data.id)}.json` !== filename || !data.projectData) continue;
                                arr.push({
                                    id: data.id,
                                    name: data.name || '',
                                    description: data.description || '',
                                    thumbnail: data.thumbnail || '',
                                    tags: data.tags || [],
                                    createdAt: data.createdAt,
                                    updatedAt: data.updatedAt,
                                    taskCount: data.projectData.tasks?.length || 0,
                                });
                            } catch (_) { /* Damaged files must not hide healthy items. */ }
                        }
                        if (arr.length) {
                            try {
                                if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.before-recovery-${Date.now()}`);
                                _atomicWriteTextSync(p, JSON.stringify(arr, null, 2));
                            } catch (_) { }
                        }
                    }
                }
                for (const item of arr) {
                    if (!item || !item.id) continue;
                    const existing = byId.get(item.id);
                    const oldTime = existing ? (Date.parse(existing.updatedAt || existing.createdAt || '') || 0) : -1;
                    const newTime = Date.parse(item.updatedAt || item.createdAt || '') || 0;
                    if (!existing || newTime >= oldTime) {
                        byId.set(item.id, item);
                    }
                }
            } catch { }
        }
        const items = [...byId.values()].sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0));
        try {
            const order = JSON.parse(fs.readFileSync(path.join(getDir(), 'order.json'), 'utf8'));
            if (Array.isArray(order)) {
                const ranks = new Map(order.map((id, i) => [id, i]));
                items.sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
            }
        } catch (_) { }
        return items;
    }

    function writeIndex(index) {
        const body = JSON.stringify(index, null, 2);
        _atomicWriteTextSync(getIndexPath(), body);
        if (!sharedProfile.isIsolatedTestProfile()) {
            for (const dir of getAllDirs()) {
                const p = path.join(dir, 'index.json');
                if (path.resolve(p) === path.resolve(getIndexPath())) continue;
                try {
                    _atomicWriteTextSync(p, body);
                } catch { }
            }
        }
    }

    function backupItem(id) {
        const file = path.join(getDir(), `${safeItemId(id)}.json`);
        if (!fs.existsSync(file)) return;
        const backups = path.join(getDir(), 'backups', safeItemId(id));
        fs.mkdirSync(backups, { recursive: true });
        fs.copyFileSync(file, path.join(backups, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`));
    }

    function readFolders() {
        const file = path.join(getDir(), 'folders.json');
        if (!fs.existsSync(file)) return { folders: [], assignments: {}, folderOrders: {} };
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return _normalizeFoldersData(data);
    }

    function writeFolders(data) {
        const file = path.join(getDir(), 'folders.json');
        if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
        _atomicWriteTextSync(file, JSON.stringify(data, null, 2));
        if (!sharedProfile.isIsolatedTestProfile()) {
            const body = JSON.stringify(data, null, 2);
            for (const dir of getAllDirs()) {
                const mirror = path.join(dir, 'folders.json');
                if (path.resolve(mirror) === path.resolve(file)) continue;
                try { _atomicWriteTextSync(mirror, body); } catch { }
            }
        }
    }

    function listItems() {
        return readIndex().map(item => {
            for (const dir of getAllDirs()) {
                const file = path.join(dir, `${safeItemId(item.id)}.json`);
                if (!fs.existsSync(file)) continue;
                try {
                    const stat = fs.statSync(file);
                    const key = `${file}:${stat.size}:${stat.mtimeMs}`;
                    let metadata = metadataCache.get(item.id);
                    if (!metadata || metadata.key !== key) {
                        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                        const tasks = data.projectData?.tasks || [];
                        const types = new Set();
                        for (const task of tasks) {
                            for (const overlay of task.overlays || []) {
                                if (overlay.type === 'scroll') types.add('滚动字幕');
                                if (overlay.type === 'textcard') types.add('文字卡片');
                            }
                            if (task.segments?.length) types.add('普通字幕');
                        }
                        metadata = {
                            key,
                            templateType: tasks.length === 0 ? '空白标签' : ([...types].sort().join(' / ') || '视频'),
                            sizeBytes: stat.size,
                        };
                        metadataCache.set(item.id, metadata);
                    }
                    return { ...item, templateType: metadata.templateType, sizeBytes: metadata.sizeBytes };
                } catch (_) { }
            }
            return { ...item, templateType: '未知', sizeBytes: 0 };
        });
    }

    function getItem(id) {
        const safeId = safeItemId(id);
        for (const dir of getAllDirs()) {
            const filePath = path.join(dir, `${safeId}.json`);
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        }
        throw new Error(`${entityLabel}不存在: ${safeId}`);
    }

    function getItemsByIds(ids) {
        if (!Array.isArray(ids) || !ids.length) return [];
        const results = [];
        for (const rawId of ids) {
            if (!rawId) continue;
            try { results.push(getItem(rawId)); } catch (_) { }
        }
        return results;
    }

    function saveItem({ id, name, description, thumbnail, tags, projectData, folderId }) {
        if (folderId !== undefined && folderId !== '' && !readFolders().folders.some(folder => folder.id === folderId)) {
            throw new Error('保存目标文件夹不存在，请重新选择文件夹');
        }
        const now = new Date().toISOString();
        const itemId = id ? safeItemId(id) : `${idPrefix}${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

        if (id) backupItem(itemId);
        const fullData = {
            id: itemId,
            name,
            description: description || '',
            thumbnail: thumbnail || '',
            tags: tags || [],
            createdAt: now,
            updatedAt: now,
            projectData,
        };

        const filePath = path.join(getDir(), `${itemId}.json`);
        if (id) {
            for (const dir of getAllDirs()) {
                const candidate = path.join(dir, `${itemId}.json`);
                if (fs.existsSync(candidate)) {
                    try {
                        const existing = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
                        fullData.createdAt = existing.createdAt || now;
                        break;
                    } catch { }
                }
            }
        }

        const fullBody = JSON.stringify(fullData, null, 2);
        _atomicWriteTextSync(filePath, fullBody);
        if (!sharedProfile.isIsolatedTestProfile()) {
            for (const dir of getAllDirs()) {
                const mirrorPath = path.join(dir, `${itemId}.json`);
                if (path.resolve(mirrorPath) === path.resolve(filePath)) continue;
                try { _atomicWriteTextSync(mirrorPath, fullBody); } catch { }
            }
        }

        const index = readIndex();
        const existingIdx = index.findIndex(t => t.id === itemId);
        const indexEntry = {
            id: itemId,
            name,
            description: description || '',
            thumbnail: thumbnail || '',
            tags: tags || [],
            createdAt: fullData.createdAt,
            updatedAt: now,
            taskCount: projectData?.tasks?.length || 0,
        };
        if (existingIdx >= 0) index[existingIdx] = indexEntry;
        else index.unshift(indexEntry);
        writeIndex(index);
        if (folderId !== undefined) moveItemsToFolder([itemId], folderId || '');
        return { id: itemId, success: true };
    }

    function deleteItem(id) {
        const safeId = safeItemId(id);
        for (const dir of getAllDirs()) {
            const filePath = path.join(dir, `${safeId}.json`);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch { }
            }
        }
        const index = readIndex().filter(t => t.id !== safeId);
        writeIndex(index);
        try {
            const folders = readFolders();
            if (folders.assignments[safeId]) {
                delete folders.assignments[safeId];
                writeFolders(folders);
            }
        } catch (_) { }
        return { success: true };
    }

    function renameItem(id, newName) {
        const safeId = safeItemId(id);
        let targetPath = '';
        for (const dir of getAllDirs()) {
            const candidate = path.join(dir, `${safeId}.json`);
            if (fs.existsSync(candidate)) {
                targetPath = candidate;
                break;
            }
        }
        if (!targetPath) {
            throw new Error(`${entityLabel}不存在: ${safeId}`);
        }
        const data = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        data.name = newName;
        data.updatedAt = new Date().toISOString();
        const body = JSON.stringify(data, null, 2);
        _atomicWriteTextSync(path.join(getDir(), `${safeId}.json`), body);
        if (!sharedProfile.isIsolatedTestProfile()) {
            for (const dir of getAllDirs()) {
                const mirrorPath = path.join(dir, `${safeId}.json`);
                try {
                    if (fs.existsSync(mirrorPath)) _atomicWriteTextSync(mirrorPath, body);
                } catch { }
            }
        }
        const index = readIndex();
        const entry = index.find(t => t.id === safeId);
        if (entry) {
            entry.name = newName;
            entry.updatedAt = data.updatedAt;
        }
        writeIndex(index);
        return { success: true };
    }

    function reorderItems(ids) {
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
            throw new Error(`无效的${entityLabel}顺序`);
        }
        const existing = readIndex().map(item => item.id);
        if (ids.length !== existing.length || ids.some(id => !existing.includes(id))) {
            throw new Error(`${entityLabel}列表已变化，请刷新后重试`);
        }
        _atomicWriteTextSync(path.join(getDir(), 'order.json'), JSON.stringify(ids));
        return { success: true };
    }

    function updateThumbnail(id, thumbnail) {
        if (typeof thumbnail !== 'string') throw new Error('无效的封面');
        const item = getItem(id);
        backupItem(id);
        item.thumbnail = thumbnail;
        _atomicWriteTextSync(path.join(getDir(), `${safeItemId(id)}.json`), JSON.stringify(item, null, 2));
        const index = readIndex();
        const entry = index.find(t => t.id === id);
        if (entry) entry.thumbnail = thumbnail;
        writeIndex(index);
        return { success: true };
    }

    function createFolder(name, parentId = '') {
        name = String(name || '').trim();
        if (!name || name.length > 200) throw new Error('请输入有效的文件夹名称（最多200字）');
        const data = readFolders();
        const cleanParentId = String(parentId || '').trim();
        if (cleanParentId && !data.folders.some(f => f.id === cleanParentId)) {
            throw new Error('上级文件夹不存在');
        }
        if (data.folders.some(f => (f.parentId || '') === cleanParentId && f.name === name)) {
            throw new Error('当前目录已有同名文件夹');
        }
        const now = new Date().toISOString();
        const folder = { id: 'folder_' + crypto.randomUUID(), name, parentId: cleanParentId, createdAt: now, updatedAt: now };
        data.folders.push(folder);
        writeFolders(data);
        return { success: true, folder };
    }

    function renameFolder(id, name) {
        name = String(name || '').trim();
        if (!name || name.length > 200) throw new Error('请输入有效的文件夹名称（最多200字）');
        const data = readFolders();
        const folder = data.folders.find(f => f.id === id);
        if (!folder) throw new Error('文件夹不存在');
        const pid = folder.parentId || '';
        if (data.folders.some(f => f.id !== id && (f.parentId || '') === pid && f.name === name)) {
            throw new Error('当前目录已有同名文件夹');
        }
        folder.name = name;
        folder.updatedAt = new Date().toISOString();
        writeFolders(data);
        return { success: true };
    }

    function moveItemsToFolder(ids, folderId) {
        if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) {
            throw new Error(`请选择${entityLabel}`);
        }
        const data = readFolders();
        folderId = folderId || '';
        if (folderId && !data.folders.some(f => f.id === folderId)) throw new Error('文件夹不存在');
        const available = new Set(readIndex().map(t => t.id));
        if (ids.some(id => !available.has(id))) throw new Error(`${entityLabel}不存在`);
        const affected = new Set([folderId]);
        for (const id of ids) {
            affected.add(data.assignments[id] || '');
            if (folderId) data.assignments[id] = folderId;
            else delete data.assignments[id];
        }
        for (const f of data.folders) if (affected.has(f.id)) f.updatedAt = new Date().toISOString();
        writeFolders(data);
        return { success: true };
    }

    function moveFolders(folderIds, targetParentId = '') {
        if (!Array.isArray(folderIds) || !folderIds.length || folderIds.some(id => typeof id !== 'string')) {
            throw new Error('请选择要移动的文件夹');
        }
        const data = readFolders();
        const cleanTarget = String(targetParentId || '').trim();
        if (cleanTarget && !data.folders.some(f => f.id === cleanTarget)) {
            throw new Error('目标文件夹不存在');
        }
        const movingSet = new Set(folderIds);
        for (const fid of movingSet) {
            const folder = data.folders.find(f => f.id === fid);
            if (!folder) throw new Error('文件夹不存在');
            if (cleanTarget === fid) throw new Error('不能把文件夹移入自己');
            const descendants = _collectDescendantFolderIds(data.folders, fid);
            if (cleanTarget && descendants.has(cleanTarget)) {
                throw new Error('不能把文件夹移入自己的子文件夹');
            }
            const collision = data.folders.find(f =>
                !movingSet.has(f.id) &&
                (f.parentId || '') === cleanTarget &&
                f.name === folder.name
            );
            if (collision) throw new Error(`目标文件夹内已存在同名子文件夹「${folder.name}」`);
        }
        const now = new Date().toISOString();
        const touched = new Set([cleanTarget]);
        for (const f of data.folders) {
            if (movingSet.has(f.id)) {
                touched.add(f.parentId || '');
                f.parentId = cleanTarget;
                f.updatedAt = now;
            }
        }
        for (const f of data.folders) if (touched.has(f.id)) f.updatedAt = now;
        writeFolders(data);
        return { success: true };
    }

    function deleteEmptyFolder(id) {
        const data = readFolders();
        if (!data.folders.some(f => f.id === id)) throw new Error('文件夹不存在');
        if (data.folders.some(f => (f.parentId || '') === id)) throw new Error('请先移出或删除子文件夹');
        const available = new Set(readIndex().map(t => t.id));
        if (Object.entries(data.assignments).some(([key, value]) => value === id && available.has(key))) {
            throw new Error(`请先移出文件夹内的${entityLabel}`);
        }
        data.folders = data.folders.filter(f => f.id !== id);
        for (const key of Object.keys(data.assignments)) if (data.assignments[key] === id) delete data.assignments[key];
        if (data.folderOrders) delete data.folderOrders[id];
        writeFolders(data);
        return { success: true };
    }

    function reorderLibrary(order, parentId = '') {
        if (!Array.isArray(order) || order.some(id => typeof id !== 'string') || new Set(order).size !== order.length) {
            throw new Error('无效的排列顺序');
        }
        const cleanParentId = String(parentId || '').trim();
        const data = readFolders();
        const childFolders = data.folders.filter(f => (f.parentId || '') === cleanParentId);
        const directItems = readIndex().filter(t => (data.assignments[t.id] || '') === cleanParentId);
        const expected = [...childFolders.map(f => 'f:' + f.id), ...directItems.map(t => 't:' + t.id)];
        const valid = new Set(expected);
        if (order.length !== expected.length || order.some(id => !valid.has(id))) {
            throw new Error(`${entityLabel}库当前目录已变化，请刷新后重试`);
        }
        if (!data.folderOrders || typeof data.folderOrders !== 'object') data.folderOrders = {};
        data.folderOrders[cleanParentId] = order;
        if (!cleanParentId) data.libraryOrder = order;
        writeFolders(data);
        return { success: true };
    }

    return {
        getDir,
        list: listItems,
        get: getItem,
        getByIds: getItemsByIds,
        save: saveItem,
        delete: deleteItem,
        rename: renameItem,
        reorder: reorderItems,
        updateThumbnail,
        readFolders,
        createFolder,
        renameFolder,
        moveItemsToFolder,
        moveFolders,
        deleteEmptyFolder,
        reorderLibrary,
    };
}

const templateStore = createLibraryStore({
    dirName: 'videokit-templates',
    idPrefix: 'tpl_',
    entityLabel: '模板',
    getCandidateDirs: () => sharedProfile.getCandidateTemplateDirs(),
});

const liveProjectStore = createLibraryStore({
    dirName: 'videokit-live-projects',
    idPrefix: 'prj_',
    entityLabel: '工程',
    getCandidateDirs: () => {
        if (typeof sharedProfile.getCandidateLiveProjectDirs === 'function') {
            const dirs = sharedProfile.getCandidateLiveProjectDirs();
            if (Array.isArray(dirs) && dirs.length) return dirs;
        }
        return [path.join(app.getPath('userData'), 'videokit-live-projects')];
    },
});

/**
 * Copy templates/folders from sealed templateStore into liveProjectStore without modifying sealed templates.
 */
function importTemplatesIntoLiveProjects({ templateIds = [], targetFolderId = '', copyAllFolders = false } = {}) {
    const cleanTarget = String(targetFolderId || '').trim();
    const tplFoldersData = templateStore.readFolders();
    const allTemplates = templateStore.list();
    const liveFoldersData = liveProjectStore.readFolders();
    if (cleanTarget && !liveFoldersData.folders.some(f => f.id === cleanTarget)) {
        throw new Error('目标工程文件夹不存在');
    }

    const sourceIds = Array.isArray(templateIds) && templateIds.length
        ? templateIds.map(v => String(v || '').trim()).filter(Boolean)
        : allTemplates.map(t => t.id);

    const ensureLiveFolder = (parentId, name) => {
        const curFolders = liveProjectStore.readFolders().folders;
        const hit = curFolders.find(f => (f.parentId || '') === (parentId || '') && f.name === name);
        if (hit) return hit.id;
        const created = liveProjectStore.createFolder(name, parentId || '');
        return created.folder.id;
    };

    const folderMap = new Map([['', cleanTarget]]);
    const folderById = new Map((tplFoldersData.folders || []).map(f => [f.id, f]));
    const ensureSourceFolderChain = (srcFolderId) => {
        const cleanSrc = String(srcFolderId || '').trim();
        if (!cleanSrc) return cleanTarget;
        if (folderMap.has(cleanSrc)) return folderMap.get(cleanSrc);
        const chain = [];
        const seen = new Set();
        let cur = cleanSrc;
        while (cur && folderById.has(cur) && !seen.has(cur)) {
            seen.add(cur);
            chain.unshift(folderById.get(cur));
            cur = String(folderById.get(cur).parentId || '').trim();
        }
        let parentLiveId = cleanTarget;
        for (const f of chain) {
            if (!folderMap.has(f.id)) {
                parentLiveId = ensureLiveFolder(parentLiveId, f.name);
                folderMap.set(f.id, parentLiveId);
            } else {
                parentLiveId = folderMap.get(f.id);
            }
        }
        return folderMap.get(cleanSrc) || cleanTarget;
    };

    if (copyAllFolders) {
        for (const f of tplFoldersData.folders || []) {
            ensureSourceFolderChain(f.id);
        }
    }

    const existingLiveByFolder = new Map();
    const existingLiveList = liveProjectStore.list();
    const existingAssign = liveProjectStore.readFolders().assignments || {};
    for (const item of existingLiveList) {
        const fId = existingAssign[item.id] || '';
        if (!existingLiveByFolder.has(fId)) existingLiveByFolder.set(fId, new Set());
        existingLiveByFolder.get(fId).add(item.name);
    }

    const imported = [];
    for (const srcId of sourceIds) {
        let full;
        try { full = templateStore.get(srcId); } catch (_) { continue; }
        const srcFolder = tplFoldersData.assignments?.[srcId] || '';
        const destFolderId = copyAllFolders || !Array.isArray(templateIds) || !templateIds.length
            ? ensureSourceFolderChain(srcFolder)
            : cleanTarget;

        if (!existingLiveByFolder.has(destFolderId)) existingLiveByFolder.set(destFolderId, new Set());
        const usedNames = existingLiveByFolder.get(destFolderId);
        const baseName = String(full.name || '导入工程').trim() || '导入工程';
        let finalName = baseName;
        let idx = 2;
        while (usedNames.has(finalName)) {
            finalName = `${baseName} (${idx++})`;
        }
        usedNames.add(finalName);

        const res = liveProjectStore.save({
            name: finalName,
            description: full.description || '',
            thumbnail: full.thumbnail || '',
            tags: Array.isArray(full.tags) ? [...full.tags] : [],
            projectData: JSON.parse(JSON.stringify(full.projectData || { version: '2.0.0', tasks: [] })),
            folderId: destFolderId,
        });
        imported.push({ id: res.id, name: finalName, folderId: destFolderId, sourceTemplateId: srcId });
    }

    return {
        success: true,
        importedCount: imported.length,
        folderCount: Math.max(0, folderMap.size - 1),
        items: imported,
    };
}

module.exports = {
    createLibraryStore,
    templateStore,
    liveProjectStore,
    importTemplatesIntoLiveProjects,
    // Sealed Template Library (📂 模板库)
    listTemplates: templateStore.list,
    getTemplate: templateStore.get,
    getTemplatesByIds: templateStore.getByIds,
    saveTemplate: templateStore.save,
    deleteTemplate: templateStore.delete,
    renameTemplate: templateStore.rename,
    reorderTemplates: templateStore.reorder,
    updateTemplateThumbnail: templateStore.updateThumbnail,
    readTemplateFolders: templateStore.readFolders,
    createTemplateFolder: templateStore.createFolder,
    renameTemplateFolder: templateStore.renameFolder,
    moveTemplatesToFolder: templateStore.moveItemsToFolder,
    moveTemplateFolders: templateStore.moveFolders,
    deleteEmptyTemplateFolder: templateStore.deleteEmptyFolder,
    reorderTemplateLibrary: templateStore.reorderLibrary,
    // Live Project Library (🗂️ 工程项目)
    listLiveProjects: liveProjectStore.list,
    getLiveProject: liveProjectStore.get,
    getLiveProjectsByIds: liveProjectStore.getByIds,
    saveLiveProject: liveProjectStore.save,
    deleteLiveProject: liveProjectStore.delete,
    renameLiveProject: liveProjectStore.rename,
    reorderLiveProjects: liveProjectStore.reorder,
    updateLiveProjectThumbnail: liveProjectStore.updateThumbnail,
    readLiveProjectFolders: liveProjectStore.readFolders,
    createLiveProjectFolder: liveProjectStore.createFolder,
    renameLiveProjectFolder: liveProjectStore.renameFolder,
    moveLiveProjectsToFolder: liveProjectStore.moveItemsToFolder,
    moveLiveProjectFolders: liveProjectStore.moveFolders,
    deleteEmptyLiveProjectFolder: liveProjectStore.deleteEmptyFolder,
    reorderLiveProjectLibrary: liveProjectStore.reorderLibrary,
};
