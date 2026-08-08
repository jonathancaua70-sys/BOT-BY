const API_KEY = '10397bf287f1ef6ca101d3072df8ccf7d2b44eda59b829f538a38ee2e7462257';
const API_URL = '/api';

let currentUser = null;
let sessionStartTime = null;
let currentCategory = 'all';
let isDarkTheme = true;

// Adiciona classe à página de login
if (document.getElementById('loginForm')) {
    initLoginPage();
}

// Verifica se estamos na página de dashboard
if (document.getElementById('logoutBtn')) {
    initDashboardPage();
}

// Verifica se estamos na página de dashboard
if (document.getElementById('logoutBtn')) {
    initDashboardPage();
}

function initLoginPage() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const themeToggle = document.getElementById('themeToggle');
    
    // Remove qualquer sessão anterior ao entrar na página de login
    localStorage.removeItem('currentUser');
    localStorage.removeItem('loginTime');
    
    // Configura botão de tema
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Aplica tema salvo
    applyTheme();
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                localStorage.setItem('loginTime', new Date().toISOString());
                window.location.href = '/dashboard.html';
            } else {
                errorMessage.textContent = data.message;
                errorMessage.classList.add('show');
                setTimeout(() => {
                    errorMessage.classList.remove('show');
                }, 5000);
            }
        } catch (error) {
            errorMessage.textContent = 'Erro ao conectar com o servidor. Tente novamente.';
            errorMessage.classList.add('show');
            setTimeout(() => {
                errorMessage.classList.remove('show');
            }, 5000);
        }
    });
}

function initDashboardPage() {
    const savedUser = localStorage.getItem('currentUser');
    const loginTime = localStorage.getItem('loginTime');
    
    if (!savedUser) {
        window.location.href = '/login.html';
        return;
    }
    
    try {
        currentUser = JSON.parse(savedUser);
        sessionStartTime = new Date(loginTime);
        
        // Atualiza informações do usuário
        document.getElementById('userDisplay').textContent = currentUser.username;
        document.getElementById('loggedUser').textContent = currentUser.username;
        document.getElementById('lastLogin').textContent = formatDateTime(sessionStartTime);
        
        // Configura botão de logout
        document.getElementById('logoutBtn').addEventListener('click', logout);
        
        // Configura botão de tema
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }
        
        // Aplica tema salvo
        applyTheme();
        
        // Configura menu toggle
        setupSidebar();
        
        // Configura navegação por categorias
        setupCategoryNavigation();
        
        // Configura botão de refresh
        document.getElementById('refreshBtn').addEventListener('click', loadDashboardData);
        
        // Atualiza tempo de sessão a cada minuto
        updateSessionTime();
        setInterval(updateSessionTime, 60000);
        
        // Carrega dados do dashboard
        loadDashboardData();
        
        // Atualiza perfil do usuário
        updateUserProfile();
        
        // Inicia verificação automática a cada 5 segundos
        startAutoRefresh();
    } catch (error) {
        console.error('Erro ao parsear usuário:', error);
        logout();
    }
}

function setupSidebar() {
    const menuToggle = document.getElementById('menuToggle');
    const closeSidebar = document.getElementById('closeSidebar');
    const sidebar = document.getElementById('sidebar');
    
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
    
    if (closeSidebar) {
        closeSidebar.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });
    }
    
    // Fecha sidebar ao clicar fora dela (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });
}

function setupCategoryNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active de todos
            navItems.forEach(nav => nav.classList.remove('active'));
            
            // Adiciona active ao clicado
            item.classList.add('active');
            
            // Atualiza categoria atual
            currentCategory = item.dataset.category;
            
            // Atualiza título da seção
            const sectionTitle = document.getElementById('sectionTitle');
            const categoryName = item.querySelector('span').textContent;
            sectionTitle.textContent = categoryName;
            
            // Carrega conteúdo da categoria
            loadCategoryContent(currentCategory);
            
            // Se for categoria de status, carrega dados imediatamente
            if (currentCategory === 'status') {
                loadDashboardData();
            }
            
            // Fecha sidebar no mobile após seleção
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });
}

function loadCategoryContent(category) {
    const contentArea = document.getElementById('contentArea');
    
    console.log('Carregando categoria:', category);
    
    // Carrega dados reais para categorias específicas
    if (category === 'all') {
        loadUsersForCategory();
        return;
    }
    
    if (category === 'keys' || category === 'active-keys') {
        loadKeysForCategory();
        return;
    }
    
    if (category === 'status') {
        contentArea.innerHTML = `
            <div class="status-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Carregando status do sistema...</p>
            </div>
        `;
        loadDashboardData(); // Carrega status imediatamente
        return;
    }
    
    if (category === 'logs') {
        loadSystemLogs();
        return;
    }
    
    // Simulação de conteúdo para outras categorias
    const categoryContent = {
        'vip': `
            <div class="empty-state">
                <i class="fas fa-crown"></i>
                <p>Categoria VIP em desenvolvimento</p>
            </div>
        `,
        'active': `
            <div class="empty-state">
                <i class="fas fa-user-check"></i>
                <p>Categoria Usuários Ativos em desenvolvimento</p>
            </div>
        `,
        'recent': `
            <div class="empty-state">
                <i class="fas fa-clock"></i>
                <p>Categoria Usuários Recentes em desenvolvimento</p>
            </div>
        `,
        'logs': `
            <div class="status-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Carregando logs do sistema...</p>
            </div>
        `
    };
    
    contentArea.innerHTML = categoryContent[category] || '<p>Conteúdo em desenvolvimento...</p>';
}

async function loadUsersForCategory() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div class="status-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Carregando usuários...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_URL}/users`, {
            headers: { 'x-api-key': API_KEY }
        });
        const data = await response.json();
        
        if (data.success) {
            updateUsersList(data.users);
        } else {
            contentArea.innerHTML = '<p>Erro ao carregar usuários</p>';
        }
    } catch (error) {
        console.error('Erro ao carregar usuários:', error);
        contentArea.innerHTML = '<p>Erro ao carregar usuários</p>';
    }
}

async function loadKeysForCategory() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div class="status-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Carregando keys...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_URL}/keys`, {
            headers: { 'x-api-key': API_KEY }
        });
        const data = await response.json();
        
        if (data.success) {
            // Filtra keys baseado na categoria
            let filteredKeys = data.keys;
            if (currentCategory === 'active-keys') {
                filteredKeys = data.keys.filter(key => key.is_used === 0);
            }
            
            updateKeysList(filteredKeys);
        } else {
            contentArea.innerHTML = '<p>Erro ao carregar keys</p>';
        }
    } catch (error) {
        console.error('Erro ao carregar keys:', error);
        contentArea.innerHTML = '<p>Erro ao carregar keys</p>';
    }
}

async function loadSystemLogs() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div class="status-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Carregando logs do sistema...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_URL}/logs`, {
            headers: { 'x-api-key': API_KEY }
        });
        const data = await response.json();
        
        if (data.success) {
            updateSystemLogsDisplay(data.logs, data.systemInfo);
        } else {
            contentArea.innerHTML = '<p>Erro ao carregar logs</p>';
        }
    } catch (error) {
        console.error('Erro ao carregar logs:', error);
        contentArea.innerHTML = '<p>Erro ao carregar logs</p>';
    }
}

function updateSystemLogsDisplay(logs, systemInfo) {
    const contentArea = document.getElementById('contentArea');
    
    // Formata uptime
    const uptime = systemInfo.uptime;
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    
    let uptimeText;
    if (uptimeHours > 0) {
        uptimeText = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;
    } else if (uptimeMinutes > 0) {
        uptimeText = `${uptimeMinutes}m ${uptimeSeconds}s`;
    } else {
        uptimeText = `${uptimeSeconds}s`;
    }
    
    // Formata hora de início
    const startTime = new Date(systemInfo.startTime).toLocaleString('pt-BR');
    
    // Formata memória
    const memoryMB = systemInfo.memory.heapUsed;
    const memoryTotalMB = systemInfo.memory.heapTotal;
    
    // Formata CPU
    const cpuPercent = systemInfo.cpu.percent || 0;
    
    let logsHTML = `
        <div class="system-info-panel">
            <div class="info-header">
                <h3>Informações do Sistema</h3>
            </div>
            <div class="info-grid-system">
                <div class="info-item-system">
                    <i class="fas fa-power-off"></i>
                    <div>
                        <label>Hora de Início:</label>
                        <span>${startTime}</span>
                    </div>
                </div>
                <div class="info-item-system">
                    <i class="fas fa-clock"></i>
                    <div>
                        <label>Uptime Total:</label>
                        <span class="uptime-highlight">${uptimeText}</span>
                    </div>
                </div>
                <div class="info-item-system">
                    <i class="fas fa-server"></i>
                    <div>
                        <label>Versão Node:</label>
                        <span>${systemInfo.nodeVersion}</span>
                    </div>
                </div>
                <div class="info-item-system">
                    <i class="fas fa-laptop"></i>
                    <div>
                        <label>Plataforma:</label>
                        <span>${systemInfo.platform}</span>
                    </div>
                </div>
                <div class="info-item-system">
                    <i class="fas fa-memory"></i>
                    <div>
                        <label>Memória Usada:</label>
                        <span>${memoryMB}MB / ${memoryTotalMB}MB</span>
                    </div>
                </div>
                <div class="info-item-system">
                    <i class="fas fa-microchip"></i>
                    <div>
                        <label>CPU Total:</label>
                        <span class="cpu-percent">${cpuPercent}%</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="applications-panel">
            <div class="info-header">
                <h3>Aplicações em Execução</h3>
            </div>
            <div class="applications-grid">
    `;
    
    // Renderiza aplicações
    systemInfo.applications.forEach(app => {
        const appUptime = app.uptime;
        const appUptimeHours = Math.floor(appUptime / 3600);
        const appUptimeMinutes = Math.floor((appUptime % 3600) / 60);
        const appUptimeSeconds = Math.floor(appUptime % 60);
        
        let appUptimeText;
        if (appUptimeHours > 0) {
            appUptimeText = `${appUptimeHours}h ${appUptimeMinutes}m`;
        } else if (appUptimeMinutes > 0) {
            appUptimeText = `${appUptimeMinutes}m ${appUptimeSeconds}s`;
        } else {
            appUptimeText = `${appUptimeSeconds}s`;
        }
        
        const cpuPercent = app.cpu || 0;
        const memoryMB = app.memory || 0;
        const statusClass = app.status === 'running' || app.status === 'connected' || app.status === 'active' ? 'online' : 'offline';
        
        // Define o tipo de aplicação para estilo
        let appType = 'api';
        if (app.name.toLowerCase().includes('discord')) {
            appType = 'discord';
        } else if (app.name.toLowerCase().includes('database')) {
            appType = 'database';
        }
        
        logsHTML += `
            <div class="application-card app-type-${appType}">
                <div class="app-header">
                    <div class="app-icon">
                        <i class="fas fa-${getAppIcon(app.name)}"></i>
                    </div>
                    <div class="app-info">
                        <h4>${app.name}</h4>
                        <span class="app-status ${statusClass}">${app.status}</span>
                    </div>
                </div>
                <div class="app-metrics">
                    <div class="metric-item">
                        <i class="fas fa-clock"></i>
                        <div>
                            <label>Tempo Ligado:</label>
                            <span>${appUptimeText}</span>
                        </div>
                    </div>
                    <div class="metric-item">
                        <i class="fas fa-microchip"></i>
                        <div>
                            <label>CPU:</label>
                            <span class="cpu-percent-small">${cpuPercent}%</span>
                        </div>
                    </div>
                    <div class="metric-item">
                        <i class="fas fa-memory"></i>
                        <div>
                            <label>Memória:</label>
                            <span>${memoryMB}MB</span>
                        </div>
                    </div>
                </div>
                <div class="app-progress">
                    <div class="progress-bar">
                        <div class="progress-fill cpu-fill" style="width: ${Math.min(100, cpuPercent)}%"></div>
                    </div>
                </div>
            </div>
        `;
    });
    
    logsHTML += `
            </div>
        </div>
        
        <div class="logs-section">
            <div class="info-header">
                <h3>Logs do Sistema</h3>
                <span class="logs-count">${logs.length} entradas</span>
            </div>
            <div class="logs-container">
    `;
    
    if (logs.length === 0) {
        logsHTML += `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <p>Nenhum log disponível</p>
                </div>
            </div>
        </div>
        `;
    } else {
        logs.forEach(log => {
            const logTime = new Date(log.time).toLocaleTimeString('pt-BR');
            const logType = log.type;
            const logMessage = log.message;
            
            logsHTML += `
                <div class="log-item">
                    <span class="log-time">${logTime}</span>
                    <span class="log-type ${logType}">${logType.toUpperCase()}</span>
                    <span class="log-message">${logMessage}</span>
                </div>
            `;
        });
        
        logsHTML += `
            </div>
        </div>
        `;
    }
    
    contentArea.innerHTML = logsHTML;
}

function getAppIcon(appName) {
    if (appName.includes('API')) return 'server';
    if (appName.includes('Discord')) return 'robot';
    if (appName.includes('Database')) return 'database';
    return 'cog';
}

function logout() {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('loginTime');
    window.location.href = '/login.html';
}

function updateSessionTime() {
    if (!sessionStartTime) return;
    
    const now = new Date();
    const diff = Math.floor((now - sessionStartTime) / 1000 / 60); // minutos
    
    const timeElement = document.getElementById('sessionTime');
    const profileSessionTime = document.getElementById('profileSessionTime');
    
    if (timeElement) {
        if (diff < 60) {
            timeElement.textContent = `${diff} minuto${diff !== 1 ? 's' : ''}`;
        } else {
            const hours = Math.floor(diff / 60);
            const minutes = diff % 60;
            timeElement.textContent = `${hours} hora${hours !== 1 ? 's' : ''} e ${minutes} minuto${minutes !== 1 ? 's' : ''}`;
        }
    }
    
    if (profileSessionTime) {
        if (diff < 60) {
            profileSessionTime.textContent = `${diff} min`;
        } else {
            const hours = Math.floor(diff / 60);
            const minutes = diff % 60;
            profileSessionTime.textContent = `${hours}h ${minutes}min`;
        }
    }
}

function updateUserProfile() {
    if (!currentUser) return;
    
    // Atualiza nome do usuário
    const profileUsername = document.getElementById('profileUsername');
    if (profileUsername) {
        profileUsername.textContent = currentUser.username;
    }
    
    // Gera avatar baseado no nome do usuário (como não temos avatar real do usuário do painel)
    const userAvatar = document.getElementById('userAvatar');
    if (userAvatar) {
        // Usa avatar padrão do Discord baseado no primeiro caractere do nome
        const avatarIndex = currentUser.username.charCodeAt(0) % 5;
        userAvatar.src = `https://cdn.discordapp.com/embed/avatars/${avatarIndex}.png`;
    }
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function loadDashboardData() {
    try {
        // Tenta buscar status da API
        const statusResponse = await fetch(`${API_URL}/status`);
        const statusData = await statusResponse.json();
        
        if (statusData.online) {
            // Busca usuários reais do banco
            const usersResponse = await fetch(`${API_URL}/users`, {
                headers: { 'x-api-key': API_KEY }
            });
            const usersData = await usersResponse.json();
            
            // Busca keys reais do banco
            const keysResponse = await fetch(`${API_URL}/keys`, {
                headers: { 'x-api-key': API_KEY }
            });
            const keysData = await keysResponse.json();
            
            // Atualiza contadores com dados reais
            const userCount = usersData.success ? usersData.total : 0;
            const keyCount = keysData.success ? keysData.total : 0;
            const activeKeysCount = keysData.success ? keysData.keys.filter(k => k.is_used === 0).length : 0;
            
            document.getElementById('userCount').textContent = userCount;
            document.getElementById('keyCount').textContent = keyCount;
            
            // Atualiza contadores na sidebar
            if (document.getElementById('countAll')) document.getElementById('countAll').textContent = userCount;
            if (document.getElementById('countVip')) document.getElementById('countVip').textContent = '0'; // VIP pode ser implementado depois
            if (document.getElementById('countActive')) document.getElementById('countActive').textContent = userCount;
            if (document.getElementById('countRecent')) document.getElementById('countRecent').textContent = userCount;
            if (document.getElementById('countKeys')) document.getElementById('countKeys').textContent = keyCount;
            if (document.getElementById('countActiveKeys')) document.getElementById('countActiveKeys').textContent = activeKeysCount;
            
            // Atualiza status do sistema se estiver visível
            updateSystemStatus(statusData);
        }
    } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
        document.getElementById('userCount').textContent = 'Erro';
        document.getElementById('keyCount').textContent = 'Erro';
    }
}

function updateUsersList(users) {
    const contentArea = document.getElementById('contentArea');
    
    if (users.length === 0) {
        contentArea.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>Nenhum usuário cadastrado</p>
            </div>
        `;
        return;
    }
    
    let usersHTML = '<div class="user-list">';
    users.forEach(user => {
        const createdAt = new Date(user.created_at).toLocaleString('pt-BR');
        const creatorAvatar = user.creator_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const userAvatar = user.user_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const creatorRole = user.creator_role || 'member';
        
        usersHTML += `
            <div class="user-item">
                <div class="user-avatar">
                    <img src="${userAvatar}" alt="${user.username}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                </div>
                <div class="user-info">
                    <h4>${user.username}</h4>
                    <p>Criado por: ${user.created_by || 'Sistema'}</p>
                    <p>Criado em: ${createdAt}</p>
                </div>
                <div class="user-creator">
                    <img src="${creatorAvatar}" alt="Criador" class="creator-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                    <span class="user-role ${creatorRole}">${creatorRole}</span>
                </div>
                <div class="user-actions">
                    <span class="user-id">ID: ${user.id}</span>
                </div>
            </div>
        `;
    });
    usersHTML += '</div>';
    
    contentArea.innerHTML = usersHTML;
}

function updateKeysList(keys) {
    const contentArea = document.getElementById('contentArea');
    
    if (keys.length === 0) {
        contentArea.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-key"></i>
                <p>Nenhuma key cadastrada</p>
            </div>
        `;
        return;
    }
    
    let keysHTML = '<div class="keys-list">';
    keys.forEach(key => {
        const createdAt = new Date(key.created_at).toLocaleString('pt-BR');
        const isUsed = key.is_used === 1;
        const statusBadge = isUsed ? 'inactive' : 'active';
        const statusText = isUsed ? 'Usada' : 'Ativa';
        const usedBy = key.used_by || 'N/A';
        const usedAt = key.used_at ? new Date(key.used_at).toLocaleString('pt-BR') : 'N/A';
        
        keysHTML += `
            <div class="key-item">
                <div class="key-info">
                    <h4>${key.key_value}</h4>
                    <p>Criada em: ${createdAt}</p>
                    ${isUsed ? `<p>Usada por: ${usedBy}</p>` : ''}
                    ${isUsed ? `<p>Usada em: ${usedAt}</p>` : ''}
                </div>
                <div class="key-status">
                    <span class="status-badge ${statusBadge}">${statusText}</span>
                </div>
            </div>
        `;
    });
    keysHTML += '</div>';
    
    contentArea.innerHTML = keysHTML;
}

function updateSystemStatus(statusData) {
    const contentArea = document.getElementById('contentArea');
    
    // Verifica se estamos na categoria de status
    if (currentCategory === 'status') {
        const dbPing = statusData.database?.ping || 0;
        const dbStatus = statusData.database?.status || 'offline';
        const botUptime = statusData.bot?.uptime || 0;
        const systemUptime = statusData.uptime || 0;
        const cpuPercent = statusData.system?.cpu?.percent || 0;
        const memoryUsed = statusData.system?.memory?.heapUsed || 0;
        const memoryTotal = statusData.system?.memory?.heapTotal || 0;
        
        const uptimeHours = Math.floor(systemUptime / 3600);
        const uptimeMinutes = Math.floor((systemUptime % 3600) / 60);
        const uptimeSeconds = Math.floor(systemUptime % 60);
        
        const uptimeText = uptimeHours > 0 
            ? `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`
            : `${uptimeMinutes}m ${uptimeSeconds}s`;
        
        contentArea.innerHTML = `
            <div class="status-container">
                <div class="status-item ${dbStatus}">
                    <div class="status-icon">
                        <i class="fas fa-database"></i>
                    </div>
                    <div class="status-details">
                        <h4>Banco de Dados</h4>
                        <p class="status-message">${statusData.database?.message || 'Desconhecido'}</p>
                        <div class="status-meta">
                            <span class="ping-indicator">
                                <i class="fas fa-clock"></i> Ping: ${dbPing}ms
                            </span>
                            <span class="host-info">
                                ${statusData.database?.host}:${statusData.database?.port}
                            </span>
                        </div>
                    </div>
                    <div class="status-indicator ${dbStatus}">
                        <span class="status-dot"></span>
                        <span class="status-text">${dbStatus === 'online' ? 'Online' : 'Offline'}</span>
                    </div>
                </div>
                
                <div class="status-item online">
                    <div class="status-icon">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="status-details">
                        <h4>Bot Discord</h4>
                        <p class="status-message">${statusData.bot?.username || 'Desconhecido'}</p>
                        <div class="status-meta">
                            <span class="uptime-indicator">
                                <i class="fas fa-clock"></i> Uptime: ${uptimeText}
                            </span>
                        </div>
                    </div>
                    <div class="status-indicator online">
                        <span class="status-dot"></span>
                        <span class="status-text">Online</span>
                    </div>
                </div>
                
                <div class="status-item online">
                    <div class="status-icon">
                        <i class="fas fa-server"></i>
                    </div>
                    <div class="status-details">
                        <h4>Servidor API</h4>
                        <p class="status-message">Sistema operacional</p>
                        <div class="status-meta">
                            <span class="cpu-indicator">
                                <i class="fas fa-microchip"></i> CPU: ${cpuPercent}%
                            </span>
                            <span class="memory-indicator">
                                <i class="fas fa-memory"></i> Mem: ${memoryUsed}MB/${memoryTotal}MB
                            </span>
                        </div>
                    </div>
                    <div class="status-indicator online">
                        <span class="status-dot"></span>
                        <span class="status-text">Online</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Inicia verificação automática a cada 5 segundos
function startAutoRefresh() {
    // Verifica status a cada 5 segundos
    setInterval(async () => {
        try {
            const statusResponse = await fetch(`${API_URL}/status`);
            const statusData = await statusResponse.json();
            
            if (statusData.online) {
                updateSystemStatus(statusData);
                
                // Atualiza logs se estiver na categoria de logs
                if (currentCategory === 'logs') {
                    loadSystemLogs();
                }
            }
        } catch (error) {
            console.error('Erro ao verificar status:', error);
        }
    }, 5000);
}

// Funções de tema
function initializeTheme() {
    // Carrega tema salvo
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        isDarkTheme = false;
        applyTheme();
    }
    
    // Configura botões de toggle
    const loginThemeToggle = document.getElementById('themeToggle');
    const dashboardThemeToggle = document.getElementById('themeToggle');
    
    if (loginThemeToggle) {
        loginThemeToggle.addEventListener('click', toggleTheme);
    }
    
    if (dashboardThemeToggle) {
        dashboardThemeToggle.addEventListener('click', toggleTheme);
    }
}

function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
    applyTheme();
}

function applyTheme() {
    const loginContainer = document.querySelector('.login-container');
    const dashboardContainer = document.querySelector('.dashboard-container');
    const themeButtons = document.querySelectorAll('.theme-toggle-btn');
    
    // Aplica tema na página de login
    if (loginContainer) {
        if (isDarkTheme) {
            loginContainer.classList.remove('light-theme');
        } else {
            loginContainer.classList.add('light-theme');
        }
    }
    
    // Aplica tema na página de dashboard
    if (dashboardContainer) {
        if (isDarkTheme) {
            dashboardContainer.classList.remove('light-theme');
        } else {
            dashboardContainer.classList.add('light-theme');
        }
    }
    
    // Atualiza botões
    themeButtons.forEach(btn => {
        const icon = btn.querySelector('i');
        const text = btn.querySelector('span');
        
        if (isDarkTheme) {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
            text.textContent = 'Dark';
            btn.classList.remove('light');
        } else {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
            text.textContent = 'Light';
            btn.classList.add('light');
        }
    });
}
