import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** The entire API the renderer can reach. Each verb maps to one validated handler in main.ts. */
const invoke = (channel: string, arg?: unknown) => ipcRenderer.invoke(channel, arg);
const on = (channel: string, cb: (payload: unknown) => void) => {
  const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload); // the IPC event never reaches the page
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld('cult', {
  platform: process.platform, // window controls and privacy-settings copy differ per OS
  login: (b: unknown) => invoke('auth:login', b),
  session: () => invoke('auth:session'),
  logout: () => invoke('auth:logout'),
  api: (method: string, path: string, body?: unknown) => invoke('api:request', { method, path, body }),
  startBroadcast: (streamId: string) => invoke('broadcast:start', { streamId }),
  whipOffer: (streamId: string, sdp: string) => invoke('whip:offer', { streamId, sdp }),
  whipStop: (streamId: string) => invoke('whip:stop', { streamId }),
  rtSend: (msg: unknown) => invoke('rt:send', msg),
  onRealtime: (cb: (msg: unknown) => void) => on('rt:event', cb),
  onRealtimeState: (cb: (state: unknown) => void) => on('rt:state', cb),
  captureSources: (kind: string) => invoke('capture:sources', { kind }),
  chooseCapture: (sourceId: string, audio: boolean) => invoke('capture:choose', { sourceId, audio }),
  chooseDesktopAudio: () => invoke('capture:desktop-audio'),
  metrics: () => invoke('app:metrics'),
  displays: () => invoke('screen:displays'),
  setLive: (live: boolean) => invoke('app:set-live', { live }),
  getSettings: () => invoke('settings:get'),
  saveSettings: (s: unknown) => invoke('settings:set', s),
  openStudio: (path: string) => invoke('shell:open-studio', { path }),
  copy: (text: string) => invoke('clipboard:write', { text }),
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggle-maximize'),
    close: () => invoke('win:close'),
    onMaximized: (cb: (max: unknown) => void) => on('win:maximized', cb),
  },
});
