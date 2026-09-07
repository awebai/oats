import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {updateSplitHandle} from '../renderer/split-resize.mjs';
test('split separator resizes with keyboard and pointer, preserves node on refresh, and supports both orientations',()=>{
 const dom=new JSDOM('<div id="host" class="split-row"><div class="group-cell"></div><div class="group-cell"></div></div>');
 const host=dom.window.document.querySelector('#host'),[a,b]=host.children;
 a.getBoundingClientRect=b.getBoundingClientRect=()=>({width:400,height:200});
 updateSplitHandle(host,a,'row',true);const h=a.querySelector('[role=separator]');h.setPointerCapture=()=>{};
 const key=new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true});h.dispatchEvent(key);
 assert.equal(key.defaultPrevented,true);assert.equal(Number(a.style.flexGrow),1.1);assert.equal(h.getAttribute('aria-valuenow'),'55');
 updateSplitHandle(host,a,'row',true);assert.equal(a.querySelector('[role=separator]'),h);assert.equal(Number(a.style.flexGrow),1.1);
 const pointer=(type,x)=>{const e=new dom.window.Event(type,{cancelable:true});Object.assign(e,{button:0,pointerId:1,clientX:x,clientY:0});h.dispatchEvent(e);};
 pointer('pointerdown',400);pointer('pointermove',600);pointer('pointerup',600);assert.equal(Number(a.style.flexGrow),1.5);
 host.className='split-col';updateSplitHandle(host,a,'col',true);assert.equal(h.getAttribute('aria-orientation'),'horizontal');
 h.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',cancelable:true}));assert.equal(h.getAttribute('aria-valuenow'),'10');
 updateSplitHandle(host,a,'col',false);assert.equal(a.querySelector('[role=separator]'),null);dom.window.close();
});
