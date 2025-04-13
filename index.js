const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const express = require('express');

// 将 exec 转换为 Promise，增加 maxBuffer 以防命令输出过长
const execPromise = util.promisify(exec);
const execPromiseWithOptions = (command, options) => util.promisify(exec)(command, { ...options, maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer

// 插件信息
const info = {
    id: 'plugin-manager',
    name: 'Plugin Manager',
    description: '通过 Git URL 安装、更新和删除 SillyTavern 插件。',
    version: '1.0.0',
};

// 全局常量
const PLUGINS_DIR = path.join(process.cwd(), 'plugins'); // SillyTavern 的插件目录
const PLUGIN_ID = info.id; // 当前插件 ID，用于过滤自身

// ========== 辅助函数 ==========

/**
 * 安全地执行 shell 命令
 * @param {string} command 要执行的命令
 * @param {string} cwd 执行命令的工作目录
 * @param {boolean} logOutput 是否打印输出到控制台
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, error?: Error}>}
 */
async function runCommand(command, cwd, logOutput = true) {
    if (logOutput) {
        console.log(`[${PLUGIN_ID}] Executing command in ${cwd}: ${command}`);
    }
    try {
        // 使用带选项的 execPromise，增加 buffer
        const { stdout, stderr } = await execPromiseWithOptions(command, { cwd });
        if (logOutput && stdout) {
            console.log(`[${PLUGIN_ID}] > stdout:\n${stdout}`);
        }
        if (logOutput && stderr) {
            // Git 经常在 stderr 中输出非错误信息，所以用 warn
            console.warn(`[${PLUGIN_ID}] > stderr:\n${stderr}`);
        }
        return { success: true, stdout, stderr };
    } catch (error) {
        if (logOutput) {
            console.error(`[${PLUGIN_ID}] Command failed: ${command}`);
            console.error(`[${PLUGIN_ID}] > error: ${error.message}`);
            if (error.stdout) console.error(`[${PLUGIN_ID}] > stdout:\n${error.stdout}`);
            if (error.stderr) console.error(`[${PLUGIN_ID}] > stderr:\n${error.stderr}`);
        }
        return { success: false, stdout: error.stdout || '', stderr: error.stderr || '', error };
    }
}

/**
 * 检查指定目录是否是一个 Git 仓库
 * @param {string} dirPath 目录路径
 * @returns {Promise<boolean>}
 */
async function isGitRepository(dirPath) {
    try {
        const gitPath = path.join(dirPath, '.git');
        const stats = await fs.stat(gitPath);
        return stats.isDirectory();
    } catch (error) {
        // 如果 .git 不存在或不是目录，stat 会抛出错误
        return false;
    }
}

/**
 * 获取插件元数据 (info 和 package.json)
 * @param {string} pluginDir 插件目录路径
 * @returns {Promise<{info: object|null, pkgJson: object|null}>}
 */
async function getPluginMetadata(pluginDir) {
    let pkgJson = null;
    let pluginInfo = null;

    // 1. 尝试读取 package.json
    const pkgPath = path.join(pluginDir, 'package.json');
    try {
        const pkgContent = await fs.readFile(pkgPath, 'utf8');
        pkgJson = JSON.parse(pkgContent);
        // 如果 package.json 有 main 字段，尝试从中加载 info
        if (pkgJson && pkgJson.main) {
            const mainPath = path.join(pluginDir, pkgJson.main);
            try {
                const pluginModule = require(mainPath);
                pluginInfo = pluginModule.info || null;
            } catch (loadError) {
                // console.warn(`[${PLUGIN_ID}] Failed to load main file specified in package.json (${pkgJson.main}): ${loadError.message}`);
            }
        }
    } catch (error) {
        // package.json 不存在或读取失败，是正常情况
    }

    // 2. 如果没有从 package.json 获取到 info，尝试加载 index.js
    if (!pluginInfo) {
        const indexPath = path.join(pluginDir, 'index.js');
        try {
            const pluginModule = require(indexPath);
            pluginInfo = pluginModule.info || null;
        } catch (loadError) {
            // index.js 不存在或加载失败
        }
    }
    
     // 3. 如果还没有，尝试加载 index.mjs (ESM 模块加载可能需要不同的处理方式，这里简化处理)
     if (!pluginInfo) {
         const mjsPath = path.join(pluginDir, 'index.mjs');
         try {
             // 注意：require() 不能直接加载 .mjs。实际需要动态 import()
             // 为了简化，我们假设 .mjs 也能提供 info，或者需要更复杂的加载逻辑
             // const module = await import(mjsPath); // 这需要在 async 函数中
             // pluginInfo = module.default?.info || null;
             // 这里暂时跳过 .mjs 的 info 加载
         } catch (loadError) {
             // index.mjs 不存在或加载失败
         }
     }


    return { info: pluginInfo, pkgJson: pkgJson };
}

// ========== 核心功能函数 ==========

/**
 * 列出所有已安装的插件及其状态
 */
async function listInstalledPlugins() {
    const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
    const plugins = [];

    for (const entry of entries) {
        // 只处理目录，并排除自身和 node_modules
        if (entry.isDirectory() && entry.name !== PLUGIN_ID && entry.name !== 'node_modules') {
            const pluginDir = path.join(PLUGINS_DIR, entry.name);
            const { info: pluginInfoData, pkgJson } = await getPluginMetadata(pluginDir);
            const isGit = await isGitRepository(pluginDir);
            let gitStatus = null;
            let remoteUrl = null;
            let hasLocalChanges = false;
            let needsPull = false;

            if (isGit) {
                // 获取远程 URL
                const remoteResult = await runCommand('git remote get-url origin', pluginDir, false);
                if (remoteResult.success) {
                    remoteUrl = remoteResult.stdout.trim();
                }
                // 获取状态
                const statusResult = await runCommand('git status --porcelain', pluginDir, false);
                if (statusResult.success) {
                    hasLocalChanges = statusResult.stdout.trim() !== '';
                }
                // 检查是否需要 pull (本地落后远程)
                await runCommand('git fetch origin', pluginDir, false); // 先 fetch
                const logResult = await runCommand('git log HEAD..origin/HEAD --oneline', pluginDir, false); // 检查远程是否有新提交 HEAD 指向主分支
                 if (logResult.success && logResult.stdout.trim() !== '') {
                     needsPull = true;
                 }
            }

            plugins.push({
                id: pluginInfoData?.id || entry.name, // 优先使用 info.id
                dirName: entry.name,
                name: pluginInfoData?.name || entry.name,
                description: pluginInfoData?.description || '',
                version: pkgJson?.version || pluginInfoData?.version || '', // 优先 pkgJson
                isGit: isGit,
                remoteUrl: remoteUrl,
                hasLocalChanges: hasLocalChanges,
                needsPull: needsPull,
                hasPackageJson: !!pkgJson,
                dependencies: pkgJson?.dependencies ? Object.keys(pkgJson.dependencies) : [],
                devDependencies: pkgJson?.devDependencies ? Object.keys(pkgJson.devDependencies) : []
            });
        }
    }
    return plugins.sort((a, b) => a.name.localeCompare(b.name)); // 按名称排序
}

/**
 * 通过 Git URL 安装插件
 * @param {string} gitUrl
 */
async function installPlugin(gitUrl) {
    // 简单的从 URL 提取仓库名作为目录名
    let pluginName = path.basename(gitUrl, '.git');
    // 如果 URL 包含 .git 后缀，去除它
    if (pluginName.endsWith('.git')) {
        pluginName = pluginName.slice(0, -4);
    }
    // 进一步清理可能的用户名部分（如果URL是 git@github.com:user/repo.git 形式）
    if (pluginName.includes(':')) {
        pluginName = pluginName.substring(pluginName.lastIndexOf(':') + 1);
    }

    const targetDir = path.join(PLUGINS_DIR, pluginName);

    // 检查目录是否已存在
    try {
        await fs.access(targetDir);
        // 如果目录已存在，返回错误
        return { success: false, message: `插件目录 '${pluginName}' 已存在。` };
    } catch (error) {
        // 目录不存在，可以继续
    }

    // 执行 git clone
    const cloneResult = await runCommand(`git clone ${gitUrl} "${pluginName}"`, PLUGINS_DIR);

    if (!cloneResult.success) {
        return { success: false, message: '克隆仓库失败', details: cloneResult.stderr || cloneResult.error?.message };
    }

    // 检查是否有 package.json
    const hasPackageJson = await fs.access(path.join(targetDir, 'package.json')).then(() => true).catch(() => false);

    return {
        success: true,
        message: `插件 '${pluginName}' 安装成功。`,
        pluginDirName: pluginName,
        needsDependencyInstall: hasPackageJson
    };
}

/**
 * 更新指定插件
 * @param {string} pluginDirName 插件的目录名
 */
async function updatePlugin(pluginDirName) {
    const pluginDir = path.join(PLUGINS_DIR, pluginDirName);

    if (!await isGitRepository(pluginDir)) {
        return { success: false, message: '插件不是一个有效的 Git 仓库。' };
    }

    // 执行 git pull
    const pullResult = await runCommand('git pull', pluginDir);

    if (!pullResult.success) {
        // 检查是否是合并冲突
        if (pullResult.stderr?.includes('Merge conflict')) {
             return { success: false, message: '更新失败：存在合并冲突，请手动解决。', error: 'merge_conflict', details: pullResult.stderr };
        }
        // 检查是否本地有未提交更改阻止了 pull
         if (pullResult.stderr?.includes('Your local changes to the following files would be overwritten by merge')) {
              return { success: false, message: '更新失败：存在未提交的本地更改，请先处理（提交或暂存）。', error: 'local_changes', details: pullResult.stderr };
         }
        return { success: false, message: '更新失败', details: pullResult.stderr || pullResult.error?.message };
    }

    // 检查 package.json 是否有变化（简单的检查）
     const statusResult = await runCommand('git status --porcelain package.json', pluginDir, false);
     const pkgChanged = statusResult.success && statusResult.stdout.trim() !== '';


    return { success: true, message: '插件更新成功。', needsDependencyInstall: pkgChanged };
}

/**
 * 删除指定插件
 * @param {string} pluginDirName 插件的目录名
 */
async function deletePlugin(pluginDirName) {
    const pluginDir = path.join(PLUGINS_DIR, pluginDirName);

    // 再次确认插件 ID 不是自己
    if (pluginDirName === PLUGIN_ID) {
        return { success: false, message: '不能删除插件管理器自身！' };
    }

    try {
        // 确保目录存在
        await fs.access(pluginDir);
        // 强制递归删除
        await fs.rm(pluginDir, { recursive: true, force: true });
        return { success: true, message: `插件 '${pluginDirName}' 已删除。` };
    } catch (error) {
        console.error(`[${PLUGIN_ID}] 删除插件 '${pluginDirName}' 失败:`, error);
        return { success: false, message: '删除插件失败', details: error.message };
    }
}

/**
 * 安装指定插件的依赖
 * @param {string} pluginDirName 插件的目录名
 */
async function installDependencies(pluginDirName) {
    const pluginDir = path.join(PLUGINS_DIR, pluginDirName);
    const pkgPath = path.join(pluginDir, 'package.json');

    // 检查 package.json 是否存在
    try {
        await fs.access(pkgPath);
    } catch (error) {
        return { success: false, message: '插件没有找到 package.json 文件，无需安装依赖。' };
    }

    // 执行 npm install
    // 注意：如果需要安装 devDependencies，可以使用 npm install --include=dev
    const installResult = await runCommand('npm install', pluginDir);

    if (!installResult.success) {
        return { success: false, message: '依赖安装失败', details: installResult.stderr || installResult.error?.message };
    }

    return { success: true, message: '依赖安装成功。' };
}


// ========== 插件初始化和导出 ==========

async function init(router) {
    console.log(`[${PLUGIN_ID}] 初始化 ${info.name} 插件...`);
    try {
        // 检查 Git 是否可用
        const gitCheck = await runCommand('git --version', process.cwd(), false);
        if (!gitCheck.success) {
            console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
            console.error(`!!! ${info.name} 错误: Git 命令未找到或无法执行。请确保 Git 已安装并配置在系统 PATH 中。`);
            console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
            // 这里不阻止插件加载，但功能会受限
        } else {
            console.log(`[${PLUGIN_ID}] Git 版本: ${gitCheck.stdout.trim()}`);
        }


        // --- BEGIN UI Serving ---
        router.use('/static', express.static(path.join(__dirname, 'public')));
        router.use(express.json()); // 解析 JSON 请求体
        router.get('/ui', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        // --- END UI Serving ---

        // ========== Express API 端点 ==========

        // 获取已安装插件列表
        router.get('/plugins', async (req, res) => {
            try {
                const plugins = await listInstalledPlugins();
                res.json({ success: true, plugins });
            } catch (error) {
                console.error(`[${PLUGIN_ID}] 获取插件列表失败:`, error);
                res.status(500).json({ success: false, message: `获取插件列表失败: ${error.message}` });
            }
        });

        // 安装新插件
        router.post('/plugins/install', async (req, res) => {
            const { gitUrl } = req.body;
            if (!gitUrl || typeof gitUrl !== 'string') {
                return res.status(400).json({ success: false, message: '需要提供有效的 Git URL。' });
            }
            try {
                const result = await installPlugin(gitUrl);
                res.json(result);
            } catch (error) {
                console.error(`[${PLUGIN_ID}] 安装插件失败 (${gitUrl}):`, error);
                res.status(500).json({ success: false, message: `安装插件时发生错误: ${error.message}` });
            }
        });

        // 更新插件
        router.post('/plugins/:pluginDirName/update', async (req, res) => {
            const { pluginDirName } = req.params;
            try {
                const result = await updatePlugin(pluginDirName);
                res.json(result);
            } catch (error) {
                console.error(`[${PLUGIN_ID}] 更新插件失败 (${pluginDirName}):`, error);
                res.status(500).json({ success: false, message: `更新插件时发生错误: ${error.message}` });
            }
        });

        // 删除插件
        router.delete('/plugins/:pluginDirName', async (req, res) => {
            const { pluginDirName } = req.params;
            // 再次确认不是删除自己
             if (pluginDirName === PLUGIN_ID) {
                 return res.status(403).json({ success: false, message: '不能删除插件管理器自身！' });
             }
            try {
                // 理论上这里应该在调用 deletePlugin 前有二次确认，但API层面通常直接执行
                const result = await deletePlugin(pluginDirName);
                res.json(result);
            } catch (error) {
                console.error(`[${PLUGIN_ID}] 删除插件失败 (${pluginDirName}):`, error);
                res.status(500).json({ success: false, message: `删除插件时发生错误: ${error.message}` });
            }
        });

        // 安装依赖
        router.post('/plugins/:pluginDirName/dependencies', async (req, res) => {
            const { pluginDirName } = req.params;
            try {
                const result = await installDependencies(pluginDirName);
                res.json(result);
            } catch (error) {
                console.error(`[${PLUGIN_ID}] 安装依赖失败 (${pluginDirName}):`, error);
                res.status(500).json({ success: false, message: `安装依赖时发生错误: ${error.message}` });
            }
        });


        console.log(`[${PLUGIN_ID}] ${info.name} 插件初始化完成。`);

    } catch (error) {
        console.error(`[${PLUGIN_ID}] ${info.name} 插件初始化失败:`, error);
    }
}

// 插件导出对象
const plugin = {
    info: info,
    init: init,
};

module.exports = plugin;
