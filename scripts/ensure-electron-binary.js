const { existsSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const projectRoot = join(__dirname, '..')
const electronPackageDir = join(projectRoot, 'node_modules', 'electron')
const electronInstallScript = join(electronPackageDir, 'install.js')
const electronBinaryPath = process.platform === 'win32'
  ? join(electronPackageDir, 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? join(electronPackageDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : join(electronPackageDir, 'dist', 'electron')

if (existsSync(electronBinaryPath)) {
  process.exit(0)
}

if (!existsSync(electronInstallScript)) {
  console.error('未找到 electron/install.js，请先安装依赖。')
  process.exit(1)
}

const result = spawnSync(process.execPath, [electronInstallScript], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  },
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(typeof result.status === 'number' ? result.status : 1)
