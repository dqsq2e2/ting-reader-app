export const isApp = typeof (window as { Capacitor?: unknown }).Capacitor !== 'undefined';
export const isElectron = typeof (window as { electronAPI?: unknown }).electronAPI !== 'undefined';
