(function () {
  // Prevent duplicate injection
  if (window.hasmyRepoMateInjected) return;
  window.hasmyRepoMateInjected = true;

  // Configuration & State
  let sidebarEl = null;
  let toggleBtnEl = null;
  let isPanelOpen = false;
  let currentRepoName = null;
  let userProfile = null;

  // Cache for generated AI analysis
  let aiAnalysisCache = null;
  let isGenerating = false;
  let currentTab = 'match'; // Default starting tab is Match

  // 1. Detect if we are on a repository page
  function getRepoName() {
    const repoMeta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    if (repoMeta) {
      return repoMeta.getAttribute('content');
    }
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const reserved = ['settings', 'pulls', 'issues', 'marketplace', 'trending', 'explore', 'notifications', 'search', 'sponsors', 'login', 'signup'];
      if (!reserved.includes(parts[0])) {
        return `${parts[0]}/${parts[1]}`;
      }
    }
    return null;
  }

  // 2. Scrape files, languages, and README from the DOM
  function scrapeRepoDetails() {
    const repoName = getRepoName();
    if (!repoName) return null;

    const fileList = [];
    const fileLinks = document.querySelectorAll([
      'a.Link--primary',
      'a[data-pjax="#repo-content-pjax-container"]',
      '.react-directory-row a',
      '.js-navigation-open.Link--primary'
    ].join(','));

    const seenPaths = new Set();
    fileLinks.forEach(link => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      if (!text || text.includes('..') || text.includes('Go to parent') || text.includes('history')) return;

      if (href && href.startsWith(`/${repoName}`)) {
        let path = '';
        if (href.includes('/blob/')) {
          const parts = href.split('/blob/');
          if (parts.length > 1) {
            const pathSegments = parts[1].split('/');
            path = pathSegments.slice(1).join('/'); // Remove branch name
          }
        } else if (href.includes('/tree/')) {
          const parts = href.split('/tree/');
          if (parts.length > 1) {
            const pathSegments = parts[1].split('/');
            path = pathSegments.slice(1).join('/'); // Remove branch name
          }
        } else {
          const pathParts = href.split('/').slice(3);
          path = pathParts.join('/');
        }

        if (path && !seenPaths.has(path)) {
          seenPaths.add(path);
          const parentRow = link.closest('tr, div[role="row"], .react-directory-row');
          let isDir = false;
          if (parentRow) {
            const svg = parentRow.querySelector('svg[aria-label="Directory"], svg.octicon-file-directory');
            if (svg) isDir = true;
          }
          fileList.push(`${isDir ? '[Folder] ' : '[File] '}${path}`);
        }
      }
    });

    const languages = {};
    const langElements = document.querySelectorAll('.RepositoryLanguage-listItem, li.d-inline-flex a');
    langElements.forEach(el => {
      const text = el.textContent.trim();
      const parts = text.split(/\s+/);
      if (parts.length >= 2) {
        const lang = parts.slice(0, -1).join(' ');
        const percent = parts[parts.length - 1];
        languages[lang] = percent;
      }
    });

    if (Object.keys(languages).length === 0) {
      const progressItems = document.querySelectorAll('.Progress-item');
      progressItems.forEach(item => {
        const lang = item.getAttribute('aria-label') || '';
        const match = lang.match(/^([a-zA-Z0-9#+-\s]+)\s+([0-9.]+%)/);
        if (match) {
          languages[match[1].trim()] = match[2];
        }
      });
    }

    const readmeContainer = document.getElementById('readme') || document.querySelector('article.markdown-body');
    let readmeText = '';
    if (readmeContainer) {
      readmeText = readmeContainer.textContent.trim()
        .replace(/\s+/g, ' ')
        .substring(0, 4000);
    }

    return {
      repoName,
      fileList: fileList.slice(0, 50),
      languages,
      readmeText
    };
  }

  // 3. Rule-Based Local Analysis (Tech Stack compatibility)
  function performLocalAnalysis(repoInfo, profile) {
    const knownTech = profile.knownTech || [];
    const detectedTech = [];
    const filesString = repoInfo.fileList.map(f => f.toLowerCase()).join(' ');

    if (filesString.includes('package.json')) detectedTech.push('Node.js');
    if (filesString.includes('tsconfig.json') || filesString.includes('.ts') || filesString.includes('.tsx')) detectedTech.push('TypeScript');
    if (filesString.includes('cargo.toml')) detectedTech.push('Rust');
    if (filesString.includes('go.mod') || filesString.includes('.go')) detectedTech.push('Go');
    if (filesString.includes('requirements.txt') || filesString.includes('pyproject.toml') || filesString.includes('.py')) detectedTech.push('Python');
    if (filesString.includes('dockerfile') || filesString.includes('docker-compose')) detectedTech.push('Docker');
    if (filesString.includes('pom.xml') || filesString.includes('build.gradle')) detectedTech.push('Java');
    if (filesString.includes('cmakelists.txt') || filesString.includes('makefile') || filesString.includes('.cpp') || filesString.includes('.h')) detectedTech.push('C++');
    if (filesString.includes('react') || filesString.includes('.jsx') || filesString.includes('.tsx') || (repoInfo.readmeText && repoInfo.readmeText.toLowerCase().includes('react'))) detectedTech.push('React');
    if (filesString.includes('vite.config') || filesString.includes('webpack.config')) detectedTech.push('Vite/Webpack');
    if (filesString.includes('.html') || filesString.includes('.css')) detectedTech.push('HTML & CSS');

    Object.keys(repoInfo.languages).forEach(lang => {
      if (!detectedTech.includes(lang)) {
        detectedTech.push(lang);
      }
    });

    const matches = [];
    const learningOpps = [];

    detectedTech.forEach(tech => {
      const isMatch = knownTech.some(kt => kt.toLowerCase().includes(tech.toLowerCase()) || tech.toLowerCase().includes(kt.toLowerCase()));
      if (isMatch) {
        matches.push(tech);
      } else {
        learningOpps.push(tech);
      }
    });

    let matchScore = 0;
    if (detectedTech.length > 0) {
      if (knownTech.length > 0) {
        matchScore = Math.round((matches.length / detectedTech.length) * 100);
      } else {
        matchScore = 0;
      }
    } else if (knownTech.length > 0) {
      matchScore = 50;
    }

    let statusText = "Learning Opportunity";
    let statusClass = "low-match";
    if (matchScore >= 70) {
      statusText = "Excellent Match";
      statusClass = "high-match";
    } else if (matchScore >= 40) {
      statusText = "Good Match";
      statusClass = "mid-match";
    }

    return {
      detectedTech,
      matches,
      learningOpps,
      matchScore,
      statusText,
      statusClass
    };
  }

  // 4. Initialize floating button and sidebar DOM
  function initUI() {
    if (document.getElementById('myRepoMate-fab')) return;

    // Create FAB
    toggleBtnEl = document.createElement('div');
    toggleBtnEl.id = 'myRepoMate-fab';
    toggleBtnEl.innerHTML = `
      <span style="font-weight: 800; font-size: 1.15rem; color: #ffffff;">RM</span>
    `;
    toggleBtnEl.title = "myRepoMate Onboarding Tour";
    document.body.appendChild(toggleBtnEl);

    // Create Sidebar container
    sidebarEl = document.createElement('div');
    sidebarEl.id = 'myRepoMate-sidebar';
    sidebarEl.innerHTML = `
      <div class="myRepoMate-header">
        <div>
          <div class="myRepoMate-title">myRepoMate Onboarding</div>
          <div class="myRepoMate-subtitle" id="myRepoMate-user-profile">Loading profile...</div>
        </div>
        <button class="myRepoMate-close" id="myRepoMate-close-btn">&times;</button>
      </div>
      <div class="myRepoMate-tabs">
        <div class="myRepoMate-tab active" data-tab="match">Match</div>
        <div class="myRepoMate-tab" data-tab="walkthrough">Tour</div>
      </div>
      <div class="myRepoMate-content-area" id="myRepoMate-content">
        <!-- Rendered tabs inside -->
      </div>
    `;
    document.body.appendChild(sidebarEl);

    // Events
    toggleBtnEl.addEventListener('click', togglePanel);
    document.getElementById('myRepoMate-close-btn').addEventListener('click', closePanel);

    const tabs = sidebarEl.querySelectorAll('.myRepoMate-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.getAttribute('data-tab');
        renderTabContent();
      });
    });
  }

  // 5. Panel Handlers
  function togglePanel() {
    if (isPanelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    initUI();
    isPanelOpen = true;
    sidebarEl.classList.add('open');
    toggleBtnEl.classList.add('active');

    chrome.storage.local.get(["skillLevel", "knownTech", "learnTech"], (profile) => {
      userProfile = {
        skillLevel: profile.skillLevel || "Beginner",
        knownTech: profile.knownTech || [],
        learnTech: profile.learnTech || ""
      };

      document.getElementById('myRepoMate-user-profile').textContent = `Personalized for ${userProfile.skillLevel}`;
      renderTabContent();
    });
  }

  function closePanel() {
    isPanelOpen = false;
    if (sidebarEl) sidebarEl.classList.remove('open');
    if (toggleBtnEl) toggleBtnEl.classList.remove('active');
  }

  // 6. Main Render Selector
  function renderTabContent() {
    const contentArea = document.getElementById('myRepoMate-content');
    if (!contentArea) return;

    const repoInfo = scrapeRepoDetails();
    if (!repoInfo) {
      contentArea.innerHTML = `
        <div class="myRepoMate-error-container">
          <div class="myRepoMate-error-title">Error loading codebase</div>
          <div class="myRepoMate-error-desc">Could not parse repository details. Please ensure you are on a GitHub repository homepage.</div>
        </div>
      `;
      return;
    }

    // A. Match Tab (Local Rule-Based matching, renders instantly)
    if (currentTab === 'match') {
      const matchData = performLocalAnalysis(repoInfo, userProfile);
      const hasConfiguredTech = userProfile && userProfile.knownTech && userProfile.knownTech.length > 0;

      let scoreDisplay = '';
      if (hasConfiguredTech) {
        scoreDisplay = `
          <div style="text-align: center; margin-bottom: 1.5rem; animation: fadeIn 0.3s ease;">
            <div style="font-size: 2.25rem; font-weight: 800; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">${matchData.matchScore}%</div>
            <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; margin-top: 0.2rem;">Compatibility Score</div>
            <div class="myRepoMate-match-badge ${matchData.statusClass}" style="margin: 0.5rem auto 0 auto; display: inline-block;">${matchData.statusText}</div>
            <div style="margin-top: 0.75rem;">
              <button class="myRepoMate-error-btn" id="myRepoMate-setup-tech-btn" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">Configure Settings</button>
            </div>
          </div>
        `;
      } else {
        scoreDisplay = `
          <div style="text-align: center; margin-bottom: 1.5rem; animation: fadeIn 0.3s ease;">
            <div style="font-size: 2.25rem; font-weight: 800; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">0%</div>
            <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; margin-top: 0.2rem;">Compatibility Score</div>
            <div style="font-size: 0.8rem; color: #8b949e; line-height: 1.4; margin-top: 0.75rem;">
              Configure your comfortable technologies in the dashboard to see your compatibility score!
            </div>
            <button class="myRepoMate-error-btn" id="myRepoMate-setup-tech-btn" style="margin-top: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.75rem;">Open Dashboard</button>
          </div>
        `;
      }

      let matchContent = `
        ${scoreDisplay}
        <h3 class="myRepoMate-h3">Scraped Tech Stack</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
          ${matchData.detectedTech.map(t => `<span class="myRepoMate-tech-tag">${t}</span>`).join('') || '<span style="color: #8b949e; font-size: 0.8rem;">None detected in local files</span>'}
        </div>
      `;

      if (hasConfiguredTech && matchData.matches.length > 0) {
        matchContent += `
          <h3 class="myRepoMate-h3" style="color: #ffffff;">Your Skills Used Here</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
            ${matchData.matches.map(t => `<span class="myRepoMate-tech-tag match">${t}</span>`).join('')}
          </div>
        `;
      }

      if (hasConfiguredTech && matchData.learningOpps.length > 0) {
        matchContent += `
          <h3 class="myRepoMate-h3" style="color: #8b949e;">Learning Opportunities</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
            ${matchData.learningOpps.map(t => `<span class="myRepoMate-tech-tag opp">${t}</span>`).join('')}
          </div>
        `;
      }

      if (aiAnalysisCache && aiAnalysisCache.match) {
        matchContent += `
          <div style="margin-top: 1.5rem; border-top: 1px solid #30363d; padding-top: 1rem;">
            <div class="myRepoMate-markdown-rendered">
              ${parseMarkdownToHTML(aiAnalysisCache.match)}
            </div>
          </div>
        `;
      } else if (isGenerating) {
        matchContent += `
          <div class="myRepoMate-loading-container" style="margin-top: 1.5rem; border-top: 1px dashed #30363d; padding-top: 1.5rem;">
            <div class="myRepoMate-spinner"></div>
            <div class="myRepoMate-loading-text">Consulting Gemini AI...</div>
          </div>
        `;
      } else {
        matchContent += `
          <div style="margin-top: 2rem; border-top: 1px dashed #30363d; padding-top: 1.25rem; text-align: center;">
            <div style="font-size: 0.75rem; color: #8b949e; margin-bottom: 0.5rem;">Want personalized AI learning advice for this stack?</div>
            <button class="myRepoMate-error-btn" id="myRepoMate-match-trigger-tour-btn" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">Generate AI Tour & Learning Guide</button>
          </div>
        `;
      }

      contentArea.innerHTML = matchContent;

      const setupBtn = document.getElementById('myRepoMate-setup-tech-btn');
      if (setupBtn) {
        setupBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: "openOptionsPage" });
        });
      }

      const matchTourBtn = document.getElementById('myRepoMate-match-trigger-tour-btn');
      if (matchTourBtn) {
        matchTourBtn.addEventListener('click', () => {
          triggerAnalysis();
        });
      }
      return;
    }

    // B. Walkthrough / Tour Tab (AI Onboarding)
    if (currentTab === 'walkthrough') {
      if (isGenerating) {
        contentArea.innerHTML = `
          <div class="myRepoMate-loading-container">
            <div class="myRepoMate-spinner"></div>
            <div class="myRepoMate-loading-text">Preparing... (This may take upto 30 seconds)</div>
            <div style="font-size: 0.75rem; color: #8b949e; text-align: center; max-width: 280px; margin-top: -0.5rem;">Analyzing file structures and configuration formats. This will take up to 10 seconds.</div>
          </div>
        `;
        return;
      }

      if (!aiAnalysisCache || !aiAnalysisCache.walkthrough) {
        contentArea.innerHTML = `
          <div class="myRepoMate-welcome-ai">
            <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.5rem; color: #ffffff;">Generate Codebase Walkthrough</h3>
            <p style="font-size: 0.8rem; color: #8b949e; line-height: 1.5; margin-bottom: 1.5rem; max-width: 285px; margin-left: auto; margin-right: auto;">
              Send repository files and README summary to the API to construct a personalized codebase map and setup guide.
            </p>
            <button class="myRepoMate-ai-btn" id="btn-trigger-ai-tab">Generate AI Onboarding Tour</button>
          </div>
        `;

        const startAiBtn = document.getElementById('btn-trigger-ai-tab');
        if (startAiBtn) {
          startAiBtn.addEventListener('click', triggerAnalysis);
        }
        return;
      }

      contentArea.innerHTML = `
        <div class="myRepoMate-markdown-rendered">
          ${parseMarkdownToHTML(aiAnalysisCache.walkthrough)}
        </div>
      `;
    }
  }

  // 7. Call Background Service Worker for Gemini API
  function triggerAnalysis() {
    const repoInfo = scrapeRepoDetails();
    if (!repoInfo) return;

    isGenerating = true;
    renderTabContent();

    chrome.runtime.sendMessage({
      action: "generateOnboarding",
      repoInfo
    }, (response) => {
      isGenerating = false;

      if (chrome.runtime.lastError) {
        showError(`Extension communication error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response && response.success) {
        parseAndStoreResponse(response.data);
      } else {
        const errMsg = response?.error || "Unknown error occurred while contacting Gemini AI.";
        showError(errMsg);
      }
    });
  }

  function parseAndStoreResponse(rawMarkdown) {
    aiAnalysisCache = {
      walkthrough: '',
      match: ''
    };

    const sections = rawMarkdown.split(/##\s+/);
    sections.forEach(sec => {
      if (sec.toLowerCase().includes('codebase walkthrough') || sec.toLowerCase().includes('entry points')) {
        aiAnalysisCache.walkthrough = '## ' + sec.trim();
      } else if (sec.toLowerCase().includes('stack match') || sec.toLowerCase().includes('learning guide')) {
        aiAnalysisCache.match = '## ' + sec.trim();
      }
    });

    // Fallbacks if splitting fails
    if (!aiAnalysisCache.walkthrough && !aiAnalysisCache.match) {
      aiAnalysisCache.walkthrough = rawMarkdown;
    }

    renderTabContent();
  }

  // Safe and basic custom markdown renderer
  function parseMarkdownToHTML(md) {
    let html = md;

    // Escape HTML tags to prevent XSS
    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks with copy button
    html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `
        <div class="myRepoMate-code-wrapper">
          <div class="myRepoMate-code-header">${lang || 'code'}</div>
          <pre><code>${code.trim()}</code></pre>
        </div>
      `;
    });

    html = html.replace(/`([^`]+)`/g, '<code class="myRepoMate-inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^##\s+(.+)$/gm, '<h3 class="myRepoMate-h3" style="color: #ffffff; border-bottom-color: rgba(255, 255, 255, 0.15);">$1</h3>');
    html = html.replace(/^###\s+(.+)$/gm, '<h4 class="myRepoMate-h4" style="color: #ffffff; margin-top: 1rem; margin-bottom: 0.25rem;">$1</h4>');

    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li class="myRepoMate-li">$1</li>');
    html = html.replace(/(<li class="myRepoMate-li">.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="myRepoMate-ol-li">$1</li>');
    html = html.replace(/(<li class="myRepoMate-ol-li">.*<\/li>\n?)+/g, (match) => `<ol>${match}</ol>`);

    html = html.replace(/\n\n/g, '<br/>');

    return html;
  }

  function showError(message) {
    const contentArea = document.getElementById('myRepoMate-content');
    if (!contentArea) return;

    let advice = "";
    if (message.includes("API Key") || message.includes("credentials")) {
      advice = `<br/><br/><button class="myRepoMate-error-btn" id="myRepoMate-err-setup">Configure Settings</button>`;
    }

    contentArea.innerHTML = `
      <div class="myRepoMate-error-container">
        <div class="myRepoMate-error-title">Error Analyzing Codebase</div>
        <div class="myRepoMate-error-desc">${message}</div>
        ${advice}
      </div>
    `;

    const errBtn = document.getElementById('myRepoMate-err-setup');
    if (errBtn) {
      errBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "openOptionsPage" });
      });
    }
  }

  // 7. Navigation & DOM observers (Reset cache ONLY when repository changes)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;

      const newRepo = getRepoName();
      if (newRepo) {
        if (newRepo !== currentRepoName) {
          currentRepoName = newRepo;
          aiAnalysisCache = null;
          isGenerating = false;
          currentTab = 'match'; // Reset tab to Match

          if (sidebarEl) {
            const tabs = sidebarEl.querySelectorAll('.myRepoMate-tab');
            tabs.forEach(t => {
              t.classList.remove('active');
              if (t.getAttribute('data-tab') === 'match') t.classList.add('active');
            });
            if (isPanelOpen) {
              renderTabContent();
            }
          }
        } else {
          if (isPanelOpen) {
            renderTabContent();
          }
        }
      } else {
        closePanel();
        if (toggleBtnEl) toggleBtnEl.style.display = 'none';
      }
    }

    if (getRepoName()) {
      initUI();
      if (toggleBtnEl) toggleBtnEl.style.display = 'flex';
    } else {
      if (toggleBtnEl) toggleBtnEl.style.display = 'none';
    }
  }).observe(document, { subtree: true, childList: true });

  // Initial set
  currentRepoName = getRepoName();
  if (currentRepoName) {
    initUI();
  }
})();
