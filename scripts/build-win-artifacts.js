const { spawnSync } = require('child_process')
const { join, resolve } = require('path')

const projectRoot = resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))

if (!['ia32', 'x64'].includes(args.arch)) {
  console.error(`暂不支持的 Windows 构建架构: ${args.arch}`)
  process.exit(1)
}

runNodeScript('ensure-electron-binary.js', [])
runNodeScript('build-rust.js', ['--release', '--platform=win32', `--arch=${args.arch}`])
runNodeScript('run-forge.js', ['package', '--platform=win32', `--arch=${args.arch}`])
runNodeScript('run-forge.js', ['make', '--skip-package', '--platform=win32', `--arch=${args.arch}`, '--targets=@electron-forge/maker-squirrel'])
runNodeScript('build-nsis-installer.js', [`--arch=${args.arch}`])

function runNodeScript(scriptName, scriptArgs) {
  const scriptPath = join(__dirname, scriptName)
  const result = spawnSync(process.execPath, [scriptPath].concat(scriptArgs), {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
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
