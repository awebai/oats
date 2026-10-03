// A fake Electron BrowserWindow for tests that run main's shipped window code in a vm (#481, #518).
// `FakeWindow.all` lists every window created since the last `reset()`; `FakeWindow.onClose(quitting)`
// runs as a window closes, before its `close` event (a test sets main's quitStarted there).
import { EventEmitter } from 'node:events';

export function fakeWindowClass(renderer) {
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.title = options.title; this.destroyed = false; this.minimized = false; this.calls = [];
      this.bounds = { x: options.x ?? 100, y: options.y ?? 100, width: options.width, height: options.height };
      this.webContents = Object.assign(new EventEmitter(), { id: FakeWindow.next++, setWindowOpenHandler() {} });
      this.webContents.mainFrame = { url: renderer };
      FakeWindow.all.push(this);
    }
    setTitle(title) { this.title = title; }
    isDestroyed() { return this.destroyed; } isMinimized() { return this.minimized; }
    restore() { this.calls.push('restore'); } show() { this.calls.push('show'); } focus() { this.calls.push('focus'); }
    maximize() { this.calls.push('maximize'); } setFullScreen(on) { this.calls.push(`fullscreen:${on}`); }
    getNormalBounds() { return this.bounds; } isMaximized() { return false; } isFullScreen() { return false; }
    async loadFile(_file, options) { this.loaded = options; if (options.hash) this.webContents.mainFrame.url = `${renderer}#${options.hash}`; }
    close({ quitting = false } = {}) { FakeWindow.onClose(quitting); this.emit('close'); this.destroyed = true; this.emit('closed'); }
    static reset() { FakeWindow.all = []; }
  }
  FakeWindow.next = 1; FakeWindow.all = []; FakeWindow.onClose = () => {};
  return FakeWindow;
}
