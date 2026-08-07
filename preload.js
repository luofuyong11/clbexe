const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('printerAPI', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getDefaultPrinter: () => ipcRenderer.invoke('get-default-printer'),
  getSerialPorts: () => ipcRenderer.invoke('get-serial-ports'),
  testPrinter: (printerName) => ipcRenderer.invoke('test-printer', printerName),
  buildLabelQrCode: (content, size) => ipcRenderer.invoke('build-label-qrcode', content, size),
  printEscpos: (receiptDataUrl, options) => ipcRenderer.invoke('print-escpos', receiptDataUrl, options),
  printTspl: (receiptDataUrl, options) => ipcRenderer.invoke('print-tspl', receiptDataUrl, options),
  printSystem: (htmlContent, options) => ipcRenderer.invoke('print-system', htmlContent, options),
  printPreview: (htmlContent) => ipcRenderer.invoke('print-preview', htmlContent)
})

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})
