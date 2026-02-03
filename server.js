const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB Configuration - Same as profile-mcp-server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mcp_profiles';
const COLLECTION_NAME = 'profiles';

let db = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
async function connectToMongoDB() {
    if (db) return db;

    try {
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

// API Routes

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
app.post('/api/profiles', async (req, res) => {
    try {
        const { name, email, role, bio } = req.body;

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
app.put('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, bio } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (role !== undefined) updates.role = role;
        if (bio !== undefined) updates.bio = bio;
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
app.delete('/api/profiles/:id', async (req, res) => {
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

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, async () => {
    await connectToMongoDB();
    console.log(`Profile UI Server running at http://localhost:${PORT}`);
});
