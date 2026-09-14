/**
 * ClassTrack — Electron preload script
 * Exposes a safe, sandboxed bridge from the renderer to the main process.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("classtrack", {
  // Fire a native OS notification via the main process
  notify: (title, body, tag) => {
    ipcRenderer.send("ct-notify", { title, body, tag: tag || `ct-${Date.now()}` });
  },

  // True when running inside Electron (renderer can branch on this)
  isElectron: () => true,

  // Open a URL in the system default browser (not an Electron window)
  openExternal: (url) => ipcRenderer.send("ct-open-external", url),
});
