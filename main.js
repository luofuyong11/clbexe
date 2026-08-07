// Modules to control application life and create native browser window
const { app, BrowserWindow, BrowserView, Menu, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
let getPixels = null
let QRCode = null
const prepareToCheckUpdates = require('./checkForUpdate')

const PAGE_LOAD_TIMEOUT_MS = 15000
const PAGE_ASSET_TIMEOUT_MS = 15000
const PRINT_TIMEOUT_MS = 30000
const LEGACY_NATIVE_MODULE_DIRS = [
  path.join(__dirname, 'src-tauri', 'target', 'debug'),
  path.join(__dirname, 'src-tauri', 'target', 'release')
]

let printerNative = null

try {
  getPixels = require('get-pixels')
} catch (error) {
  console.warn('get-pixels load failed:', error.message)
}

try {
  QRCode = require('qrcode')
} catch (error) {
  console.warn('qrcode load failed:', error.message)
}

function loadPrinterNativeModule() {
  const profileCandidates = app.isPackaged ? ['release', 'debug'] : ['debug', 'release']
  const runtimeKey = `${process.platform}-${process.arch}`
  const nativeModuleRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'native-modules')
    : path.join(__dirname, 'native-modules')
  const nativeModuleDirs = profileCandidates
    .map(profile => path.join(nativeModuleRoot, runtimeKey, profile))
    .concat(LEGACY_NATIVE_MODULE_DIRS)
  const nativeModuleCandidates = nativeModuleDirs
    .filter(dir => fs.existsSync(dir))
    .flatMap(dir => fs.readdirSync(dir)
      .filter(name => /^printer_native(?:-\d+)?\.node$/.test(name))
      .map(name => path.join(dir, name))
    )
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  const nativeModulePath = nativeModuleCandidates[0]
  if (!nativeModulePath) {
    return null
  }

  return require(nativeModulePath)
}

try {
  printerNative = loadPrinterNativeModule()
  if (printerNative) {
    console.log('printer native module loaded')
  } else {
    console.warn('printer native module not found, only system print is available')
  }
} catch (error) {
  console.warn('printer native module load failed:', error.message)
}

function removeNullish(value) {
  if (Array.isArray(value)) {
    return value.map(removeNullish)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined)
        .map(([key, entryValue]) => [key, removeNullish(entryValue)])
    )
  }

  return value
}

function normalizeNativeOptions(options) {
  const cleaned = removeNullish(options || {})
  const keyMap = {
    printer_name: 'printerName',
    baud_rate: 'baudRate',
    label_width: 'labelWidth',
    label_height: 'labelHeight',
    paper_size: 'paperSize'
  }

  return Object.fromEntries(
    Object.entries(cleaned).map(([key, value]) => [keyMap[key] || key, value])
  )
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)

    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function waitForPageAssets(webContents, timeoutMs = PAGE_ASSET_TIMEOUT_MS) {
  await withTimeout(
    webContents.executeJavaScript(`
      (async () => {
        const timeout = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        if (document.fonts && document.fonts.ready) {
          try {
            await Promise.race([document.fonts.ready, timeout(3000)]);
          } catch (error) {
            void error;
          }
        }

        const waitForImage = async (img) => {
          if (!img) {
            return;
          }

          if (!img.complete) {
            await Promise.race([
              new Promise(resolve => {
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              }),
              timeout(10000),
            ]);
          }

          if (typeof img.decode === 'function') {
            try {
              await Promise.race([img.decode(), timeout(3000)]);
            } catch (error) {
              void error;
            }
          }
        };

        const imageWait = Promise.all(Array.from(document.images || []).map(waitForImage));
        await Promise.race([imageWait, timeout(${PAGE_ASSET_TIMEOUT_MS})]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })();
    `, true),
    timeoutMs + 2000,
    'wait page assets timeout'
  )
}

async function writeTempHtmlFile(htmlContent, prefix = 'print-document') {
  const tempDir = app.getPath('temp')
  const filePath = path.join(tempDir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.html`)
  await fs.promises.writeFile(filePath, htmlContent, 'utf8')
  return filePath
}

async function loadHtmlIntoWindow(windowInstance, htmlContent, prefix) {
  const htmlFilePath = await writeTempHtmlFile(htmlContent, prefix)

  try {
    await withTimeout(
      windowInstance.loadURL(pathToFileURL(htmlFilePath).toString()),
      PAGE_LOAD_TIMEOUT_MS,
      'load print page timeout'
    )
    await waitForPageAssets(windowInstance.webContents)
    return htmlFilePath
  } catch (error) {
    await fs.promises.unlink(htmlFilePath).catch(() => {})
    throw error
  }
}

async function printWebContents(webContents, printOptions, timeoutMs = PRINT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error('print timeout'))
    }, timeoutMs)

    webContents.print(printOptions, (success, failureReason) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      if (success) {
        resolve({ success: true, message: '打印成功' })
      } else {
        reject(new Error(failureReason || '打印失败'))
      }
    })
  })
}

function decodeImageDataUrlPixels(imageDataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof getPixels !== 'function') {
      reject(new Error('get-pixels 模块未加载'))
      return
    }

    getPixels(imageDataUrl, (error, pixels) => {
      if (error) {
        reject(error)
        return
      }

      const shape = Array.isArray(pixels && pixels.shape) ? pixels.shape : []
      if (shape.length < 3) {
        reject(new Error('invalid image pixels'))
        return
      }

      resolve({
        width: Number(shape[0]) || 0,
        height: Number(shape[1]) || 0,
        channels: Number(shape[2]) || 0,
        data: Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength)
      })
    })
  })
}

function buildTsplBitmapOptions(options, pixels) {
  const normalized = normalizeNativeOptions(options)
  const fallbackWidth = Math.max(1, Math.ceil((Number(pixels && pixels.width) || 0) / 8))
  const fallbackHeight = Math.max(1, Math.ceil((Number(pixels && pixels.height) || 0) / 8))

  return removeNullish({
    printerName: normalized.printerName,
    port: normalized.port,
    baudRate: normalized.baudRate,
    speed: normalized.speed,
    density: normalized.density,
    copies: normalized.copies,
    labelWidth: Math.max(1, Number(normalized.labelWidth) || fallbackWidth),
    labelHeight: Math.max(1, Number(normalized.labelHeight) || fallbackHeight)
  })
}

async function printImageDataUrlAsTspl(imageDataUrl, options, jobName) {
  if (!printerNative || typeof printerNative.printTsplPixels !== 'function') {
    return { success: false, message: `${jobName} TSPL 图片打印功能需要原生模块支持` }
  }

  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return { success: false, message: `${jobName}图像数据无效` }
  }

  const pixels = await decodeImageDataUrlPixels(imageDataUrl)
  if (pixels.width <= 0 || pixels.height <= 0 || pixels.channels <= 0) {
    return { success: false, message: `解析${jobName}像素失败` }
  }

  return printerNative.printTsplPixels(
    pixels.width,
    pixels.height,
    pixels.channels,
    pixels.data,
    buildTsplBitmapOptions(options, pixels)
  )
}

async function getPrinters(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return []
  }

  const printers = typeof mainWindow.webContents.getPrintersAsync === 'function'
    ? await mainWindow.webContents.getPrintersAsync()
    : mainWindow.webContents.getPrinters()

  return printers.map(printer => ({
    name: printer.name,
    displayName: printer.displayName,
    description: printer.description,
    status: printer.status,
    isDefault: printer.isDefault,
    printer_type: 'normal'
  }))
}

async function getDefaultPrinter(mainWindow) {
  const printers = await getPrinters(mainWindow)
  return printers.find(printer => printer.isDefault) || null
}

async function handlePrintEscpos(receiptDataUrl, options) {
  try {
    if (!printerNative || typeof printerNative.printEscposPixels !== 'function') {
      return { success: false, message: '热敏图片打印功能需要原生模块支持' }
    }

    if (typeof receiptDataUrl !== 'string' || !receiptDataUrl.startsWith('data:image/')) {
      return { success: false, message: '小票图像数据无效' }
    }

    const pixels = await decodeImageDataUrlPixels(receiptDataUrl)
    if (pixels.width <= 0 || pixels.height <= 0 || pixels.channels <= 0) {
      return { success: false, message: '解析小票像素失败' }
    }

    return printerNative.printEscposPixels(
      pixels.width,
      pixels.height,
      pixels.channels,
      pixels.data,
      normalizeNativeOptions(options)
    )
  } catch (error) {
    return { success: false, message: error.message }
  }
}

async function handlePrintTspl(receiptDataUrl, options) {
  try {
    return await printImageDataUrlAsTspl(receiptDataUrl, options, '标签')
  } catch (error) {
    return { success: false, message: error.message }
  }
}

async function handlePrintSystem(htmlContent, options) {
  let printWindow = null
  let htmlFilePath = null

  try {
    if (typeof htmlContent !== 'string' || !htmlContent.trim()) {
      return { success: false, message: '打印 HTML 内容不能为空' }
    }

    printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: false
      }
    })

    htmlFilePath = await loadHtmlIntoWindow(printWindow, htmlContent, 'print-document')
    const printOptions = {
      ...options,
      silent: true,
      printBackground: true,
      deviceName: options && options.printerName ? options.printerName : '',
      copies: options && options.copies ? options.copies : 1,
      color: !options || options.color !== false,
      landscape: Boolean(options && options.orientation === 'landscape'),
      pageSize: options && options.pageSize ? options.pageSize : 'A4'
    }

    return await printWebContents(printWindow.webContents, printOptions)
  } catch (error) {
    return { success: false, message: error.message }
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.destroy()
    }
    if (htmlFilePath) {
      await fs.promises.unlink(htmlFilePath).catch(() => {})
    }
  }
}

async function handlePrintPreview(htmlContent) {
  let htmlFilePath = null

  try {
    if (typeof htmlContent !== 'string' || !htmlContent.trim()) {
      return { success: false, message: '预览 HTML 内容不能为空' }
    }

    const previewWindow = new BrowserWindow({
      width: 900,
      height: 700,
      title: '打印预览',
      webPreferences: {
        sandbox: false
      }
    })

    htmlFilePath = await writeTempHtmlFile(htmlContent, 'print-preview')
    await previewWindow.loadURL(pathToFileURL(htmlFilePath).toString())
    await waitForPageAssets(previewWindow.webContents, 8000)

    previewWindow.on('closed', () => {
      if (htmlFilePath) {
        fs.promises.unlink(htmlFilePath).catch(() => {})
        htmlFilePath = null
      }
    })

    return { success: true, message: '预览窗口已打开' }
  } catch (error) {
    if (htmlFilePath) {
      await fs.promises.unlink(htmlFilePath).catch(() => {})
    }
    return { success: false, message: error.message }
  }
}

function registerPrinterIpc(mainWindowProvider) {
  ipcMain.handle('get-printers', async () => getPrinters(mainWindowProvider()))
  ipcMain.handle('get-default-printer', async () => getDefaultPrinter(mainWindowProvider()))
  ipcMain.handle('get-serial-ports', async () => {
    if (printerNative && printerNative.getSerialPorts) {
      return printerNative.getSerialPorts()
    }
    return []
  })
  ipcMain.handle('test-printer', async (event, printerName) => {
    void event
    if (printerNative && printerNative.testPrinter) {
      return printerNative.testPrinter(printerName)
    }
    return { success: false, message: '原生模块未加载' }
  })
  ipcMain.handle('build-label-qrcode', async (event, content, size) => {
    void event
    if (!QRCode) {
      throw new Error('qrcode 模块未加载')
    }
    return QRCode.toDataURL(String(content || ''), {
      margin: 0,
      width: Math.max(32, Number(size) || 100),
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    })
  })
  ipcMain.handle('print-escpos', async (event, receiptDataUrl, options) => {
    void event
    return handlePrintEscpos(receiptDataUrl, options)
  })
  ipcMain.handle('print-tspl', async (event, receiptDataUrl, options) => {
    void event
    return handlePrintTspl(receiptDataUrl, options)
  })
  ipcMain.handle('print-system', async (event, htmlContent, options) => {
    void event
    return handlePrintSystem(htmlContent, options)
  })
  ipcMain.handle('print-preview', async (event, htmlContent) => {
    void event
    return handlePrintPreview(htmlContent)
  })
}

let mainAppWindow = null

function createWindow () {
  Menu.setApplicationMenu(null)
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon:path.join(__dirname, '/icon/clb.ico'),
    frame: false
  })
  mainAppWindow = mainWindow

  // and load the index.html of the app.
  mainWindow.loadFile('index.html')

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.setBrowserView(view)  
  // view.setBounds({ x: 0, y: 30 })
  view.setBounds({ x: 0, y: 30, width: 900, height: 570 })
  // view.setAutoResize({ width: true, height: true})
  // view.webContents.loadURL('http://testv63.chonglaoban.com.cn/') 
  
  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
  //禁止多开 点击打开原来应用
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()    
  }
  else {
    app.on('second-instance', () => {
      // 有人试图运行第二个实例，我们应该关注我们的窗口
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()        
      }
    })    
  }

  view.webContents.on('context-menu', ()=>{    
    const template = [
      {label: '复制',role: 'copy'},      
      {label: '粘贴',role: 'paste'}
    ]
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: mainWindow })    
  })
  // 
  var express = require('express');
  const bodyParser = require('body-parser');
  var exp = express();
  exp.use(bodyParser.urlencoded({ extended: false }))
  exp.use(express.json())
  exp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  exp.post('/checkupdate', function(req, res) {   
    // console.log(req.body)  
    // prepareToCheckUpdates("http://v6.chonglaoban.cn/Public/shopappapk/chonglaoban_ele_v10.exe")    
    prepareToCheckUpdates(req.body.appUrl)    
    res.send('success');
  })  

  exp.get('/exitappop', function(req, res) {       
    // app.quit()
    mainWindow.destroy()
    res.send('success');
  }) 

  exp.get('/gohideappop', function(req, res) {       
    mainWindow.minimize()
    res.send('success');
  })
  exp.get('/toogleappop', function(req, res) {       
    if (mainWindow.isMaximized()){
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }

    res.send('success');
  })
  // 
  exp.get('/toogledevtool', function(req, res) {   
    // if(mainWindow.webContents.isDevToolsOpened()){
    //   mainWindow.webContents.closeDevTools()
    // }else{
    //   mainWindow.webContents.openDevTools()
    // }  
    view.webContents.openDevTools()  
    res.send('success');
  }) 

  exp.post('/settheline', function(req, res) {      
    view.webContents.loadURL(req.body.line) 
    res.send('success');
  })

  exp.post('/opdirection', function(req, res) {   
    if(req.body.op==1){
      view.webContents.goBack()
    }else if(req.body.op==2){
      view.webContents.goForward()
    }else{
      view.webContents.reload()
    }  
    res.send('success');
  })

  exp.post('/hideorshowview', function(req, res) {      
    if(req.body.op==1){
      mainWindow.addBrowserView(view)
    }else{
      mainWindow.removeBrowserView(view)
    }
    res.send('success');
  })

  exp.post('/setdevicesize', function(req, res) {      
    view.setBounds({ x: 0, y: 30, width: req.body.width, height: req.body.height })
    res.send('success');
  })

  exp.post('/setscalesize', function(req, res) {      
    view.webContents.setZoomLevel(Number(req.body.op))
    res.send('success');
  })

  exp.get('/printers', async function (req, res) {
    void req
    try {
      res.json(await getPrinters(mainWindow))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.get('/defaultprinter', async function (req, res) {
    void req
    try {
      res.json(await getDefaultPrinter(mainWindow))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.get('/serialports', async function (req, res) {
    void req
    if (printerNative && printerNative.getSerialPorts) {
      res.json(await printerNative.getSerialPorts())
      return
    }
    res.json([])
  })

  exp.post('/testprinter', async function (req, res) {
    try {
      if (printerNative && printerNative.testPrinter) {
        res.json(await printerNative.testPrinter(req.body && req.body.printerName))
        return
      }
      res.json({ success: false, message: '原生模块未加载' })
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.post('/buildlabelqrcode', async function (req, res) {
    try {
      if (!QRCode) {
        res.json({ success: false, message: 'qrcode 模块未加载' })
        return
      }
      const dataUrl = await QRCode.toDataURL(String(req.body && req.body.content || ''), {
        margin: 0,
        width: Math.max(32, Number(req.body && req.body.size) || 100),
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
      res.json({ success: true, dataUrl })
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.post('/printescpos', async function (req, res) {
    try {
      res.json(await handlePrintEscpos(req.body && req.body.receiptDataUrl, req.body && req.body.options))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.post('/printtspl', async function (req, res) {
    try {
      res.json(await handlePrintTspl(req.body && req.body.receiptDataUrl, req.body && req.body.options))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.post('/printsystem', async function (req, res) {
    try {
      res.json(await handlePrintSystem(req.body && req.body.htmlContent, req.body && req.body.options))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })

  exp.post('/printpreview', async function (req, res) {
    try {
      res.json(await handlePrintPreview(req.body && req.body.htmlContent))
    } catch (error) {
      res.status(500).json({ success: false, message: error.message })
    }
  })
  
 
  if (BrowserWindow.getAllWindows().length >=1){
    var server = exp.listen(1998, function () {  
      //  var host = server.address().address
      //  var port = server.address().port  
       console.log("serve-is-running")
      
     }) 
  }
  
  
  
}

registerPrinterIpc(() => mainAppWindow)

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()
  
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})



// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
