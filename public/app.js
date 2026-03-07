/**
 * TechForge - Client Application

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
// Initialization
// ========================================

document.addEventListener('DOMContentLoaded', () => {
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
});

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

    // Image Upload
    if (selectImageBtn) {
        selectImageBtn.addEventListener('click', () => imageInput.click());
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
        document.getElementById('blogModal').classList.add('active');
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
        blogInsertImageBtn.addEventListener('click', () => blogImageInput.click());
        blogImageInput.addEventListener('change', (e) => handleBlogImageUpload(e.target.files[0]));
    }

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
        blogContentInput.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    handleBlogImageUpload(file);
                }
            }
        });

        // Live Preview in Split Mode
        const updateOnInput = () => {
            if (window.innerWidth > 1024) {
                updateBlogPreview();
            }
        };

        blogContentInput.addEventListener('input', updateOnInput);
        document.getElementById('blogTitleInput')?.addEventListener('input', updateOnInput);
        document.getElementById('blogTagsInput')?.addEventListener('input', updateOnInput);
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
                <img src="${heroImageUrl}" alt="Preview">
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
    const tabs = document.querySelectorAll('.nav-tab');
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

    if (tabId === 'blogs') {
        blogsSection.style.display = 'block';
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
        const response = await fetch('/api/change-password', {
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
        const response = await fetch('/api/login', {
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
        const response = await fetch('/api/register', {
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

    if (currentUser) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (changePasswordBtn) changePasswordBtn.style.display = 'flex';
        mainNavTabs.style.display = 'flex';

        // Update Header Avatar
        if (userAvatar) {
            const user = currentUser.user;
            const initials = getInitials(user.name);
            userAvatar.innerHTML = user.imageUrl
                ? `<img src="${user.imageUrl}" alt="${escapeHtml(user.name)}">`
                : initials;
            userAvatar.style.display = 'flex';
        }

        if (currentUser.user.role === 'admin') {
            if (adminBadge) adminBadge.style.display = 'flex';
            if (addProfileBtn) addProfileBtn.style.display = 'flex';
            if (adminProfilesTab) adminProfilesTab.style.display = 'flex';
            if (userProfileTab) userProfileTab.style.display = 'none';
        } else {
            if (adminBadge) adminBadge.style.display = 'none';
            if (addProfileBtn) addProfileBtn.style.display = 'none';
            if (adminProfilesTab) adminProfilesTab.style.display = 'none';
            if (userProfileTab) userProfileTab.style.display = 'flex';
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
        if (addProfileBtn) addProfileBtn.style.display = 'none';
        if (userAvatar) userAvatar.style.display = 'none';
        mainNavTabs.style.display = 'none';
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
        const response = await fetch('/api/blogs');
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
    document.getElementById('blogForm').reset();
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
        const response = await fetch('/api/forgot-password', {
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
        const response = await fetch('/api/reset-password', {
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
            const response = await fetch('/api/upload', {
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

    submitBtn.classList.add('loading');

    try {
        const response = await fetch('/api/blogs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': currentUser ? currentUser.token : ''
            },
            body: JSON.stringify({ title, tags, content })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Blog post published!', 'success');
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
        const response = await fetch(`/api/blogs/${id}`);
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

            const renderedContent = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');

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
                            <img src="${heroImageUrl}" alt="${escapeHtml(blog.title)}">
                        </div>` : ''}

                        <div class="blog-content markdown-body">
                            ${renderedContent}
                        </div>

                        <footer class="blog-footer">
                            <div class="blog-tags">
                                ${blog.tags.map(tag => `<span class="blog-tag">#${escapeHtml(tag)}</span>`).join('')}
                            </div>

                            <div class="author-card">
                                <div class="author-avatar-large">${getInitials(blog.author.name)}</div>
                                <div class="author-bio">
                                    <h4>Written by ${escapeHtml(blog.author.name)}</h4>
                                    <p>Technical contributor at TechForge. Sharing insights on software architecture, modern web development, and AI implementation.</p>
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
        // Extract first image URL from markdown content: ![alt](url)
        const imgMatch = blog.content.match(/!\[.*?\]\((.*?)\)/);
        const imageUrl = imgMatch ? imgMatch[1] : null;

        // Clean content for preview (remove markdown images and trim)
        let cleanContent = blog.content.replace(/!\[.*?\]\(.*?\)/g, '').substring(0, 150);
        if (blog.content.length > 150) cleanContent += '...';

        // Calculate reading time (avg 200 words per minute)
        const words = blog.content.trim().split(/\s+/).length;
        const readingTime = Math.max(1, Math.ceil(words / 200));

        return `
            <div class="blog-card" onclick="showBlogDetail('${blog._id}')" style="position: relative;">
                ${isAdmin ? `
                <button class="btn btn-danger btn-icon blog-delete-btn"
                    title="Delete post"
                    onclick="event.stopPropagation(); deleteBlogPost('${blog._id}', this)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"/>
                        <path d="M19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1 2-2h4a2,2 0 0,1 2,2v2"/>
                    </svg>
                </button>` : ''}
                
                <div class="blog-card-content">
                    <h3>${escapeHtml(blog.title)}</h3>
                    <div class="blog-meta">
                        <span>By ${escapeHtml(blog.author.name)}</span>
                        <span>${new Date(blog.createdAt).toLocaleDateString()}</span>
                        <div class="reading-time">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            ${readingTime} min read
                        </div>
                    </div>

                    ${imageUrl ? `
                    <div class="blog-card-image" style="margin: 1rem 0; border-radius: var(--radius-md);">
                        <img src="${imageUrl}" alt="${escapeHtml(blog.title)}">
                    </div>
                    ` : ''}

                    <div class="blog-content-preview">
                        ${escapeHtml(cleanContent)}
                    </div>
                    <div class="blog-tags">
                        ${blog.tags.map(tag => `<span class="blog-tag">${escapeHtml(tag)}</span>`).join('')}
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
        const response = await fetch(`/api/blogs/${id}`, {
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

async function loadMyProfile() {
    const content = document.getElementById('myProfileContent');

    try {
        const response = await fetch('/api/profiles/me', {
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
            ? `<img src="${profile.imageUrl}" alt="${escapeHtml(profile.name)}">`
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
    // Hard reload ensures no in-memory state lingers
    window.location.reload();
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
        ? `<img src="${profile.imageUrl}" alt="${escapeHtml(profile.name)}">`
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
        imagePreview.innerHTML = profile.imageUrl ? `<img src="${profile.imageUrl}" alt="Preview">` : '';
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
        const response = await fetch('/api/chat', {
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
