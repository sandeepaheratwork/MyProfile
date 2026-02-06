/**
 * Profile Manager - Client Application
 */

// API Base URL
const API_URL = '/api/profiles';

// DOM Elements
const searchInput = document.getElementById('searchInput');
const profilesGrid = document.getElementById('profilesGrid');
const profileCount = document.getElementById('profileCount');
const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');

// Modal Elements
const profileModal = document.getElementById('profileModal');
const modalTitle = document.getElementById('modalTitle');
const profileForm = document.getElementById('profileForm');
const profileIdInput = document.getElementById('profileId');
const nameInput = document.getElementById('nameInput');
const emailInput = document.getElementById('emailInput');
const roleInput = document.getElementById('roleInput');
const bioInput = document.getElementById('bioInput');
const submitBtn = document.getElementById('submitBtn');

// Toast Container
const toastContainer = document.getElementById('toastContainer');

// State
let profiles = [];
let searchDebounceTimer = null;
let currentUser = null; // Stores { token, user }

// ========================================
// Initialization
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Check for stored session
    const storedSession = localStorage.getItem('adminSession');
    if (storedSession) {
        currentUser = JSON.parse(storedSession);
    }

    loadProfiles();
    setupEventListeners();
    updateUIForRole(); // Ensure UI is updated based on current state (null or user)
});

function setupEventListeners() {
    // Login/Logout Buttons
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginModal = document.getElementById('loginModal');

    if (loginBtn) loginBtn.addEventListener('click', () => {
        document.getElementById('loginModal').classList.add('active');
        document.getElementById('loginEmail').focus();
    });

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Login Modal Controls
    document.getElementById('closeLoginModal').addEventListener('click', closeLoginModal);
    document.getElementById('cancelLoginBtn').addEventListener('click', closeLoginModal);
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) closeLoginModal();
    });

    // Search
    searchInput.addEventListener('input', handleSearch);

    // Keyboard shortcut for search
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'Escape') {
            closeModal();
            closeLoginModal();
        }
    });

    // Add Profile Buttons
    document.getElementById('addProfileBtn').addEventListener('click', () => openModal());
    document.getElementById('addFirstProfileBtn').addEventListener('click', () => openModal());

    // Modal Controls
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) closeModal();
    });

    // Form Submit
    profileForm.addEventListener('submit', handleFormSubmit);
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('submitLoginBtn');

    // UI Loading state
    submitBtn.classList.add('loading');
    errorEl.style.display = 'none';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = { token: data.token, user: data.user };
            localStorage.setItem('adminSession', JSON.stringify(currentUser));
            closeLoginModal();
            updateUIForRole();
            showToast('Logged in successfully', 'success');
        } else {
            errorEl.textContent = data.error || 'Login failed';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        submitBtn.classList.remove('loading');
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('adminSession');
    updateUIForRole();
    showToast('Logged out', 'info');
}

function updateUIForRole() {
    const isAdmin = currentUser && currentUser.user.role === 'admin';
    const addProfileBtn = document.getElementById('addProfileBtn');
    const addFirstProfileBtn = document.getElementById('addFirstProfileBtn');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminBadge = document.getElementById('adminBadge');

    // Toggle Add Buttons
    if (addProfileBtn) addProfileBtn.style.display = isAdmin ? 'flex' : 'none';
    if (addFirstProfileBtn) addFirstProfileBtn.style.display = isAdmin ? 'inline-flex' : 'none';

    // Toggle Login/Logout
    if (loginBtn) loginBtn.style.display = isAdmin ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = isAdmin ? 'flex' : 'none';
    if (adminBadge) adminBadge.style.display = isAdmin ? 'flex' : 'none';

    // Re-render profiles to update card actions
    renderProfiles();
}

// ========================================
// API Functions
// ========================================

async function loadProfiles(query = '') {
    showLoading(true);

    try {
        const url = query
            ? `${API_URL}/search?q=${encodeURIComponent(query)}`
            : API_URL;

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            profiles = data.profiles;
            renderProfiles();
        } else {
            showToast('Failed to load profiles', 'error');
        }
    } catch (error) {
        console.error('Error loading profiles:', error);
        showToast('Connection error. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

async function createProfile(profileData) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser) {
        headers['x-auth-token'] = currentUser.token;
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(profileData)
    });

    return response.json();
}

async function updateProfile(id, profileData) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser) {
        headers['x-auth-token'] = currentUser.token;
    }

    const response = await fetch(`${API_URL}/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(profileData)
    });

    return response.json();
}

async function deleteProfile(id) {
    const headers = {};
    if (currentUser) {
        headers['x-auth-token'] = currentUser.token;
    }

    const response = await fetch(`${API_URL}/${id}`, {
        method: 'DELETE',
        headers
    });

    return response.json();
}

// ========================================
// UI Functions
// ========================================

function renderProfiles() {
    profileCount.textContent = profiles.length;

    if (profiles.length === 0) {
        profilesGrid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    profilesGrid.innerHTML = profiles.map(profile => createProfileCard(profile)).join('');

    // Add event listeners to card buttons
    profilesGrid.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const profile = profiles.find(p => p._id === id);
            if (profile) openModal(profile);
        });
    });

    profilesGrid.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });
}

function createProfileCard(profile) {
    const initials = getInitials(profile.name);
    const roleHtml = profile.role
        ? `<span class="profile-role">${escapeHtml(profile.role)}</span>`
        : '';
    const bioHtml = profile.bio
        ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>`
        : '';

    const createdAt = formatDate(profile.createdAt);

    return `
        <div class="profile-card" data-id="${profile._id}">
            <div class="profile-header">
                <div class="profile-avatar">${initials}</div>
                <div class="profile-actions" style="opacity: ${currentUser && currentUser.user.role === 'admin' ? '1' : '0'}; pointer-events: ${currentUser && currentUser.user.role === 'admin' ? 'auto' : 'none'}; display: ${currentUser && currentUser.user.role === 'admin' ? 'flex' : 'none'}">
                    <button class="btn btn-secondary btn-icon btn-edit" data-id="${profile._id}" title="Edit Profile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-danger btn-icon btn-delete" data-id="${profile._id}" title="Delete Profile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1 2-2h4a2,2 0 0,1 2,2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            <h3 class="profile-name">${escapeHtml(profile.name)}</h3>
            ${roleHtml}
            <div class="profile-email">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                </svg>
                <span>${escapeHtml(profile.email)}</span>
            </div>
            ${bioHtml}
            <div class="profile-meta">
                <span>Created ${createdAt}</span>
                <a href="/profile.html?id=${profile._id}" class="view-profile-link" style="margin-left: auto; color: var(--color-accent-primary); text-decoration: none; font-weight: 500;">View Portfolio →</a>
            </div>
        </div>
    `;
}

function showLoading(show) {
    loadingState.classList.toggle('active', show);
    if (show) {
        profilesGrid.innerHTML = '';
        emptyState.style.display = 'none';
    }
}

// ========================================
// Modal Functions
// ========================================

function openModal(profile = null) {
    if (profile) {
        // Edit mode
        modalTitle.textContent = 'Edit Profile';
        submitBtn.querySelector('.btn-text').textContent = 'Save Changes';

        profileIdInput.value = profile._id;
        nameInput.value = profile.name;
        emailInput.value = profile.email;
        roleInput.value = profile.role || '';
        bioInput.value = profile.bio || '';
    } else {
        // Create mode
        modalTitle.textContent = 'Create Profile';
        submitBtn.querySelector('.btn-text').textContent = 'Create Profile';

        profileForm.reset();
        profileIdInput.value = '';
    }

    profileModal.classList.add('active');
    nameInput.focus();
}

function closeModal() {
    profileModal.classList.remove('active');
    profileForm.reset();
    submitBtn.classList.remove('loading');
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const profileData = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        role: roleInput.value.trim() || undefined,
        bio: bioInput.value.trim() || undefined
    };

    submitBtn.classList.add('loading');

    try {
        const isEdit = !!profileIdInput.value;
        const result = isEdit
            ? await updateProfile(profileIdInput.value, profileData)
            : await createProfile(profileData);

        if (result.success) {
            showToast(
                isEdit ? 'Profile updated successfully!' : 'Profile created successfully!',
                'success'
            );
            closeModal();
            loadProfiles(searchInput.value);
        } else {
            showToast(result.error || 'An error occurred', 'error');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        showToast('Connection error. Please try again.', 'error');
    } finally {
        submitBtn.classList.remove('loading');
    }
}

// ========================================
// Search Functions
// ========================================

function handleSearch(e) {
    const query = e.target.value.trim();

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        loadProfiles(query);
    }, 300);
}

// ========================================
// Delete Function
// ========================================

// ========================================
// Delete Function
// ========================================

const deleteModal = document.getElementById('deleteModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
let profileIdToDelete = null;

function setupDeleteModalListeners() {
    closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });
    confirmDeleteBtn.addEventListener('click', executeDelete);
}

function openDeleteModal(id) {
    profileIdToDelete = id;
    deleteModal.classList.add('active');
}

function closeDeleteModal() {
    deleteModal.classList.remove('active');
    profileIdToDelete = null;
    confirmDeleteBtn.classList.remove('loading');
}

function handleDelete(id) {
    openDeleteModal(id);
}

async function executeDelete() {
    if (!profileIdToDelete) return;

    confirmDeleteBtn.classList.add('loading');

    try {
        const result = await deleteProfile(profileIdToDelete);

        if (result.success) {
            showToast('Profile deleted successfully!', 'success');
            loadProfiles(searchInput.value);
            closeDeleteModal();
        } else {
            showToast(result.error || 'Failed to delete profile', 'error');
            confirmDeleteBtn.classList.remove('loading');
        }
    } catch (error) {
        console.error('Error deleting profile:', error);
        showToast('Connection error. Please try again.', 'error');
        confirmDeleteBtn.classList.remove('loading');
    }
}

// Initialize delete listeners
document.addEventListener('DOMContentLoaded', setupDeleteModalListeners);

// ========================================
// Toast Notifications
// ========================================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconSvg = type === 'success'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

    toast.innerHTML = `
        <div class="toast-icon">${iconSvg}</div>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================================
// Utility Functions
// ========================================

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

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// ========================================
// AI Chat Widget
// ========================================

const chatWidget = document.getElementById('chatWidget');
const chatToggle = document.getElementById('chatToggle');
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

let isChatOpen = false;
let isProcessing = false;

// Initialize chat
function initChat() {
    if (!chatToggle) return;

    chatToggle.addEventListener('click', toggleChat);
    chatForm.addEventListener('submit', handleChatSubmit);

    // Close chat on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isChatOpen) {
            toggleChat();
        }
    });
}

// Toggle chat panel
function toggleChat() {
    isChatOpen = !isChatOpen;
    chatWidget.classList.toggle('active', isChatOpen);

    if (isChatOpen) {
        chatInput.focus();
    }
}

// Handle chat form submit
async function handleChatSubmit(e) {
    e.preventDefault();

    const message = chatInput.value.trim();
    if (!message || isProcessing) return;

    // Add user message
    addChatMessage(message, 'user');
    chatInput.value = '';

    // Show typing indicator
    isProcessing = true;
    chatSend.disabled = true;
    const typingEl = showTypingIndicator();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        // Remove typing indicator
        typingEl.remove();

        if (data.success) {
            // Add AI response
            addChatMessage(data.response, 'ai', data.action);

            // Refresh profiles if data changed
            if (data.action && ['created', 'updated', 'search', 'list'].includes(data.action.type)) {
                loadProfiles(searchInput.value);
            }
        } else {
            addChatMessage(data.response || data.error || 'Sorry, I encountered an error.', 'ai');
        }
    } catch (error) {
        console.error('Chat error:', error);
        typingEl.remove();
        addChatMessage('Sorry, I encountered a connection error. Please try again.', 'ai');
    } finally {
        isProcessing = false;
        chatSend.disabled = false;
        chatInput.focus();
    }
}

// Add message to chat
function addChatMessage(content, type, action = null) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${type}`;

    let html = `<div class="message-content"><p>${escapeHtml(content)}</p>`;

    // Add action-specific content
    if (action) {
        switch (action.type) {
            case 'created':
                html += `<div class="message-profiles">`;
                html += `<div class="message-profile-card">`;
                html += `<strong>${escapeHtml(action.profile.name)}</strong>`;
                if (action.profile.role) html += ` - ${escapeHtml(action.profile.role)}`;
                html += `<br>${escapeHtml(action.profile.email)}`;
                html += `</div></div>`;
                break;

            case 'updated':
                html += `<div class="message-profiles">`;
                html += `<div class="message-profile-card">`;
                html += `<strong>${escapeHtml(action.profile.name)}</strong>`;
                if (action.profile.role) html += ` - ${escapeHtml(action.profile.role)}`;
                html += `<br>${escapeHtml(action.profile.email)}`;
                html += `</div></div>`;
                break;

            case 'search':
            case 'list':
                if (action.profiles && action.profiles.length > 0) {
                    html += `<div class="message-profiles">`;
                    action.profiles.slice(0, 5).forEach(profile => {
                        html += `<div class="message-profile-card">`;
                        html += `<strong>${escapeHtml(profile.name)}</strong>`;
                        if (profile.role) html += ` - ${escapeHtml(profile.role)}`;
                        html += `<br>${escapeHtml(profile.email)}`;
                        html += `</div>`;
                    });
                    if (action.profiles.length > 5) {
                        html += `<p style="font-size: 0.75rem; color: var(--color-text-muted);">...and ${action.profiles.length - 5} more</p>`;
                    }
                    html += `</div>`;
                }
                break;

            case 'not_found':
            case 'error':
                // Error message already in content
                break;

            case 'help':
                // Help content handled by AI response
                break;
        }
    }

    html += `</div>`;
    messageEl.innerHTML = html;

    chatMessages.appendChild(messageEl);
    scrollChatToBottom();
}

// Show typing indicator
function showTypingIndicator() {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message ai';
    messageEl.innerHTML = `
        <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    chatMessages.appendChild(messageEl);
    scrollChatToBottom();
    return messageEl;
}

// Scroll chat to bottom
function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Initialize chat on DOM ready
document.addEventListener('DOMContentLoaded', initChat);
