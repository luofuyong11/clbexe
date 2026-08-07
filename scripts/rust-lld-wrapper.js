const { existsSync, readFileSync, writeFileSync } = require('fs')
const { join, relative, resolve } = require('path')
const { spawnSync } = require('child_process')

function getRustHostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) {
    throw new Error(result.stderr || '读取 rustc 主机三元组失败')
  }

  const hostLine = (result.stdout || '')
    .split(/\r?\n/)
    .find(line => line.indexOf('host: ') === 0)

  if (!hostLine) {
    throw new Error('未找到 rustc host 信息')
  }

  return hostLine.slice('host: '.length).trim()
}

function getRustLldPath() {
  const sysrootResult = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8', stdio: 'pipe' })
  if (sysrootResult.status !== 0) {
    throw new Error(sysrootResult.stderr || '读取 rustc sysroot 失败')
  }

  const sysroot = (sysrootResult.stdout || '').trim()
  const hostTriple = getRustHostTriple()
  const rustLldPath = join(sysroot, 'lib', 'rustlib', hostTriple, 'bin', 'rust-lld.exe')
  if (!existsSync(rustLldPath)) {
    throw new Error(`未找到 rust-lld: ${rustLldPath}`)
  }

  return rustLldPath
}

function normalizeArg(arg) {
  if (!arg) {
    return arg
  }

  const cwd = process.cwd()

  const normalizeAbsolutePath = (value) => {
    if (!/^[A-Za-z]:[\\/]/.test(value)) {
      return value.replace(/\\/g, '/')
    }

    const resolved = resolve(value)
    let relativePath = relative(cwd, resolved)
    if (!relativePath || relativePath.startsWith('..')) {
      relativePath = relative(cwd, resolved)
    }

    return relativePath.replace(/\\/g, '/')
  }

  if (/^[A-Za-z]:[\\/].*\{.*\}\.rlib$/.test(arg)) {
    const braceIndex = arg.indexOf('{')
    const prefix = arg.slice(0, braceIndex)
    const suffix = arg.slice(braceIndex)
    return `${normalizeAbsolutePath(prefix)}${suffix.replace(/\\/g, '/')}`
  }

  if (arg.indexOf('=') !== -1) {
    const equalIndex = arg.indexOf('=')
    const left = arg.slice(0, equalIndex + 1)
    const right = arg.slice(equalIndex + 1)
    if (/^[A-Za-z]:[\\/]/.test(right)) {
      return `${left}${normalizeAbsolutePath(right)}`
    }
  }

  if (
    /^[A-Za-z]:[\\/]/.test(arg)
    || arg.indexOf('target-macos\\') !== -1
    || arg.indexOf('target\\') !== -1
    || arg.indexOf('\\Users\\') !== -1
    || arg.indexOf('\\rustlib\\') !== -1
    || arg.indexOf('..\\') !== -1
    || arg.indexOf('.\\') !== -1
  ) {
    return normalizeAbsolutePath(arg)
  }

  return arg.replace(/\\/g, '/')
}

function normalizeResponseFileArg(arg) {
  if (!arg.startsWith('@')) {
    return arg
  }

  const responseFilePath = arg.slice(1)
  if (!existsSync(responseFilePath)) {
    return arg
  }

  const rawContent = readFileSync(responseFilePath, 'utf8')
  const normalizedContent = rawContent
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) {
        return line
      }

      const isQuoted = trimmed.startsWith('"') && trimmed.endsWith('"')
      const core = isQuoted ? trimmed.slice(1, -1) : trimmed
      const normalized = normalizeArg(core)
      return isQuoted ? `"${normalized}"` : normalized
    })
    .join('\n')

  if (process.env.DEBUG_RUST_LLD === '1') {
    writeFileSync(join(process.cwd(), 'rust-lld-response-raw.txt'), rawContent, 'utf8')
    writeFileSync(join(process.cwd(), 'rust-lld-response-normalized.txt'), normalizedContent, 'utf8')
  }

  const normalizedResponseFile = join(process.cwd(), 'rust-lld-linker-arguments.txt')
  writeFileSync(normalizedResponseFile, normalizedContent, 'utf8')
  return `@${normalizedResponseFile.replace(/\\/g, '/')}`
}

try {
  const rustLldPath = getRustLldPath()
  const args = process.argv.slice(2).map(normalizeArg).map(normalizeResponseFileArg)
  const finalArgs = args[0] === '-flavor' ? args : ['-flavor', 'darwin'].concat(args)
  if (process.env.DEBUG_RUST_LLD === '1') {
    writeFileSync(
      join(process.cwd(), 'rust-lld-debug.json'),
      JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), finalArgs }, null, 2),
      'utf8'
    )
  }
  const result = spawnSync(rustLldPath, finalArgs, { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }

  process.exit(result.status || 0)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
