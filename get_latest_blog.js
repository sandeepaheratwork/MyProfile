
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function getLatestBlog() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('mcp_profiles');
        const collection = db.collection('blogs');
        const latestBlog = await collection.findOne({}, { sort: { createdAt: -1 } });

        if (latestBlog) {
            console.log(JSON.stringify(latestBlog, null, 2));
        } else {
            console.log("No blogs found");
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

getLatestBlog();
