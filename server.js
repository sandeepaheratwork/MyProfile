const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cheerio = require('cheerio');

// JWT Secret — falls back to a hard-coded dev value if not set
const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET_ENV) {
    console.warn('WARNING: JWT_SECRET environment variable is not defined in production. Falling back to dev secret.');
}
const JWT_SECRET = JWT_SECRET_ENV || 'profile-manager-dev-secret-2024';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB Configuration - Same as profile-mcp-server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mcp_profiles';
const COLLECTION_NAME = 'profiles';

// Gemini AI Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    console.log('Gemini AI initialized');
} else {
    console.warn('Warning: GEMINI_API_KEY not set. Chat functionality will be limited.');
}

// Middleware
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? (process.env.ALLOWED_ORIGIN || 'https://myprofile.com') : '*' }));

// MCP SSE Routes (Must be before any global body-parsers to avoid stream consumption)
const mcpTransports = new Map();

app.get('/mcp/sse', async (req, res) => {
    // SECURITY/COST SAVING: Disable SSE on Cloud Run to stop 24/7 billing
    // Cloud Run natively injects K_SERVICE, so we use that to detect production
    if (process.env.NODE_ENV === 'production' || process.env.K_SERVICE) {
        console.warn('Blocked SSE connection in production to prevent CPU billing.');
        return res.status(403).json({ error: 'MCP Cloud functionality is disabled in production to prevent runaway compute costs. Please run locally instead.' });
    }

    console.log('New MCP Cloud connection (SSE)');

    // Cloud Run / Proxy settings to prevent buffering
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    const transport = new SSEServerTransport('/mcp/messages', res);
    const sessionServer = createMcpServer();

    mcpTransports.set(transport.sessionId, { transport, server: sessionServer });

    res.on('close', () => {
        mcpTransports.delete(transport.sessionId);
        console.log(`MCP session ${transport.sessionId} closed`);
    });

    await sessionServer.connect(transport);
});

app.post('/mcp/messages', express.json(), async (req, res) => {
    const sessionId = req.query.sessionId;
    const sessionHandle = mcpTransports.get(sessionId);

    if (!sessionHandle) {
        console.warn(`MCP session ${sessionId} not found for POST message`);
        return res.status(404).send('Session not found');
    }

    try {
        await sessionHandle.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
        console.error(`Error handling MCP POST message: ${error.message}`);
        res.status(500).send(error.message);
    }
});

app.get('/mcp', (req, res) => {
    res.json({
        name: "Profile Manager MCP Cloud",
        status: "active",
        endpoints: { sse: "/mcp/sse", messages: "/mcp/messages" },
        description: "Connect your MCP client to the SSE endpoint to manage profiles remotely."
    });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// JWT helper functions (stateless – safe across Cloud Run restarts)
function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

let db = null;

// Connect to MongoDB
async function connectToMongoDB() {
    if (db) return db;

    try {
        console.log('Connecting to MongoDB...');
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log(`Connected to MongoDB: ${DB_NAME}`);
        return db;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

// Get profiles collection
async function getProfilesCollection() {
    const database = await connectToMongoDB();
    return database.collection(COLLECTION_NAME);
}

// Helper to hash password
async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// Middleware
const checkAdminRole = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    const payload = verifyToken(token);

    if (!payload || payload.role.toLowerCase() !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Access denied. Valid Admin session required.'
        });
    }
    req.session = payload; // attach for downstream use
    next();
};

// Middleware – any logged-in user
const checkAuth = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    req.session = payload;
    next();
};

// Middleware – Admin or the profile owner
const checkAdminOrOwner = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const { id } = req.params;
    const isAdmin = payload.role.toLowerCase() === 'admin';
    const isOwner = payload.userId === id;

    if (!isAdmin && !isOwner) {
        return res.status(403).json({
            success: false,
            error: 'Access denied. You can only update your own profile.'
        });
    }
    req.session = payload;
    next();
};

// ==========================================
// MCP Cloud Server Implementation
// ==========================================

// ==========================================
// MCP Cloud Server Implementation
// ==========================================

function createMcpServer() {
    const server = new McpServer({
        name: "profile-manager-cloud",
        version: "1.0.0",
    });

    // Tool: Search Profiles
    server.tool(
        "search_profiles",
        "Search for profiles by name, email, or role",
        {
            query: z.string().describe("Search query to find profiles")
        },
        async ({ query }) => {
            try {
                const collection = await getProfilesCollection();
                const profiles = await collection.find({
                    $or: [
                        { name: { $regex: query, $options: 'i' } },
                        { email: { $regex: query, $options: 'i' } },
                        { role: { $regex: query, $options: 'i' } }
                    ]
                }).limit(10).toArray();

                return {
                    content: [{ type: "text", text: JSON.stringify(profiles, null, 2) }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error searching profiles: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: Create Profile
    server.tool(
        "create_profile",
        "Create a new profile",
        {
            name: z.string(),
            email: z.string().email(),
            role: z.string().optional()
        },
        async ({ name, email, role }) => {
            try {
                const collection = await getProfilesCollection();
                const result = await collection.insertOne({
                    name,
                    email,
                    role,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                return {
                    content: [{ type: "text", text: `Profile created with ID: ${result.insertedId}` }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error creating profile: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: Create Blog Post
    server.tool(
        "create_blog_post",
        "Create a new technical blog post",
        {
            title: z.string().describe("Title of the blog post"),
            content: z.string().describe("Content of the blog post (Markdown supported)"),
            tags: z.array(z.string()).optional().describe("Tags for the blog post")
        },
        async ({ title, content, tags }) => {
            try {
                const collection = await getBlogsCollection();
                const blog = {
                    title,
                    content,
                    tags: tags || [],
                    author: { name: 'Admin (MCP)' },
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                const result = await collection.insertOne(blog);
                return {
                    content: [{ type: "text", text: `Blog post created with ID: ${result.insertedId}` }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error creating blog: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: List Blog Posts
    server.tool(
        "list_blogs",
        "List recent technical blog posts",
        {},
        async () => {
            try {
                const collection = await getBlogsCollection();
                const blogs = await collection.find({}).sort({ createdAt: -1 }).limit(10).toArray();
                return {
                    content: [{ type: "text", text: JSON.stringify(blogs, null, 2) }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error listing blogs: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: Search Blog Posts
    server.tool(
        "search_blogs",
        "Search for technical blog posts by title or content keywords",
        {
            query: z.string().describe("The search term or keyword to find in blog posts")
        },
        async ({ query }) => {
            try {
                const collection = await getBlogsCollection();
                const searchRegex = new RegExp(query, 'i');
                const blogs = await collection.find({
                    $or: [
                        { title: { $regex: searchRegex } },
                        { content: { $regex: searchRegex } },
                        { tags: { $in: [searchRegex] } }
                    ]
                }).limit(10).toArray();

                return {
                    content: [{ type: "text", text: JSON.stringify(blogs, null, 2) }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error searching blogs: ${error.message}` }],
                    isError: true
                };
            }
        }
    );
    // Tool: List Profiles
    server.tool(
        "list_profiles",
        "List high-level details of all user profiles",
        {},
        async () => {
            try {
                const collection = await getProfilesCollection();
                const profiles = await collection.find({}).sort({ createdAt: -1 }).limit(20).toArray();
                return {
                    content: [{ type: "text", text: JSON.stringify(profiles, null, 2) }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error listing profiles: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: Delete Profile
    server.tool(
        "delete_profile",
        "Delete a user profile by email or name",
        {
            identifier: z.string().describe("The email address or full name of the profile to delete")
        },
        async ({ identifier }) => {
            try {
                const collection = await getProfilesCollection();
                const result = await collection.deleteOne({
                    $or: [
                        { email: identifier },
                        { name: identifier }
                    ]
                });

                if (result.deletedCount === 0) {
                    return { content: [{ type: "text", text: `No profile found matching "${identifier}"` }], isError: true };
                }

                return {
                    content: [{ type: "text", text: `Successfully deleted profile: ${identifier}` }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error deleting profile: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    // Tool: Delete Blog Post
    server.tool(
        "delete_blog_post",
        "Delete a technical blog post by its exact title",
        {
            title: z.string().describe("The exact title of the blog post to delete")
        },
        async ({ title }) => {
            try {
                const collection = await getBlogsCollection();
                const result = await collection.deleteOne({ title: title });

                if (result.deletedCount === 0) {
                    return { content: [{ type: "text", text: `No blog post found with title "${title}"` }], isError: true };
                }

                return {
                    content: [{ type: "text", text: `Successfully deleted blog post: ${title}` }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error deleting blog post: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    return server;
}

// API Routes

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const collection = await getProfilesCollection();

        // Find user by email (case insensitive)
        const profile = await collection.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });

        if (!profile) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Verify password
        if (!profile.password || !(await comparePassword(password, profile.password))) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Get role (default to 'user' if not specified)
        const role = (profile.role || 'user').toLowerCase();

        // Issue a stateless JWT — survives Cloud Run cold-starts
        const token = signToken({ userId: profile._id.toString(), role });

        res.json({
            success: true,
            token,
            user: {
                id: profile._id,
                name: profile.name,
                email: profile.email,
                role,
                imageUrl: profile.imageUrl
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, error: 'Name, email and password are required' });
        }

        const collection = await getProfilesCollection();

        // Check if user already exists
        const existing = await collection.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
        if (existing) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        const newUser = {
            name,
            email,
            password: await hashPassword(password),
            role: 'user', // Default role
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await collection.insertOne(newUser);

        // Issue a stateless JWT
        const token = signToken({ userId: result.insertedId.toString(), role: 'user' });

        res.status(201).json({
            success: true,
            token,
            user: {
                id: result.insertedId,
                name,
                email,
                role: 'user',
                imageUrl: newUser.imageUrl
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Setup (Temporary endpoint to set password for existing user)
// Also issues a fresh JWT so admin can login immediately
app.post('/api/admin/setup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const collection = await getProfilesCollection();

        const updateResult = await collection.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, 'i') } },
            {
                $set: {
                    password: await hashPassword(password),
                    role: 'Admin', // Force role to Admin
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'Admin password set successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Change Password
app.post('/api/change-password', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = verifyToken(token);
        if (!session) {
            return res.status(403).json({ success: false, error: 'Access denied. Invalid session.' });
        }
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Both current and new passwords are required' });
        }

        const collection = await getProfilesCollection();
        const profile = await collection.findOne({ _id: new ObjectId(session.userId) });

        if (!profile) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Verify current password
        if (profile.password && !(await comparePassword(currentPassword, profile.password))) {
            return res.status(401).json({ success: false, error: 'Incorrect current password' });
        }

        // Update to new password
        await collection.updateOne(
            { _id: profile._id },
            {
                $set: {
                    password: await hashPassword(newPassword),
                    updatedAt: new Date()
                }
            }
        );

        res.json({ success: true, message: 'Password updated successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all profiles (Admin only)
app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = verifyToken(token);

        // If not admin, restrict visibility
        if (!session || session.role.toLowerCase() !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Only Admins can view the user list.'
            });
        }

        const collection = await getProfilesCollection();
        const profiles = await collection.find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, profiles, count: profiles.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get current user's own profile
app.get('/api/profiles/me', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = verifyToken(token);

        if (!session) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const collection = await getProfilesCollection();
        const profile = await collection.findOne({ _id: new ObjectId(session.userId) });

        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }

        // Remove sensitive fields
        const { password, ...safeProfile } = profile;
        res.json({ success: true, profile: safeProfile });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Search profiles
app.get('/api/profiles/search', async (req, res) => {
    try {
        const { q } = req.query;
        const collection = await getProfilesCollection();

        if (!q || q.trim() === '') {
            const profiles = await collection.find({}).sort({ createdAt: -1 }).toArray();
            return res.json({ success: true, profiles, count: profiles.length });
        }

        const searchRegex = new RegExp(q, 'i');
        const profiles = await collection.find({
            $or: [
                { name: { $regex: searchRegex } },
                { email: { $regex: searchRegex } },
                { role: { $regex: searchRegex } }
            ]
        }).sort({ createdAt: -1 }).toArray();

        res.json({ success: true, profiles, count: profiles.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single profile by ID
app.get('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const collection = await getProfilesCollection();

        const profile = await collection.findOne({ _id: new ObjectId(id) });

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({ success: true, profile });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// Blog API Routes
// ==========================================

const BLOG_COLLECTION = 'blogs';
const IMAGE_COLLECTION = 'images';

async function getBlogsCollection() {
    const database = await connectToMongoDB();
    return database.collection(BLOG_COLLECTION);
}

async function getImagesCollection() {
    const database = await connectToMongoDB();
    return database.collection(IMAGE_COLLECTION);
}

// ==========================================
// Image Storage API
// ==========================================

// Upload image (base64)
app.post('/api/upload', checkAuth, async (req, res) => {
    try {
        const { image, name, type } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, error: 'No image data provided' });
        }

        // Clean base64 string (remove data:image/png;base64, prefix)
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        // Check magic bytes to ensure it's actually an image
        const isImage = (buf) => {
            if (!buf || buf.length < 4) return false;
            const hex = buf.toString('hex', 0, 4).toUpperCase();
            if (hex.startsWith('FFD8FF')) return true; // JPEG
            if (hex === '89504E47') return true; // PNG
            if (hex === '47494638') return true; // GIF
            if (hex === '52494646' && buf.toString('ascii', 8, 12) === 'WEBP') return true; // WebP
            return false;
        };

        if (!isImage(buffer)) {
            return res.status(400).json({ success: false, error: 'Invalid file type. Only genuine images are allowed.' });
        }

        const collection = await getImagesCollection();
        const imageDoc = {
            name: name || 'upload',
            contentType: type || 'image/png',
            data: buffer,
            userId: req.session.userId,
            createdAt: new Date()
        };

        const result = await collection.insertOne(imageDoc);
        res.status(201).json({
            success: true,
            id: result.insertedId,
            url: `/api/images/${result.insertedId}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve image
app.get('/api/images/:id', async (req, res) => {
    try {
        const collection = await getImagesCollection();
        const image = await collection.findOne({ _id: new ObjectId(req.params.id) });

        if (!image) {
            return res.status(404).send('Image not found');
        }

        res.set('Content-Type', image.contentType);
        res.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
        res.send(image.data.buffer);
    } catch (error) {
        res.status(500).send('Error retrieving image');
    }
});

// Search existing tags for autocomplete
app.get('/api/tags/search', async (req, res) => {
    try {
        const { q } = req.query;
        const collection = await getBlogsCollection();
        // Aggregation to get distinct tags efficiently, or just distinct
        const allTags = await collection.distinct('tags');
        let matchedTags = allTags || [];
        if (q) {
            matchedTags = matchedTags.filter(t => t && t.toLowerCase().includes(q.toLowerCase()));
        }
        res.json({ success: true, tags: matchedTags.slice(0, 5) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// List all blogs
app.get('/api/blogs', async (req, res) => {
    try {
        const collection = await getBlogsCollection();
        const blogs = await collection.find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, blogs, count: blogs.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single blog
app.get('/api/blogs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const collection = await getBlogsCollection();
        const blog = await collection.findOne({ _id: new ObjectId(id) });

        if (!blog) {
            return res.status(404).json({ success: false, error: 'Blog post not found' });
        }

        res.json({ success: true, blog });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create blog (any logged-in user)
app.post('/api/blogs', checkAuth, async (req, res) => {
    try {
        const { title, content, tags } = req.body;

        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }

        // Fetch the author's real name from their profile
        const profilesCollection = await getProfilesCollection();
        let authorName = 'Anonymous';
        try {
            const authorProfile = await profilesCollection.findOne(
                { _id: new ObjectId(req.session.userId) },
                { projection: { name: 1 } }
            );
            if (authorProfile) authorName = authorProfile.name;
        } catch (_) { /* userId may not be a valid ObjectId on some edge case */ }

        let finalTags = [...(tags || [])];
        let mentions = [];

        // Extract #hashtags from content body
        const hashtagRegex = /#(\w+)/g;
        let hashtagMatch;
        while ((hashtagMatch = hashtagRegex.exec(content)) !== null) {
            if (!finalTags.includes(hashtagMatch[1])) {
                finalTags.push(hashtagMatch[1]);
            }
        }

        // Extract @mentions from content body
        const mentionRegex = /@(\w+)/g;
        let mentionMatch;
        while ((mentionMatch = mentionRegex.exec(content)) !== null) {
            if (!mentions.includes(mentionMatch[1])) {
                mentions.push(mentionMatch[1]);
            }
        }

        const collection = await getBlogsCollection();
        const blog = {
            title,
            content,
            tags: finalTags,
            mentions: mentions,
            author: { id: req.session.userId, name: authorName },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await collection.insertOne(blog);
        res.status(201).json({ success: true, blog: { ...blog, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete blog (Admin or Author)
app.delete('/api/blogs/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const collection = await getBlogsCollection();

        const blog = await collection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
            return res.status(404).json({ success: false, error: 'Blog not found' });
        }

        const isAdmin = req.session.role && req.session.role.toLowerCase() === 'admin';
        const isAuthor = blog.author.id === req.session.userId;
        if (!isAdmin && !isAuthor) {
            return res.status(403).json({ success: false, error: 'Access denied. You can only delete your own posts.' });
        }

        await collection.deleteOne({ _id: new ObjectId(id) });

        res.json({ success: true, message: 'Blog deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Edit blog (Admin or Author)
app.put('/api/blogs/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, tags } = req.body;

        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }

        const collection = await getBlogsCollection();
        const blog = await collection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
            return res.status(404).json({ success: false, error: 'Blog not found' });
        }

        const isAdmin = req.session.role && req.session.role.toLowerCase() === 'admin';
        const isAuthor = blog.author.id === req.session.userId;
        if (!isAdmin && !isAuthor) {
            return res.status(403).json({ success: false, error: 'Access denied. You can only edit your own posts.' });
        }

        let finalTags = [...(tags || [])];
        let mentions = [];

        // Extract #hashtags from content body
        const hashtagRegex = /#(\w+)/g;
        let hashtagMatch;
        while ((hashtagMatch = hashtagRegex.exec(content)) !== null) {
            if (!finalTags.includes(hashtagMatch[1])) {
                finalTags.push(hashtagMatch[1]);
            }
        }

        // Extract @mentions from content body
        const mentionRegex = /@(\w+)/g;
        let mentionMatch;
        while ((mentionMatch = mentionRegex.exec(content)) !== null) {
            if (!mentions.includes(mentionMatch[1])) {
                mentions.push(mentionMatch[1]);
            }
        }

        await collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    title,
                    content,
                    tags: finalTags,
                    mentions,
                    updatedAt: new Date()
                }
            }
        );

        res.json({ success: true, message: 'Blog updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Forgot Password
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const collection = await getProfilesCollection();

        const user = await collection.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
        if (!user) {
            // Treat user not found as success to avoid email enumeration in production
            // but here we might want to be helpful for the demo
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Generate a simple 6-digit token (simulated)
        const token = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 3600000); // 1 hour expiry

        await collection.updateOne(
            { _id: user._id },
            { $set: { resetToken: token, resetTokenExpiry: expiry } }
        );

        // In a real app, send email here. For now, return the token in the response
        res.json({ success: true, message: 'Reset code generated', token });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset Password
app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;
        const collection = await getProfilesCollection();

        const user = await collection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') },
            resetToken: token,
            resetTokenExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
        }

        await collection.updateOne(
            { _id: user._id },
            {
                $set: { password: await hashPassword(newPassword) },
                $unset: { resetToken: "", resetTokenExpiry: "" }
            }
        );

        res.json({ success: true, message: 'Password reset successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create profile
app.post('/api/profiles', checkAdminRole, async (req, res) => {
    try {
        const { name, email, role, bio, imageUrl } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                error: 'Name and email are required'
            });
        }

        const collection = await getProfilesCollection();

        const profile = {
            name,
            email,
            role: role || undefined,
            bio: bio || undefined,
            imageUrl: imageUrl || undefined,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await collection.insertOne(profile);

        res.status(201).json({
            success: true,
            message: 'Profile created successfully',
            profile: { ...profile, _id: result.insertedId }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update profile
app.put('/api/profiles/:id', checkAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, bio, imageUrl } = req.body;
        const isAdmin = req.session.role.toLowerCase() === 'admin';

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (bio !== undefined) updates.bio = bio;
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;

        // Security: only admins can update roles or change emails
        if (isAdmin) {
            if (email !== undefined) updates.email = email;
            if (role !== undefined) updates.role = role;
        }

        updates.updatedAt = new Date();

        if (Object.keys(updates).length === 1) { // plus updatedAt
            return res.status(400).json({
                success: false,
                error: 'No valid update fields provided'
            });
        }

        const collection = await getProfilesCollection();

        const result = await collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updates },
            { returnDocument: 'after' }
        );

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: result
        });
    } catch (error) {
        if (error.message.includes('ObjectId')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid profile ID format'
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete profile
app.delete('/api/profiles/:id', checkAdminRole, async (req, res) => {
    try {
        const { id } = req.params;
        const collection = await getProfilesCollection();

        const result = await collection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// AI Chat Endpoint
// ========================================

const SYSTEM_PROMPT = `You are a helpful assistant for a Profile Management system. You help users create, search, update, and delete profiles and blogs using natural language.

IMPORTANT: You must respond with valid JSON only. No markdown, no explanation, just pure JSON.

Based on the user's message, determine the intent and extract relevant information.

Respond with a JSON object in this exact format:
{
  "intent": "create" | "search" | "update" | "list" | "delete" | "create_blog" | "search_blogs" | "list_blogs" | "delete_blog" | "help" | "unknown",
  "entities": {
    "name": "string or null",
    "email": "string or null",
    "role": "string or null",
    "bio": "string or null",
    "searchQuery": "string or null",
    "blogTitle": "string or null",
    "blogContent": "string or null",
    "tags": "array or null"
  },
  "response": "A friendly response to show the user"
}

Examples:
- "Create a profile for John Smith" -> intent: "create", entities: {name: "John Smith"}
- "Delete the profile for jane@example.com" -> intent: "delete", entities: {email: "jane@example.com"}
- "Search for blogs about React" -> intent: "search_blogs", entities: {searchQuery: "React"}
- "Delete the blog titled 'AI Tips'" -> intent: "delete_blog", entities: {blogTitle: "AI Tips"}
- "Show all profiles" -> intent: "list"
- "Post a blog about Node.js" -> intent: "create_blog", entities: {blogTitle: "Node.js", blogContent: "..."}
- "Hello" -> intent: "help"

Always provide a friendly, conversational response in the "response" field.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const token = req.headers['x-auth-token'];
        const user = verifyToken(token); // Get user role and data if logged in
        const isAdmin = user && user.role && user.role.toLowerCase() === 'admin';
        const isUser = user && user.role; // Registered users (includes admins)

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        if (!model) {
            return res.status(503).json({
                success: false,
                error: 'AI chat is not available. Please set GEMINI_API_KEY environment variable.',
                response: 'I apologize, but AI chat is not configured. Please use the form interface to manage profiles.'
            });
        }

        // Determine general intent category before sending to AI
        const messageLower = message.toLowerCase();
        const isBlogTopic = messageLower.includes('blog') || messageLower.includes('post') || messageLower.includes('technical');

        // 1. Check permissions for Profiles (Admin Only)
        if (!isBlogTopic && !isAdmin && !messageLower.includes('help') && !messageLower.includes('hello')) {
            return res.json({
                success: true,
                intent: 'denied',
                response: "I'm sorry, but profile management via AI assistant is restricted to administrators. Registered users can however manage technical blogs!",
                action: { type: 'error', message: 'Admin access required for profile tools' }
            });
        }

        // 2. Check permissions for Blogs (Registered Users)
        if (isBlogTopic && !isUser) {
            return res.json({
                success: true,
                intent: 'denied',
                response: "I'd love to help you with technical blogs, but you'll need to login first to post or browse full details!",
                action: { type: 'error', message: 'Authentication required for blog tools' }
            });
        }

        // Send message to Gemini
        const result = await model.generateContent([
            { text: SYSTEM_PROMPT },
            { text: `User message: ${message}` }
        ]);

        const responseText = result.response.text();

        // Parse the JSON response
        let parsed;
        try {
            // Clean up the response - remove markdown code blocks if present
            let cleanedResponse = responseText.trim();
            if (cleanedResponse.startsWith('```json')) {
                cleanedResponse = cleanedResponse.slice(7);
            } else if (cleanedResponse.startsWith('```')) {
                cleanedResponse = cleanedResponse.slice(3);
            }
            if (cleanedResponse.endsWith('```')) {
                cleanedResponse = cleanedResponse.slice(0, -3);
            }
            let intent;
            let entities;
            let response = "I'm not sure how to respond to that."; // Default response

            if (message.toLowerCase().includes('blog') || message.toLowerCase().includes('post') || message.toLowerCase().includes('technical')) {
                const prompt = `
                The user wants to interact with blogs.
                Message: "${message}"
                Extract: blogTitle, blogContent, tags (as array), searchQuery.
                And determine intent: "create_blog", "list_blogs", "search_blogs", or "delete_blog".
                Return JSON only: { "intent": "string", "entities": { "blogTitle": "string or null", "blogContent": "string or null", "tags": "array or null", "searchQuery": "string or null" } }
            `;
                const result = await model.generateContent(prompt);
                const aiResponse = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
                intent = aiResponse.intent;
                entities = aiResponse.entities || {};
            } else {
                const prompt = `
                Extract profile management intent from this message: "${message}"
                Possible intents: "create", "search", "update", "list", "delete", "help".
                Return JSON only: { "intent": "string", "entities": { "name": "string or null", "email": "string or null", "role": "string or null", "bio": "string or null", "searchQuery": "string or null" } }
            `;
                const result = await model.generateContent(prompt);
                const aiResponse = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
                intent = aiResponse.intent;
                entities = aiResponse.entities || {};
            }

            let actionResult = null;
            let profiles = [];

            const collection = await getProfilesCollection();

            // Execute the appropriate action based on intent
            switch (intent) {
                case 'create':
                    if (entities.name && entities.email) {
                        const newProfile = {
                            name: entities.name,
                            email: entities.email,
                            role: entities.role || undefined,
                            bio: entities.bio || undefined,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        };
                        const insertResult = await collection.insertOne(newProfile);
                        actionResult = {
                            type: 'created',
                            profile: { ...newProfile, _id: insertResult.insertedId }
                        };
                    } else {
                        actionResult = {
                            type: 'error',
                            message: 'I need at least a name and email to create a profile.'
                        };
                    }
                    break;

                case 'create_blog':
                    if (entities.blogTitle && entities.blogContent) {
                        const blogsCollection = await getBlogsCollection();
                        const newBlog = {
                            title: entities.blogTitle,
                            content: entities.blogContent,
                            tags: entities.tags || [],
                            author: { name: 'Admin (AI)' },
                            createdAt: new Date(),
                            updatedAt: new Date()
                        };
                        const result = await blogsCollection.insertOne(newBlog);
                        actionResult = {
                            type: 'blog_created',
                            blog: { ...newBlog, _id: result.insertedId }
                        };
                        response = `I've successfully posted your technical blog: "${entities.blogTitle}".`;
                    } else {
                        response = `I'd love to help you post a blog! Please provide a title and some content.`;
                        actionResult = { type: 'error', message: 'Missing title or content' };
                    }
                    break;

                case 'search':
                    if (entities.searchQuery) {
                        const searchRegex = new RegExp(entities.searchQuery, 'i');
                        profiles = await collection.find({
                            $or: [
                                { name: { $regex: searchRegex } },
                                { email: { $regex: searchRegex } },
                                { role: { $regex: searchRegex } }
                            ]
                        }).toArray();
                        actionResult = {
                            type: 'search',
                            count: profiles.length,
                            profiles
                        };
                    }
                    break;

                case 'update':
                    if (entities.name) {
                        // Find the profile by name
                        const nameRegex = new RegExp(entities.name, 'i');
                        const existingProfile = await collection.findOne({ name: { $regex: nameRegex } });

                        if (existingProfile) {
                            const updates = { updatedAt: new Date() };
                            if (entities.role) updates.role = entities.role;
                            if (entities.email) updates.email = entities.email;
                            if (entities.bio) updates.bio = entities.bio;
                            if (entities.name && entities.name !== existingProfile.name) {
                                updates.name = entities.name;
                            }

                            const updateResult = await collection.findOneAndUpdate(
                                { _id: existingProfile._id },
                                { $set: updates },
                                { returnDocument: 'after' }
                            );

                            actionResult = {
                                type: 'updated',
                                profile: updateResult
                            };
                        } else {
                            actionResult = {
                                type: 'not_found',
                                message: `I couldn't find a profile matching "${entities.name}".`
                            };
                        }
                    }
                    break;

                case 'delete':
                    if (entities.email || entities.name) {
                        const filter = entities.email ? { email: entities.email } : { name: new RegExp(entities.name, 'i') };
                        const deleteResult = await collection.deleteOne(filter);
                        if (deleteResult.deletedCount > 0) {
                            actionResult = { type: 'deleted', count: 1 };
                            response = `I've successfully deleted the profile for "${entities.email || entities.name}".`;
                        } else {
                            response = `I couldn't find a profile to delete matching "${entities.email || entities.name}".`;
                            actionResult = { type: 'not_found' };
                        }
                    } else {
                        response = "Who are we deleting today? Please provide a name or email.";
                    }
                    break;

                case 'delete_blog':
                    if (entities.blogTitle) {
                        const blogsColl = await getBlogsCollection();
                        const deleteBlogResult = await blogsColl.deleteOne({ title: new RegExp(entities.blogTitle, 'i') });
                        if (deleteBlogResult.deletedCount > 0) {
                            actionResult = { type: 'blog_deleted', count: 1 };
                            response = `I've successfully removed the blog post: "${entities.blogTitle}".`;
                        } else {
                            response = `I couldn't find a blog with the title "${entities.blogTitle}".`;
                            actionResult = { type: 'not_found' };
                        }
                    } else {
                        response = "Which blog would you like me to delete? Just give me the title.";
                    }
                    break;

                case 'list':
                    profiles = await collection.find({}).sort({ createdAt: -1 }).limit(10).toArray();
                    actionResult = {
                        type: 'list',
                        count: profiles.length,
                        profiles
                    };
                    break;

                case 'list_blogs':
                    const bCollection = await getBlogsCollection();
                    const recentBlogs = await bCollection.find({}).sort({ createdAt: -1 }).limit(5).toArray();
                    actionResult = {
                        type: 'blog_list',
                        count: recentBlogs.length,
                        blogs: recentBlogs
                    };
                    response = recentBlogs.length > 0
                        ? `Here are the latest technical blog posts.`
                        : `There are no blog posts yet. Would you like me to help you write one?`;
                    break;

                case 'search_blogs':
                    if (entities.searchQuery) {
                        const blogsCol = await getBlogsCollection();
                        const blogRegex = new RegExp(entities.searchQuery, 'i');
                        const matchingBlogs = await blogsCol.find({
                            $or: [
                                { title: { $regex: blogRegex } },
                                { content: { $regex: blogRegex } },
                                { tags: { $in: [blogRegex] } }
                            ]
                        }).limit(5).toArray();

                        actionResult = {
                            type: 'blog_list',
                            count: matchingBlogs.length,
                            blogs: matchingBlogs
                        };
                        response = matchingBlogs.length > 0
                            ? `I found ${matchingBlogs.length} blog posts matching "${entities.searchQuery}".`
                            : `I couldn't find any blog posts matching "${entities.searchQuery}".`;
                    } else {
                        response = "I'd be happy to search our technical blogs! What keywords are you looking for?";
                        actionResult = { type: 'error', message: 'Missing search query' };
                    }
                    break;

                case 'help':
                    let helpMsg = 'I can help you manage technical blogs. Try saying things like:\n\n' +
                        '**Technical Blogs:**\n' +
                        '• "Show me recent blogs"\n' +
                        '• "Search for blogs about React"\n' +
                        '• "Post a blog titled \'AI Tips\' with content \'Use MCP for scale\'"';

                    if (isAdmin) {
                        helpMsg += '\n\n**Admin Controls (Profiles):**\n' +
                            '• "Create a profile for Jane Doe"\n' +
                            '• "Find all engineers"\n' +
                            '• "Delete the profile for user@email.com"';
                    }

                    actionResult = {
                        type: 'help',
                        message: helpMsg
                    };
                    break;
            }

            res.json({
                success: true,
                intent,
                response,
                action: actionResult
            });

        } catch (error) {
            console.error('AI Processing error:', error);
            res.json({
                success: true,
                intent: 'unknown',
                response: "I encountered an error while processing that. Could you please try again?",
                action: null
            });
        }
    } catch (error) {
        console.error('Chat error:', error);

        let errorMessage = 'I encountered an error processing your request. Please try again.';
        let isRateLimited = false;

        if (error.message.includes('429') || error.message.includes('Quota exceeded')) {
            errorMessage = 'I am currently receiving too many requests. This is a provider limit (Gemini 2.0 Flash Free Tier). Please wait about 60 seconds and try again.';
            isRateLimited = true;
        } else if (error.message.includes('503')) {
            errorMessage = 'The AI service is temporarily unavailable. Please try again later.';
        }

        res.status(200).json({ // Return 200 so the UI shows the message instead of error
            success: true,
            intent: 'unknown',
            response: errorMessage,
            isRateLimited,
            action: null
        });
    }
});

// ========================================
// Link Preview Endpoint
// ========================================
app.get('/api/link-preview', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ success: false, error: 'Valid URL is required' });
        }

        const response = await fetch(url, {
            // Add a common user agent so sites don't block us as a bot
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch URL: ${response.statusText}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const getMetaTag = (names) => {
            for (let name of names) {
                const content = $(`meta[property="${name}"], meta[name="${name}"]`).attr('content');
                if (content) return content;
            }
            return null;
        };

        const previewData = {
            title: getMetaTag(['og:title', 'twitter:title']) || $('title').text(),
            description: getMetaTag(['og:description', 'twitter:description', 'description']),
            image: getMetaTag(['og:image', 'twitter:image', 'twitter:image:src']),
            url: url
        };

        res.json({ success: true, preview: previewData });
    } catch (error) {
        console.error('Link preview error:', error);
        res.status(500).json({ success: false, error: 'Could not fetch link preview' });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, async () => {
    await connectToMongoDB();
    console.log(`Profile UI Server running at http://localhost:${PORT}`);
});
