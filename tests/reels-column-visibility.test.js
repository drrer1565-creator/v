'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/reels-batch-table.js'), 'utf8');
const code = source.slice(source.indexOf('function _getColVisStorageKey() {'), source.indexOf('/** 点击 AI 按钮'));
function session(entries = new Map(), tab = 'new-template') {
    const ctx = {
        _RBT_COLUMNS: [{key:'bg',default:true},{key:'cvtrim',default:true},{key:'srt',default:true}],
        _batchTableState: {activeTabId:tab}, console,
        localStorage: {getItem:k=>entries.get(k) ?? null,setItem:(k,v)=>entries.set(k,v),
            key:i=>[...entries.keys()][i],get length(){return entries.size;}}
    };
    vm.createContext(ctx); vm.runInContext(code, ctx);
    return {ctx, entries, get:()=>JSON.parse(JSON.stringify(ctx._getColVisibility())), save:v=>ctx._saveColVisibility(v)};
}
test('manual visibility survives regenerated tabs and a fresh application session',()=>{
    const a=session(); a.save({bg:true,cvtrim:false,srt:false});
    a.ctx._batchTableState.activeTabId='another-template';
    assert.equal(a.get().cvtrim,false);
    assert.deepEqual(session(a.entries,'restart-tab').get(),{bg:true,cvtrim:false,srt:false});
});
test('legacy current tab is migrated without a reset-version marker or data deletion',()=>{
    const entries=new Map([['rbt-col-vis-old',JSON.stringify({cvtrim:false})]]);
    const a=session(entries,'old'); assert.equal(a.get().cvtrim,false);
    assert.ok(entries.has('rbt-col-vis-old'));
    assert.equal(session(entries,'new').get().cvtrim,false);
});
test('new template recovers a customized legacy layout instead of default all-visible',()=>{
    const a=session(new Map([['rbt-col-vis-default','{"cvtrim":true}'],['rbt-col-vis-old','{"cvtrim":false}'],['rbt-col-vis-old-reset-version','v5-column-unification']]));
    assert.equal(a.get().cvtrim,false);
});
test('global preference wins over other templates and explicit reset persists',()=>{
    const a=session(new Map([['rbt-col-vis-old','{"cvtrim":false}']]),'old');
    a.get(); a.save({bg:true,cvtrim:true,srt:true});
    assert.equal(session(a.entries,'old').get().cvtrim,true);
});
test('invalid stored values are ignored and newly introduced columns use defaults',()=>{
    const a=session(new Map([['rbt-col-vis-bad','null'],['rbt-col-vis-array','[]'],['rbt-col-vis-old','{"cvtrim":false,"srt":"false"}']]));
    assert.deepEqual(a.get(),{bg:true,cvtrim:false,srt:true});
});
test('fresh defaults do not lock out later legacy restoration',()=>{
    const a=session(); assert.equal(a.get().cvtrim,true); assert.equal(a.entries.size,0);
    a.entries.set('rbt-col-vis-old','{"cvtrim":false}'); assert.equal(a.get().cvtrim,false);
});
