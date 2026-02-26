const { MongoClient } = require('mongodb');

async function listProfiles() {
    const uri = "mongodb://localhost:27017";
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const database = client.db('mcp_profiles');
        const collection = database.collection('profiles');

        const profiles = await collection.find({}).toArray();
        console.log("Found profiles:");
        profiles.forEach(p => console.log(`- ${p.name} (${p._id})`));
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

listProfiles();
