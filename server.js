const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
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
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple session store
const sessions = new Map();

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
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Middleware
const checkAdminRole = (req, res, next) => {
    const token = req.headers['x-auth-token'];

    // Verify token exists and is valid for an admin session
    if (!token || !sessions.has(token) || sessions.get(token).role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Access denied. Valid Admin session required.'
        });
    }
    next();
};

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

        // Check if user is admin
        if (!profile.role || profile.role.toLowerCase() !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied. You are not an Admin.' });
        }

        // Verify password
        // Note: For existing users without password, we might need a setup flow.
        // For this demo, we check exact match if password field exists.
        if (!profile.password || profile.password !== hashPassword(password)) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Create session token
        const token = crypto.randomBytes(16).toString('hex');
        sessions.set(token, { userId: profile._id, role: 'admin' });

        res.json({
            success: true,
            token,
            user: { name: profile.name, email: profile.email, role: 'admin' }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Setup (Temporary endpoint to set password for existing user)
app.post('/api/admin/setup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const collection = await getProfilesCollection();

        const updateResult = await collection.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, 'i') } },
            {
                $set: {
                    password: hashPassword(password),
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
        if (!token || !sessions.has(token)) {
            return res.status(403).json({ success: false, error: 'Access denied. Invalid session.' });
        }

        const session = sessions.get(token);
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
        if (profile.password && profile.password !== hashPassword(currentPassword)) {
            return res.status(401).json({ success: false, error: 'Incorrect current password' });
        }

        // Update to new password
        await collection.updateOne(
            { _id: profile._id },
            {
                $set: {
                    password: hashPassword(newPassword),
                    updatedAt: new Date()
                }
            }
        );

        res.json({ success: true, message: 'Password updated successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all profiles
app.get('/api/profiles', async (req, res) => {
    try {
        const collection = await getProfilesCollection();
        const profiles = await collection.find({}).sort({ createdAt: -1 }).toArray();
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
app.put('/api/profiles/:id', checkAdminRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, bio, imageUrl } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (role !== undefined) updates.role = role;
        if (bio !== undefined) updates.bio = bio;
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;
        updates.updatedAt = new Date();

        if (Object.keys(updates).length === 1) {
            return res.status(400).json({
                success: false,
                error: 'No update fields provided'
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

const SYSTEM_PROMPT = `You are a helpful assistant for a Profile Management system. You help users create, search, and update profiles using natural language.

IMPORTANT: You must respond with valid JSON only. No markdown, no explanation, just pure JSON.

Based on the user's message, determine the intent and extract relevant information.

Respond with a JSON object in this exact format:
{
  "intent": "create" | "search" | "update" | "list" | "help" | "unknown",
  "entities": {
    "name": "string or null",
    "email": "string or null",
    "role": "string or null",
    "bio": "string or null",
    "searchQuery": "string or null"
  },
  "response": "A friendly response to show the user"
}

Examples:
- "Create a profile for John Smith, email john@example.com, Software Engineer" -> intent: "create", entities: {name: "John Smith", email: "john@example.com", role: "Software Engineer"}
- "Find all engineers" -> intent: "search", entities: {searchQuery: "engineers"}
- "Update John's role to Senior Engineer" -> intent: "update", entities: {name: "John", role: "Senior Engineer"}
- "Show all profiles" or "list everyone" -> intent: "list"
- "Hello" or "How does this work?" -> intent: "help"

For updates, try to identify the person by name, then what field to update.
Always provide a friendly, conversational response in the "response" field.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

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
            parsed = JSON.parse(cleanedResponse.trim());
        } catch (parseError) {
            console.error('Failed to parse AI response:', responseText);
            return res.json({
                success: true,
                intent: 'unknown',
                response: "I understood your message, but I'm having trouble processing it. Could you please try rephrasing?",
                action: null
            });
        }

        const { intent, entities, response } = parsed;
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

            case 'list':
                profiles = await collection.find({}).sort({ createdAt: -1 }).limit(10).toArray();
                actionResult = {
                    type: 'list',
                    count: profiles.length,
                    profiles
                };
                break;

            case 'help':
                actionResult = {
                    type: 'help',
                    message: 'I can help you manage profiles. Try saying things like:\n• "Create a profile for Jane Doe, jane@company.com, Product Manager"\n• "Find all engineers"\n• "Update John\'s role to Senior Developer"\n• "Show all profiles"'
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
        console.error('Chat error:', error);

        let errorMessage = 'I encountered an error processing your request. Please try again.';
        if (error.message.includes('429') || error.message.includes('Quota exceeded')) {
            errorMessage = 'I am currently receiving too many requests. Please wait a minute and try again.';
        } else if (error.message.includes('503')) {
            errorMessage = 'The AI service is temporarily unavailable. Please try again later.';
        }

        res.status(200).json({ // Return 200 so the UI shows the message instead of error
            success: true,
            intent: 'unknown',
            response: errorMessage,
            action: null
        });
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
