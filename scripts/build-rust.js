const { copyFileSync, existsSync, mkdirSync } = require('fs');
const os = require('os');
const { join } = require('path');
const { spawnSync } = require('child_process');
const { ensureMacSdkEnvironment } = require('./macos-build-env');

const projectRoot = process.cwd();
const srcTauriDir = join(projectRoot, 'src-tauri');
const nativeModulesDir = join(projectRoot, 'native-modules');
const scriptsDir = join(projectRoot, 'scripts');
const args = process.argv.slice(2);
const systemDrive = process.env.SystemDrive || process.env.SYSTEMDRIVE || '';
const programFiles = process.env.ProgramFiles || join(systemDrive, 'Program Files');
const programFilesX86 = process.env['ProgramFiles(x86)'] || programFiles;

const options = parseArgs(args);
const targetConfig = resolveTargetConfig(options.platform, options.arch);

function run(command, args, options) {
  return spawnSync(command, args, {
    cwd: srcTauriDir,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function resolveExecutable(commandName) {
  const executableName = process.platform === 'win32' ? `${commandName}.exe` : commandName;
  const cargoHome = process.env.CARGO_HOME || join(os.homedir(), '.cargo');
  const candidates = [
    process.env[`${commandName.toUpperCase()}_BIN`],
    process.env[commandName.toUpperCase()],
    join(cargoHome, 'bin', executableName),
    executableName,
    commandName,
  ].filter(Boolean);

  return candidates.find(existsSync) || candidates[candidates.length - 1];
}

const cargoCommand = resolveExecutable('cargo');
const rustupCommand = resolveExecutable('rustup');

function printResult(result) {
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function parseArgs(argv) {
  const parsed = {
    release: false,
    platform: process.platform,
    arch: process.arch,
  };

  argv.forEach(arg => {
    if (arg === '--release') {
      parsed.release = true;
      return;
    }

    if (arg.indexOf('--platform=') === 0) {
      parsed.platform = arg.slice('--platform='.length);
      return;
    }

    if (arg.indexOf('--arch=') === 0) {
      parsed.arch = arg.slice('--arch='.length);
    }
  });

  return parsed;
}

function resolveTargetConfig(platform, arch) {
  const targetMap = {
    win32: {
      ia32: 'i686-pc-windows-msvc',
      x64: 'x86_64-pc-windows-msvc',
      arm64: 'aarch64-pc-windows-msvc',
    },
    darwin: {
      x64: 'x86_64-apple-darwin',
      arm64: 'aarch64-apple-darwin',
    },
    linux: {
      x64: 'x86_64-unknown-linux-gnu',
      arm64: 'aarch64-unknown-linux-gnu',
    },
  };

  if (!targetMap[platform] || !targetMap[platform][arch]) {
    console.error(`暂不支持的 Rust 构建目标: ${platform}/${arch}`);
    process.exit(1);
  }

  return {
    triple: targetMap[platform][arch],
    platform,
    arch,
  };
}

function buildProfile() {
  return options.release ? 'release' : 'debug';
}

function cargoArgs() {
  const result = ['build', '--target', targetConfig.triple];
  if (options.release) {
    result.push('--release');
  }
  return result;
}

function builtLibraryFileName() {
  if (targetConfig.platform === 'win32') {
    return 'printer_native.dll';
  }

  if (targetConfig.platform === 'darwin') {
    return 'libprinter_native.dylib';
  }

  return 'libprinter_native.so';
}

function cargoTargetBaseDir() {
  if (targetConfig.platform === 'darwin' && process.platform === 'win32') {
    return join(srcTauriDir, 'target-macos');
  }

  return join(srcTauriDir, 'target');
}

function cargoTargetEnvPrefix() {
  return `CARGO_TARGET_${targetConfig.triple.toUpperCase().replace(/-/g, '_')}`;
}

function nativeModuleOutputDir() {
  return join(nativeModulesDir, `${targetConfig.platform}-${targetConfig.arch}`, buildProfile());
}

function syncNativeModule() {
  const profile = buildProfile();
  const builtLibraryPath = join(cargoTargetBaseDir(), targetConfig.triple, profile, builtLibraryFileName());
  const outputDir = nativeModuleOutputDir();
  const nodePath = join(outputDir, `printer_native-${Date.now()}.node`);
  const stableNodePath = join(outputDir, 'printer_native.node');

  if (existsSync(builtLibraryPath)) {
    mkdirSync(outputDir, { recursive: true });
    copyFileSync(builtLibraryPath, nodePath);
    copyFileSync(builtLibraryPath, stableNodePath);
  }
}

function ensureRustTargetInstalled() {
  const listResult = spawnSync(rustupCommand, ['target', 'list', '--installed'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (listResult.status !== 0) {
    printResult(listResult);
    process.exit(listResult.status || 1);
  }

  const installedTargets = (listResult.stdout || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);

  if (installedTargets.includes(targetConfig.triple)) {
    return;
  }

  console.log(`Installing Rust target ${targetConfig.triple}`);
  const addResult = spawnSync(rustupCommand, ['target', 'add', targetConfig.triple], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  printResult(addResult);
  if (addResult.status !== 0) {
    process.exit(addResult.status || 1);
  }
}

function findVcvarsScript(arch) {
  const scriptNameMap = {
    ia32: 'vcvars32.bat',
    x64: 'vcvars64.bat',
    arm64: 'vcvarsamd64_arm64.bat',
  };

  const scriptName = scriptNameMap[arch];
  if (!scriptName) {
    return null;
  }

  if (process.env.VCVARS_PATH && existsSync(process.env.VCVARS_PATH)) {
    return process.env.VCVARS_PATH;
  }

  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const probe = spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (probe.status === 0) {
      const installPath = probe.stdout.trim();
      if (installPath) {
        const vcvars = join(installPath, 'VC', 'Auxiliary', 'Build', scriptName);
        if (existsSync(vcvars)) {
          return vcvars;
        }
      }
    }
  }

  const fallbacks = [
    join(programFiles, 'Microsoft Visual Studio', '2022', 'Community', 'VC', 'Auxiliary', 'Build', scriptName),
    join(programFiles, 'Microsoft Visual Studio', '2022', 'Professional', 'VC', 'Auxiliary', 'Build', scriptName),
    join(programFiles, 'Microsoft Visual Studio', '2022', 'Enterprise', 'VC', 'Auxiliary', 'Build', scriptName),
  ];

  return fallbacks.find(existsSync);
}

function runCargoWithVcvars(vcvarsPath) {
  const helper = '..\\scripts\\run-cargo-with-vcvars.cmd';
  return spawnSync(
    'cmd.exe',
    ['/d', '/c', helper, 'cargo'].concat(cargoArgs()),
    {
      cwd: srcTauriDir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        VCVARS_PATH: vcvarsPath,
      },
    }
  );
}

function runCargoBuild() {
  if (process.platform !== 'win32' || targetConfig.platform !== 'win32') {
    let env = { ...process.env };
    if (targetConfig.platform === 'darwin') {
      try {
        env = ensureMacSdkEnvironment(env, { operation: 'macOS Rust 原生模块构建' });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
    }

    if (targetConfig.platform === 'darwin' && process.platform === 'win32') {
      env.CARGO_TARGET_DIR = 'target-macos';
      env.PATH = `${scriptsDir};${env.PATH || ''}`;
      env.UNI_AGENT_NODE_PATH = process.execPath;
      env.HBUILDERX_NODE_PATH = process.execPath;
      env[`${cargoTargetEnvPrefix()}_LINKER`] = 'rust-lld.cmd';
      env[`${cargoTargetEnvPrefix()}_RUSTFLAGS`] = '-C linker-flavor=ld64.lld';
    }

    return run(cargoCommand, cargoArgs(), { env });
  }

  const vcvarsPath = findVcvarsScript(targetConfig.arch);
  if (!vcvarsPath) {
    console.error(`未找到 ${targetConfig.arch} 对应的 Visual Studio C++ 构建环境。`);
    process.exit(1);
  }

  return runCargoWithVcvars(vcvarsPath);
}

let result;

if (targetConfig.platform === 'darwin' && process.platform !== 'darwin') {
  console.warn('正在尝试跨平台构建 macOS 原生模块；若缺少 Apple 交叉编译工具链，构建会失败。');
}

ensureRustTargetInstalled();
result = runCargoBuild();

printResult(result);

if (result.error) {
  process.exit(1);
}

const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
if (result.status === 0) {
  syncNativeModule();
}

if (result.status !== 0 && combinedOutput.includes('kernel32.lib')) {
  console.error('\n缺少 Windows SDK：请在 Visual Studio Installer 中安装 Windows 10/11 SDK。');
}

process.exit(typeof result.status === 'number' ? result.status : 1);
