// 当文档加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 初始化 Bootstrap 工具提示
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // 插件管理器 DOM 元素引用
    const pluginList = document.getElementById('pluginList');
    const installForm = document.getElementById('installForm');
    const gitUrlInput = document.getElementById('gitUrl');
    const refreshBtn = document.getElementById('refreshBtn');
    const pluginSearch = document.getElementById('pluginSearch');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    
    // 模态框引用
    const deleteConfirmModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    const pluginDetailsModal = new bootstrap.Modal(document.getElementById('pluginDetailsModal'));
    
    // 删除确认相关元素
    const deletePluginName = document.getElementById('deletePluginName');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    let currentPluginToDelete = null;
    
    // 插件详情相关元素
    const pluginDetailsContent = document.getElementById('pluginDetailsContent');
    
    // ========== 工具函数 ==========
    
    /**
     * 显示加载动画
     * @param {string} message 加载提示信息
     */
    function showLoading(message = '正在处理...') {
        loadingText.textContent = message;
        loadingOverlay.classList.add('show');
    }
    
    /**
     * 隐藏加载动画
     */
    function hideLoading() {
        loadingOverlay.classList.remove('show');
    }
    
    /**
     * 创建并显示 Toast 通知
     * @param {string} title 通知标题
     * @param {string} message 通知内容
     * @param {'success'|'error'|'warning'|'info'} type 通知类型
     */
    function showToast(title, message, type = 'info') {
        const toastContainer = document.querySelector('.toast-container');
        
        // 设置 Toast 背景颜色根据类型
        let bgColor, textColor, iconClass;
        switch (type) {
            case 'success':
                bgColor = 'bg-success';
                textColor = 'text-white';
                iconClass = 'bi-check-circle-fill';
                break;
            case 'error':
                bgColor = 'bg-danger';
                textColor = 'text-white';
                iconClass = 'bi-exclamation-circle-fill';
                break;
            case 'warning':
                bgColor = 'bg-warning';
                textColor = 'text-dark';
                iconClass = 'bi-exclamation-triangle-fill';
                break;
            default:
                bgColor = 'bg-info';
                textColor = 'text-white';
                iconClass = 'bi-info-circle-fill';
        }
        
        // 创建 Toast 元素
        const toastEl = document.createElement('div');
        toastEl.className = `toast ${bgColor} ${textColor} mb-3`;
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');
        
        // 设置 Toast 内容
        toastEl.innerHTML = `
            <div class="toast-header ${bgColor} ${textColor}">
                <i class="bi ${iconClass} me-2"></i>
                <strong class="me-auto">${title}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        `;
        
        // 添加到容器
        toastContainer.appendChild(toastEl);
        
        // 初始化 Toast 并显示
        const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
        toast.show();
        
        // 设置自动删除元素
        toastEl.addEventListener('hidden.bs.toast', () => {
            toastContainer.removeChild(toastEl);
        });
    }
    
    /**
     * API 调用函数
     * @param {string} endpoint API 端点
     * @param {'GET'|'POST'|'PUT'|'DELETE'} method HTTP 方法
     * @param {object|null} data 请求数据
     * @returns {Promise<object>} 响应数据
     */
    async function apiCall(endpoint, method = 'GET', data = null) {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include' // 包含凭证（cookies）
        };
        
        // 对于非GET请求，先获取CSRF令牌
        if (method !== 'GET' && method !== 'HEAD') {
            try {
                const csrfResponse = await fetch('/csrf-token');
                if (!csrfResponse.ok) {
                    throw new Error(`获取CSRF令牌失败: ${csrfResponse.statusText}`);
                }
                const csrfData = await csrfResponse.json();
                if (!csrfData || !csrfData.token) {
                    throw new Error('无效的CSRF令牌响应');
                }
                options.headers['X-CSRF-Token'] = csrfData.token;
            } catch (csrfError) {
                console.error('无法获取或设置CSRF令牌:', csrfError);
                showToast('安全错误', `无法执行操作，获取安全令牌失败: ${csrfError.message}`, 'error');
                throw csrfError; // 阻止后续请求
            }
        }
        
        // 添加请求体
        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(`/api/plugins/plugin-manager/${endpoint}`, options);
            
            // 检查是否是 CSRF 错误导致的 HTML 响应
            if (!response.ok && response.headers.get('content-type')?.includes('text/html')) {
                if (response.status === 403) {
                    throw new Error('认证或权限错误 (403 Forbidden)。CSRF令牌可能无效或已过期。');
                } else {
                    throw new Error(`请求失败，服务器返回了非JSON响应 (状态码: ${response.status})`);
                }
            }
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.message || `请求失败，状态码: ${response.status}`);
            }
            
            return result;
        } catch (error) {
            console.error(`API调用失败 (${endpoint}):`, error);
            throw error;
        }
    }
    
    /**
     * 格式化时间戳为相对时间
     * @param {string} timestamp 时间戳
     * @returns {string} 相对时间
     */
    function timeAgo(timestamp) {
        const now = new Date();
        const past = new Date(timestamp);
        const diffMs = now - past;
        const diffSeconds = Math.floor(diffMs / 1000);
        
        if (diffSeconds < 60) {
            return '刚刚';
        }
        
        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) {
            return `${diffMinutes}分钟前`;
        }
        
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return `${diffHours}小时前`;
        }
        
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 30) {
            return `${diffDays}天前`;
        }
        
        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths < 12) {
            return `${diffMonths}个月前`;
        }
        
        const diffYears = Math.floor(diffMonths / 12);
        return `${diffYears}年前`;
    }
    
    // ========== 核心功能函数 ==========
    
    /**
     * 获取并渲染已安装的插件列表
     */
    async function loadPlugins() {
        showLoading('正在获取插件列表...');
        try {
            const result = await apiCall('plugins');
            if (result.success) {
                renderPluginList(result.plugins);
            } else {
                throw new Error(result.message || '获取插件列表失败');
            }
        } catch (error) {
            console.error('获取插件列表失败:', error);
            showToast('错误', `获取插件列表失败: ${error.message}`, 'error');
            // 显示错误状态
            pluginList.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-exclamation-circle text-danger" style="font-size: 3rem;"></i>
                    <p class="mt-3">加载插件失败: ${error.message}</p>
                    <button class="btn btn-outline-light mt-2" onclick="location.reload()">
                        <i class="bi bi-arrow-clockwise me-2"></i>重试
                    </button>
                </div>
            `;
        } finally {
            hideLoading();
        }
    }
    
    /**
     * 渲染插件列表
     * @param {Array} plugins 插件数据数组
     */
    function renderPluginList(plugins) {
        if (!plugins || plugins.length === 0) {
            pluginList.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-box text-muted" style="font-size: 3rem;"></i>
                    <p class="mt-3">未找到已安装的插件</p>
                    <p class="text-muted">使用上方表单通过 Git URL 安装新插件</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        plugins.forEach(plugin => {
            // 添加状态徽章
            const badges = [];
            if (plugin.isGit) {
                badges.push(`<span class="plugin-badge git" title="Git 仓库"><i class="bi bi-git me-1"></i>Git</span>`);
            }
            if (plugin.needsPull) {
                badges.push(`<span class="plugin-badge update" title="有更新可用"><i class="bi bi-arrow-up-circle me-1"></i>可更新</span>`);
            }
            if (plugin.hasLocalChanges) {
                badges.push(`<span class="plugin-badge local-changes" title="本地有未提交的更改"><i class="bi bi-pencil me-1"></i>已修改</span>`);
            }
            
            // 依赖徽章
            if (plugin.hasPackageJson && plugin.dependencies.length > 0) {
                const depsCount = plugin.dependencies.length;
                badges.push(`<span class="plugin-badge" style="background-color: #4834d4;" title="需要安装 ${depsCount} 个依赖"><i class="bi bi-box me-1"></i>${depsCount} 依赖</span>`);
            }
            
            // 构建卡片 HTML
            html += `
                <div class="col-md-6 col-lg-4 mb-4" data-plugin-id="${plugin.dirName}" data-plugin-search="${(plugin.name + ' ' + plugin.description).toLowerCase()}">
                    <div class="card plugin-card h-100">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5 class="mb-0" title="${plugin.name}">${plugin.name}</h5>
                            <div class="btn-group">
                                <button class="btn btn-sm btn-outline-light view-details-btn" data-plugin-id="${plugin.dirName}" title="查看详情">
                                    <i class="bi bi-info-circle"></i>
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="mb-3">
                                ${badges.join('')}
                                ${plugin.version ? `<span class="badge bg-secondary">v${plugin.version}</span>` : ''}
                            </div>
                            <p class="card-text">${plugin.description || '无描述'}</p>
                        </div>
                        <div class="card-footer">
                            <div class="plugin-actions">
                                ${plugin.isGit ? `
                                    <button class="btn btn-sm btn-success update-plugin-btn" data-plugin-id="${plugin.dirName}" ${!plugin.needsPull ? 'disabled' : ''}>
                                        <i class="bi bi-arrow-repeat me-1"></i>更新
                                    </button>
                                ` : ''}
                                ${plugin.hasPackageJson ? `
                                    <button class="btn btn-sm btn-info install-deps-btn" data-plugin-id="${plugin.dirName}">
                                        <i class="bi bi-box me-1"></i>安装依赖
                                    </button>
                                ` : ''}
                                <button class="btn btn-sm btn-danger delete-plugin-btn" data-plugin-id="${plugin.dirName}" data-plugin-name="${plugin.name}">
                                    <i class="bi bi-trash me-1"></i>删除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        pluginList.innerHTML = html;
        
        // 为按钮添加事件监听器
        document.querySelectorAll('.update-plugin-btn').forEach(btn => {
            btn.addEventListener('click', handleUpdatePlugin);
        });
        
        document.querySelectorAll('.install-deps-btn').forEach(btn => {
            btn.addEventListener('click', handleInstallDeps);
        });
        
        document.querySelectorAll('.delete-plugin-btn').forEach(btn => {
            btn.addEventListener('click', handleDeletePrompt);
        });
        
        document.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', handleViewDetails);
        });
    }
    
    /**
     * 安装新插件处理函数
     * @param {Event} event 表单提交事件
     */
    async function handleInstallPlugin(event) {
        event.preventDefault();
        
        const gitUrl = gitUrlInput.value.trim();
        if (!gitUrl) {
            showToast('错误', '请输入有效的 Git 仓库 URL', 'error');
            return;
        }
        
        showLoading('正在安装插件...');
        try {
            const result = await apiCall('plugins/install', 'POST', { gitUrl });
            
            if (result.success) {
                showToast('成功', result.message, 'success');
                
                // 如果插件需要安装依赖，提示用户
                if (result.needsDependencyInstall) {
                    if (confirm(`插件安装成功，但它包含 package.json 文件。是否立即安装依赖？`)) {
                        await handleInstallDepsForPlugin(result.pluginDirName);
                    }
                }
                
                // 清空输入框并重新加载插件列表
                gitUrlInput.value = '';
                await loadPlugins();
            } else {
                throw new Error(result.message || '安装插件失败');
            }
        } catch (error) {
            console.error('安装插件失败:', error);
            showToast('错误', `安装插件失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * 更新插件处理函数
     * @param {Event} event 按钮点击事件
     */
    async function handleUpdatePlugin(event) {
        const btn = event.currentTarget;
        const pluginId = btn.dataset.pluginId;
        
        showLoading(`正在更新插件...`);
        
        try {
            const result = await apiCall(`plugins/${pluginId}/update`, 'POST');
            
            if (result.success) {
                showToast('成功', result.message, 'success');
                
                // 如果插件需要安装依赖，提示用户
                if (result.needsDependencyInstall) {
                    if (confirm(`插件更新成功，但 package.json 文件已更改。是否立即更新依赖？`)) {
                        await handleInstallDepsForPlugin(pluginId);
                    }
                }
                
                // 重新加载插件列表
                await loadPlugins();
            } else {
                // 处理不同类型的错误
                if (result.error === 'merge_conflict') {
                    showToast('更新失败', '存在合并冲突，请手动解决', 'error');
                } else if (result.error === 'local_changes') {
                    showToast('更新失败', '存在未提交的本地更改', 'error');
                } else {
                    throw new Error(result.message || '更新插件失败');
                }
            }
        } catch (error) {
            console.error(`更新插件 ${pluginId} 失败:`, error);
            showToast('错误', `更新插件失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * 安装插件依赖处理函数
     * @param {Event} event 按钮点击事件
     */
    async function handleInstallDeps(event) {
        const btn = event.currentTarget;
        const pluginId = btn.dataset.pluginId;
        
        await handleInstallDepsForPlugin(pluginId);
    }
    
    /**
     * 为指定插件安装依赖
     * @param {string} pluginId 插件 ID
     */
    async function handleInstallDepsForPlugin(pluginId) {
        showLoading(`正在安装依赖...`);
        
        try {
            const result = await apiCall(`plugins/${pluginId}/dependencies`, 'POST');
            
            if (result.success) {
                showToast('成功', result.message, 'success');
            } else {
                throw new Error(result.message || '安装依赖失败');
            }
        } catch (error) {
            console.error(`安装依赖失败 (${pluginId}):`, error);
            showToast('错误', `安装依赖失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
            // 不需要重新加载插件列表，因为依赖安装不会改变列表状态
        }
    }
    
    /**
     * 显示删除确认提示
     * @param {Event} event 按钮点击事件
     */
    function handleDeletePrompt(event) {
        const btn = event.currentTarget;
        const pluginId = btn.dataset.pluginId;
        const pluginName = btn.dataset.pluginName;
        
        // 设置模态框内容
        deletePluginName.textContent = `${pluginName} (${pluginId})`;
        currentPluginToDelete = pluginId;
        
        // 显示确认对话框
        deleteConfirmModal.show();
    }
    
    /**
     * 删除插件处理函数
     */
    async function handleDeletePlugin() {
        if (!currentPluginToDelete) return;
        
        // 隐藏确认对话框
        deleteConfirmModal.hide();
        
        showLoading(`正在删除插件...`);
        
        try {
            const result = await apiCall(`plugins/${currentPluginToDelete}`, 'DELETE');
            
            if (result.success) {
                showToast('成功', result.message, 'success');
                // 重新加载插件列表
                await loadPlugins();
            } else {
                throw new Error(result.message || '删除插件失败');
            }
        } catch (error) {
            console.error(`删除插件 ${currentPluginToDelete} 失败:`, error);
            showToast('错误', `删除插件失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
            currentPluginToDelete = null;
        }
    }
    
    /**
     * 查看插件详情
     * @param {Event} event 按钮点击事件
     */
    async function handleViewDetails(event) {
        const btn = event.currentTarget;
        const pluginId = btn.dataset.pluginId;
        
        showLoading(`正在加载插件详情...`);
        
        try {
            // 获取插件列表以找到选择的插件
            const result = await apiCall('plugins');
            
            if (result.success) {
                const plugin = result.plugins.find(p => p.dirName === pluginId);
                
                if (plugin) {
                    // 构建详情 HTML
                    let detailsHtml = `
                        <div class="row">
                            <div class="col-md-12">
                                <h3>${plugin.name}</h3>
                                <p>${plugin.description || '无描述'}</p>
                                <hr>
                                <div class="row">
                                    <div class="col-md-6">
                                        <h5>基本信息</h5>
                                        <table class="table table-sm table-dark">
                                            <tr>
                                                <th>目录名</th>
                                                <td>${plugin.dirName}</td>
                                            </tr>
                                            <tr>
                                                <th>ID</th>
                                                <td>${plugin.id}</td>
                                            </tr>
                                            <tr>
                                                <th>版本</th>
                                                <td>${plugin.version || '未知'}</td>
                                            </tr>
                                            <tr>
                                                <th>是否Git仓库</th>
                                                <td>${plugin.isGit ? '是' : '否'}</td>
                                            </tr>
                                            <tr>
                                                <th>本地修改</th>
                                                <td>${plugin.hasLocalChanges ? '<span class="text-warning">是</span>' : '否'}</td>
                                            </tr>
                                            <tr>
                                                <th>需要更新</th>
                                                <td>${plugin.needsPull ? '<span class="text-success">是</span>' : '否'}</td>
                                            </tr>
                                        </table>
                                    </div>
                                    <div class="col-md-6">
                                        <h5>Git信息</h5>
                                        ${plugin.isGit ? `
                                            <table class="table table-sm table-dark">
                                                <tr>
                                                    <th>远程URL</th>
                                                    <td class="text-break">${plugin.remoteUrl || '未知'}</td>
                                                </tr>
                                            </table>
                                        ` : ''}
                                    </div>
                                </div>
                                <hr>
                                <h5>依赖信息</h5>
                                ${plugin.hasPackageJson ? `
                                    <p>包含 package.json 文件。</p>
                                    <h6>依赖 (Dependencies):</h6>
                                    ${plugin.dependencies.length > 0 ? `<ul class="list-inline">${plugin.dependencies.map(dep => `<li class="list-inline-item"><span class="badge bg-secondary">${dep}</span></li>`).join('')}</ul>` : '<p class="text-muted">无生产依赖</p>'}
                                    <h6>开发依赖 (DevDependencies):</h6>
                                    ${plugin.devDependencies.length > 0 ? `<ul class="list-inline">${plugin.devDependencies.map(dep => `<li class="list-inline-item"><span class="badge bg-secondary">${dep}</span></li>`).join('')}</ul>` : '<p class="text-muted">无开发依赖</p>'}
                                    <button class="btn btn-sm btn-info install-deps-btn mt-2" data-plugin-id="${plugin.dirName}">
                                        <i class="bi bi-box me-1"></i>安装/更新依赖
                                    </button>
                                ` : '<p class="text-muted">未找到 package.json 文件</p>'}
                            </div>
                        </div>
                    `;
                    
                    // 设置模态框内容
                    pluginDetailsContent.innerHTML = detailsHtml;
                    
                    // 为模态框内的安装依赖按钮添加事件 (如果存在)
                    const modalInstallBtn = pluginDetailsContent.querySelector('.install-deps-btn');
                    if (modalInstallBtn) {
                        modalInstallBtn.addEventListener('click', handleInstallDeps);
                    }
                    
                    pluginDetailsModal.show();
                } else {
                    throw new Error(`找不到插件 ${pluginId}`);
                }
            } else {
                throw new Error(result.message || '获取插件列表失败');
            }
        } catch (error) {
            console.error('获取插件详情失败:', error);
            showToast('错误', `获取插件详情失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * 过滤插件列表
     */
    function filterPlugins() {
        const searchTerm = pluginSearch.value.toLowerCase();
        const pluginCards = pluginList.querySelectorAll('[data-plugin-search]');
        
        pluginCards.forEach(card => {
            const searchData = card.dataset.pluginSearch;
            if (searchData.includes(searchTerm)) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    }
    
    // ========== 事件绑定 ========== 
    
    // 安装表单提交
    installForm.addEventListener('submit', handleInstallPlugin);
    
    // 刷新按钮
    refreshBtn.addEventListener('click', loadPlugins);
    
    // 搜索框输入
    pluginSearch.addEventListener('input', filterPlugins);
    
    // 删除确认按钮
    confirmDeleteBtn.addEventListener('click', handleDeletePlugin);
    
    // ========== 初始化 ========== 
    
    // 页面加载时获取插件列表
    loadPlugins();
    
});
