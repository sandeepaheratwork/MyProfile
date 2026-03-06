
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function getBlogCount() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('mcp_profiles');
        const collection = db.collection('blogs');
        const count = await collection.countDocuments();
        console.log(`Total blogs: ${count}`);
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

getBlogCount();
