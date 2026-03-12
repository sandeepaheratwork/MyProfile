/**
 * TechForge - Client Application

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

// Image Elements
const imageInput = document.getElementById('imageInput');
const selectImageBtn = document.getElementById('selectImageBtn');
const imagePreview = document.getElementById('imagePreview');
const imageUrlInput = document.getElementById('imageUrlInput');

// Toast Container
const toastContainer = document.getElementById('toastContainer');

// State
let profiles = [];
let blogs = []; // Store blogs globally for count
let searchDebounceTimer = null;
let currentUser = null; // Stores { token, user }

// ========================================

if (typeof marked !== 'undefined') {
    marked.use({
        renderer: {
            image(href, title, text) {
                return `<img src="${getImageUrl(href)}" alt="${text || ''}" title="${title || ''}">`;
            }
        }
    });
}

// Initialization
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    if (isCapacitor) {
        document.body.classList.add('is-native-app');
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
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
    }

    // Check for stored session
    const storedSession = localStorage.getItem('adminSession');
    if (storedSession) {
        currentUser = JSON.parse(storedSession);
    }

    setupEventListeners();
    updateUIForRole(false); // Don't switch tab automatically here

    // Handle initial route
    handleRouting();

    // Listen for back/forward buttons
    window.addEventListener('hashchange', handleRouting);

    // Initialize native-feel Pull To Refresh on Mobile
    if (typeof PullToRefresh !== 'undefined' && isCapacitor) {
        PullToRefresh.init({
            mainElement: 'body',
            onRefresh() {
                return new Promise(async (resolve) => {
                    try {
                        const loadingTasks = [];
                        if (typeof loadBlogs === 'function') loadingTasks.push(loadBlogs());
                        if (typeof loadProfiles === 'function' && currentUser && currentUser.user && currentUser.user.role === 'admin') {
                            loadingTasks.push(loadProfiles());
                        }
                        await Promise.all(loadingTasks);
                    } catch (e) { console.error('Refresh error', e); }
                    resolve();
                });
            }
        });
    }

    // Register for push notifications after login (called from updateUIForRole too)
    initPushNotifications();
});

// ======================================================
// Push Notification Registration
// ======================================================

async function initPushNotifications() {
    if (!currentUser) return; // Only register when logged in

    try {
        // --- Mobile (Capacitor) ---
        if (isCapacitor && window.Capacitor?.Plugins?.PushNotifications) {
            const { PushNotifications } = window.Capacitor.Plugins;

            const permResult = await PushNotifications.requestPermissions();
            if (permResult.receive === 'granted') {
                await PushNotifications.register();

                PushNotifications.addListener('registration', async (tokenData) => {
                    console.log('FCM Token:', tokenData.value);
                    try {
                        await fetch(`${API_BASE_URL}/api/notifications/fcm-token`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
                            body: JSON.stringify({
                                fcmToken: tokenData.value,
                                platform: window.Capacitor.getPlatform()
                            })
                        });
                    } catch (e) { console.warn('Failed to save FCM token', e); }
                });

                PushNotifications.addListener('pushNotificationReceived', (notification) => {
                    showToast(`🔔 ${notification.title}: ${notification.body}`, 'info');
                    fetchNotifications(); // Update UI when notification arrives
                });

                PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                    const url = action.notification?.data?.url;
                    if (url) window.location.hash = url.replace(/^.*#/, '#');
                });
            }
        }

        // --- Web Browser (Service Worker + VAPID) ---
        if (!isCapacitor && 'serviceWorker' in navigator && 'PushManager' in window) {
            const reg = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            // Get VAPID public key from server
            const keyRes = await fetch(`${API_BASE_URL}/api/notifications/vapid-public-key`);
            const keyData = await keyRes.json();
            if (!keyData.publicKey) return;

            const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
            let subscription = await reg.pushManager.getSubscription();

            if (!subscription) {
                subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            }

            // Save to backend
            await fetch(`${API_BASE_URL}/api/notifications/web-subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
                body: JSON.stringify({ subscription })
            });

            console.log('✅ Web Push registered');
        }
    } catch (e) {
        console.warn('Push notification init failed:', e.message);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ===================================
// Notification Center Logic
// ===================================
let notifPollingInterval = null;

function toggleNotificationPanel(e) {
    const panel = document.getElementById('notificationPanel');
    const isVisible = panel.style.display === 'flex';
    
    // Close other panels if any
    
    if (!isVisible) {
        panel.style.display = 'flex';
        fetchNotifications();
        
        // Mark all as read after a short delay or when opening
        // For this UX, we'll keep them showing "unread" dot until individual interaction or "Mark all read" click
    } else {
        panel.style.display = 'none';
    }
}

async function fetchNotifications() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
            headers: { 'x-auth-token': currentUser.token }
        });
        const data = await response.json();
        if (data.success) {
            renderNotifications(data.notifications);
            updateNotifBadge(data.unreadCount);
        }
    } catch (e) { console.warn('Failed to fetch notifications', e); }
}

function updateNotifBadge(count) {
    const badge = document.getElementById('notifBadge');
    const badgeBottom = document.getElementById('notifBadgeBottom');
    
    const text = count > 99 ? '99+' : count;
    
    if (badge) {
        badge.textContent = text;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
    
    if (badgeBottom) {
        badgeBottom.textContent = text;
        badgeBottom.style.display = count > 0 ? 'flex' : 'none';
    }
}

function renderNotifications(notifs) {
    const list = document.getElementById('notifList');
    if (!notifs || notifs.length === 0) {
        list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
        return;
    }

    list.innerHTML = notifs.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="handleNotifClick('${n._id}', '${n.url}')">
            <div class="notif-content">
                <div class="notif-title">${escapeHtml(n.title)}</div>
                <div class="notif-body">${escapeHtml(n.body)}</div>
                <div class="notif-time">${formatTimeAgo(new Date(n.createdAt))}</div>
            </div>
        </div>
    `).join('');
}

async function handleNotifClick(notifId, url) {
    try {
        // Mark as read in background
        fetch(`${API_BASE_URL}/api/notifications/${notifId}/read`, {
            method: 'POST',
            headers: { 'x-auth-token': currentUser.token }
        });
        
        // Navigate
        if (url) {
            window.location.hash = url.replace(/^.*#/, '#');
            // Close panel
            document.getElementById('notificationPanel').style.display = 'none';
        }
        
        // Locally mark read for UI snappiness
        fetchNotifications(); 
    } catch (e) { console.error('Notif click error', e); }
}

async function markAllNotificationsRead() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
            method: 'POST',
            headers: { 'x-auth-token': currentUser.token }
        });
        const data = await response.json();
        if (data.success) {
            fetchNotifications();
        }
    } catch (e) { console.error('Mark all read error', e); }
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

function setupEventListeners() {
    // Login/Logout/Register Buttons
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginModal = document.getElementById('loginModal');
    const showRegisterLink = document.getElementById('showRegisterLink');
    const showLoginLink = document.getElementById('showLoginLink');

    if (loginBtn) loginBtn.addEventListener('click', () => {
        document.getElementById('loginModal').classList.add('active');
        showLoginForm();
    });

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    if (showRegisterLink) showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        showRegisterForm();
    });

    if (showLoginLink) showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        showLoginForm();
    });

    // Login Modal Controls
    document.getElementById('closeLoginModal').addEventListener('click', closeLoginModal);
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('forgotPasswordForm').addEventListener('submit', handleForgotPassword);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetPassword);

    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        showForgotPasswordForm();
    });

    document.querySelectorAll('.back-to-login').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showLoginForm();
        });
    });

    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) closeLoginModal();
    });

    // Navigation Tabs
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            switchTab(tab.dataset.tab);
        });
    });

    // Change Password
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const changePasswordModal = document.getElementById('changePasswordModal');

    if (changePasswordBtn) changePasswordBtn.addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.add('active');
        document.getElementById('currentPassword').focus();
    });

    document.getElementById('closeChangePasswordModal').addEventListener('click', closeChangePasswordModal);
    document.getElementById('cancelChangePasswordBtn').addEventListener('click', closeChangePasswordModal);
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);

    changePasswordModal.addEventListener('click', (e) => {
        if (e.target === changePasswordModal) closeChangePasswordModal();
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
            closeChangePasswordModal();
            document.getElementById('notificationPanel').style.display = 'none';
        }
    });

    // Close notification panel when clicking outside
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notificationPanel');
        const bellBtn = document.getElementById('notificationBellBtn');
        if (panel.style.display === 'flex' && !panel.contains(e.target) && !bellBtn.contains(e.target)) {
            panel.style.display = 'none';
        }
    });

    // Add Profile Buttons
    document.getElementById('addProfileBtn').addEventListener('click', () => openModal());
    document.getElementById('addFirstProfileBtn').addEventListener('click', () => openModal());

    // --- Bottom Nav Event Listeners ---
    const bottomNavItems = document.querySelectorAll('.bottom-nav-item[data-tab]');
    bottomNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });

    const bottomNewPostBtn = document.getElementById('bottomNewPostBtn');
    if (bottomNewPostBtn) {
        bottomNewPostBtn.addEventListener('click', () => {
            if (currentUser) {
                switchTab('blogs');
                openBlogModal();
            } else {
                showToast('Please login to create a post', 'info');
                document.getElementById('loginBtn').click();
            }
        });
    }

    // Modal Controls
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) closeModal();
    });

    // Form Submit
    profileForm.addEventListener('submit', handleFormSubmit);

    // Image Upload
    if (selectImageBtn) {
        selectImageBtn.addEventListener('click', async () => {
            if (isCapacitor && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
                try {
                    const Camera = window.Capacitor.Plugins.Camera;
                    const image = await Camera.getPhoto({
                        quality: 90,
                        allowEditing: false,
                        resultType: 'base64',  // For easy preview
                        source: 'PROMPT'       // Shows 'Photos' or 'Camera'
                    });

                    if (image && image.base64String) {
                        const base64Data = `data:image/${image.format};base64,${image.base64String}`;
                        imagePreview.innerHTML = `<img src="${base64Data}" alt="Preview">`;
                        imageUrlInput.value = base64Data; // Use data URL directly
                    }
                } catch (error) {
                    console.log('User cancelled or camera error', error);
                }
            } else {
                imageInput.click();
            }
        });
    }

    if (imageInput) {
        imageInput.addEventListener('change', handleImageUpload);
    }

    // Blog Buttons — visible to everyone, but guests are prompted to register
    const newBlogBtn = document.getElementById('newBlogBtn');
    if (newBlogBtn) newBlogBtn.addEventListener('click', () => {
        if (!currentUser) {
            // Guest: open login modal on the Register tab with a hint
            const loginModal = document.getElementById('loginModal');
            const registerTab = document.getElementById('showRegisterTab');
            if (loginModal) loginModal.classList.add('active');
            if (registerTab) registerTab.click(); // switch to Register tab
            showToast('Please register or log in to create a post.', 'error');
            return;
        }

        const form = document.getElementById('blogForm');
        form.reset();
        form.removeAttribute('data-edit-id');

        document.getElementById('blogModal').classList.add('active');

        // Restore Draft
        const savedDraft = localStorage.getItem('draft_blog');
        if (savedDraft) {
            try {
                const draft = JSON.parse(savedDraft);
                const titleInput = document.getElementById('blogTitleInput');
                const tagsInput = document.getElementById('blogTagsInput');
                const contentInput = document.getElementById('blogContentInput');

                if (titleInput && draft.title) titleInput.value = draft.title;
                if (tagsInput && draft.tags) tagsInput.value = draft.tags;
                if (contentInput && draft.content) contentInput.value = draft.content;

                if (window.innerWidth > 1024) {
                    updateBlogPreview();
                }
            } catch (e) {
                console.error('Failed to restore draft', e);
            }
        } else {
            // explicitly clear preview if no draft
            if (window.innerWidth > 1024 && typeof updateBlogPreview === 'function') {
                updateBlogPreview();
            }
        }

        document.getElementById('blogTitleInput').focus();
    });

    document.getElementById('closeBlogModal').addEventListener('click', closeBlogModal);
    document.getElementById('cancelBlogBtn').addEventListener('click', closeBlogModal);
    document.getElementById('blogForm').addEventListener('submit', handleBlogSubmit);

    // Blog Image Insertion
    const blogInsertImageBtn = document.getElementById('blogInsertImageBtn');
    const blogImageInput = document.getElementById('blogImageInput');
    const blogContentInput = document.getElementById('blogContentInput');

    if (blogInsertImageBtn && blogImageInput) {
        blogInsertImageBtn.addEventListener('click', async () => {
            if (isCapacitor && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
                try {
                    const Camera = window.Capacitor.Plugins.Camera;
                    const image = await Camera.getPhoto({
                        quality: 90,
                        allowEditing: false,
                        resultType: 'base64',  // For easy upload
                        source: 'PROMPT'       // Shows 'Photos' or 'Camera'
                    });

                    if (image && image.base64String) {
                        const res = await fetch(`data:image/${image.format};base64,${image.base64String}`);
                        const blob = await res.blob();
                        const file = new File([blob], `capacitor-upload.${image.format}`, { type: `image/${image.format}` });
                        handleBlogImageUpload(file);
                    }
                } catch (error) {
                    console.log('User cancelled or camera error', error);
                }
            } else {
                blogImageInput.click();
            }
        });
        blogImageInput.addEventListener('change', (e) => handleBlogImageUpload(e.target.files[0]));
    }

    // Text Formatting Buttons (using mousedown + preventDefault to retain textarea focus)
    const formatBtnBold = document.getElementById('blogFormatBoldBtn');
    const formatBtnItalic = document.getElementById('blogFormatItalicBtn');
    const formatBtnH2 = document.getElementById('blogFormatH2Btn');
    const formatBtnLink = document.getElementById('blogFormatLinkBtn');

    const applyFormat = (prefix, suffix = '') => {
        if (!blogContentInput) return;
        const start = blogContentInput.selectionStart;
        const end = blogContentInput.selectionEnd;
        const selectedText = blogContentInput.value.substring(start, end);
        const text = blogContentInput.value;
        const replaceStr = prefix + selectedText + suffix;
        blogContentInput.value = text.substring(0, start) + replaceStr + text.substring(end);

        // Adjust cursor position
        blogContentInput.focus();
        if (selectedText.length > 0) {
            blogContentInput.setSelectionRange(start, start + replaceStr.length);
        } else {
            // Place cursor inside the formatting tags if nothing was selected
            blogContentInput.setSelectionRange(start + prefix.length, start + prefix.length);
        }
        blogContentInput.dispatchEvent(new Event('input')); // Trigger preview/autosave
    };

    if (formatBtnBold) formatBtnBold.addEventListener('mousedown', (e) => { e.preventDefault(); applyFormat('**', '**'); });
    if (formatBtnItalic) formatBtnItalic.addEventListener('mousedown', (e) => { e.preventDefault(); applyFormat('*', '*'); });
    if (formatBtnH2) formatBtnH2.addEventListener('mousedown', (e) => { e.preventDefault(); applyFormat('\n## ', '\n'); });
    if (formatBtnLink) formatBtnLink.addEventListener('mousedown', (e) => { e.preventDefault(); applyFormat('[', '](https://)'); });

    const blogInsertSandboxBtn = document.getElementById('blogInsertSandboxBtn');
    if (blogInsertSandboxBtn && blogContentInput) {
        blogInsertSandboxBtn.addEventListener('click', () => {
            const sandboxId = prompt("Enter CodeSandbox ID (e.g., 'new' or a specific ID like 'react-new'):", "react-new");
            if (sandboxId) {
                const cursorPos = blogContentInput.selectionStart;
                const text = blogContentInput.value;
                const embedCode = `\n\n[sandbox:${sandboxId}]\n\n`;
                blogContentInput.value = text.substring(0, cursorPos) + embedCode + text.substring(cursorPos);
            }
        });
    }

    if (blogContentInput) {
        // Drag and Drop
        blogContentInput.addEventListener('dragover', (e) => {
            e.preventDefault();
            blogContentInput.style.borderColor = 'var(--color-accent-primary)';
            blogContentInput.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)';
        });
        blogContentInput.addEventListener('dragleave', () => {
            blogContentInput.style.borderColor = '';
            blogContentInput.style.boxShadow = '';
        });
        blogContentInput.addEventListener('drop', (e) => {
            e.preventDefault();
            blogContentInput.style.borderColor = '';
            blogContentInput.style.boxShadow = '';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleBlogImageUpload(e.dataTransfer.files[0]);
            }
        });
        // Paste support
        blogContentInput.addEventListener('paste', async (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            const textContent = (e.clipboardData || e.originalEvent.clipboardData).getData('text');

            // Image Paste
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    handleBlogImageUpload(file);
                    return; // exit early if it's an image
                }
            }

            // URL Paste for Rich Previews
            if (textContent && /^https?:\/\/[^\s]+$/.test(textContent.trim())) {
                const url = textContent.trim();

                // Show a loading indicator temporarily
                const placeholder = `\n\n[Loading preview for ${url}...]()\n\n`;
                const cursorFallback = blogContentInput.value.length;
                const start = blogContentInput.selectionStart ?? cursorFallback;
                const end = blogContentInput.selectionEnd ?? cursorFallback;
                blogContentInput.value = blogContentInput.value.substring(0, start) + placeholder + blogContentInput.value.substring(end);

                try {
                    const res = await fetch(`${API_BASE_URL}/api/link-preview?url=${encodeURIComponent(url)}`);
                    const data = await res.json();

                    if (data.success && data.preview.title) {
                        const previewMetadata = JSON.stringify(data.preview);
                        // Save string as base64 to avoid markdown parsing breaking the JSON string
                        const encodedMeta = btoa(unescape(encodeURIComponent(previewMetadata)));
                        const linkCardMarkdown = `\n\n[link-preview:${encodedMeta}]\n\n`;
                        blogContentInput.value = blogContentInput.value.replace(placeholder, linkCardMarkdown);
                    } else {
                        // Revert to plain url if preview failed
                        blogContentInput.value = blogContentInput.value.replace(placeholder, `\n\n${url}\n\n`);
                    }
                    blogContentInput.dispatchEvent(new Event('input'));
                } catch (error) {
                    blogContentInput.value = blogContentInput.value.replace(placeholder, `\n\n${url}\n\n`);
                }
            }
        });

        // Live Preview in Split Mode and Autosave Draft
        let draftTimeout;
        const saveDraft = () => {
            clearTimeout(draftTimeout);
            draftTimeout = setTimeout(() => {
                const form = document.getElementById('blogForm');
                if (form && form.dataset.editId) {
                    // Do not overwrite the 'New Post' draft with an edit of an existing post
                    return;
                }

                const title = document.getElementById('blogTitleInput')?.value || '';
                const tags = document.getElementById('blogTagsInput')?.value || '';
                const content = document.getElementById('blogContentInput')?.value || '';

                if (title || content || tags) {
                    localStorage.setItem('draft_blog', JSON.stringify({ title, tags, content }));
                } else {
                    localStorage.removeItem('draft_blog');
                }
            }, 1000); // Debounce for 1 second
        };

        const updateOnInput = () => {
            if (window.innerWidth > 1024) {
                updateBlogPreview();
            }
            saveDraft();
        };

        blogContentInput.addEventListener('input', updateOnInput);
        document.getElementById('blogTitleInput')?.addEventListener('input', updateOnInput);
        document.getElementById('blogTagsInput')?.addEventListener('input', updateOnInput);

        // Add Autocomplete for @mentions and #tags
        setupAutocomplete(blogContentInput);
        setupTagsInputAutocomplete(document.getElementById('blogTagsInput'));
    }

    // Blog Modal Preview Tabs
    const blogWriteTab = document.getElementById('blogWriteTab');
    const blogPreviewTab = document.getElementById('blogPreviewTab');

    if (blogWriteTab && blogPreviewTab) {
        blogWriteTab.addEventListener('click', () => {
            blogWriteTab.classList.add('active');
            blogWriteTab.style.borderBottomColor = 'var(--color-accent-primary)';
            blogWriteTab.style.color = 'var(--color-accent-primary)';
            blogPreviewTab.classList.remove('active');
            blogPreviewTab.style.borderBottomColor = 'transparent';
            blogPreviewTab.style.color = 'var(--color-text-muted)';

            document.querySelector('.write-pane').style.display = 'flex';
            document.querySelector('.preview-pane').style.display = 'none';
        });

        blogPreviewTab.addEventListener('click', () => {
            blogPreviewTab.classList.add('active');
            blogPreviewTab.style.borderBottomColor = 'var(--color-accent-primary)';
            blogPreviewTab.style.color = 'var(--color-accent-primary)';
            blogWriteTab.classList.remove('active');
            blogWriteTab.style.borderBottomColor = 'transparent';
            blogWriteTab.style.color = 'var(--color-text-muted)';

            document.querySelector('.write-pane').style.display = 'none';
            document.querySelector('.preview-pane').style.display = 'flex';

            updateBlogPreview();
        });
    }
}

// Real-time Autocomplete implementation logic
function setupAutocomplete(textarea) {
    if (!textarea) return;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    document.body.appendChild(dropdown);

    let activeIndex = -1;
    let currentMatch = null;
    let lastQuery = null;

    const hideDropdown = () => {
        dropdown.style.display = 'none';
        currentMatch = null;
    };

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target !== textarea && !dropdown.contains(e.target)) {
            hideDropdown();
        }
    });

    // Keyboard navigation inside text area
    textarea.addEventListener('keydown', (e) => {
        if (dropdown.style.display === 'block') {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (activeIndex >= 0 && activeIndex < items.length) {
                    e.preventDefault();
                    items[activeIndex].click();
                }
            } else if (e.key === 'Escape') {
                hideDropdown();
            }
        }
    });

    const updateActiveItem = (items) => {
        items.forEach((item, idx) => {
            if (idx === activeIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    };

    textarea.addEventListener('input', async () => {
        const cursorPosition = textarea.selectionStart;
        const textBeforeCursor = textarea.value.substring(0, cursorPosition);

        // Match @mention or #hashtag at the end of what's typed
        // Note: allowing letters, numbers, hyphens, and spaces up to 20 characters for a broader match 
        const match = textBeforeCursor.match(/(?:^|\s)([@#])([\w\-\s]{0,20})$/);

        if (!match) {
            hideDropdown();
            return;
        }

        const type = match[1]; // "@" or "#"
        const query = match[2];
        // Calculate the starting index of the query
        const isSpaced = textBeforeCursor.match(/\s[@#][\w\-\s]{0,20}$/);
        currentMatch = { index: match.index + (isSpaced ? 1 : 0), length: query.length + 1, type };

        // Debounce requests
        if (query === lastQuery && dropdown.style.display === 'block') return;
        lastQuery = query;

        let results = [];
        try {
            if (type === '@') {
                const res = await fetch(`${API_BASE_URL}/api/profiles/search?q=${query}`);
                const data = await res.json();
                if (data.success && data.profiles.length > 0) {
                    results = data.profiles.slice(0, 5).map(p => ({ label: p.name, value: p.name }));
                }
            } else if (type === '#') {
                const res = await fetch(`${API_BASE_URL}/api/tags/search?q=${query}`);
                const data = await res.json();
                if (data.success && data.tags.length > 0) {
                    results = data.tags.slice(0, 5).map(t => ({ label: t, value: t }));
                }
            }
        } catch (e) {
            console.error('Autocomplete fetch error:', e);
        }

        if (results.length === 0) {
            hideDropdown();
            return;
        }

        // Render dropdown
        dropdown.innerHTML = '';
        results.forEach((result) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';

            // If the label accidentally contains the prefix already, strip it for clean display
            const cleanLabel = result.label.startsWith(type) ? result.label.substring(1) : result.label;

            item.innerHTML = `${type === '@' ? '👤' : '🏷️'} <strong>${type}${escapeHtml(cleanLabel)}</strong>`;

            // Handle Selection
            item.addEventListener('click', () => {
                const text = textarea.value;
                const newText = text.substring(0, currentMatch.index) + type + cleanLabel + ' ' + text.substring(cursorPosition);
                textarea.value = newText;

                // Reposition cursor right after newly inserted tag + space
                const newCursorPos = currentMatch.index + type.length + cleanLabel.length + 1;
                textarea.focus();
                textarea.setSelectionRange(newCursorPos, newCursorPos);

                hideDropdown();
                textarea.dispatchEvent(new Event('input')); // Trigger autosave
            });
            dropdown.appendChild(item);
        });

        // Position dropdown relatively to textarea container
        const rect = textarea.getBoundingClientRect();
        dropdown.style.top = `${rect.top + window.scrollY + 10}px`;
        dropdown.style.left = `${rect.left + window.scrollX + 20}px`;
        dropdown.style.display = 'block';

        activeIndex = 0;
        updateActiveItem(dropdown.querySelectorAll('.autocomplete-item'));
    });
}

function setupTagsInputAutocomplete(inputField) {
    if (!inputField) return;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    document.body.appendChild(dropdown);

    let activeIndex = -1;
    let currentMatch = null;
    let lastQuery = null;

    const hideDropdown = () => {
        dropdown.style.display = 'none';
        currentMatch = null;
    };

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target !== inputField && !dropdown.contains(e.target)) {
            hideDropdown();
        }
    });

    // Keyboard navigation inside text area
    inputField.addEventListener('keydown', (e) => {
        if (dropdown.style.display === 'block') {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (activeIndex >= 0 && activeIndex < items.length) {
                    e.preventDefault();
                    items[activeIndex].click();
                }
            } else if (e.key === 'Escape') {
                hideDropdown();
            }
        }
    });

    const updateActiveItem = (items) => {
        items.forEach((item, idx) => {
            if (idx === activeIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    };

    inputField.addEventListener('input', async () => {
        const cursorPosition = inputField.selectionStart;
        const textBeforeCursor = inputField.value.substring(0, cursorPosition);

        let commaIndex = textBeforeCursor.lastIndexOf(',');
        const startIndex = commaIndex !== -1 ? commaIndex + 1 : 0;
        const currentWord = textBeforeCursor.substring(startIndex);

        // Remove leading spaces
        const matches = currentWord.match(/^\s*(.*)$/);
        const leadingSpaces = currentWord.length - matches[1].length;
        const query = matches[1];

        // Only search if there are characters
        if (query.trim().length === 0) {
            hideDropdown();
            return;
        }

        currentMatch = { index: startIndex + leadingSpaces, length: query.length };

        // Debounce requests
        if (query === lastQuery && dropdown.style.display === 'block') return;
        lastQuery = query;

        let results = [];
        try {
            // Strip a leading '#' if the user typed it, since tags are saved in the DB without the '#' prefix
            const searchQuery = query.startsWith('#') ? query.substring(1) : query;
            const res = await fetch(`${API_BASE_URL}/api/tags/search?q=${searchQuery}`);
            const data = await res.json();
            if (data.success && data.tags.length > 0) {
                results = data.tags.slice(0, 5).map(t => ({ label: t, value: t }));
            }
        } catch (e) {
            console.error('Autocomplete fetch error:', e);
        }

        if (results.length === 0) {
            hideDropdown();
            return;
        }

        // Render dropdown
        dropdown.innerHTML = '';
        results.forEach((result) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';

            // Clean display
            const cleanLabel = result.label.startsWith('#') ? result.label.substring(1) : result.label;

            item.innerHTML = `🏷️ <strong>${escapeHtml(cleanLabel)}</strong>`;

            // Handle Selection
            item.addEventListener('click', () => {
                const text = inputField.value;

                // Find end of current tag (next comma or end of string)
                let nextComma = text.indexOf(',', currentMatch.index);
                if (nextComma === -1) nextComma = text.length;

                const newText = text.substring(0, currentMatch.index) + cleanLabel + text.substring(nextComma);
                inputField.value = newText;

                // Reposition cursor right after newly inserted text
                const newCursorPos = currentMatch.index + cleanLabel.length;
                inputField.focus();
                inputField.setSelectionRange(newCursorPos, newCursorPos);

                hideDropdown();
                inputField.dispatchEvent(new Event('input')); // Trigger autosave
            });
            dropdown.appendChild(item);
        });

        // Position dropdown relatively to input container
        const rect = inputField.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 2}px`;
        dropdown.style.left = `${rect.left + window.scrollX}px`;
        dropdown.style.display = 'block';

        activeIndex = 0;
        updateActiveItem(dropdown.querySelectorAll('.autocomplete-item'));
    });
}

function updateBlogPreview() {
    const blogTitleInput = document.getElementById('blogTitleInput');
    const blogTagsInput = document.getElementById('blogTagsInput');
    const blogContentInput = document.getElementById('blogContentInput');
    const blogPreviewContent = document.getElementById('blogPreviewContent');
    if (!blogContentInput || !blogPreviewContent) return;

    const title = blogTitleInput ? blogTitleInput.value : 'Post Title';
    const tags = blogTagsInput ? blogTagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [];
    let content = blogContentInput.value || '';

    // Extract hero image logic like showBlogDetail
    const imgMatch = content.match(/!\[.*?\]\((.*?)\)/);
    const heroImageUrl = imgMatch ? imgMatch[1] : null;

    if (heroImageUrl) {
        content = content.replace(/!\[.*?\]\(.*?\)/, '');
    }

    const renderedContent = typeof marked !== 'undefined' ? marked.parse(content || '*No content to preview*') : escapeHtml(content);

    blogPreviewContent.innerHTML = `
        <article class="blog-detail" style="border: none; box-shadow: none; background: transparent;">
            <header class="blog-header" style="padding: 0 0 1.5rem 0;">
                <h1 style="font-size: 1.75rem; margin-bottom: 1rem;">${escapeHtml(title || 'Post Title')}</h1>
                <div class="blog-author-strip">
                    <div class="author-info-sm" style="margin-left: 0;">
                        <span class="author-name">Draft by You</span>
                        <span class="post-date">Just now</span>
                    </div>
                </div>
            </header>

            ${heroImageUrl ? `
            <div class="blog-hero-image" style="margin-bottom: 2rem; border-radius: var(--radius-md);">
                <img src="${getImageUrl(heroImageUrl)}" alt="Preview">
            </div>` : ''}

            <div class="blog-content markdown-body" style="padding: 0;">
                ${renderedContent}
            </div>
            
            ${tags.length > 0 ? `
            <div class="blog-tags" style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border);">
                ${tags.map(tag => `<span class="blog-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>` : ''}
        </article>
    `;
}

function showForgotPasswordForm() {
    document.getElementById('modalTitle').textContent = 'Forgot Password';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'block';
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('forgotEmail').focus();
}

function showResetForm(email) {
    document.getElementById('modalTitle').textContent = 'Reset Password';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('resetPasswordForm').style.display = 'block';
    document.getElementById('resetEmail').value = email;
    document.getElementById('resetToken').focus();
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    document.getElementById('forgotPasswordForm').reset();
    document.getElementById('resetPasswordForm').reset();
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('forgotError').style.display = 'none';
    document.getElementById('resetError').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('loginModalTitle').textContent = 'Create Account';
    document.getElementById('regName').focus();
}

function showLoginForm() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('loginModalTitle').textContent = 'Login';
    document.getElementById('loginEmail').focus();
}

function handleRouting() {
    const hash = window.location.hash;

    if (hash.startsWith('#blog-')) {
        const blogId = hash.replace('#blog-', '');
        showBlogDetail(blogId, false); // false = don't push state
    } else if (hash === '#profiles') {
        switchTab('profiles', false);
    } else if (hash === '#my-profile') {
        switchTab('my-profile', false);
    } else {
        // Default to blogs
        switchTab('blogs', false);
    }
}

function switchTab(tabId, pushState = true) {
    const blogsSection = document.getElementById('blogsSection');
    const profilesSection = document.getElementById('profilesSection');
    const searchSection = document.getElementById('searchSection');
    const myProfileSection = document.getElementById('myProfileSection');

    // Update active class on nav tabs
    const tabs = document.querySelectorAll('.nav-tab, .bottom-nav-item[data-tab]');
    tabs.forEach(tab => {
        if (tab.dataset.tab === tabId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    if (pushState) {
        window.location.hash = tabId;
    }

    // Hide all
    blogsSection.style.display = 'none';
    profilesSection.style.display = 'none';
    searchSection.style.display = 'none';
    myProfileSection.style.display = 'none';
    
    const blogStickyHeader = document.getElementById('blogStickyHeader');
    if (blogStickyHeader) blogStickyHeader.style.display = 'none';

    if (tabId === 'blogs') {
        blogsSection.style.display = 'block';
        if (blogStickyHeader) blogStickyHeader.style.display = 'flex';
        loadBlogs();
    } else if (tabId === 'profiles') {
        profilesSection.style.display = 'block';
        searchSection.style.display = 'block';
        loadProfiles();
    } else if (tabId === 'my-profile') {
        myProfileSection.style.display = 'block';
        loadMyProfile();
    }
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('active');
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordError').style.display = 'none';
}

async function handleChangePassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('changePasswordError');
    const submitBtn = document.getElementById('submitChangePasswordBtn');

    if (newPassword !== confirmNewPassword) {
        errorEl.textContent = 'New passwords do not match';
        errorEl.style.display = 'block';
        return;
    }

    if (newPassword.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters long';
        errorEl.style.display = 'block';
        return;
    }

    // UI Loading state
    submitBtn.classList.add('loading');
    errorEl.style.display = 'none';

    try {
        const response = await fetch(API_BASE_URL + '/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser ? currentUser.token : ''
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();

        if (data.success) {
            closeChangePasswordModal();
            showToast('Password updated successfully', 'success');
        } else {
            errorEl.textContent = data.error || 'Update failed';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Password change error:', error);
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        submitBtn.classList.remove('loading');
    }
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
        const response = await fetch(API_BASE_URL + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = {
                token: data.token,
                user: data.user
            };
            localStorage.setItem('adminSession', JSON.stringify(currentUser));

            closeLoginModal();
            updateUIForRole();

            // Register for push notifications now that we have a valid session
            initPushNotifications();

            // All users now start on blogs by default
            switchTab('blogs');

            showToast(`Welcome back, ${data.user.name}!`, 'success');
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

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const errorEl = document.getElementById('registerError');
    const submitBtn = document.getElementById('submitRegisterBtn');

    submitBtn.classList.add('loading');
    errorEl.style.display = 'none';

    try {
        const response = await fetch(API_BASE_URL + '/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = {
                token: data.token,
                user: data.user
            };
            localStorage.setItem('adminSession', JSON.stringify(currentUser));

            closeLoginModal();
            updateUIForRole();
            switchTab('blogs');

            showToast(`Account created! Welcome, ${data.user.name}`, 'success');
        } else {
            errorEl.textContent = data.error || 'Registration failed';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Registration error:', error);
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        submitBtn.classList.remove('loading');
    }
}

function updateUIForRole(switchView = true) {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminBadge = document.getElementById('adminBadge');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const addProfileBtn = document.getElementById('addProfileBtn');
    const mainNavTabs = document.getElementById('mainNavTabs');
    const adminProfilesTab = document.getElementById('adminProfilesTab');
    const userProfileTab = document.getElementById('userProfileTab');
    const newBlogBtn = document.getElementById('newBlogBtn');
    const userAvatar = document.getElementById('userAvatar');
    const notificationBellWrap = document.getElementById('notificationBellWrap');
    const mobileBottomNav = document.getElementById('mobileBottomNav');

    if (currentUser) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (changePasswordBtn) changePasswordBtn.style.display = 'flex';
        if (notificationBellWrap) notificationBellWrap.style.display = 'block';
        if (mobileBottomNav) mobileBottomNav.style.display = 'flex';
        mainNavTabs.style.display = 'flex';

        // Update Header Avatar
        if (userAvatar) {
            const user = currentUser.user;
            const initials = getInitials(user.name);
            userAvatar.innerHTML = user.imageUrl
                ? `<img src="${getImageUrl(user.imageUrl)}" alt="${escapeHtml(user.name)}">`
                : initials;
            userAvatar.style.display = 'flex';
        }

        // Start notification polling
        if (!notifPollingInterval) {
            fetchNotifications(); // Initial fetch
            notifPollingInterval = setInterval(fetchNotifications, 60000); // Poll every minute
        }

        const bottomProfilesTab = document.getElementById('bottomProfilesTab');
        const bottomProfileTab = document.getElementById('bottomProfileTab');

        if (currentUser.user.role === 'admin') {
            if (adminBadge) adminBadge.style.display = 'flex';
            if (addProfileBtn) addProfileBtn.style.display = 'flex';
            if (adminProfilesTab) adminProfilesTab.style.display = 'flex';
            if (userProfileTab) userProfileTab.style.display = 'none';
            if (bottomProfilesTab) bottomProfilesTab.style.display = 'flex';
            if (bottomProfileTab) bottomProfileTab.style.display = 'none';
        } else {
            if (adminBadge) adminBadge.style.display = 'none';
            if (addProfileBtn) addProfileBtn.style.display = 'none';
            if (adminProfilesTab) adminProfilesTab.style.display = 'none';
            if (userProfileTab) userProfileTab.style.display = 'flex';
            if (bottomProfilesTab) bottomProfilesTab.style.display = 'none';
            if (bottomProfileTab) bottomProfileTab.style.display = 'flex';
        }
        // All logged-in users can create posts
        if (newBlogBtn) newBlogBtn.style.display = 'flex';
        if (switchView) switchTab('blogs');
    } else {
        // Guest: show login button, hide user actions
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (adminBadge) adminBadge.style.display = 'none';
        if (changePasswordBtn) changePasswordBtn.style.display = 'none';
        if (notificationBellWrap) notificationBellWrap.style.display = 'none';
        if (mobileBottomNav) mobileBottomNav.style.display = 'none';
        if (addProfileBtn) addProfileBtn.style.display = 'none';
        if (userAvatar) userAvatar.style.display = 'none';
        mainNavTabs.style.display = 'none';

        // Clear notification polling
        if (notifPollingInterval) {
            clearInterval(notifPollingInterval);
            notifPollingInterval = null;
        }

        // Guests can see blogs and are shown New Post to encourage registration
        if (newBlogBtn) newBlogBtn.style.display = 'flex';
        if (switchView) switchTab('blogs');
    }
}

async function loadBlogs() {
    const blogsGrid = document.getElementById('blogsGrid');
    const loadingState = document.getElementById('blogLoadingState');
    const emptyState = document.getElementById('blogEmptyState');

    // Disable reading progress bar when not in detail
    const progressBar = document.getElementById('readingProgressBar');
    if (progressBar) progressBar.style.display = 'none';

    loadingState.style.display = 'none';
    emptyState.style.display = 'none';
    blogsGrid.innerHTML = generateSkeletons(3, 'blog');

    try {
        const headers = {};
        if (currentUser) headers['x-auth-token'] = currentUser.token;
        const response = await fetch(API_BASE_URL + '/api/blogs', { headers });
        const data = await response.json();

        if (data.success) {
            blogs = data.blogs; // Store it
            if (data.blogs.length === 0) {
                emptyState.style.display = 'block';
            } else {
                renderBlogs(data.blogs);
            }
        }
    } catch (error) {
        console.error('Error loading blogs:', error);
    } finally {
        loadingState.style.display = 'none';
    }
}

function closeBlogModal() {
    document.getElementById('blogModal').classList.remove('active');
    const form = document.getElementById('blogForm');
    form.reset();
    form.removeAttribute('data-edit-id');
    document.getElementById('submitBlogBtn').classList.remove('loading');

    // Reset tabs
    const blogWriteTab = document.getElementById('blogWriteTab');
    if (blogWriteTab) blogWriteTab.click();
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    const errorEl = document.getElementById('forgotError');
    const submitBtn = document.getElementById('submitForgotBtn');

    submitBtn.classList.add('loading');
    errorEl.style.display = 'none';

    try {
        const response = await fetch(API_BASE_URL + '/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Reset code generated (simulated)! Check your console/response.', 'info');
            // In a real app, the user would check email. 
            // Here, we'll help them by showing the form and they can "guess" the code or we show it.
            console.log('RESET CODE:', data.token); // Helpful for the user in this demo
            showResetForm(email);
        } else {
            errorEl.textContent = data.error || 'Failed to process request';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Forgot password error:', error);
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        submitBtn.classList.remove('loading');
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const token = document.getElementById('resetToken').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value.trim();
    const errorEl = document.getElementById('resetError');
    const submitBtn = document.getElementById('submitResetBtn');

    submitBtn.classList.add('loading');
    errorEl.style.display = 'none';

    try {
        const response = await fetch(API_BASE_URL + '/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, token, newPassword })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Password reset successfully! Please login.', 'success');
            showLoginForm();
        } else {
            errorEl.textContent = data.error || 'Reset failed';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Reset password error:', error);
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        submitBtn.classList.remove('loading');
    }
}

async function handleBlogImageUpload(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file.', 'error');
        return;
    }

    if (file.size > 5 * 1024 * 1024) { // Increased to 5MB for server storage
        showToast('Image is too large. Max 5MB.', 'error');
        return;
    }

    const blogContentInput = document.getElementById('blogContentInput');

    // Add a placeholder while processing
    const placeholder = `\n![Processing ${file.name}...]()\n`;
    const cursorFallback = blogContentInput.value.length;
    const start = blogContentInput.selectionStart ?? cursorFallback;
    const end = blogContentInput.selectionEnd ?? cursorFallback;
    blogContentInput.value = blogContentInput.value.substring(0, start) + placeholder + blogContentInput.value.substring(end);

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;

            // Upload to backend
            const response = await fetch(API_BASE_URL + '/api/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': currentUser ? currentUser.token : ''
                },
                body: JSON.stringify({
                    image: base64,
                    name: file.name,
                    type: file.type
                })
            });

            const data = await response.json();

            if (data.success) {
                const markdownImage = `\n![${file.name}](${data.url})\n`;
                blogContentInput.value = blogContentInput.value.replace(placeholder, markdownImage);
                blogContentInput.dispatchEvent(new Event('input'));

                // Switch to Preview tab on mobile to show the image view immediately
                if (window.innerWidth <= 1024) {
                    const blogPreviewTab = document.getElementById('blogPreviewTab');
                    if (blogPreviewTab) {
                        blogPreviewTab.click();
                    }
                }
            } else {
                throw new Error(data.error);
            }
        };
        reader.readAsDataURL(file);
    } catch (error) {
        console.error('Error uploading image:', error);
        blogContentInput.value = blogContentInput.value.replace(placeholder, '');
        showToast('Failed to upload image: ' + error.message, 'error');
    }
}

async function handleBlogSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('blogTitleInput').value.trim();
    const tags = document.getElementById('blogTagsInput').value.split(',').map(t => t.trim()).filter(t => t);
    const content = document.getElementById('blogContentInput').value.trim();
    const submitBtn = document.getElementById('submitBlogBtn');

    const form = document.getElementById('blogForm');
    const editBlogId = form.dataset.editId;

    submitBtn.classList.add('loading');

    try {
        const url = editBlogId ? `${API_BASE_URL}/api/blogs/${editBlogId}` : API_BASE_URL + '/api/blogs';
        const method = editBlogId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser ? currentUser.token : ''
            },
            body: JSON.stringify({ title, tags, content })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.removeItem('draft_blog');
            showToast(editBlogId ? 'Blog post updated!' : 'Blog post published!', 'success');
            form.removeAttribute('data-edit-id');
            closeBlogModal();
            loadBlogs();
        } else {
            showToast(data.error || 'Failed to publish blog', 'error');
        }
    } catch (error) {
        console.error('Error publishing blog:', error);
        showToast('Connection error. Please try again.', 'error');
    } finally {
        submitBtn.classList.remove('loading');
    }
}

async function showBlogDetail(id, pushState = true) {
    if (pushState) {
        window.location.hash = `blog-${id}`;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${id}`);
        const data = await response.json();

        if (data.success) {
            const blog = data.blog;

            // Extract hero image if present and remove it from content to avoid duplication
            let content = blog.content;
            const imgMatch = content.match(/!\[.*?\]\((.*?)\)/);
            const heroImageUrl = imgMatch ? imgMatch[1] : null;

            if (heroImageUrl) {
                // Remove the first image match from the content
                content = content.replace(/!\[.*?\]\(.*?\)/, '');
            }

            // Transform [sandbox:id] into iframe
            content = content.replace(/\[sandbox:(.*?)\]/g, (match, id) => {
                return `
                <div class="sandbox-wrapper" style="margin: 2rem 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--color-border); height: 500px; box-shadow: var(--shadow-md);">
                    <iframe src="https://codesandbox.io/embed/${id}?fontsize=14&hidenavigation=1&theme=dark"
                        style="width:100%; height:500px; border:0; overflow:hidden;"
                        title="CodeSandbox Embed"
                        allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
                        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
                    ></iframe>
                </div>`;
            });

            // Transform [link-preview:base64] into Rich Cards
            content = content.replace(/\[link-preview:(.*?)\]/g, (match, base64Str) => {
                try {
                    const decodedMeta = decodeURIComponent(escape(atob(base64Str)));
                    const meta = JSON.parse(decodedMeta);
                    return `
                    <div style="margin: 2rem 0;">
                        <a href="${escapeHtml(meta.url)}" target="_blank" style="text-decoration: none; color: inherit; display: block; border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; background: var(--bg-card); transition: transform 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm);" onmouseover="this.style.boxShadow='var(--shadow-md)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.boxShadow='var(--shadow-sm)'; this.style.transform='translateY(0)';">
                            ${meta.image ? `<div style="width: 100%; height: 200px; background-image: url('${escapeHtml(meta.image)}'); background-size: cover; background-position: center;"></div>` : ''}
                            <div style="padding: 1rem;">
                                <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--color-text);">${escapeHtml(meta.title || 'Link')}</h3>
                                ${meta.description ? `<p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(meta.description)}</p>` : ''}
                                <span style="font-size: 0.8rem; color: var(--color-accent-primary); display: flex; align-items: center; gap: 4px;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                    ${escapeHtml(new URL(meta.url).hostname)}
                                </span>
                            </div>
                        </a>
                    </div>`;
                } catch (e) {
                    return ''; // Fallback if data is corrupted
                }
            });

            let renderedContent = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');

            // Convert @mentions and #hashtags to clickable/styled links inside the HTML
            // Note: We avoid replacing content inside existing hrefs/srcs by using a naive lookbehind
            renderedContent = renderedContent.replace(/(^|\s)@(\w+)/g, '$1<span style="color: var(--color-accent-primary); font-weight: 500; cursor: pointer;">@$2</span>');
            renderedContent = renderedContent.replace(/(^|\s)#(\w+)/g, '$1<span style="color: var(--color-accent-primary); cursor: pointer;">#$2</span>');

            const detailHtml = `
                <div class="blog-detail-container">
                    <div class="blog-detail-actions">
                        <button class="btn btn-secondary btn-sm back-to-list" onclick="switchTab('blogs')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                                <line x1="19" y1="12" x2="5" y2="12"></line>
                                <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                            Back to Insights
                        </button>
                        <button class="btn btn-primary btn-sm ai-explain-btn" onclick="toggleChat(); chatInput.value = 'Can you explain the key takeaways from the blog post \\'${escapeHtml(blog.title)}\\'?'; handleChatSubmit(new Event('submit'));">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                            </svg>
                            Ask AI about this
                        </button>
                    </div>

                    <article class="blog-detail">
                        <header class="blog-header">
                            <div class="blog-category">Technical Insight</div>
                            <h1>${escapeHtml(blog.title)}</h1>
                            
                            <div class="blog-author-strip">
                                <div class="author-avatar-sm">${getInitials(blog.author.name)}</div>
                                <div class="author-info-sm">
                                    <span class="author-name">${escapeHtml(blog.author.name)}</span>
                                    <span class="post-date">${new Date(blog.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                                <div class="reading-time-badge">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    ${Math.max(1, Math.ceil(blog.content.trim().split(/\s+/).length / 200))} min read
                                </div>
                            </div>
                        </header>

                        ${heroImageUrl ? `
                        <div class="blog-hero-image">
                            <img src="${getImageUrl(heroImageUrl)}" alt="${escapeHtml(blog.title)}">
                        </div>` : ''}

                        <div class="blog-content markdown-body">
                            ${renderedContent}
                        </div>

                        <footer class="blog-footer">
                            <div class="blog-tags">
                                ${(blog.tags || []).map(tag => `<span class="blog-tag">#${escapeHtml(tag)}</span>`).join('')}
                            </div>
                            
                            ${blog.mentions && blog.mentions.length > 0 ? `
                            <div class="blog-tags" style="margin-top: 10px;">
                                <span style="font-size: 0.85rem; color: var(--color-text-muted); margin-right: 10px;">Mentions:</span>
                                ${(blog.mentions || []).map(mention => `<span class="blog-tag" style="background: rgba(99, 102, 241, 0.1); color: var(--color-accent-primary);">@${escapeHtml(mention)}</span>`).join('')}
                            </div>
                            ` : ''}

                            <div class="blog-interaction-bar">
                                <button class="interaction-btn like-btn ${blog.likes && currentUser && blog.likes.includes(currentUser.user.id) ? 'active' : ''}" onclick="toggleLike('${blog._id}', this)">
                                    <svg viewBox="0 0 24 24" fill="${blog.likes && currentUser && blog.likes.includes(currentUser.user.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                                    </svg>
                                    ${blog.likes ? blog.likes.length : 0} ${(blog.likes && blog.likes.length === 1) ? 'Like' : 'Likes'}
                                </button>
                                <button class="interaction-btn" onclick="document.getElementById('commentInput') ? document.getElementById('commentInput').focus() : null">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                                    </svg>
                                    ${blog.comments ? blog.comments.length : 0} Comments
                                </button>
                                <button class="interaction-btn share-btn" onclick="shareBlog('${blog.title.replace(/'/g, "\\'")}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="18" cy="5" r="3"></circle>
                                        <circle cx="6" cy="12" r="3"></circle>
                                        <circle cx="18" cy="19" r="3"></circle>
                                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                                    </svg>
                                    Share
                                </button>
                            </div>

                            <div class="author-card" style="margin-top: 1.5rem;">
                                <div class="author-avatar-large">${getInitials(blog.author.name)}</div>
                                <div class="author-bio">
                                    <h4>Written by ${escapeHtml(blog.author.name)}</h4>
                                    <p>Technical contributor at TechForge. Sharing insights on software architecture, modern web development, and AI implementation.</p>
                                </div>
                            </div>

                            <!-- Comments Section -->
                            <div class="blog-comments-section">
                                <h3>Comments (${blog.comments ? blog.comments.length : 0})</h3>
                                
                                ${currentUser ? `
                                <div class="comment-input-area">
                                    <div class="author-avatar-sm" style="flex-shrink: 0;">${getInitials(currentUser.user.name)}</div>
                                    <textarea id="commentInput" class="comment-input" placeholder="Add a comment..."></textarea>
                                    <button class="btn btn-primary" style="height: fit-content;" onclick="addComment('${blog._id}')">Post</button>
                                </div>
                                ` : `
                                <div style="margin-bottom: 2rem; padding: 1rem; background: var(--color-bg-tertiary); border-radius: 8px; text-align: center;">
                                    <p style="color: var(--color-text-secondary); margin-bottom: 1rem;">Please log in to join the conversation.</p>
                                    <button class="btn btn-primary" onclick="window.scrollTo({top: 0}); document.getElementById('loginModal').classList.add('active');">Log In to Comment</button>
                                </div>
                                `}

                                <div class="comments-list">
                                    ${(blog.comments || []).slice().reverse().map(comment => `
                                        <div class="comment-item">
                                            <div class="author-avatar-sm" style="flex-shrink: 0; width: 36px; height: 36px; font-size: 0.8rem;">${getInitials(comment.userName)}</div>
                                            <div class="comment-content">
                                                <h5>${escapeHtml(comment.userName)}</h5>
                                                <span class="comment-date">${new Date(comment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute:'2-digit' })}</span>
                                                <p>${escapeHtml(comment.content)}</p>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </footer>
                    </article>
                </div>
            `;
            document.getElementById('blogsGrid').innerHTML = detailHtml;
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // Enable reading progress bar
            const progressBar = document.getElementById('readingProgressBar');
            if (progressBar) {
                progressBar.style.display = 'block';
                progressBar.style.width = '0%';
            }
        }
    } catch (error) {
        console.error('Error loading blog detail:', error);
        showToast('Failed to load blog details', 'error');
    }
}

function renderBlogs(blogs) {
    const isAdmin = currentUser && currentUser.user.role === 'admin';
    const blogsGrid = document.getElementById('blogsGrid');

    blogsGrid.innerHTML = blogs.map(blog => {
        const isAuthor = currentUser && currentUser.user && (currentUser.user._id === blog.author.id || currentUser.user.id === blog.author.id);
        const canEditOrDelete = isAdmin || isAuthor;

        // Extract hero image if present and remove it from content
        let content = blog.content;
        const imgMatch = content.match(/!\[.*?\]\((.*?)\)/);
        const heroImageUrl = imgMatch ? imgMatch[1] : null;
        if (heroImageUrl) content = content.replace(/!\[.*?\]\(.*?\)/, '');

        // Transform sandboxes
        content = content.replace(/\[sandbox:(.*?)\]/g, (match, id) => {
            return `<div class="sandbox-wrapper" style="margin: 1rem 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--color-border); height: 400px; box-shadow: var(--shadow-sm);"><iframe src="https://codesandbox.io/embed/${id}?fontsize=14&hidenavigation=1&theme=dark" style="width:100%; height:400px; border:0; overflow:hidden;" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe></div>`;
        });

        // Transform link previews
        content = content.replace(/\[link-preview:(.*?)\]/g, (match, base64Str) => {
            try {
                const meta = JSON.parse(decodeURIComponent(escape(atob(base64Str))));
                return `<div style="margin: 1rem 0;"><a href="${escapeHtml(meta.url)}" target="_blank" style="text-decoration: none; color: inherit; display: block; border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; background: var(--bg-card); transition: transform 0.2s;"><div style="padding: 1rem;"><h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--color-text);">${escapeHtml(meta.title || 'Link')}</h3><p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-text-muted);">${escapeHtml(meta.description || '')}</p></div></a></div>`;
            } catch (e) { return ''; }
        });

        // Render Markdown
        let renderedContent = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');
        renderedContent = renderedContent.replace(/(^|\s)@(\w+)/g, '$1<span style="color: var(--color-accent-primary); font-weight: 500; cursor: pointer;">@$2</span>');
        renderedContent = renderedContent.replace(/(^|\s)#(\w+)/g, '$1<span style="color: var(--color-accent-primary); cursor: pointer;">#$2</span>');

        return `
            <div class="blog-card" style="cursor: default;" id="blog-${blog._id}">
                <div class="blog-card-content">
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div class="author-avatar-sm" style="width: 48px; height: 48px; font-size: 1.1rem; flex-shrink: 0;">${getInitials(blog.author.name)}</div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0; font-size: 1rem; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(blog.author.name)}</h4>
                            <span style="font-size: 0.8rem; color: var(--color-text-muted);">${new Date(blog.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                            ${currentUser && !isAuthor ? `
                            <button class="follow-btn ${blog.author.isFollowedByCurrentUser ? 'following' : ''}"
                                id="follow-btn-${blog.author.id}"
                                onclick="toggleFollow('${blog.author.id}', this)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                    <circle cx="8.5" cy="7" r="4"/>
                                    ${blog.author.isFollowedByCurrentUser
                                        ? `<polyline points="17 11 19 13 23 9"/>`
                                        : `<line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>`}
                                </svg>
                                ${blog.author.isFollowedByCurrentUser ? 'Following' : 'Follow'}
                            </button>` : ''}
                            ${canEditOrDelete ? `
                            <button class="btn btn-secondary btn-icon blog-action-btn" title="Edit post" onclick="editBlogPost('${blog._id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="btn btn-danger btn-icon blog-action-btn" title="Delete post" onclick="deleteBlogPost('${blog._id}', this)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1 2-2h4a2,2 0 0,1 2,2v2"/></svg>
                            </button>` : ''}
                        </div>
                    </div>

                    <h2 style="font-size: 1.25rem; margin-bottom: 1rem; color: var(--color-text-primary);">${escapeHtml(blog.title)}</h2>

                    ${heroImageUrl ? `
                    <div class="blog-card-image" style="margin: 1rem 0 -0.5rem 0; border-radius: var(--radius-md); overflow: hidden;">
                        <img src="${getImageUrl(heroImageUrl)}" alt="${escapeHtml(blog.title)}">
                    </div>
                    ` : ''}

                    <div class="blog-content markdown-body" style="margin-top: 1rem; max-height: 400px; overflow-y: auto;">
                        ${renderedContent}
                    </div>

                    <div class="blog-tags" style="margin-top: 1rem;">
                        ${(blog.tags || []).map(tag => `<span class="blog-tag">#${escapeHtml(tag)}</span>`).join('')}
                    </div>
                </div>

                <div class="blog-interaction-bar" style="margin-top: 1rem; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); padding: 0.5rem 0; margin-left: var(--spacing-lg); margin-right: var(--spacing-lg);">
                    <button class="interaction-btn like-btn ${blog.likes && currentUser && blog.likes.includes(currentUser.user.id) ? 'active' : ''}" onclick="toggleLike('${blog._id}', this)">
                        <svg viewBox="0 0 24 24" fill="${blog.likes && currentUser && blog.likes.includes(currentUser.user.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        ${blog.likes ? blog.likes.length : 0}
                    </button>
                    <button class="interaction-btn" onclick="const cc = document.getElementById('comments-${blog._id}'); cc.style.display = cc.style.display === 'none' ? 'block' : 'none';">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                        </svg>
                        ${blog.comments ? blog.comments.length : 0}
                    </button>
                    <button class="interaction-btn share-btn" onclick="shareBlog('${blog.title.replace(/'/g, "\\'")}', '${blog._id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="18" cy="5" r="3"></circle>
                            <circle cx="6" cy="12" r="3"></circle>
                            <circle cx="18" cy="19" r="3"></circle>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                        </svg>
                        Share
                    </button>
                </div>

                <!-- Inline Comments Section -->
                <div id="comments-${blog._id}" style="display: none; padding: 1rem var(--spacing-lg);">
                    ${currentUser ? `
                    <div class="comment-input-area" style="margin-bottom: 1rem;">
                        <textarea id="commentInput-${blog._id}" class="comment-input" placeholder="Add a comment..." style="min-height: 40px; padding: 8px 12px; font-size: 0.9rem;"></textarea>
                        <button class="btn btn-primary btn-sm" style="height: fit-content;" onclick="addInlineComment('${blog._id}')">Post</button>
                    </div>
                    ` : `<p style="font-size: 0.85rem; color: var(--color-text-muted); text-align: center;">Log in to join the conversation</p>`}
                    
                    <div class="comments-list">
                        ${(blog.comments || []).slice().reverse().map(c => `
                            <div class="comment-item" style="gap: 0.75rem; margin-bottom: 0.75rem;">
                                <div class="author-avatar-sm" style="flex-shrink: 0; width: 32px; height: 32px; font-size: 0.75rem;">${getInitials(c.userName)}</div>
                                <div class="comment-content" style="padding: 0.5rem 0.75rem;">
                                    <h5 style="margin-bottom: 2px; font-size: 0.85rem;">${escapeHtml(c.userName)}</h5>
                                    <p style="font-size: 0.9rem; margin:0;">${escapeHtml(c.content)}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteBlogPost(id, btn) {
    if (!confirm('Delete this blog post? This cannot be undone.')) return;

    btn.disabled = true;
    btn.classList.add('loading');

    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${id}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': currentUser ? currentUser.token : '' }
        });
        const data = await response.json();

        if (data.success) {
            showToast('Blog post deleted.', 'success');
            loadBlogs();
        } else {
            showToast(data.error || 'Failed to delete post', 'error');
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    } catch (error) {
        console.error('Error deleting blog:', error);
        showToast('Connection error. Please try again.', 'error');
        btn.disabled = false;
        btn.classList.remove('loading');
    }
}

async function editBlogPost(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${id}`);
        const data = await response.json();

        if (data.success && data.blog) {
            const blog = data.blog;
            document.getElementById('blogTitleInput').value = blog.title || '';
            document.getElementById('blogTagsInput').value = (blog.tags || []).join(', ');
            document.getElementById('blogContentInput').value = blog.content || '';

            const form = document.getElementById('blogForm');
            form.dataset.editId = blog._id;

            // Switch to write tab and update preview if large screen
            const blogWriteTab = document.getElementById('blogWriteTab');
            if (blogWriteTab) blogWriteTab.click();

            if (window.innerWidth > 1024 && typeof updateBlogPreview === 'function') {
                updateBlogPreview();
            }

            document.getElementById('blogModal').classList.add('active');
        } else {
            showToast('Failed to load blog for editing', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Connection error while fetching post details', 'error');
    }
}

async function loadMyProfile() {
    const content = document.getElementById('myProfileContent');

    try {
        const response = await fetch(API_BASE_URL + '/api/profiles/me', {
            headers: { 'x-auth-token': currentUser ? currentUser.token : '' }
        });

        if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
        }

        const data = await response.json();

        if (data.success) {
            renderMyProfile(data.profile);
        } else {
            content.innerHTML = `<p class="error">${data.error || 'Failed to load profile'}</p>`;
        }
    } catch (error) {
        console.error('Error loading personal profile:', error);
        content.innerHTML = `<p class="error">Connection error. Please try again.</p>`;
    }
}

function renderMyProfile(profile) {
    const content = document.getElementById('myProfileContent');
    const userBlogs = blogs.filter(b => b.author && b.author.id === profile._id);
    const joinDate = new Date(profile.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    content.innerHTML = `
        <div class="profile-detail-view">
            <div class="profile-banner"></div>
            <div class="profile-detail-content">
                <div class="profile-image-container large">
                    ${profile.imageUrl
            ? `<img src="${getImageUrl(profile.imageUrl)}" alt="${escapeHtml(profile.name)}">`
            : `<div class="profile-initials xl">${profile.name[0]}</div>`
        }
                </div>
                
                <h3>${escapeHtml(profile.name)}</h3>
                <span class="role-badge">${escapeHtml(profile.role || 'Professional')}</span>
                
                <div class="profile-stats">
                    <div class="stat-item">
                        <span class="stat-value">${userBlogs.length}</span>
                        <span class="stat-label">Posts</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">0</span>
                        <span class="stat-label">Likes</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${joinDate}</span>
                        <span class="stat-label">Joined</span>
                    </div>
                </div>

                <div class="profile-info-grid">
                    <div class="info-group">
                        <h4>Contact Information</h4>
                        <p>${escapeHtml(profile.email)}</p>
                    </div>
                    ${profile.bio ? `
                        <div class="info-group">
                            <h4>Professional Bio</h4>
                            <p>${escapeHtml(profile.bio)}</p>
                        </div>
                    ` : ''}
                </div>

                <div class="my-profile-actions">
                    <button class="btn btn-primary" onclick="document.getElementById('newBlogBtn').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 8px;">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        New Post
                    </button>
                    <button class="btn btn-secondary" onclick="openModal(${JSON.stringify(profile).replace(/"/g, '&quot;')})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 8px;">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit Profile
                    </button>
                </div>
            </div>
        </div>
    `;
}

function handleLogout() {
    if (!confirm('Are you sure you want to log out?')) return;

    currentUser = null;
    // Clear all possible session keys (belt-and-suspenders)
    localStorage.removeItem('adminSession');
    localStorage.removeItem('currentUser');
    // Using explicit href fixes Android Capacitor Webview white screen on reload
    window.location.href = 'index.html';
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

        const response = await fetch(url, {
            headers: currentUser ? { 'x-auth-token': currentUser.token } : {}
        });

        if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
        }

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

// Clears a stale or invalid session (e.g. old token from before JWT migration)
function handleUnauthorized() {
    localStorage.removeItem('adminSession');
    localStorage.removeItem('currentUser');
    currentUser = null;
    updateUIForRole(true);
    showToast('Session expired. Please log in again.', 'error');
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
    const avatarHtml = profile.imageUrl
        ? `<img src="${getImageUrl(profile.imageUrl)}" alt="${escapeHtml(profile.name)}">`
        : initials;

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
                <div class="profile-avatar">${avatarHtml}</div>
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
    if (show) {
        profilesGrid.innerHTML = generateSkeletons(4, 'profile');
        emptyState.style.display = 'none';
        loadingState.style.display = 'none'; // Use skeletons instead of generic spinner
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

        // Handle Image Preview
        imageUrlInput.value = profile.imageUrl || '';
        imagePreview.innerHTML = profile.imageUrl ? `<img src="${getImageUrl(profile.imageUrl)}" alt="Preview">` : '';
        if (!profile.imageUrl) {
            resetImagePreview();
        }

        // Security: Only admins can change roles or emails
        const isAdmin = currentUser && currentUser.user.role === 'admin';
        emailInput.disabled = !isAdmin;
        roleInput.disabled = !isAdmin;

        // Add visual hint for disabled fields
        if (emailInput && roleInput) {
            emailInput.style.opacity = isAdmin ? '1' : '0.6';
            roleInput.style.opacity = isAdmin ? '1' : '0.6';
            emailInput.title = isAdmin ? '' : 'Only administrators can change email addresses';
            roleInput.title = isAdmin ? '' : 'Only administrators can change job titles';
        }
    } else {
        // Create mode
        modalTitle.textContent = 'Create Profile';
        submitBtn.querySelector('.btn-text').textContent = 'Create Profile';

        profileForm.reset();
        profileIdInput.value = '';
        resetImagePreview();

        // Enable for new profiles
        emailInput.disabled = false;
        roleInput.disabled = false;
        emailInput.style.opacity = '1';
        roleInput.style.opacity = '1';
    }

    profileModal.classList.add('active');
    nameInput.focus();
}

function closeModal() {
    profileModal.classList.remove('active');
    profileForm.reset();
    resetImagePreview();
    submitBtn.classList.remove('loading');
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (2MB limit)
    if (file.size > 2 * 1024 * 1024) {
        showToast('Image too large. Max size is 2MB.', 'error');
        imageInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const base64String = event.target.result;
        imageUrlInput.value = base64String;
        imagePreview.innerHTML = `<img src="${base64String}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
}

function resetImagePreview() {
    imagePreview.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>
    `;
    if (imageUrlInput) imageUrlInput.value = '';
    if (imageInput) imageInput.value = '';
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const profileData = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        role: roleInput.value.trim() || undefined,
        bio: bioInput.value.trim() || undefined,
        imageUrl: imageUrlInput.value || undefined
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

            // If the user updated their own profile, refresh "My Profile" tab and header
            if (isEdit && currentUser && profileIdInput.value === currentUser.user._id) {
                // Update local session data with new info
                currentUser.user = { ...currentUser.user, ...profileData };
                localStorage.setItem('adminSession', JSON.stringify(currentUser));

                // Refresh UI components
                loadMyProfile();
                updateUIForRole(false);
            }
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

// Reading Time helper
function getReadingTime(text) {
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
}

// Generate Skeletons
function generateSkeletons(count, type) {
    let html = '';
    for (let i = 0; i < count; i++) {
        if (type === 'blog') {
            html += `
                <div class="blog-card">
                    <div class="blog-card-image skeleton"></div>
                    <div class="blog-card-content">
                        <div class="skeleton-text" style="width: 80%; height: 1.5rem; margin-bottom: 1rem;"></div>
                        <div class="skeleton-text short"></div>
                        <div class="skeleton-text" style="margin-top: 1rem;"></div>
                        <div class="skeleton-text"></div>
                        <div class="skeleton-text short"></div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="profile-card">
                    <div class="profile-header">
                        <div class="profile-avatar skeleton skeleton-circle"></div>
                        <div class="profile-info">
                            <div class="skeleton-text" style="width: 120px;"></div>
                            <div class="skeleton-text short"></div>
                        </div>
                    </div>
                    <div class="profile-body">
                        <div class="skeleton-text"></div>
                        <div class="skeleton-text"></div>
                        <div class="skeleton-text short"></div>
                    </div>
                </div>
            `;
        }
    }
    return html;
}

// Scroll Progress Bar Logic
window.addEventListener('scroll', () => {
    const progressBar = document.getElementById('readingProgressBar');
    if (!progressBar || progressBar.style.display === 'none') return;

    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;
    progressBar.style.width = scrolled + "%";
});

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

    // Get token from adminSession
    const sessionData = localStorage.getItem('adminSession');
    const token = sessionData ? JSON.parse(sessionData).token : null;

    try {
        const response = await fetch(API_BASE_URL + '/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': token
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        // Remove typing indicator
        typingEl.remove();

        if (data.success) {
            // Add AI response
            if (data.isRateLimited) {
                addChatMessage(data.response, 'ai-error');
                showToast('Rate limit reached', 'error');
            } else {
                addChatMessage(data.response, 'ai', data.action);
            }

            // Refresh data if actions occurred
            if (data.action) {
                if (['created', 'updated', 'search', 'list', 'deleted'].includes(data.action.type)) {
                    loadProfiles(searchInput.value);
                } else if (['blog_created', 'blog_list', 'blog_deleted'].includes(data.action.type)) {
                    loadBlogs();
                }
            }
        } else {
            addChatMessage(data.response || data.error || 'Sorry, I encountered an error.', 'ai-error');
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

            case 'blog_created':
                html += `<div class="message-profiles">`;
                html += `<div class="message-profile-card">`;
                html += `<strong>Blog Posted:</strong> ${escapeHtml(action.blog.title)}`;
                html += `</div></div>`;
                break;

            case 'blog_list':
                if (action.blogs && action.blogs.length > 0) {
                    html += `<div class="message-profiles">`;
                    action.blogs.forEach(blog => {
                        html += `<div class="message-profile-card">`;
                        html += `<strong>${escapeHtml(blog.title)}</strong>`;
                        html += `<br><span style="font-size: 0.75rem;">${new Date(blog.createdAt).toLocaleDateString()}</span>`;
                        html += `</div>`;
                    });
                    html += `</div>`;
                }
                break;

            case 'help':
                // Help content handled by AI response
                break;
        }
    }

    html += `</div>`;

    // Explicitly sanitize HTML to prevent XSS attacks from potentially malicious model output
    messageEl.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;

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

// ========================================
// Blog Interaction Functions
// ========================================

async function toggleFollow(userId, btnObj) {
    if (!currentUser) {
        showToast('Please log in to follow users', 'warning');
        return;
    }

    try {
        btnObj.disabled = true;
        const response = await fetch(`${API_BASE_URL}/api/users/${userId}/follow`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser.token
            }
        });

        const data = await response.json();
        if (data.success) {
            const isNowFollowing = data.following;
            btnObj.classList.toggle('following', isNowFollowing);

            // Update button icon and text
            btnObj.innerHTML = isNowFollowing
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg> Following`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Follow`;

            // Update all follow buttons for this user across the feed
            document.querySelectorAll(`[id="follow-btn-${userId}"]`).forEach(btn => {
                if (btn !== btnObj) {
                    btn.classList.toggle('following', isNowFollowing);
                    btn.innerHTML = btnObj.innerHTML;
                }
            });

            showToast(isNowFollowing ? 'You are now following this user!' : 'Unfollowed', isNowFollowing ? 'success' : 'info');
        } else {
            showToast(data.error || 'Could not update follow status', 'error');
        }
    } catch (err) {
        console.error('Follow error:', err);
        showToast('Connection error', 'error');
    } finally {
        if (btnObj) btnObj.disabled = false;
    }
}

async function toggleLike(blogId, btnObj) {
    if (!currentUser) {
        showToast('Please log in to like this post', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${blogId}/like`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser.token
            }
        });
        
        const data = await response.json();
        if (data.success) {
            const likesCount = data.likes.length;
            const isLiked = data.likes.includes(currentUser.user.id);
            
            if (isLiked) {
                btnObj.classList.add('active');
            } else {
                btnObj.classList.remove('active');
            }
            
            btnObj.innerHTML = `
                <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
                ${likesCount} ${likesCount === 1 ? 'Like' : 'Likes'}
            `;
        }
    } catch (err) {
        console.error('Like error:', err);
    }
}

async function addComment(blogId) {
    if (!currentUser) {
        showToast('Please log in to comment', 'warning');
        return;
    }

    const commentInput = document.getElementById('commentInput');
    const content = commentInput.value.trim();
    
    if (!content) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${blogId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser.token
            },
            body: JSON.stringify({ content })
        });
        
        const data = await response.json();
        if (data.success) {
            commentInput.value = '';
            showToast('Comment added!', 'success');
            // Reload the blog detail to show the new comment
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('id') === blogId) {
                // If it's a standalone detail
            } else {
                // Re-render
                showBlogDetail(blogId);
            }
        } else {
            showToast(data.error || 'Failed to add comment', 'error');
        }
    } catch (err) {
        console.error('Comment error:', err);
        showToast('Connection error', 'error');
    }
}

async function addInlineComment(blogId) {
    if (!currentUser) {
        showToast('Please log in to comment', 'warning');
        return;
    }

    const commentInput = document.getElementById(`commentInput-${blogId}`);
    const content = commentInput.value.trim();
    
    if (!content) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/blogs/${blogId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser.token
            },
            body: JSON.stringify({ content })
        });
        
        const data = await response.json();
        if (data.success) {
            commentInput.value = '';
            showToast('Comment added!', 'success');
            // Reload the feed, then reopen the comment block
            const oldScrollY = window.scrollY;
            await loadBlogs();
            window.scrollTo(0, oldScrollY);
            
            const commentsContainer = document.getElementById(`comments-${blogId}`);
            if(commentsContainer) {
                commentsContainer.style.display = 'block';
            }
        } else {
            showToast(data.error || 'Failed to add comment', 'error');
        }
    } catch (err) {
        console.error('Comment error:', err);
        showToast('Connection error', 'error');
    }
}

async function shareBlog(title, blogId) {
    // Generate the specific URL to this blog instead of sharing the generic site root
    const shareUrl = `${window.location.origin}${window.location.pathname}?id=${blogId}#blogs`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: title,
                url: shareUrl
            });
        } catch (err) {
            console.log('Share canceled or failed', err);
        }
    } else {
        navigator.clipboard.writeText(shareUrl);
        showToast('Link copied to clipboard!', 'success');
    }
}

// Initialize chat on DOM ready
document.addEventListener('DOMContentLoaded', initChat);
console.log('Location:', window.location.href); console.log('Protocol:', window.location.protocol); console.log('Origin:', window.location.origin);
