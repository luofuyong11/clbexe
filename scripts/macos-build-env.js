const { existsSync } = require('fs')
const { spawnSync } = require('child_process')

function resolveMacSdkRoot(env) {
  const configuredKeys = ['SDKROOT', 'MACOS_SDKROOT', 'MACOSX_SDKROOT']

  for (const key of configuredKeys) {
    const value = env[key]
    if (!value) {
      continue
    }

    if (existsSync(value)) {
      return value
    }

    throw new Error(`${key} 指向的路径不存在: ${value}`)
  }

  const xcrunResult = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
    encoding: 'utf8',
    stdio: 'pipe',
    env,
  })

  if (xcrunResult.status !== 0) {
    return null
  }

  const detectedSdkRoot = (xcrunResult.stdout || '').trim()
  if (detectedSdkRoot && existsSync(detectedSdkRoot)) {
    return detectedSdkRoot
  }

  return null
}

function ensureMacSdkEnvironment(env, options = {}) {
  const { requireMacHost = false, operation = 'macOS 构建' } = options

  if (requireMacHost && process.platform !== 'darwin') {
    throw new Error(`${operation}必须在 macOS 主机执行。当前主机为 ${process.platform}。\n请在 macOS + Xcode 环境执行。`)
  }

  const sdkRoot = resolveMacSdkRoot(env)
  if (sdkRoot) {
    return {
      ...env,
      SDKROOT: sdkRoot,
    }
  }

  if (process.platform === 'darwin') {
    throw new Error('未检测到可用的 macOS SDK。\n请先安装 Xcode Command Line Tools，或设置 SDKROOT 指向有效的 MacOSX.sdk。')
  }

  throw new Error('未检测到可用的 macOS SDK。\n当前为非 macOS 主机；请在 macOS + Xcode 环境执行，或预先配置 Apple 交叉编译工具链，并设置 SDKROOT 指向有效的 MacOSX.sdk。')
}

module.exports = {
  ensureMacSdkEnvironment,
}
