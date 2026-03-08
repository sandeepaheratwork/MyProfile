require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) return;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('mcp_profiles');

        // Create an index on the tags array to make searches ultra-fast
        console.log('Creating index on tags array...');
        await db.collection('blogs').createIndex({ tags: 1 });

        // Also create a text index on content if you want to support hashtag text search
        // await db.collection('blogs').createIndex({ content: "text" });

        const indexes = await db.collection('blogs').indexes();
        console.log('Current Indexes:', indexes);
    } catch (err) {
        console.error('Error creating index:', err);
    } finally {
        await client.close();
    }
}

run();
