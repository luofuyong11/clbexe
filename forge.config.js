const fs = require('fs')
const path = require('path')

function resolveTargetPlatform() {
  const argv = process.argv || []
  const platformArg = argv.find(arg => arg.indexOf('--platform=') === 0)
  if (platformArg) {
    return platformArg.slice('--platform='.length)
  }

  return process.platform
}

function resolveIconBase(extension, candidates) {
  for (const candidate of candidates) {
    const basePath = path.join(__dirname, 'icon', candidate)
    if (fs.existsSync(`${basePath}.${extension}`)) {
      return basePath
    }
  }

  return undefined
}

function resolveIconPath(targetPlatform) {
  if (targetPlatform === 'darwin') {
    return resolveIconBase('icns', ['clb', 'icon'])
  }

  return resolveIconBase('ico', ['clb', 'icon'])
}

const targetPlatform = resolveTargetPlatform()
const iconPath = resolveIconPath(targetPlatform)
const windowsSetupIconPath = targetPlatform === 'win32' && iconPath ? `${iconPath}.ico` : undefined
const nativeModulesPath = path.join(__dirname, 'native-modules')

module.exports = {
  packagerConfig: {
    appBundleId: 'cn.chonglaoban.desktop',
    appCategoryType: 'public.app-category.business',
    extraResource: fs.existsSync(nativeModulesPath) ? [nativeModulesPath] : [],
    icon: iconPath,
    ignore: [
      /(^|[\\/])src-tauri[\\/]target([\\/]|$)/,
      /(^|[\\/])native-modules([\\/]|$)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'chonglaoban',
        authors: 'chonglaoban',
        exe: 'chonglaoban.exe',
        setupExe: 'chonglaoban-Setup.exe',
        setupIcon: windowsSetupIconPath,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
}
