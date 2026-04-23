import './style.css';

document.addEventListener('DOMContentLoaded', () => {

    // Theme toggle (global, persistent)
    const THEME_STORAGE_KEY = 'theme';
    const getSystemTheme = () => (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    const getSavedTheme = () => {
        try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
    };
    const setSavedTheme = (theme) => {
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
    };

    const applyTheme = (theme) => {
        document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    };

    const getInitialTheme = () => getSavedTheme() || getSystemTheme();
    applyTheme(getInitialTheme());

    const ensureThemeToggle = () => {
        if (document.querySelector('.theme-toggle')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';

        const icon = document.createElement('span');
        icon.className = 'theme-toggle-icon';

        const sunSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v2"></path><path d="M12 20v2"></path>
            <path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path>
            <path d="M2 12h2"></path><path d="M20 12h2"></path>
            <path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>
          </svg>`;
        const moonSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>`;

        const syncButton = () => {
            const isDark = document.documentElement.classList.contains('theme-dark');
            btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            icon.innerHTML = isDark ? sunSvg : moonSvg;
        };

        btn.addEventListener('click', () => {
            const next = document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark';
            setSavedTheme(next);
            applyTheme(next);
            syncButton();
        });

        syncButton();
        btn.appendChild(icon);
        document.body.appendChild(btn);
    };

    ensureThemeToggle();

    // Copy email logic
    const copyBtns = document.querySelectorAll('.copy-email-btn');
    if (copyBtns.length > 0) {
        copyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const email = btn.getAttribute('data-email');
                navigator.clipboard.writeText(email).then(() => {
                    const msgSpan = btn.querySelector('.copy-msg');
                    msgSpan.textContent = 'COPIED!';
                    msgSpan.classList.add('show');
                    
                    setTimeout(() => {
                        msgSpan.classList.remove('show');
                    }, 2000);
                });
            });
        });
    }

});
