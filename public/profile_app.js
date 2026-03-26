/**
 * Profile Details Page - Client Application
 */

// API Base URL
// Check strictly for localhost without port string to avoid blocking local webdev envs (e.g http://localhost:3001)
const isCapacitor = window.location.protocol === 'capacitor:' || window.location.origin === 'http://localhost' || window.location.origin === 'https://localhost' || window.location.origin === 'capacitor://localhost';
const API_BASE_URL = isCapacitor ? 'https://profile-ui-ghfjj7iuaa-uc.a.run.app' : '';
const API_URL = `${API_BASE_URL}/api/profiles`;

// Image URL Helper
function getImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('data:')) return url;
    if (url.startsWith('/api/') && typeof API_BASE_URL !== 'undefined') {
        return API_BASE_URL + url;
    }
    return url;
}


// DOM Elements
const profileContent = document.getElementById('profileContent');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
let currentLanguage = localStorage.getItem('appLanguage') || 'en';

// Translation Logic
function updateTranslations() {
    const lang = currentLanguage;
    const tDict = translations[lang] || translations['en'];

    // Update text content for elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (tDict[key]) {
            el.textContent = tDict[key];
        }
    });

    // Set the language selector value
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        langSelect.value = lang;
    }
}

function setLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('appLanguage', lang);
    updateTranslations();
    
    // Re-render profile if already loaded to apply new translations
    const urlParams = new URLSearchParams(window.location.search);
    const profileId = urlParams.get('id');
    if (profileId) {
        loadProfile(profileId);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (isCapacitor && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
        try {
            const StatusBar = window.Capacitor.Plugins.StatusBar;
            await StatusBar.setStyle({ style: 'DARK' });
            if (window.Capacitor.getPlatform() === 'android') {
                await StatusBar.setBackgroundColor({ color: '#ffffff' });
                await StatusBar.setOverlaysWebView({ overlay: false });
            } else {
                await StatusBar.setOverlaysWebView({ overlay: true });
            }
        } catch (e) {
            console.log('Error initializing StatusBar', e);
        }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const profileId = urlParams.get('id');

    if (profileId) {
        loadProfile(profileId);
    } else {
        showError('No profile ID specified');
    }

    // Initialize Translations
    updateTranslations();

    // Language switcher listener
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        languageSelect.addEventListener('change', (e) => {
            setLanguage(e.target.value);
        });
    }

    // Initialize native-feel Pull To Refresh on Mobile
    if (typeof PullToRefresh !== 'undefined' && isCapacitor) {
        PullToRefresh.init({
            mainElement: 'body',
            onRefresh() {
                return new Promise(async (resolve) => {
                    try {
                        if (profileId) await loadProfile(profileId);
                    } catch (e) {
                        console.error('Refresh error', e); 
                    }
                    resolve();
                });
            }
        });
    }
});

async function loadProfile(id) {
    showLoading(true);
    try {
        const response = await fetch(`${API_URL}/${id}`);
        const data = await response.json();

        if (data.success) {
            renderProfile(data.profile);
            showLoading(false);
        } else {
            showError(data.error || 'Profile not found');
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showError('Connection error. Please try again.');
    }
}

function renderProfile(profile) {
    const initials = getInitials(profile.name);
    const avatarHtml = profile.imageUrl
        ? `<img src="${getImageUrl(profile.imageUrl)}" alt="${escapeHtml(profile.name)}">`
        : initials;

    // Update document title
    document.title = `${profile.name} | TechForge`;


    const html = `
        <div class="portfolio-header">
            <div class="portfolio-avatar">${avatarHtml}</div>
            <div class="portfolio-info">
                <h1>${escapeHtml(profile.name)}</h1>
                ${profile.role ? `<div class="portfolio-role">${escapeHtml(profile.role)}</div>` : ''}
                <div class="portfolio-contact">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <span>${escapeHtml(profile.email)}</span>
                </div>
            </div>
            <div class="portfolio-actions">
                <a href="/" class="btn btn-secondary" data-i18n="back_to_dashboard">${t('back_to_dashboard')}</a>
            </div>
        </div>

        <div class="portfolio-content">
            <section class="content-section">
                <h2 data-i18n="about">${t('about')}</h2>
                <div class="bio-text">
                    ${profile.bio ? escapeHtml(profile.bio).replace(/\n/g, '<br>') : `<em data-i18n="no_bio">${t('no_bio')}</em>`}
                </div>
            </section>

            <section class="content-section">
                <h2 data-i18n="portfolio_details">${t('portfolio_details')}</h2>
                <div class="portfolio-grid">
                    <!-- Placeholder portfolio items -->
                    <div class="portfolio-item">
                        <div class="portfolio-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                        </div>
                        <h3 data-i18n="recent_projects">${t('recent_projects')}</h3>
                        <p data-i18n="recent_projects_desc">${t('recent_projects_desc')}</p>
                    </div>
                    
                    <div class="portfolio-item">
                         <div class="portfolio-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </div>
                        <h3 data-i18n="activity">${t('activity')}</h3>
                        <p data-i18n="activity_desc">${t('activity_desc')}</p>
                    </div>

                     <div class="portfolio-item">
                         <div class="portfolio-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                            </svg>
                        </div>
                        <h3 data-i18n="connections">${t('connections')}</h3>
                        <p data-i18n="connections_desc">${t('connections_desc')}</p>
                    </div>
                </div>
            </section>
        </div>
    `;

    profileContent.innerHTML = html;
}

function showLoading(show) {
    if (show) {
        loadingState.style.display = 'block';
        profileContent.style.display = 'none';
        errorState.style.display = 'none';
    } else {
        loadingState.style.display = 'none';
        profileContent.style.display = 'block';
    }
}

function showError(message) {
    loadingState.style.display = 'none';
    profileContent.style.display = 'none';
    errorState.style.display = 'block';
    errorState.querySelector('p').textContent = message;
}

// Utility Functions
function getInitials(name) {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
