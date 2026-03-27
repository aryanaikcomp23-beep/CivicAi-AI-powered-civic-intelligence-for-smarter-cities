const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('Missing MONGO_URI in environment. Set it in a .env file.');
  process.exit(1);
}
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function main() {
  try {
    await client.connect();
    console.log('MongoDB connected ✅');

    const db = client.db('mydb');
    const users = db.collection('users');

    const insertResult = await users.insertOne({ name: 'Arya', createdAt: new Date() });
    console.log('Inserted id:', insertResult.insertedId);

    const docs = await users.find({}).toArray();
    console.log('Users:', docs);
  } catch (error) {
    console.error('MongoDB connection error:', error);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

main();
