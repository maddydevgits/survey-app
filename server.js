const express = require('express');
const nunjucks = require('nunjucks');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir + '/' });

const app = express();
const PORT = process.env.PORT || 8091;

// In-memory storage (can be replaced with database)
const surveys = new Map(); // Store survey definitions
const responses = new Map(); // Store survey responses

// MongoDB (optional) - for draft save/load
let mongoClient = null;
let draftsCollection = null;
let usersCollection = null;
let surveysCollection = null;
let responsesCollection = null;
let sharingCollection = null;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://parvathanenimadhu:123madhu@cluster0.yaaw6.mongodb.net/surveyapp?retryWrites=true&w=majority';
async function initMongo() {
    if (!MONGODB_URI) {
        console.warn('MONGODB_URI not set. Draft endpoints will be unavailable.');
        return;
    }
    try {
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        const dbName = process.env.MONGODB_DB || 'surveyapp';
        const db = mongoClient.db(dbName);
        draftsCollection = db.collection('drafts');
        usersCollection = db.collection('users');
        surveysCollection = db.collection('surveys');
        responsesCollection = db.collection('responses');
        sharingCollection = db.collection('sharing'); // Survey sharing permissions
        
        // Clean up drafts with null or invalid ownerId before creating index
        try {
            const cleanupResult = await draftsCollection.deleteMany({
                $or: [
                    { ownerId: null },
                    { ownerId: { $exists: false } },
                    { ownerId: '' }
                ]
            });
            if (cleanupResult.deletedCount > 0) {
                console.log(`Cleaned up ${cleanupResult.deletedCount} draft(s) with invalid ownerId`);
            }
        } catch (cleanupError) {
            console.warn('Error cleaning up invalid drafts:', cleanupError.message);
        }
        
        // Ensure index for upsert lookups (unique per surveyId + ownerId combination)
        // This allows multiple users to have separate drafts for the same survey
        try {
            // Drop old indexes if they exist (including wrong field names)
            const indexesToDrop = ['surveyId_1', 'surveyId_1_ownerId_1', 'surveyId_1_userId_1'];
            for (const indexName of indexesToDrop) {
                try {
                    await draftsCollection.dropIndex(indexName);
                } catch (_) {
                    // Index doesn't exist, that's fine
                }
            }
            
            // Create new composite index with ownerId (not userId)
            await draftsCollection.createIndex({ surveyId: 1, ownerId: 1 }, { unique: true });
        } catch (indexError) {
            // If index creation fails, try to drop and recreate
            console.warn('Index creation failed, attempting to drop and recreate:', indexError.message);
            try {
                await draftsCollection.dropIndex('surveyId_1_ownerId_1');
            } catch (_) {}
            try {
                await draftsCollection.createIndex({ surveyId: 1, ownerId: 1 }, { unique: true });
            } catch (retryError) {
                console.error('Failed to create drafts index after retry:', retryError.message);
            }
        }
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await surveysCollection.createIndex({ id: 1 }, { unique: true });
        await responsesCollection.createIndex({ surveyId: 1 });
        await sharingCollection.createIndex({ surveyId: 1, sharedWithUserId: 1 }, { unique: true });
        console.log('✅ Connected to MongoDB and initialized collections');
        // Seed admin user if not exists (username: admin, password: admin123)
        const admin = await usersCollection.findOne({ username: 'admin' });
        if (!admin) {
            await usersCollection.insertOne({ username: 'admin', password: 'admin123', role: 'admin', createdAt: new Date().toISOString() });
            console.log('👑 Seeded default admin user');
        }
    } catch (err) {
        console.error('❌ MongoDB init failed:', err.message);
        draftsCollection = null;
    }
}
initMongo();

// Configure Nunjucks
nunjucks.configure('views', {
    autoescape: true,
    express: app,
    watch: process.env.NODE_ENV !== 'production' // Auto-reload templates in development
});

// Set view engine
app.set('view engine', 'html');

// Parse JSON bodies (before routes)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
    resave: false,
    saveUninitialized: false,
}));

// Auth helpers
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    return res.redirect('/admin/login');
}
function requireUser(req, res, next) {
    if (req.session && req.session.user) return next();
    const redirect = encodeURIComponent(req.originalUrl || '/dynamic-form');
    return res.redirect(`/user/login?redirect=${redirect}`);
}

// Admin auth routes
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { title: 'Admin Login' });
});
app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body || {};
    try {
        if (usersCollection) {
            const user = await usersCollection.findOne({ username });
            if (user && user.password === password && user.role === 'admin') {
                req.session.user = { id: String(user._id), username: user.username, role: 'admin' };
                return res.redirect('/');
            }
        } else if (username === 'admin' && password === 'admin123') {
            req.session.user = { username: 'admin', role: 'admin' };
            return res.redirect('/');
        }
    } catch (e) {}
    res.status(401).render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
});
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});
app.post('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});

// Admin dashboard
app.get('/admin', requireAdmin, async (req, res) => {
    let surveysList = [];
    let usersList = [];
    try {
        if (surveysCollection) {
            const cursor = surveysCollection.find({}, { projection: { _id: 1, id: 1, title: 1, createdAt: 1 } }).sort({ _id: -1 }).limit(100);
            surveysList = await cursor.toArray();
        }
        if (usersCollection) {
            const cursorU = usersCollection.find({ role: { $in: ['user', 'admin'] } }, { projection: { _id: 1, username: 1, role: 1, createdAt: 1 } }).sort({ _id: -1 }).limit(100);
            usersList = await cursorU.toArray();
        }
        console.log('✅ Admin dashboard loaded', { surveysList: surveysList.length, usersList: usersList.length });
    } catch (e) {
        // ignore listing errors, show empty lists
    }
    res.render('admin', { title: 'Admin Dashboard', user: req.session.user, surveysList, usersList });
});
app.post('/admin/users', requireAdmin, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).render('admin', { title: 'Admin Dashboard', user: req.session.user, error: 'Username and password required' });
    }
    try {
        if (!usersCollection) throw new Error('DB unavailable');
        await usersCollection.insertOne({ username, password, role: 'user', createdAt: new Date().toISOString() });
        res.render('admin', { title: 'Admin Dashboard', user: req.session.user, success: `User ${username} created` });
    } catch (e) {
        res.status(400).render('admin', { title: 'Admin Dashboard', user: req.session.user, error: 'Failed to create user (might already exist)' });
    }
});

// User auth routes
app.get('/user/login', (req, res) => {
    res.render('user-login', { title: 'User Login', redirect: req.query.redirect || '' });
});
app.post('/user/login', async (req, res) => {
    const { username, password, redirect } = req.body || {};
    try {
        if (!usersCollection) throw new Error('DB unavailable');
        const user = await usersCollection.findOne({ username, role: { $in: ['user', 'admin'] } });
        if (!user || user.password !== password) throw new Error('Invalid');
        req.session.user = { id: String(user._id), username: user.username, role: user.role };
        // Redirect to user dashboard if no specific redirect URL, or to requested page if provided
        return res.redirect(redirect || '/user/dashboard');
    } catch (e) {
        res.status(401).render('user-login', { title: 'User Login', error: 'Invalid credentials', redirect });
    }
});
app.get('/user/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/user/login'));
});
app.post('/user/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/user/login'));
});

// Current user info (for client-side usage)
app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        const { id, username, role } = req.session.user;
        return res.json({ loggedIn: true, user: { id, username, role } });
    }
    return res.status(401).json({ loggedIn: false });
});

// Get list of users (for sharing)
app.get('/api/users/list', requireUser, async (req, res) => {
    try {
        if (!usersCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        const currentUserId = req.session.user.id;
        const cursor = usersCollection.find(
            { _id: { $ne: new ObjectId(currentUserId) }, role: { $in: ['user', 'admin'] } },
            { projection: { _id: 1, username: 1, role: 1 } }
        ).sort({ username: 1 });
        const users = await cursor.toArray();
        res.json({
            success: true,
            users: users.map(u => ({ id: String(u._id), username: u.username, role: u.role }))
        });
    } catch (e) {
        console.error('❌ Error fetching users:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

// Share survey with users
app.post('/api/survey/:surveyId/share', requireUser, async (req, res) => {
    const surveyId = req.params.surveyId;
    const { userIds } = req.body || {}; // Array of user IDs to share with
    const ownerId = req.session.user.id;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ success: false, error: 'userIds array required' });
    }
    
    try {
        if (!sharingCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        
        // Verify survey exists and user is owner
        let survey = null;
        if (surveysCollection) {
            let doc = await surveysCollection.findOne({ id: surveyId });
            if (!doc) {
                try {
                    const oid = new ObjectId(surveyId);
                    doc = await surveysCollection.findOne({ _id: oid });
                } catch (_) {}
            }
            if (doc) survey = doc;
        }
        
        if (!survey) {
            return res.status(404).json({ success: false, error: 'Survey not found' });
        }
        
        // Share with each user
        const results = [];
        for (const sharedWithUserId of userIds) {
            try {
                await sharingCollection.updateOne(
                    { surveyId, sharedWithUserId },
                    { $set: { surveyId, sharedWithUserId, ownerId, sharedAt: new Date().toISOString() } },
                    { upsert: true }
                );
                results.push({ userId: sharedWithUserId, success: true });
            } catch (e) {
                results.push({ userId: sharedWithUserId, success: false, error: e.message });
            }
        }
        
        res.json({ success: true, results });
    } catch (e) {
        console.error('❌ Error sharing survey:', e);
        res.status(500).json({ success: false, error: 'Failed to share survey' });
    }
});

// Get who has access to a survey
app.get('/api/survey/:surveyId/shared', requireUser, async (req, res) => {
    const surveyIdParam = req.params.surveyId;
    try {
        if (!sharingCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        
        // Find shares - try exact surveyId match first
        let shares = await sharingCollection.find({ surveyId: surveyIdParam }).toArray();
        
        // If no matches, try by Mongo _id if surveyId looks like ObjectId
        if (shares.length === 0) {
            try {
                const surveyOid = new ObjectId(surveyIdParam);
                shares = await sharingCollection.find({ 
                    $or: [
                        { surveyId: surveyIdParam },
                        { surveyId: String(surveyOid) }
                    ]
                }).toArray();
            } catch (_) {}
        }
        
        const userIds = shares.map(s => s.sharedWithUserId);
        
        // Get user details
        let users = [];
        if (usersCollection && userIds.length > 0) {
            const objectIds = userIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
            if (objectIds.length > 0) {
                const cursor = usersCollection.find(
                    { _id: { $in: objectIds } },
                    { projection: { _id: 1, username: 1, role: 1 } }
                );
                users = await cursor.toArray();
            }
        }
        
        res.json({
            success: true,
            sharedWith: users.map(u => ({ id: String(u._id), username: u.username, role: u.role }))
        });
    } catch (e) {
        console.error('❌ Error fetching shared users:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch shared users' });
    }
});

// Remove sharing access (owner only)
app.delete('/api/survey/:surveyId/share/:userId', requireUser, async (req, res) => {
    const surveyIdParam = req.params.surveyId;
    const sharedWithUserId = req.params.userId;
    const loggedInUserId = req.session.user.id;
    
    try {
        if (!sharingCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        
        // Find share record - try by exact surveyId match first
        let share = await sharingCollection.findOne({ 
            surveyId: surveyIdParam, 
            sharedWithUserId: sharedWithUserId 
        });
        
        // If not found, try matching by survey _id (in case surveyId is Mongo _id)
        if (!share) {
            try {
                const surveyOid = new ObjectId(surveyIdParam);
                share = await sharingCollection.findOne({ 
                    $or: [
                        { surveyId: surveyIdParam, sharedWithUserId: sharedWithUserId },
                        { surveyId: String(surveyOid), sharedWithUserId: sharedWithUserId }
                    ]
                });
            } catch (_) {}
        }
        
        if (!share) {
            return res.status(404).json({ success: false, error: 'Sharing record not found' });
        }
        
        // Verify logged-in user is the owner (check share.ownerId matches or user is admin)
        const isAdmin = req.session.user.role === 'admin';
        const isOwner = share.ownerId === loggedInUserId;
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Only the owner can remove sharing access' });
        }
        
        // Remove sharing access - delete by _id to ensure exact match
        const result = await sharingCollection.deleteOne({ _id: share._id });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: 'Sharing record not found or already deleted' });
        }
        
        res.json({ success: true, message: 'Access removed successfully' });
    } catch (e) {
        console.error('❌ Error removing sharing access:', e);
        res.status(500).json({ success: false, error: 'Failed to remove sharing access: ' + e.message });
    }
});

// Bulk generate public links from CSV
app.post('/api/bulk-generate-links', requireAdmin, upload.single('csvfile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'CSV file is required' });
    }
    
    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // Parse CSV (simple parsing - assumes comma-separated, no quoted values)
        const lines = fileContent.split('\n').filter(line => line.trim());
        const results = [];
        const errors = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Split by comma, handling potential spaces
            const columns = line.split(',').map(col => col.trim());
            
            if (columns.length < 2) {
                errors.push({ row: i + 1, error: 'Insufficient columns (need Survey ID and User ID)' });
                continue;
            }
            
            const surveyId = columns[0];
            const userId = columns[1];
            
            if (!surveyId || !userId) {
                errors.push({ row: i + 1, error: 'Missing Survey ID or User ID' });
                continue;
            }
            
            // Generate link
            const baseUrl = req.protocol + '://' + req.get('host');
            const link = `${baseUrl}/f/${encodeURIComponent(surveyId)}/${encodeURIComponent(userId)}`;
            
            results.push({
                row: i + 1,
                surveyId,
                userId,
                link,
                status: 'success'
            });
        }
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            totalRows: lines.length,
            successCount: results.length,
            errorCount: errors.length,
            results,
            errors
        });
    } catch (err) {
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (_) {}
        }
        console.error('❌ Error processing CSV:', err);
        res.status(500).json({ success: false, error: 'Failed to process CSV: ' + err.message });
    }
});

// Get surveys shared with current user
app.get('/api/surveys/shared-with-me', requireUser, async (req, res) => {
    const userId = req.session.user.id;
    try {
        if (!sharingCollection || !surveysCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        
        // Find all surveys shared with this user
        const shares = await sharingCollection.find({ sharedWithUserId: userId }).toArray();
        const surveyIds = shares.map(s => s.surveyId);
        
        if (surveyIds.length === 0) {
            return res.json({ success: true, surveys: [] });
        }
        
        // Get survey details
        const surveys = [];
        for (const surveyId of surveyIds) {
            try {
                let doc = await surveysCollection.findOne({ id: surveyId });
                if (!doc) {
                    try {
                        const oid = new ObjectId(surveyId);
                        doc = await surveysCollection.findOne({ _id: oid });
                    } catch (_) {}
                }
                if (doc) {
                    // Get owner info
                    let owner = null;
                    const shareDoc = shares.find(s => s.surveyId === surveyId || s.surveyId === String(doc._id || doc.id));
                    if (shareDoc && shareDoc.ownerId && usersCollection) {
                        try {
                            const ownerDoc = await usersCollection.findOne({ _id: new ObjectId(shareDoc.ownerId) });
                            if (ownerDoc) owner = { id: String(ownerDoc._id), username: ownerDoc.username };
                        } catch (_) {}
                    }
                    surveys.push({
                        id: String(doc._id || doc.id),
                        title: doc.title || 'Untitled Survey',
                        createdAt: doc.createdAt,
                        owner: owner,
                        ownerLink: shareDoc ? `/f/${String(doc._id || doc.id)}/${shareDoc.ownerId}` : null
                    });
                }
            } catch (e) {
                console.warn('Error loading survey:', surveyId, e);
            }
        }
        
        res.json({ success: true, surveys });
    } catch (e) {
        console.error('❌ Error fetching shared surveys:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch shared surveys' });
    }
});
// Routes - API routes first to avoid conflicts
// Get all surveys (for export selection) - MUST come before /survey/:id
app.get('/api/surveys/list', async (req, res) => {
    console.log('📋 /api/surveys/list endpoint called - Route registered!');
    try {
        let dbSurveys = [];
        if (surveysCollection) {
            const cursor = surveysCollection.find({}, { projection: { _id: 1, id: 1, title: 1, createdAt: 1 } });
            dbSurveys = await cursor.toArray();
        }
        const normalized = dbSurveys.map(d => ({ id: String(d._id || d.id), title: d.title || 'Untitled Survey', createdAt: d.createdAt }));
        const sorted = normalized.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        console.log(`✅ Returning ${sorted.length} surveys`);
        res.json({ success: true, surveys: sorted });
    } catch (error) {
        console.error('❌ Error in /api/surveys/list:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch surveys', message: error.message });
    }
});

// Get a specific survey by ID (for export)
app.get('/api/survey/:id/export', async (req, res) => {
    const id = req.params.id;
    let survey = null;
    try {
        if (surveysCollection) {
            // Try by custom id then by _id
            let doc = await surveysCollection.findOne({ id });
            if (!doc) {
                try {
                    const oid = new ObjectId(id);
                    doc = await surveysCollection.findOne({ _id: oid });
                } catch (_) {}
            }
            if (doc) {
                survey = { id: String(doc._id || doc.id), title: doc.title, json: doc.json, createdAt: doc.createdAt };
            }
        }
    if (!survey) {
            return res.status(404).json({ success: false, error: 'Survey not found' });
        }
        res.json({ success: true, survey: { id: survey.id, title: survey.title || 'Untitled Survey', json: survey.json, createdAt: survey.createdAt } });
    } catch (e) {
        console.error('❌ Error exporting survey:', e);
        res.status(500).json({ success: false, error: 'Failed to load survey' });
    }
});

// Helper function to check if user has access to survey (owner or explicitly shared)
async function checkSurveyAccess(surveyIdParam, loggedInUserId, expectedOwnerUserId) {
    // First check: If logged-in user matches expected owner ID from URL
    // This means the user is accessing a link that was assigned to them
    if (expectedOwnerUserId && loggedInUserId === expectedOwnerUserId) {
        // User is accessing their assigned link - allow access
        // Note: Multiple users can be assigned to the same survey (same surveyId, different userId)
        // Each user only sees their own drafts (handled in draft loading endpoint)
        return { hasAccess: true, isOwner: true, ownerId: expectedOwnerUserId };
    }
    
    // Second check: If not owner, check if survey is explicitly shared with this user
    if (sharingCollection) {
        try {
            // Try exact surveyId match
            let share = await sharingCollection.findOne({ 
                surveyId: surveyIdParam, 
                sharedWithUserId: loggedInUserId 
            });
            
            // If not found, try with Mongo _id as surveyId
            if (!share) {
                try {
                    const surveyOid = new ObjectId(surveyIdParam);
                    share = await sharingCollection.findOne({ 
                        $or: [
                            { surveyId: surveyIdParam, sharedWithUserId: loggedInUserId },
                            { surveyId: String(surveyOid), sharedWithUserId: loggedInUserId }
                        ]
                    });
                } catch (_) {}
            }
            
            if (share && share.ownerId) {
                // Verify the share record's ownerId matches the expected owner from URL
                // This prevents User B from accessing User A's survey via different URL
                if (expectedOwnerUserId && share.ownerId !== expectedOwnerUserId) {
                    // Share exists but for different owner - deny access
                    return { hasAccess: false, isOwner: false };
                }
                return { hasAccess: true, isOwner: false, shareRecord: share, ownerId: share.ownerId };
            }
        } catch (e) {
            console.warn('Error checking share access:', e);
        }
    }
    
    // No access - user is not owner and survey is not shared with them
    return { hasAccess: false, isOwner: false };
}

// Draft APIs (Mongo-backed) - Shared drafts for owner and shared users only
app.post('/api/draft/save', requireUser, async (req, res) => {
    if (!draftsCollection) {
        return res.status(503).json({ success: false, error: 'Draft storage unavailable (no DB connection)' });
    }
    const { surveyId, userId, data } = req.body || {};
    const loggedInUserId = req.session.user.id;
    
    if (!surveyId || typeof data !== 'object') {
        return res.status(400).json({ success: false, error: 'surveyId and data are required' });
    }
    
    // Verify user has access to this survey (owner OR explicitly shared)
    const accessCheck = await checkSurveyAccess(surveyId, loggedInUserId, userId);
    
    if (!accessCheck.hasAccess) {
        return res.status(403).json({ success: false, error: 'No access to this survey. Survey must be shared with you.' });
    }
    
    // Determine the owner ID - use userId from request body (comes from URL parameter in frontend)
    // This ensures each assigned user gets their own draft based on their URL parameter
    // For shared users, accessCheck.ownerId will be the actual owner's ID
    let ownerId = userId; // Use userId from request body (from URL parameter)
    if (accessCheck.shareRecord && accessCheck.shareRecord.ownerId) {
        // If user is accessing via sharing, use the owner's ID for shared draft
        ownerId = accessCheck.shareRecord.ownerId;
    }
    
    // Ensure ownerId is always a valid string (never null or undefined)
    if (!ownerId || typeof ownerId !== 'string' || ownerId.trim() === '') {
        // Fallback to loggedInUserId if ownerId is invalid
        ownerId = loggedInUserId;
    }
    
    // Validate ownerId is not null/undefined before saving
    if (!ownerId) {
        return res.status(400).json({ success: false, error: 'Unable to determine owner ID for draft' });
    }
    
    const now = new Date().toISOString();
    try {
        // Save draft by (surveyId, ownerId) combination
        // This allows multiple assigned users to have separate drafts for the same survey
        // Use surveyId + ownerId as composite key
        const result = await draftsCollection.updateOne(
            { surveyId, ownerId },
            { $set: { surveyId, ownerId, savedByUserId: loggedInUserId, data, updatedAt: now } },
            { upsert: true }
        );
        res.json({ success: true, upserted: !!result.upsertedId, matchedCount: result.matchedCount });
    } catch (err) {
        console.error('❌ Error saving draft:', err);
        res.status(500).json({ success: false, error: 'Failed to save draft' });
    }
});

app.get('/api/draft/:surveyId/:userId', requireUser, async (req, res) => {
    if (!draftsCollection) {
        return res.status(503).json({ success: false, error: 'Draft storage unavailable (no DB connection)' });
    }
    const surveyIdParam = req.params.surveyId;
    const expectedUserId = req.params.userId;
    const loggedInUserId = req.session.user.id;
    
    try {
        // Check if user has access (owner OR explicitly shared) - MUST pass before loading draft
        const accessCheck = await checkSurveyAccess(surveyIdParam, loggedInUserId, expectedUserId);
        
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ success: false, error: 'No access to this survey. Survey must be shared with you.' });
        }
        
        // Determine which draft to load based on access type
        // For assigned users, use expectedUserId from URL (their assigned userId)
        // For shared users, use the owner's ID from share record
        let draftOwnerId = expectedUserId; // Default to userId from URL (assigned user)
        if (accessCheck.shareRecord && accessCheck.shareRecord.ownerId) {
            // If user is accessing via sharing, they should see the owner's draft
            draftOwnerId = accessCheck.shareRecord.ownerId;
        }
        
        // Try finding draft by (surveyId, ownerId) combination - MUST match exactly
        // No fallback to old drafts - only return exact matches
        let draft = await draftsCollection.findOne({ surveyId: surveyIdParam, ownerId: draftOwnerId });
        
        // If not found, try with Mongo _id as surveyId (for backwards compatibility with surveyId format)
        if (!draft) {
            try {
                const surveyOid = new ObjectId(surveyIdParam);
                draft = await draftsCollection.findOne({ 
                    surveyId: String(surveyOid), 
                    ownerId: draftOwnerId 
                });
            } catch (_) {
                // surveyIdParam is not a valid ObjectId, continue
            }
        }
        
        // No fallback logic - if draft doesn't exist for this user, return 404
        
        if (!draft) {
            return res.status(404).json({ success: false, error: 'Draft not found' });
        }
        
        res.json({ success: true, data: draft.data, updatedAt: draft.updatedAt, savedByUserId: draft.savedByUserId });
    } catch (err) {
        console.error('❌ Error fetching draft:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch draft' });
    }
});

// Serve static files (CSS, JS, images, etc.) - after API routes
app.use(express.static('public'));

// Routes - page routes
app.get('/', requireAdmin, (req, res) => {
    res.render('index', {
        title: 'SurveyJS Form Builder',
        pageTitle: 'SurveyJS Form Builder'
    });
});

// List all surveys (admin)
app.get('/surveys', requireAdmin, async (req, res) => {
    try {
        let dbSurveys = [];
        if (surveysCollection) {
            const cursor = surveysCollection.find({}, { projection: { _id: 1, id: 1, title: 1, createdAt: 1 } });
            dbSurveys = await cursor.toArray();
        }
        const base = dbSurveys.map(d => ({ id: String(d._id || d.id), title: d.title || 'Untitled Survey', createdAt: d.createdAt }));
        const addCounts = await Promise.all(base.map(async s => {
            let cnt = 0;
            if (responsesCollection) {
                cnt = await responsesCollection.countDocuments({ surveyId: s.id });
            }
            return { ...s, responseCount: cnt };
        }));
        const sorted = addCounts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.render('surveys', { title: 'My Surveys', surveys: sorted });
    } catch (e) {
        res.render('surveys', { title: 'My Surveys', surveys: [] });
    }
});

// View/run a survey (for users to fill out)
app.get('/survey/:id', async (req, res) => {
    const id = req.params.id;
    let survey = null;
    try {
        if (surveysCollection) {
            let doc = await surveysCollection.findOne({ id });
            if (!doc) {
                try {
                    const oid = new ObjectId(id);
                    doc = await surveysCollection.findOne({ _id: oid });
                } catch (_) {}
            }
            if (doc) {
                survey = { id: String(doc._id || doc.id), title: doc.title, json: doc.json };
            }
        }
        if (!survey) return res.status(404).send('Survey not found');
        res.render('survey-runner', { title: survey.title || 'Survey', surveyJSON: JSON.stringify(survey.json), surveyId: survey.id });
    } catch (e) {
        res.status(500).send('Error loading survey');
    }
});

// Save survey definition (admin only)
app.post('/api/survey/save', requireAdmin, async (req, res) => {
    const { json, title } = req.body;
    if (!json) {
        return res.status(400).json({ error: 'Survey JSON is required' });
    }
    const surveyId = req.body.id || uuidv4();
    try {
        if (!surveysCollection) throw new Error('DB unavailable');
        await surveysCollection.updateOne(
            { id: surveyId },
            { $set: { id: surveyId, title: title || 'Untitled Survey', json, createdAt: new Date().toISOString() } },
            { upsert: true }
        );
        res.json({ success: true, surveyId: surveyId, message: 'Survey saved successfully' });
    } catch (e) {
        console.error('❌ Error saving survey:', e);
        res.status(500).json({ success: false, error: 'Failed to save survey' });
    }
});

// Submit survey response
app.post('/api/survey/:id/respond', async (req, res) => {
    const surveyId = String(req.params.id);
    try {
        if (!surveysCollection) return res.status(404).json({ error: 'Survey not found' });
        // Ensure survey exists in DB
        let exists = await surveysCollection.findOne({ id: surveyId });
        if (!exists) {
            try {
                const oid = new ObjectId(surveyId);
                exists = await surveysCollection.findOne({ _id: oid });
            } catch (_) {}
        }
        if (!exists) return res.status(404).json({ error: 'Survey not found' });
        const responseId = uuidv4();
        if (responsesCollection) {
            await responsesCollection.insertOne({ id: responseId, surveyId, data: req.body, submittedAt: new Date().toISOString() });
        }
        res.json({ success: true, message: 'Response submitted successfully', responseId });
    } catch (e) {
        console.error('❌ Error saving response:', e);
        res.status(500).json({ success: false, error: 'Failed to submit response' });
    }
});

// Helper function to extract questions from survey JSON
function extractQuestions(surveyJson) {
    const questions = [];
    
    if (!surveyJson) {
        console.log('No survey JSON provided');
        return questions;
    }
    
    // Function to recursively extract elements
    function extractElements(elements, path = '') {
        if (!elements || !Array.isArray(elements)) return;
        
        elements.forEach(element => {
            // Check if this is a question element (has a name) - extract even without title
            if (element.name) {
                // Get title - try multiple possible properties
                const questionTitle = element.title || 
                                     element.questionTitle || 
                                     element.question || 
                                     element.label ||
                                     element.caption ||
                                     element.description ||
                                     element.name; // Fallback to name if no title
                
                // Extract choices - handle different structures
                let choices = null;
                if (element.choices && Array.isArray(element.choices)) {
                    choices = element.choices;
                } else if (element.options && Array.isArray(element.options)) {
                    // Some question types use 'options' instead of 'choices'
                    choices = element.options;
                } else if (element.type === 'radiogroup' || element.type === 'checkbox' || element.type === 'dropdown' || element.type === 'selectbase') {
                    choices = [];
                }
                
                questions.push({
                    name: element.name,
                    title: questionTitle,
                    type: element.type || 'text',
                    choices: choices
                });
                
                console.log(`Found question: name="${element.name}", title="${questionTitle}", type="${element.type || 'text'}", hasChoices=${!!choices}`);
            }
            
            // Recursively check for elements in panels, pages, etc.
            if (element.elements) {
                extractElements(element.elements, path + '/' + (element.name || element.type || 'element'));
            }
            
            // Also check for questions in question arrays (some structures)
            if (element.questions && Array.isArray(element.questions)) {
                extractElements(element.questions, path + '/questions');
            }
        });
    }
    
    // Check for pages structure (most common in SurveyJS)
    if (surveyJson.pages && Array.isArray(surveyJson.pages)) {
        console.log('Found pages structure, extracting from', surveyJson.pages.length, 'pages');
        surveyJson.pages.forEach((page, pageIndex) => {
            if (page.elements) {
                extractElements(page.elements, `page[${pageIndex}]`);
            }
        });
    }
    
    // Check for direct elements structure
    if (surveyJson.elements && Array.isArray(surveyJson.elements)) {
        console.log('Found direct elements structure');
        extractElements(surveyJson.elements);
    }
    
    // Check for questions property (alternative structure)
    if (surveyJson.questions && Array.isArray(surveyJson.questions)) {
        console.log('Found questions property');
        extractElements(surveyJson.questions);
    }
    
    console.log(`Extracted ${questions.length} questions total`);
    return questions;
}

// Get survey responses
app.get('/survey/:id/responses', async (req, res) => {
    const surveyIdParam = String(req.params.id);
    let surveyDoc = null;
    try {
        if (surveysCollection) {
            let doc = await surveysCollection.findOne({ id: surveyIdParam });
            if (!doc) {
                try {
                    const oid = new ObjectId(surveyIdParam);
                    doc = await surveysCollection.findOne({ _id: oid });
                } catch (_) {}
            }
            if (doc) surveyDoc = doc;
        }
        if (!surveyDoc) return res.status(404).send('Survey not found');
    
    // Extract questions from survey JSON for mapping
        const questions = extractQuestions(surveyDoc.json);
    const questionMap = new Map();
        questions.forEach(q => questionMap.set(q.name, q));

        // Load responses from Mongo
        let dbResponses = [];
        if (responsesCollection) {
            const cursor = responsesCollection.find({ surveyId: String(surveyDoc._id || surveyDoc.id) }).sort({ submittedAt: -1 });
            dbResponses = await cursor.toArray();
        }

        const surveyResponses = dbResponses.map(r => {
            const data = r.data || {};
            const formattedData = {};
            const formattedAnswers = [];
            Object.keys(data).forEach(fieldName => {
                const question = questionMap.get(fieldName);
                const questionTitle = question ? question.title : fieldName;
                let answerValue = data[fieldName];
                if (question && question.choices && Array.isArray(question.choices)) {
                    const choice = question.choices.find(c => {
                        if (typeof c === 'string') return c === answerValue;
                        if (c && typeof c === 'object' && c.value !== undefined) return c.value === answerValue || c.value === String(answerValue);
                            return false;
                    });
                    if (choice) answerValue = typeof choice === 'string' ? choice : (choice.text || choice.value || answerValue);
                } else if (Array.isArray(answerValue)) {
                    if (question && question.choices) {
                        answerValue = answerValue.map(val => {
                            const choice = question.choices.find(c => {
                                if (typeof c === 'string') return c === val;
                                if (c && typeof c === 'object' && c.value !== undefined) return c.value === val || c.value === String(val);
                                return false;
                            });
                            return choice ? (typeof choice === 'string' ? choice : (choice.text || choice.value)) : val;
                        }).join(', ');
                    } else {
                        answerValue = answerValue.join(', ');
                    }
                }
                formattedData[questionTitle] = answerValue;
                formattedAnswers.push({ question: questionTitle, answer: answerValue !== null && answerValue !== undefined ? String(answerValue) : '(No answer)', fieldName });
            });
            return { id: r.id, dataJSON: JSON.stringify(data, null, 2), formattedData, formattedAnswers, submittedAt: r.submittedAt };
        });

        res.render('responses', { title: `Responses: ${surveyDoc.title || 'Survey'}`, survey: { id: String(surveyDoc._id || surveyDoc.id), title: surveyDoc.title }, responses: surveyResponses });
    } catch (e) {
        console.error('❌ Error loading responses:', e);
        res.status(500).send('Error loading responses');
    }
});

// Delete survey
app.delete('/api/survey/:id', async (req, res) => {
    const surveyId = req.params.id;
    let found = false;
    if (surveys.has(surveyId)) {
        found = true;
        surveys.delete(surveyId);
    }
    // Delete associated in-memory responses
    Array.from(responses.entries()).forEach(([rid, response]) => {
            if (response.surveyId === surveyId) {
            responses.delete(rid);
        }
    });
    // Delete from Mongo if available
    try {
        if (surveysCollection) {
            // Try delete by custom id
            const r1 = await surveysCollection.deleteOne({ id: surveyId });
            // If not found, try by _id
            if (r1.deletedCount === 0) {
                try {
                    const oid = new (require('mongodb').ObjectId)(surveyId);
                    const r2 = await surveysCollection.deleteOne({ _id: oid });
                    if (r2.deletedCount > 0) found = true;
                } catch (_) {}
            } else {
                found = true;
            }
        }
        if (responsesCollection) {
            await responsesCollection.deleteMany({ surveyId });
        }
        if (draftsCollection) {
            await draftsCollection.deleteMany({ surveyId });
        }
    } catch (e) {
        console.warn('Mongo deletion warning:', e.message);
    }
    if (!found) {
        return res.status(404).json({ success: false, error: 'Survey not found' });
    }
    res.json({ success: true, message: 'Survey deleted' });
});

// Serve the dynamic form demo page
app.get('/dynamic-form', requireUser, (req, res) => {
    const username = (req.session && req.session.user && req.session.user.username) || '';
    res.render('dynamic-form', { username });
});

// User Dashboard - shows assigned forms and shared forms
app.get('/user/dashboard', requireUser, async (req, res) => {
    try {
        res.render('user-dashboard', { 
            title: 'User Dashboard', 
            user: req.session.user 
        });
    } catch (e) {
        res.status(500).render('user-dashboard', { 
            title: 'User Dashboard', 
            user: req.session.user,
            error: 'Failed to load dashboard' 
        });
    }
});

// API: Get assigned forms for a user (forms where userId in URL matches this user)
// Since we use URL-based assignment, show all surveys but only if user has access
app.get('/api/user/assigned-forms', requireUser, async (req, res) => {
    const userId = req.session.user.id;
    const baseUrl = req.protocol + '://' + req.get('host');
    
    try {
        // Get all surveys
        let surveysList = [];
        if (surveysCollection) {
            const cursor = surveysCollection.find({}, { 
                projection: { _id: 1, id: 1, title: 1, createdAt: 1 } 
            });
            surveysList = await cursor.toArray();
        }
        
        // Get list of shared survey IDs to exclude from assigned list
        let sharedSurveyIds = new Set();
        if (sharingCollection) {
            const shares = await sharingCollection.find({ sharedWithUserId: userId }).toArray();
            shares.forEach(share => sharedSurveyIds.add(share.surveyId));
        }
        
        // Generate public URLs for each survey with this user's ID
        // Only include surveys that are not shared (shared ones go to shared list)
        const assignedForms = surveysList
            .filter(s => {
                const surveyId = String(s._id || s.id);
                return !sharedSurveyIds.has(surveyId);
            })
            .map(s => ({
                surveyId: String(s._id || s.id),
                title: s.title || 'Untitled Survey',
                createdAt: s.createdAt,
                publicUrl: `${baseUrl}/f/${encodeURIComponent(String(s._id || s.id))}/${encodeURIComponent(userId)}`,
                isAssigned: true
            }));
        
        res.json({ success: true, forms: assignedForms });
    } catch (e) {
        console.error('❌ Error fetching assigned forms:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch assigned forms' });
    }
});

// API: Get shared forms for a user
app.get('/api/user/shared-forms', requireUser, async (req, res) => {
    const userId = req.session.user.id;
    const baseUrl = req.protocol + '://' + req.get('host');
    
    try {
        if (!sharingCollection || !surveysCollection) {
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        }
        
        // Find all surveys shared with this user
        const shares = await sharingCollection.find({ sharedWithUserId: userId }).toArray();
        
        // Get survey details for shared surveys
        const sharedForms = [];
        for (const share of shares) {
            try {
                let survey = await surveysCollection.findOne({ id: share.surveyId });
                if (!survey) {
                    try {
                        const oid = new ObjectId(share.surveyId);
                        survey = await surveysCollection.findOne({ _id: oid });
                    } catch (_) {}
                }
                
                if (survey) {
                    sharedForms.push({
                        surveyId: String(survey._id || survey.id),
                        title: survey.title || 'Untitled Survey',
                        createdAt: survey.createdAt,
                        sharedAt: share.createdAt || share.sharedAt,
                        ownerId: share.ownerId,
                        publicUrl: `${baseUrl}/f/${encodeURIComponent(String(survey._id || survey.id))}/${encodeURIComponent(share.ownerId)}`,
                        isShared: true
                    });
                }
            } catch (e) {
                console.warn('Error fetching shared survey:', e);
            }
        }
        
        res.json({ success: true, forms: sharedForms });
    } catch (e) {
        console.error('❌ Error fetching shared forms:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch shared forms' });
    }
});

// Shared surveys page
app.get('/shared-surveys', requireUser, (req, res) => {
    res.render('shared-surveys', { title: 'Shared Surveys', user: req.session.user });
});

// Serve public, stateless form links: /f/:surveyId/:userId (requires auth + authorization)
app.get('/f/:surveyId/:userId', async (req, res) => {
    const expectedUserId = req.params.userId;
    const surveyId = req.params.surveyId;
    
    // Require authentication
    if (!req.session || !req.session.user) {
        const redirectUrl = encodeURIComponent(req.originalUrl);
        return res.redirect(`/user/login?redirect=${redirectUrl}`);
    }
    
    const loggedInUserId = req.session.user.id;
    
    // Use the same access check function used for drafts
    const accessCheck = await checkSurveyAccess(surveyId, loggedInUserId, expectedUserId);
    
    if (!accessCheck.hasAccess) {
        return res.status(403).send(`
            <html>
                <head>
                    <title>Access Denied</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-gray-100 min-h-screen flex items-center justify-center p-6">
                    <div class="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
                        <h1 class="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
                        <p class="text-gray-700 mb-6">You don't have permission to access this survey form.</p>
                        <p class="text-sm text-gray-500 mb-4">This form is assigned to a different user or has not been shared with you.</p>
                        <a href="/user/logout" class="inline-block bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded">Logout</a>
                    </div>
                </body>
            </html>
        `);
    }
    
    // User is authenticated and authorized (owner or shared)
    // Use expectedUserId from URL (the assigned owner), not loggedInUserId
    // This ensures each assigned user gets their own draft
    const isOwner = accessCheck.isOwner;
    const userIdForDraft = expectedUserId; // Use the userId from URL (assigned owner)
    res.render('dynamic-form', { userId: userIdForDraft, surveyId, isPublic: true, isOwner });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SurveyJS Form Builder running on http://localhost:${PORT}`);
    console.log(`📝 Build beautiful surveys and forms with ease`);
    console.log(`✅ API Routes registered:`);
    console.log(`   - GET /api/surveys/list`);
    console.log(`   - GET /api/survey/:id/export`);
    console.log(`   - POST /api/survey/save`);
    console.log(`   - POST /api/draft/save`);
    console.log(`   - GET /api/draft/:surveyId/:userId`);
    console.log(`   - Admin/User auth routes enabled`);
});

