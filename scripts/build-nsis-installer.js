const { existsSync, rmSync } = require('fs')
const { join, resolve } = require('path')

const { build, Platform, Arch } = require('../node_modules/electron-builder/out/index.js')

const projectRoot = resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const iconPath = join(projectRoot, 'icon', 'clb.ico')
const packageDir = join(projectRoot, 'out', `chonglaoban-win32-${args.arch}`)
const outputDir = join(projectRoot, 'out', 'make', 'nsis', args.arch)

async function main() {
  if (!['ia32', 'x64'].includes(args.arch)) {
    console.error(`暂不支持的 Windows 安装器架构: ${args.arch}`)
    process.exit(1)
  }

  if (!existsSync(packageDir)) {
    console.error(`未找到预打包目录: ${packageDir}`)
    process.exit(1)
  }

  rmSync(outputDir, { recursive: true, force: true })

  const result = await build({
    projectDir: projectRoot,
    prepackaged: packageDir,
    publish: 'never',
    targets: Platform.WINDOWS.createTarget('nsis', Arch[args.arch]),
    config: {
      appId: 'cn.chonglaoban.desktop',
      productName: 'chonglaoban',
      directories: {
        output: outputDir,
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        artifactName: 'chonglaoban-Installer-${arch}.${ext}',
        installerIcon: existsSync(iconPath) ? iconPath : undefined,
        uninstallerIcon: existsSync(iconPath) ? iconPath : undefined,
      },
    },
  })

  result.forEach(item => process.stdout.write(`${item}\n`))
}

function parseArgs(argv) {
  const parsed = {
    arch: process.arch,
  }

  argv.forEach(arg => {
    if (arg.indexOf('--arch=') === 0) {
      parsed.arch = arg.slice('--arch='.length)
    }
  })

  return parsed
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
