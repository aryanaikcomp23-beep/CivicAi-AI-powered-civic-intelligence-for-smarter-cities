require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const multer = require('multer');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static('.'));

const MONGO_URI = process.env.MONGO_URI || '';
const DB_NAME = process.env.DB_NAME || 'civicai';
const PORT = process.env.PORT || 5000;

let db;
const mem = {
  issues: [],
  escalations: []
};

const upload = multer({ storage: multer.memoryStorage() });

function newId() {
  return new ObjectId().toHexString();
}

async function getIssues(limit = 500) {
  if (db) return await db.collection('issues').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  return mem.issues.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, limit);
}

async function getEscalations(limit = 100) {
  if (db) return await db.collection('escalations').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  return mem.escalations.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, limit);
}

async function computeHotspots() {
  const issues = await getIssues(500);
  const zones = {};
  issues.forEach(i => {
    if (i.location && i.location.coordinates) {
      const [lng, lat] = i.location.coordinates;
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      if (!zones[key]) zones[key] = { zone: `Zone ${key}`, issueType: i.type, riskScore: 0, predictedIn: '7 days', location: i.location, count: 0 };
      zones[key].count++;
      zones[key].riskScore = Math.min(100, zones[key].count * 10 + (i.priorityScore || 0));
      zones[key].predictedIn = zones[key].count > 5 ? '2 days' : zones[key].count > 2 ? '4 days' : '7 days';
    }
  });
  return Object.values(zones).sort((a,b) => b.riskScore - a.riskScore).slice(0,6);
}

async function escalateIssues() {
  const now = new Date();
  const overdue = db
    ? await db.collection('issues').find({ status: 'open', createdAt: { $exists: true } }).toArray()
    : mem.issues.filter(i => i.status === 'open' && i.createdAt);

  for (const issue of overdue) {
    if (!issue.createdAt || !issue.slaHours) continue;
    const createdAt = new Date(issue.createdAt);
    const elapsedHours = (now - createdAt) / 3600000;
    if (elapsedHours > issue.slaHours && (issue.escalationLevel || 0) < 3) {
      const newLevel = (issue.escalationLevel || 0) + 1;
      if (db) {
        await db.collection('issues').updateOne({ _id: issue._id }, { $set: { escalationLevel: newLevel, escalated: true } });
      } else {
        issue.escalationLevel = newLevel;
        issue.escalated = true;
      }

      const escDoc = {
        issueId: issue.issueId,
        issueType: issue.type,
        level: newLevel,
        assignedTo: newLevel === 3 ? 'Commissioner' : newLevel === 2 ? 'Senior Officer' : 'Local Officer',
        resolved: false,
        createdAt: new Date().toISOString(),
        message: `SLA breach: level ${newLevel}`
      };

      if (db) await db.collection('escalations').insertOne(escDoc);
      else mem.escalations.unshift({ _id: newId(), ...escDoc });

      io.emit('update-escalations', { issueId: issue.issueId, level: newLevel });
    }
  }

  // emit current issue list after escalation update so dashboards refresh graphs/summary
  const issues = await getIssues(500);
  io.emit('update-issues', issues);
}

async function init() {
  if (!MONGO_URI) {
    console.warn('MONGO_URI not set. Running in demo (in-memory) mode.');
    return;
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection('issues').createIndex({ 'location': '2dsphere' }, { sparse: true });
  await db.collection('issues').createIndex({ issueId: 1 }, { unique: true, sparse: true });
  console.log('MongoDB connected. db:', DB_NAME);

  // Seed admin user
  const adminExists = await db.collection('users').findOne({ username: 'admin' });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await db.collection('users').insertOne({ username: 'admin', password: hashedPassword, role: 'admin', createdAt: new Date() });
    console.log('Admin user seeded');
  }

  // Automatic escalation worker
  setInterval(async () => {
    try {
      await escalateIssues();
    } catch (e) {
      console.error('Escalation worker error', e);
    }
  }, 60 * 1000); // every minute
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('/health', (req, res) => {
  return res.json({ ok: true, mode: db ? 'mongodb' : 'memory', database: db ? DB_NAME : null });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, message: 'Username and password required' });
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    return res.json({ ok: true, message: 'Login successful' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, message: 'Username and password required' });
    const existing = await db.collection('users').findOne({ username });
    if (existing) return res.status(409).json({ ok: false, message: 'User already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({ username, password: hashedPassword, role: 'admin', createdAt: new Date() });
    return res.status(201).json({ ok: true, message: 'User registered', insertedId: result.insertedId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/issues', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (db) {
      const issues = await db.collection('issues').find(filter).sort({ createdAt: -1 }).limit(500).toArray();
      return res.json({ ok: true, data: issues });
    }
    const issues = mem.issues
      .filter(i => Object.entries(filter).every(([k, v]) => i?.[k] === v))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 500);
    return res.json({ ok: true, data: issues, mode: 'memory' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/issues', upload.single('photo'), async (req, res) => {
  try {
    const issue = req.body;
    if (!issue.issueId) issue.issueId = `CIV-${Math.floor(Math.random()*90000 + 10000)}`;
    issue.createdAt = issue.createdAt || new Date().toISOString();

    // Parse JSON fields
    if (issue.location) issue.location = JSON.parse(issue.location);
    issue.slaHours = parseInt(issue.slaHours) || 48;
    issue.escalationLevel = parseInt(issue.escalationLevel) || 0;
    issue.escalated = issue.escalated === 'true';
    if (issue.resolvedAt && issue.resolvedAt !== 'null') issue.resolvedAt = new Date(issue.resolvedAt);
    else issue.resolvedAt = null;
    if (issue.resolutionRating) issue.resolutionRating = parseInt(issue.resolutionRating) || null;

    // AI Analysis if image provided
    if (req.file) {
      issue.photoData = req.file.buffer.toString('base64'); // Store base64 for simplicity
      // TODO: Add AI analysis here
    }

    // Clustering: Check for nearby issues
    if (issue.location && issue.location.coordinates) {
      const [lng, lat] = issue.location.coordinates;
      const nearby = db
        ? await db.collection('issues').find({
            location: {
              $near: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
                $maxDistance: 500 // 500 meters
              }
            },
            status: 'open',
            type: issue.type
          }).toArray()
        : mem.issues.filter(i => {
            if (!i.location?.coordinates) return false;
            if (i.status !== 'open') return false;
            if (i.type !== issue.type) return false;
            const [ilng, ilat] = i.location.coordinates;
            // rough distance check (good enough for demo mode)
            const dx = (ilng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
            const dy = (ilat - lat) * 111_000;
            return Math.sqrt(dx * dx + dy * dy) <= 500;
          });
      if (nearby.length > 0) {
        issue.cluster = nearby[0].issueId;
        issue.isDuplicate = true;
        issue.clusterCount = nearby.length + 1;
        // Update cluster count
        if (db) {
          await db.collection('issues').updateMany({ issueId: nearby[0].issueId }, { $set: { clusterCount: issue.clusterCount } });
        } else {
          mem.issues.forEach(i => {
            if (i.issueId === nearby[0].issueId) i.clusterCount = issue.clusterCount;
          });
        }
      } else {
        issue.cluster = null;
        issue.isDuplicate = false;
        issue.clusterCount = 1;
      }
    }

    // Priority Scoring
    let score = 50;
    if (issue.severity === 'critical') score += 40;
    else if (issue.severity === 'high') score += 25;
    else if (issue.severity === 'medium') score += 10;
    score += (parseInt(issue.clusterCount) - 1) * 5; // More reports = higher priority
    issue.priorityScore = Math.min(100, score);
    issue.priority = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

    if (db) {
      const existing = await db.collection('issues').findOne({ issueId: issue.issueId });
      if (existing) return res.status(409).json({ ok: false, message: 'Duplicate issueId' });
    } else {
      if (mem.issues.some(i => i.issueId === issue.issueId)) return res.status(409).json({ ok: false, message: 'Duplicate issueId' });
    }

    let insertedId;
    if (db) {
      const result = await db.collection('issues').insertOne(issue);
      insertedId = result.insertedId;
    } else {
      issue._id = newId();
      insertedId = issue._id;
      mem.issues.unshift(issue);
    }
    // Emit real-time updates
    io.emit('new-issue', issue);
    const issues = await getIssues(500);
    io.emit('update-issues', issues);
    const hotspots = await computeHotspots();
    io.emit('update-hotspots', hotspots);
    // Fire escalation check right away
    await escalateIssues();
    const escs = await getEscalations(100);
    io.emit('update-escalations', escs);
    return res.status(201).json({ ok: true, insertedId, issueId: issue.issueId, priority: issue.priority, cluster: issue.cluster, mode: db ? 'mongodb' : 'memory' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/issues/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    let modifiedCount = 0;
    if (db) {
      const result = await db.collection('issues').updateOne({ _id: new ObjectId(id) }, { $set: body });
      modifiedCount = result.modifiedCount;
    } else {
      const idx = mem.issues.findIndex(i => i._id === id || i.issueId === id);
      if (idx >= 0) {
        mem.issues[idx] = { ...mem.issues[idx], ...body };
        modifiedCount = 1;
      }
    }

    const issues = await getIssues(500);
    io.emit('update-issues', issues);
    const hotspots = await computeHotspots();
    io.emit('update-hotspots', hotspots);
    await escalateIssues();
    const escs = await getEscalations(100);
    io.emit('update-escalations', escs);
    return res.json({ ok: true, modifiedCount, mode: db ? 'mongodb' : 'memory' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/escalations', async (req, res) => {
  try {
    const esc = await getEscalations(100);
    return res.json({ ok: true, data: esc, mode: db ? 'mongodb' : 'memory' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/escalations', async (req, res) => {
  try {
    const doc = req.body;
    doc.createdAt = doc.createdAt || new Date().toISOString();
    if (db) {
      const result = await db.collection('escalations').insertOne(doc);
      return res.status(201).json({ ok: true, insertedId: result.insertedId });
    }
    const insertedId = newId();
    mem.escalations.unshift({ _id: insertedId, ...doc });
    return res.status(201).json({ ok: true, insertedId, mode: 'memory' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/hotspots', async (req, res) => {
  try {
    const hots = await computeHotspots();
    return res.json({ ok: true, data: hots });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/hotspots', async (req, res) => {
  try {
    const doc = req.body;
    doc.createdAt = doc.createdAt || new Date().toISOString();
    const result = await db.collection('hotspots').insertOne(doc);
    return res.status(201).json({ ok: true, insertedId: result.insertedId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

init().then(()=>{
  server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}).catch(err=>{
  console.error('Failed to init DB; continuing in demo (in-memory) mode.', err);
  server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
});
