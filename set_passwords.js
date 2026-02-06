const { MongoClient } = require('mongodb');
const crypto = require('crypto');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mcp_profiles';
const COLLECTION_NAME = 'profiles';
const DEFAULT_PASSWORD = 'password123';

// Helper to hash password (must match server.js logic)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function setPasswords() {
    let client;
    try {
        console.log('Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const hashedPassword = hashPassword(DEFAULT_PASSWORD);

        console.log(`Updating all profiles with default password: "${DEFAULT_PASSWORD}"`);

        const result = await collection.updateMany(
            {}, // Filter: all documents
            {
                $set: {
                    password: hashedPassword,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`Successfully updated ${result.modifiedCount} profiles.`);
        console.log(`Matched ${result.matchedCount} profiles.`);

    } catch (error) {
        console.error('Error updating profiles:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('Disconnected from MongoDB.');
        }
    }
}

setPasswords();
