/**
 * Profile Details Page - Client Application
 */

// API Base URL
const API_URL = '/api/profiles';

// DOM Elements
const profileContent = document.getElementById('profileContent');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const profileId = urlParams.get('id');

    if (profileId) {
        loadProfile(profileId);
    } else {
        showError('No profile ID specified');
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

    // Update document title
    document.title = `${profile.name} - Portfolio | Profile Manager`;

    const html = `
        <div class="portfolio-header">
            <div class="portfolio-avatar">${initials}</div>
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
                <a href="/" class="btn btn-secondary">Back to Dashboard</a>
            </div>
        </div>

        <div class="portfolio-content">
            <section class="content-section">
                <h2>About</h2>
                <div class="bio-text">
                    ${profile.bio ? escapeHtml(profile.bio).replace(/\n/g, '<br>') : '<em>No bio available</em>'}
                </div>
            </section>

            <section class="content-section">
                <h2>Portfolio Details</h2>
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
                        <h3>Recent Projects</h3>
                        <p>View a collection of recent work and contributions.</p>
                    </div>
                    
                    <div class="portfolio-item">
                         <div class="portfolio-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </div>
                        <h3>Activity</h3>
                        <p>Track recent activity and updates.</p>
                    </div>

                     <div class="portfolio-item">
                         <div class="portfolio-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                            </svg>
                        </div>
                        <h3>Connections</h3>
                        <p>Network and professional connections.</p>
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
