const { existsSync } = require('fs')
const os = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { ensureMacSdkEnvironment } = require('./macos-build-env')

const projectRoot = join(__dirname, '..')
const forgeCliPath = join(projectRoot, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js')
const forgeArgs = process.argv.slice(2)
const electronMirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
const forgeCommand = forgeArgs[0] || ''

function resolveTargetPlatform() {
  const platformArg = forgeArgs.find(arg => arg.indexOf('--platform=') === 0)
  if (platformArg) {
    return platformArg.slice('--platform='.length)
  }

  return process.platform
}

function resolveForgeEnv() {
  let env = {
    ...process.env,
    ELECTRON_MIRROR: electronMirror,
  }

  const targetPlatform = resolveTargetPlatform()
  if (targetPlatform !== 'darwin' || !['package', 'make'].includes(forgeCommand)) {
    return env
  }

  const operation = forgeCommand === 'make' ? 'macOS 制品构建' : 'macOS 打包'
  return ensureMacSdkEnvironment(env, {
    requireMacHost: true,
    operation,
  })
}

function resolvePreferredNodePath() {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  const desktopRelativeNodePath = resolve(__dirname, '..', '..', '..', 'Desktop', 'HBuilderX', 'plugins', 'node', executableName)
  const homeNodePath = join(os.homedir(), 'Desktop', 'HBuilderX', 'plugins', 'node', executableName)
  const candidates = [
    process.env.HBUILDERX_NODE_PATH,
    process.env.UNI_AGENT_NODE_PATH,
    desktopRelativeNodePath,
    homeNodePath,
    process.execPath,
  ].filter(Boolean)

  return candidates.find(existsSync) || process.execPath
}

const nodePath = resolvePreferredNodePath()

if (!existsSync(forgeCliPath)) {
  console.error('未找到 Electron Forge CLI，请先安装依赖。')
  process.exit(1)
}

let forgeEnv

try {
  forgeEnv = resolveForgeEnv()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const result = spawnSync(nodePath, [forgeCliPath].concat(forgeArgs), {
  cwd: projectRoot,
  env: forgeEnv,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status || 0)
