const { MongoClient } = require('mongodb');
const crypto = require('crypto');

// User's provided connection string
const MONGODB_URI = 'mongodb+srv://sandeepaheratwork_db_user:7Sn0YIVKZH2WM7yL@cluster0.ycbbvbl.mongodb.net/mcp_profiles?retryWrites=true&w=majority';
const DB_NAME = 'mcp_profiles';
const COLLECTION_NAME = 'profiles';

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function seedDatabase() {
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');
        
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Clear existing data (optional, but good for a fresh start)
        const deleteResult = await collection.deleteMany({});
        console.log(`Deleted ${deleteResult.deletedCount} existing profiles`);

        const profiles = [
            {
                name: 'Sandeep Ramdas Aher',
                email: 'sandeepaheratwork@gmail.com',
                role: 'Admin',
                bio: 'Cloud Architect and Senior Developer.',
                password: hashPassword('Admin@123'), // Default password for initial login
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                name: 'Saanvi',
                email: 'saanvi@test.com',
                role: 'Student',
                bio: 'Exploring computer science and coding.',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                name: 'Priyanka',
                email: 'priyanka@test.com',
                role: 'Homemaker',
                bio: 'Passionate about learning new technologies.',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                name: 'Parth Aher',
                email: 'parth.aher@gmail.com',
                role: 'Grade 7th',
                bio: 'Loves gaming and robotics.',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        const insertResult = await collection.insertMany(profiles);
        console.log(`Successfully inserted ${insertResult.insertedCount} profiles`);

    } catch (error) {
        console.error('Error seeding database:', error);
    } finally {
        await client.close();
    }
}

seedDatabase();
