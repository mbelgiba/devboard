// === СОСТОЯНИЕ ПРИЛОЖЕНИЯ ===
let currentAuthSource = null; 
let currentLang = 'ru';
let currentPeriod = 'month';
let currentMode = 'line';
let activeChartData = { labels: [], points: [] }; 
let jwtToken = '';
let heatmapData = Array.from({length: 365}, () => Math.random() > 0.7 ? Math.floor(Math.random() * 4) : 0);

// Хранилище реальных данных
let realStats = { xp: 0, up: 0, down: 0, repos: 0, languages: [], skills: [] };

// === ПЛАН 4: ОБЛАЧНАЯ БАЗА (Firebase / LocalStorage) ===
const Cloud = {
    init() {
        // Если у тебя есть ключи Firebase, вставь их сюда. 
        // Иначе система умно продолжит использовать LocalStorage
        const firebaseConfig = { /* apiKey: "ТВОЙ_КЛЮЧ", projectId: "ТВОЙ_ID" */ };
        
        try {
            if(Object.keys(firebaseConfig).length > 0 && window.firebase) {
                firebase.initializeApp(firebaseConfig);
                this.db = firebase.firestore();
                console.log("Firebase Connected");
            } else {
                this.db = null; // Фолбэк на localStorage
            }
        } catch(e) { this.db = null; }
    },
    async saveNote(text) {
        if(this.db && currentAuthSource) {
            const user = document.getElementById('user-display-name').innerText;
            await this.db.collection("users").doc(user).set({ notes: text }, { merge: true });
        } else {
            localStorage.setItem('devboard_notes', text);
        }
    },
    async loadNote() {
        if(this.db && currentAuthSource) {
            const user = document.getElementById('user-display-name').innerText;
            const doc = await this.db.collection("users").doc(user).get();
            return doc.exists ? doc.data().notes : "";
        } else {
            return localStorage.getItem('devboard_notes') || "";
        }
    }
};

const githubMockData = {
    week: { labels: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'], points: [12, 19, 3, 5, 2, 3, 9], xp: '1.2k' },
    month: { labels: ['Нед 1','Нед 2','Нед 3','Нед 4'], points: [65, 59, 80, 81], xp: '8.4k' },
    year: { labels: ['Q1','Q2','Q3','Q4'], points: [300, 450, 320, 600], xp: '24.5k' }
};

// === МУЛЬТИЯЗЫЧНОСТЬ ===
function setLang(lang) {
    currentLang = lang;
    document.getElementById('lang-ru').classList.toggle('active', lang === 'ru');
    document.getElementById('lang-en').classList.toggle('active', lang === 'en');
    document.querySelectorAll('[data-ru]').forEach(el => { el.innerText = el.getAttribute(`data-${lang}`); });
    if(currentAuthSource) updateDashboardLabels();
}

function switchLoginTab(tab) {
    document.getElementById('tab-github').classList.toggle('active', tab === 'github');
    document.getElementById('tab-01edu').classList.toggle('active', tab === '01edu');
    document.getElementById('form-github').classList.toggle('hidden', tab !== 'github');
    document.getElementById('form-01edu').classList.toggle('hidden', tab !== '01edu');
    document.getElementById('login-error').style.display = 'none';
}

function logout() {
    currentAuthSource = null; jwtToken = '';
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('edu-pass').value = '';
}

function animateStat(id, endValueStr) {
    const el = document.getElementById(id);
    if(!el) return;
    const isK = String(endValueStr).includes('k');
    const endVal = parseFloat(endValueStr) || 0;
    const startVal = parseFloat(el.innerText) || 0;
    let startTime = null;

    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / 1000, 1);
        const easeOut = 1 - Math.pow(1 - progress, 4);
        let currentVal = startVal + (endVal - startVal) * easeOut;
        if (isK) el.innerText = currentVal.toFixed(1) + 'k';
        else el.innerText = Math.floor(currentVal);
        if (progress < 1) window.requestAnimationFrame(step);
        else el.innerText = endValueStr;
    }
    window.requestAnimationFrame(step);
}

// === GITHUB API (План 1: Сбор реальных языков) ===
async function loginGithub() {
    const username = document.getElementById('gh-username').value.trim();
    const btn = document.querySelector('#form-github button');
    const err = document.getElementById('login-error');
    btn.innerText = "ЗАГРУЗКА..."; err.style.display = 'none';

    try {
        const res = await fetch(`https://api.github.com/users/${username}`);
        if (!res.ok) throw new Error('Not found');
        const user = await res.json();

        currentAuthSource = 'github';
        document.getElementById('profile-link').href = user.html_url;
        document.getElementById('profile-action-text').innerText = "🔗 GitHub Account";

        // План 1: Анализируем языки программирования из 100 репозиториев
        const repoRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`);
        const repos = await repoRes.json();
        
        let langCounts = {};
        let totalLangs = 0;
        repos.forEach(r => {
            if(r.language) { langCounts[r.language] = (langCounts[r.language] || 0) + 1; totalLangs++; }
        });
        
        // Превращаем в массив процентов для Пирога
        realStats.languages = Object.entries(langCounts)
            .map(([name, count]) => ({ name, val: Math.round((count/totalLangs)*100) }))
            .sort((a,b) => b.val - a.val).slice(0, 5); // Топ 5 языков

        realStats.repos = user.public_repos;
        realStats.xp = parseFloat(githubMockData.month.xp) * 1000;

        setupDashboardForSource(user, false, repos);
        document.getElementById('login-screen').classList.add('hidden');
        btn.innerText = "ВОЙТИ";
    } catch (e) {
        btn.innerText = "ВОЙТИ"; err.style.display = 'block';
    }
}

// === 01EDU GRAPHQL API ===
async function login01edu() {
    const login = document.getElementById('edu-login').value.trim();
    const pass = document.getElementById('edu-pass').value;
    const err = document.getElementById('login-error');
    if(!login || !pass) return;
    const credentials = btoa(`${login}:${pass}`);

    try {
        const res = await fetch('https://01yessenov.yu.edu.kz/api/auth/signin', {
            method: 'POST', headers: { 'Authorization': `Basic ${credentials}` }
        });
        if (!res.ok) throw new Error('Auth failed');
        const data = await res.json(); 
        jwtToken = typeof data === 'string' ? data : data.token;
        currentAuthSource = '01edu';
        document.getElementById('profile-link').href = `https://01yessenov.yu.edu.kz/profile/${login}`;
        document.getElementById('profile-action-text').innerText = "🔗 01edu Profile";

        fetch01eduData();
        document.getElementById('login-screen').classList.add('hidden');
    } catch (e) {
        console.warn("API failed, loading Mock 01edu data");
        currentAuthSource = '01edu';
        document.getElementById('profile-link').href = "#";
        document.getElementById('profile-action-text').innerText = "🔗 Local Profile";
        setupDashboardForSource({ login: login || 'Student_01' }, true);
        document.getElementById('login-screen').classList.add('hidden');
    }
}

async function fetch01eduData() {
    const query = `{
        user { login }
        transaction(where: {type: {_in: ["xp", "up", "down"]}}, order_by: {createdAt: asc}) { type amount createdAt path }
    }`;
    try {
        const res = await fetch('https://01yessenov.yu.edu.kz/api/graphql-engine/v1/graphql', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}` },
            body: JSON.stringify({ query })
        });
        const json = await res.json();
        setupDashboardForSource(json.data.user[0], false, json.data.transaction);
    } catch(e) { console.error(e); }
}

// === НАСТРОЙКА ИНТЕРФЕЙСА ===
async function setupDashboardForSource(user, isMockEdu = false, transactions = []) {
    document.getElementById('user-display-name').innerText = user.name || user.login;
    if(user.avatar_url) { document.getElementById('avatar-img').src = user.avatar_url; document.getElementById('avatar-img').classList.remove('hidden'); } 
    else { document.getElementById('avatar-img').classList.add('hidden'); }

    const mainChartBox = document.getElementById('main-chart-box');
    const auditChartBox = document.getElementById('audit-chart-box');
    const filters = document.getElementById('period-filters');

    if(currentAuthSource === 'github') {
        mainChartBox.style.gridColumn = "span 3";
        auditChartBox.classList.add('hidden');
        filters.classList.remove('hidden');
        
        animateStat('stat-1-val', user.public_repos);
        animateStat('stat-2-val', user.followers);
        activeChartData = githubMockData[currentPeriod];
        animateStat('stat-3-val', activeChartData.xp);

        // Список репозиториев
        document.getElementById('repo-list').innerHTML = transactions.slice(0,5).map(r => `<div class="list-item"><span>${r.name}</span><span style="color:var(--accent)">${r.language || 'Code'}</span></div>`).join('');

    } else if (currentAuthSource === '01edu') {
        mainChartBox.style.gridColumn = "span 2"; 
        auditChartBox.classList.remove('hidden');
        filters.classList.add('hidden'); 

        let up = 0, down = 0, xp = 0;
        let xpData = { labels: [], points: [] };
        let recentProjectsHTML = "";
        
        // План 1: Распределяем реальные навыки (Радар)
        let skillScores = { "Go": 10, "JS/Web": 10, "Algo": 10, "System": 10, "DB": 10, "DevOps": 10 };

        if(isMockEdu) {
            up = 18000; down = 12000; xp = 45000;
            xpData = { labels: ['Jan','Feb','Mar','Apr','May'], points: [5000, 12000, 25000, 38000, 45000] };
            recentProjectsHTML = `<div class="list-item"><span>/piscine-go/quest-01</span><span style="color:var(--accent)">14 Jan</span></div>`;
            realStats.skills = [ {name:"Go", val:90}, {name:"Web", val:40}, {name:"Algo", val:75}, {name:"Sys", val:50}, {name:"DB", val:30}, {name:"DevOps", val:20} ];
        } else {
            let xpTransactions = [];
            transactions.forEach(t => {
                if(t.type === 'up') up += t.amount;
                if(t.type === 'down') down += t.amount;
                if(t.type === 'xp' && !t.path.includes('piscine')) {
                    xp += t.amount;
                    xpData.labels.push(new Date(t.createdAt).toLocaleDateString());
                    xpData.points.push(xp);
                    xpTransactions.push(t);
                    
                    // Парсим навыки из пути
                    let p = t.path.toLowerCase();
                    if(p.includes('go')) skillScores["Go"] += 5;
                    if(p.includes('js') || p.includes('graphql')) skillScores["JS/Web"] += 5;
                    if(p.includes('math') || p.includes('sort')) skillScores["Algo"] += 5;
                    if(p.includes('docker') || p.includes('net')) skillScores["DevOps"] += 5;
                    if(p.includes('forum') || p.includes('sql')) skillScores["DB"] += 5;
                }
            });
            
            xpTransactions.reverse().slice(0, 5).forEach(t => {
                let shortPath = t.path.split('/').pop() || t.path; 
                let date = new Date(t.createdAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
                recentProjectsHTML += `<div class="list-item"><span>${shortPath}</span><span style="color:var(--accent)">${date}</span></div>`;
            });
            
            // Сохраняем в глобальный стейт, чтобы отрисовать Радар (Макс 100)
            realStats.skills = Object.keys(skillScores).map(k => ({ name: k, val: Math.min(skillScores[k], 100) }));
        }

        realStats.xp = xp; realStats.up = up; realStats.down = down;

        document.getElementById('repo-list').innerHTML = recentProjectsHTML;
        let ratio = down === 0 ? up : (up / down);
        document.getElementById('stat-1-val').innerText = ratio.toFixed(2);
        document.getElementById('stat-1-val').style.color = ratio >= 1 ? '#00ff41' : '#ff003c';
        document.getElementById('stat-2-val').innerText = Math.floor(Math.sqrt(xp / 1000)); 
        animateStat('stat-3-val', (xp/1000).toFixed(1) + 'k');

        activeChartData = xpData;
        drawAuditChart(up, down);
    }

    updateDashboardLabels();
    drawChart();
    drawHeatmap();
    
    // План 3: Проверка достижений на основе реальных данных
    checkAchievements();
    
    // План 4: Загрузка заметок из облака
    Cloud.init();
    document.getElementById('notes').value = await Cloud.loadNote();
}

function updateDashboardLabels() {
    const isRu = currentLang === 'ru';
    if(currentAuthSource === 'github') {
        document.getElementById('stat-1-label').innerText = isRu ? "РЕПОЗИТОРИЕВ" : "REPOSITORIES";
        document.getElementById('stat-2-label').innerText = isRu ? "ПОДПИСЧИКОВ" : "FOLLOWERS";
        document.getElementById('stat-3-label').innerText = isRu ? "ЛОКАЛЬНЫЙ XP" : "LOCAL XP";
        document.getElementById('chart-title').innerText = isRu ? "АКТИВНОСТЬ (КОММИТЫ)" : "ACTIVITY (COMMITS)";
        document.getElementById('last-activity-title').innerText = isRu ? "ПОСЛЕДНИЕ ПРОЕКТЫ" : "RECENT PROJECTS";
    } else {
        document.getElementById('stat-1-label').innerText = isRu ? "AUDIT RATIO" : "AUDIT RATIO";
        document.getElementById('stat-2-label').innerText = isRu ? "УРОВЕНЬ" : "LEVEL";
        document.getElementById('stat-3-label').innerText = isRu ? "ОБЩИЙ XP" : "TOTAL XP";
        document.getElementById('chart-title').innerText = isRu ? "ПРОГРЕСС XP ВО ВРЕМЕНИ" : "XP PROGRESS OVER TIME";
        document.getElementById('last-activity-title').innerText = isRu ? "LAST ACTIVITY (ПРОЕКТЫ)" : "LAST ACTIVITY (PROJECTS)";
    }
}

// === НАВИГАЦИЯ & СМЕНА ТЕМ ===
function switchPage(page) {
    document.querySelectorAll('.page-container').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-' + page).classList.remove('hidden');
    event.currentTarget.classList.add('active');

    // Рендер графиков при открытии
    if(page === 'categories') { drawRadar(); drawPie(); }
    if(page === 'achievements') renderBadges();
}

function setTheme(themeName, btnElement) {
    document.body.className = `theme-${themeName}`;
    const btns = btnElement.parentElement.querySelectorAll('.btn');
    btns.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    setTimeout(() => { 
        drawChart(); if(currentAuthSource === '01edu') drawAuditChart(realStats.up, realStats.down); 
        drawRadar(); drawPie(); drawHeatmap();
    }, 50); 
}

function updateData(period, btn) {
    if(currentAuthSource !== 'github') return;
    currentPeriod = period;
    btn.parentElement.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeChartData = githubMockData[period];
    animateStat('stat-3-val', activeChartData.xp);
    drawChart();
}

document.getElementById('toggleMode').onclick = function() {
    currentMode = currentMode === 'line' ? 'bar' : 'line';
    this.innerText = (currentLang === 'ru' ? "ВИД: " : "VIEW: ") + (currentMode === 'line' ? (currentLang==='ru'?'ЛИНИЯ':'LINE') : (currentLang==='ru'?'СТОЛБЦЫ':'BARS'));
    drawChart();
};

// === ОТРИСОВКА ГЛАВНОГО ГРАФИКА ===
function drawChart() {
    const svg = document.getElementById('svg-chart');
    const tooltip = document.getElementById('tooltip');
    svg.innerHTML = '';
    const data = activeChartData;
    if(!data.points || data.points.length === 0) return;

    const w = svg.clientWidth || 600, h = svg.clientHeight || 260, px = 40, py = 40;
    const max = Math.max(...data.points) || 1;
    const accentColor = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.6"/><stop offset="100%" stop-color="${accentColor}" stop-opacity="0.0"/>
    </linearGradient>`;
    svg.appendChild(defs);

    if (currentMode === 'line') {
        let pts = data.points.map((v, i) => ({ x: px + (i * ((w - px*2) / (data.points.length > 1 ? data.points.length - 1 : 1))), y: (h - py) - ((v / max) * (h - py*2)) }));
        let pathStr = `M ${pts[0].x},${pts[0].y} `;
        for (let i = 1; i < pts.length; i++) { let cpX = (pts[i-1].x + pts[i].x) / 2; pathStr += `C ${cpX},${pts[i-1].y} ${cpX},${pts[i].y} ${pts[i].x},${pts[i].y} `; }

        let areaStr = pathStr + `L ${pts[pts.length-1].x},${h-py} L ${pts[0].x},${h-py} Z`;
        const area = document.createElementNS("http://www.w3.org/2000/svg", "path"); area.setAttribute("d", areaStr); area.setAttribute("fill", "url(#areaGrad)"); svg.appendChild(area);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path"); line.setAttribute("d", pathStr); line.setAttribute("stroke", accentColor); line.setAttribute("stroke-width", 3); line.setAttribute("fill", "none"); line.style.filter = `drop-shadow(0px 0px 8px ${accentColor})`; svg.appendChild(line);

        pts.forEach((pt, i) => {
            const zone = document.createElementNS("http://www.w3.org/2000/svg", "rect"); let segmentW = (w - px*2) / (pts.length > 1 ? pts.length - 1 : 1);
            zone.setAttribute("x", pt.x - segmentW/2); zone.setAttribute("y", 0); zone.setAttribute("width", segmentW); zone.setAttribute("height", h); zone.setAttribute("fill", "transparent"); zone.style.cursor = "crosshair";
            zone.onmouseover = () => { tooltip.style.opacity = 1; tooltip.innerHTML = `<span style="color:${accentColor};">${data.labels[i]}</span><br/>Значение: <b>${data.points[i]}</b>`; };
            zone.onmousemove = (e) => { tooltip.style.left = e.pageX+15+'px'; tooltip.style.top = e.pageY-30+'px'; };
            zone.onmouseout = () => tooltip.style.opacity = 0; svg.appendChild(zone);
        });
    } else {
        const barW = (w - px*2) / data.points.length - 10;
        data.points.forEach((v, i) => {
            const x = px + (i * ((w - px*2) / data.points.length)) + 5; const barH = (v / max) * (h - py*2);
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", x); rect.setAttribute("y", h - py); rect.setAttribute("width", barW); rect.setAttribute("height", 0); rect.setAttribute("fill", accentColor); 
            setTimeout(() => { rect.setAttribute("y", (h - py) - barH); rect.setAttribute("height", barH || 1); }, 50);
            rect.onmouseover = () => { rect.style.opacity = 0.7; tooltip.style.opacity = 1; tooltip.innerHTML = `<span style="color:${accentColor};">${data.labels[i]}</span><br/>Значение: <b>${v}</b>`; };
            rect.onmousemove = (e) => { tooltip.style.left = e.pageX+15+'px'; tooltip.style.top = e.pageY-30+'px'; };
            rect.onmouseout = () => { rect.style.opacity = 1; tooltip.style.opacity = 0; }; svg.appendChild(rect);
        });
    }
}

// === КРУГОВОЙ ГРАФИК АУДИТОВ ===
function drawAuditChart(up, down) {
    const svg = document.getElementById('chart-audits'); svg.innerHTML = '';
    const size = 200, cx = size / 2, cy = size / 2 - 10; 
    const strokeW = 12, radiusUp = 75, radiusDown = 55, maxVal = Math.max(up, down) || 1;
    const circUp = 2 * Math.PI * radiusUp, circDown = 2 * Math.PI * radiusDown;
    const upFill = (up / maxVal) * circUp, downFill = (down / maxVal) * circDown;

    const createRing = (r, color, maxCirc, fillAmount) => {
        const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        track.setAttribute("cx", cx); track.setAttribute("cy", cy); track.setAttribute("r", r); track.setAttribute("fill", "none"); track.setAttribute("stroke", "rgba(255,255,255,0.05)"); track.setAttribute("stroke-width", strokeW); svg.appendChild(track);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r); circle.setAttribute("fill", "none"); circle.setAttribute("stroke", color); circle.setAttribute("stroke-width", strokeW); circle.setAttribute("stroke-linecap", "round"); 
        circle.setAttribute("stroke-dasharray", maxCirc); circle.setAttribute("stroke-dashoffset", maxCirc); circle.style.transition = "stroke-dashoffset 1.5s ease-out"; circle.style.filter = `drop-shadow(0px 0px 5px ${color})`; circle.style.transformOrigin = "center"; circle.style.transform = "rotate(-90deg)";
        setTimeout(() => { circle.setAttribute("stroke-dashoffset", maxCirc - fillAmount); }, 100); svg.appendChild(circle);
    };

    createRing(radiusUp, "#00ff41", circUp, upFill); createRing(radiusDown, "#ff003c", circDown, downFill);

    let ratio = down === 0 ? (up/1000).toFixed(1) : (up / down).toFixed(2);
    const ratioText = document.createElementNS("http://www.w3.org/2000/svg", "text"); ratioText.setAttribute("x", cx); ratioText.setAttribute("y", cy + 8); ratioText.setAttribute("fill", ratio >= 1 ? "#00ff41" : "#ff003c"); ratioText.setAttribute("font-size", "26"); ratioText.setAttribute("font-weight", "900"); ratioText.setAttribute("text-anchor", "middle"); ratioText.textContent = ratio; ratioText.style.filter = `drop-shadow(0px 0px 8px ${ratio >= 1 ? "#00ff41" : "#ff003c"})`; svg.appendChild(ratioText);

    const labelText = document.createElementNS("http://www.w3.org/2000/svg", "text"); labelText.setAttribute("x", cx); labelText.setAttribute("y", cy + 25); labelText.setAttribute("fill", "var(--text-muted)"); labelText.setAttribute("font-size", "10"); labelText.setAttribute("font-weight", "bold"); labelText.setAttribute("text-anchor", "middle"); labelText.textContent = "RATIO"; svg.appendChild(labelText);

    const addLegend = (x, y, color, label, valStr) => {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); dot.setAttribute("cx", x); dot.setAttribute("cy", y - 3); dot.setAttribute("r", 4); dot.setAttribute("fill", color); dot.style.filter = `drop-shadow(0px 0px 3px ${color})`;
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text"); txt.setAttribute("x", x + 10); txt.setAttribute("y", y); txt.setAttribute("fill", "#fff"); txt.setAttribute("font-size", "11"); txt.textContent = `${label} (${valStr})`; svg.appendChild(dot); svg.appendChild(txt);
    };

    addLegend(15, size - 10, "#00ff41", "Done", (up / 1000).toFixed(1) + "kB"); addLegend(110, size - 10, "#ff003c", "Received", (down / 1000).toFixed(1) + "kB");
}

// === ПЛАН 1: РЕАЛЬНЫЕ ДАННЫЕ РАДАРА ===
function drawRadar() {
    const svg = document.getElementById('chart-radar'); svg.innerHTML = '';
    // Если реальных скиллов нет, ставим демо
    const skills = realStats.skills.length > 0 ? realStats.skills : [
        { name: "Algorithms", val: 80 }, { name: "Golang", val: 90 }, { name: "Web/JS", val: 60 },
        { name: "DevOps", val: 40 }, { name: "Systems", val: 70 }, { name: "Databases", val: 50 }
    ];
    const cx = 150, cy = 150, radius = 100, color = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    
    for(let level=1; level<=5; level++) {
        const r = radius * (level/5); let path = "";
        skills.forEach((_, i) => { const angle = (Math.PI * 2 * i / skills.length) - Math.PI/2; path += `${i===0?'M':'L'} ${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} `; });
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "path"); poly.setAttribute("d", path + "Z"); poly.setAttribute("fill", "none"); poly.setAttribute("stroke", "rgba(255,255,255,0.1)"); svg.appendChild(poly);
    }

    let valPath = "";
    skills.forEach((s, i) => {
        const angle = (Math.PI * 2 * i / skills.length) - Math.PI/2; const r = radius * (s.val/100); const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle); valPath += `${i===0?'M':'L'} ${x},${y} `;
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text"); txt.setAttribute("x", cx + (radius+25) * Math.cos(angle)); txt.setAttribute("y", cy + (radius+15) * Math.sin(angle)); txt.setAttribute("fill", "var(--text-muted)"); txt.setAttribute("text-anchor", "middle"); txt.setAttribute("font-size", "12"); txt.textContent = s.name; svg.appendChild(txt);
    });
    
    const dataPoly = document.createElementNS("http://www.w3.org/2000/svg", "path"); dataPoly.setAttribute("d", valPath + "Z"); dataPoly.setAttribute("fill", color); dataPoly.setAttribute("fill-opacity", "0.4"); dataPoly.setAttribute("stroke", color); dataPoly.setAttribute("stroke-width", "2"); dataPoly.style.filter = `drop-shadow(0 0 10px ${color})`; svg.appendChild(dataPoly);
}

// === ПЛАН 1: РЕАЛЬНЫЕ ДАННЫЕ PIE CHART ===
function drawPie() {
    const svg = document.getElementById('chart-pie'); svg.innerHTML = '';
    const legend = document.getElementById('pie-legend'); legend.innerHTML = '';
    // Берем реальные языки с GitHub, если они есть
    const langs = realStats.languages.length > 0 ? realStats.languages : [ {name:"Go", val: 55}, {name:"JS", val: 30}, {name:"Shell", val: 15} ];
    const colors = ["#00d2ff", "#f7df1e", "#00ff41", "#ff003c", "#f0f"];
    
    let cumulativePercent = 0;
    langs.forEach((lang, i) => {
        const col = colors[i % colors.length];
        const dashArray = `${lang.val} ${100 - lang.val}`; const dashOffset = 25 - cumulativePercent; 
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle"); circle.setAttribute("cx", 50); circle.setAttribute("cy", 50); circle.setAttribute("r", 25); circle.setAttribute("fill", "transparent"); circle.setAttribute("stroke", col); circle.setAttribute("stroke-width", 50); circle.setAttribute("stroke-dasharray", dashArray); circle.setAttribute("stroke-dashoffset", dashOffset); svg.appendChild(circle);
        cumulativePercent += lang.val;
        legend.innerHTML += `<div style="display:flex; align-items:center; gap:5px;"><span style="display:inline-block; width:12px; height:12px; background:${col}; border-radius:3px;"></span>${lang.name} (${lang.val}%)</div>`;
    });
}

function drawHeatmap() {
    const container = document.getElementById('heatmap-container'); container.innerHTML = '';
    const color = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    const hexToRgb = hex => hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (m, r, g, b) => '#' + r + r + g + g + b + b).substring(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ');
    if(color.startsWith('#')) document.body.style.setProperty('--accent-rgb', hexToRgb(color));

    heatmapData.forEach(level => { const cell = document.createElement('div'); cell.className = 'heatmap-cell'; cell.setAttribute('data-level', level); container.appendChild(cell); });
}

// === ПЛАН 3: УМНЫЕ ДОСТИЖЕНИЯ ===
let badgesList = [
    { id: 1, title: "Первая кровь", desc: "Сделать первую активность", unlocked: false, icon: "🩸" },
    { id: 2, title: "Глаз-алмаз", desc: "Провести Аудиты", unlocked: false, icon: "👁️" },
    { id: 3, title: "Сеньор", desc: "Заработать более 100k XP", unlocked: false, icon: "👑" },
    { id: 4, title: "Хранилище", desc: "Больше 10 репозиториев", unlocked: false, icon: "📦" }
];

function checkAchievements() {
    // Умная логика проверок
    if (realStats.xp > 0 || realStats.repos > 0) badgesList[0].unlocked = true; // Первая кровь
    if (realStats.up > 0 || realStats.down > 0) badgesList[1].unlocked = true; // Глаз алмаз
    if (realStats.xp > 100000) badgesList[2].unlocked = true; // Сеньор
    if (realStats.repos > 10) badgesList[3].unlocked = true; // Хранилище
}

function renderBadges() {
    const container = document.getElementById('badges-container'); container.innerHTML = '';
    badgesList.forEach(b => {
        container.innerHTML += `
            <div class="badge ${b.unlocked ? '' : 'locked'}">
                <div style="font-size: 3.5rem; margin-bottom: 10px;">${b.icon}</div>
                <h3>${b.title}</h3>
                <p>${b.desc}</p>
            </div>
        `;
    });
}

// === ПЛАН 2: РЕАЛЬНОЕ PVP API ===
async function comparePvP() {
    const enemy = document.getElementById('pvp-enemy-login').value.trim();
    const btn = document.getElementById('btn-pvp');
    const res = document.getElementById('pvp-results');
    
    if(!enemy) return alert("Введите логин соперника!");
    if(!currentAuthSource) return alert("Сначала войдите в систему на главной!");
    
    btn.innerText = "ПОИСК СОПЕРНИКА...";
    let myXp = (realStats.xp / 1000).toFixed(1);
    let enemyXp = 0;

    try {
        if(currentAuthSource === 'github') {
            const req = await fetch(`https://api.github.com/users/${enemy}`);
            if(!req.ok) throw new Error("Not found");
            const data = await req.json();
            enemyXp = (data.public_repos * 2.5).toFixed(1); // Для GitHub используем мок формулу (репо * 2.5k XP)
        } else {
            const query = `{ transaction(where: {user: {login: {_eq: "${enemy}"}}, type: {_eq: "xp"}}) { amount } }`;
            const req = await fetch('https://01yessenov.yu.edu.kz/api/graphql-engine/v1/graphql', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}` },
                body: JSON.stringify({ query })
            });
            const data = await req.json();
            let total = 0; data.data.transaction.forEach(t => total += t.amount);
            enemyXp = (total / 1000).toFixed(1);
        }

        const myName = document.getElementById('user-display-name').innerText;
        
        // Математика для визуальных столбиков (макс высота 220px)
        const maxVal = Math.max(myXp, enemyXp, 1);
        const myHeight = (myXp / maxVal) * 220;
        const enemyHeight = (enemyXp / maxVal) * 220;

        res.innerHTML = `
            <div style="flex:1; text-align:center; color: var(--accent); display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                <div style="font-size: 1.2rem; font-weight: bold; margin-bottom: 10px;">${myName}</div>
                <div style="height: ${myHeight}px; width: 70px; background: var(--accent); box-shadow: var(--accent-glow); border-radius: 8px 8px 0 0; transition: height 1s ease-out;"></div>
                <p style="margin-top: 10px; font-weight: bold;">${myXp}k XP</p>
            </div>
            <div style="font-size: 2.5rem; font-weight: 900; margin-bottom: 50px; text-shadow: 0 0 10px rgba(255,255,255,0.3);">VS</div>
            <div style="flex:1; text-align:center; color: #b0b0b0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                <div style="font-size: 1.2rem; font-weight: bold; margin-bottom: 10px;">${enemy}</div>
                <div style="height: ${enemyHeight}px; width: 70px; background: rgba(255,255,255,0.2); border-radius: 8px 8px 0 0; transition: height 1s ease-out;"></div>
                <p style="margin-top: 10px; font-weight: bold;">${enemyXp}k XP</p>
            </div>
        `;
    } catch(e) {
        alert("Соперник не найден!");
    }
    btn.innerText = "СРАВНИТЬ АПИ";
}

// === УТИЛИТЫ И БАЗОВЫЕ ФУНКЦИИ (Drag & Drop, CSV, Notes) ===
const draggables = document.querySelectorAll('.drag-panel');
const container = document.getElementById('drag-container');
draggables.forEach(d => { d.addEventListener('dragstart', () => d.classList.add('dragging')); d.addEventListener('dragend', () => d.classList.remove('dragging')); });
container.addEventListener('dragover', e => {
    e.preventDefault();
    const afterElement = [...container.querySelectorAll('.drag-panel:not(.dragging)')].reduce((closest, child) => {
        const box = child.getBoundingClientRect(); const offset = e.clientX - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child }; else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
    const draggable = document.querySelector('.dragging');
    if (afterElement == null) container.appendChild(draggable); else container.insertBefore(draggable, afterElement);
});

function exportCSV() {
    let csvContent = "Период,Значение\n";
    activeChartData.labels.forEach((label, i) => { csvContent += `${label},${activeChartData.points[i]}\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `export.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

document.addEventListener('DOMContentLoaded', () => {
    const notesArea = document.getElementById('notes');
    notesArea.oninput = () => { Cloud.saveNote(notesArea.value); };
});
