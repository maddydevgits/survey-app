const express = require('express');
const nunjucks = require('nunjucks');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const session = require('express-session');

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
        // Ensure index for upsert lookups
        await draftsCollection.createIndex({ surveyId: 1, userId: 1 }, { unique: true });
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await surveysCollection.createIndex({ id: 1 }, { unique: true });
        await responsesCollection.createIndex({ surveyId: 1 });
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
                req.session.user = { id: user._id, username: user.username, role: 'admin' };
                return res.redirect('/');
            }
        } else if (username === 'admin' && password === 'admin123') {
            req.session.user = { username: 'admin', role: 'admin' };
            return res.redirect('/');
        }
    } catch (e) {}
    res.status(401).render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
});
app.post('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});

// Admin dashboard
app.get('/admin', requireAdmin, (req, res) => {
    res.render('admin', { title: 'Admin Dashboard', user: req.session.user });
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
        req.session.user = { id: user._id, username: user.username, role: user.role };
        return res.redirect(redirect || '/dynamic-form');
    } catch (e) {
        res.status(401).render('user-login', { title: 'User Login', error: 'Invalid credentials', redirect });
    }
});
app.post('/user/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/user/login'));
});

// Current user info (for client-side usage)
app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        const { username, role } = req.session.user;
        return res.json({ loggedIn: true, user: { username, role } });
    }
    return res.status(401).json({ loggedIn: false });
});
// Routes - API routes first to avoid conflicts
// Get all surveys (for export selection) - MUST come before /survey/:id
app.get('/api/surveys/list', (req, res) => {
    console.log('📋 /api/surveys/list endpoint called - Route registered!');
    try {
        const surveysList = Array.from(surveys.values()).map(s => ({
            id: s.id,
            title: s.title || 'Untitled Survey',
            createdAt: s.createdAt
        }));
        const sorted = surveysList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        console.log(`✅ Returning ${sorted.length} surveys`);
        res.json({
            success: true,
            surveys: sorted
        });
    } catch (error) {
        console.error('❌ Error in /api/surveys/list:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch surveys',
            message: error.message
        });
    }
});

// Get a specific survey by ID (for export)
app.get('/api/survey/:id/export', (req, res) => {
    const survey = surveys.get(req.params.id);
    if (!survey) {
        return res.status(404).json({ error: 'Survey not found' });
    }
    res.json({
        success: true,
        survey: {
            id: survey.id,
            title: survey.title || 'Untitled Survey',
            json: survey.json,
            createdAt: survey.createdAt
        }
    });
});

// Draft APIs (Mongo-backed)
app.post('/api/draft/save', async (req, res) => {
    if (!draftsCollection) {
        return res.status(503).json({ success: false, error: 'Draft storage unavailable (no DB connection)' });
    }
    const { surveyId, userId, data } = req.body || {};
    if (!surveyId || !userId || typeof data !== 'object') {
        return res.status(400).json({ success: false, error: 'surveyId, userId and data are required' });
    }
    const now = new Date().toISOString();
    try {
        const result = await draftsCollection.updateOne(
            { surveyId, userId },
            { $set: { surveyId, userId, data, updatedAt: now } },
            { upsert: true }
        );
        res.json({ success: true, upserted: !!result.upsertedId, matchedCount: result.matchedCount });
    } catch (err) {
        console.error('❌ Error saving draft:', err);
        res.status(500).json({ success: false, error: 'Failed to save draft' });
    }
});

app.get('/api/draft/:surveyId/:userId', async (req, res) => {
    if (!draftsCollection) {
        return res.status(503).json({ success: false, error: 'Draft storage unavailable (no DB connection)' });
    }
    const { surveyId, userId } = req.params;
    try {
        const draft = await draftsCollection.findOne({ surveyId, userId });
        if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });
        res.json({ success: true, data: draft.data, updatedAt: draft.updatedAt });
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

// List all surveys
app.get('/surveys', requireAdmin, (req, res) => {
    const surveyList = Array.from(surveys.values()).map(s => ({
        id: s.id,
        title: s.title || 'Untitled Survey',
        createdAt: s.createdAt,
        responseCount: Array.from(responses.values()).filter(r => r.surveyId === s.id).length
    }));
    res.render('surveys', {
        title: 'My Surveys',
        surveys: surveyList
    });
});

// View/run a survey (for users to fill out)
app.get('/survey/:id', (req, res) => {
    const survey = surveys.get(req.params.id);
    if (!survey) {
        return res.status(404).send('Survey not found');
    }
    res.render('survey-runner', {
        title: survey.title || 'Survey',
        surveyJSON: JSON.stringify(survey.json),
        surveyId: survey.id
    });
});

// Save survey definition
app.post('/api/survey/save', requireAdmin, async (req, res) => {
    const { json, title } = req.body;
    if (!json) {
        return res.status(400).json({ error: 'Survey JSON is required' });
    }
    
    const surveyId = req.body.id || uuidv4();
    surveys.set(surveyId, {
        id: surveyId,
        title: title || 'Untitled Survey',
        json: json,
        createdAt: new Date().toISOString()
    });
    try {
        if (surveysCollection) {
            await surveysCollection.updateOne(
                { id: surveyId },
                { $set: { id: surveyId, title: title || 'Untitled Survey', json, createdAt: new Date().toISOString() } },
                { upsert: true }
            );
        }
    } catch (e) {
        console.warn('Mongo save survey failed:', e.message);
    }
    
    res.json({
        success: true,
        surveyId: surveyId,
        message: 'Survey saved successfully'
    });
});

// Submit survey response
app.post('/api/survey/:id/respond', async (req, res) => {
    const surveyId = req.params.id;
    const survey = surveys.get(surveyId);
    
    if (!survey) {
        return res.status(404).json({ error: 'Survey not found' });
    }
    
    const responseId = uuidv4();
    responses.set(responseId, {
        id: responseId,
        surveyId: surveyId,
        data: req.body,
        submittedAt: new Date().toISOString()
    });
    try {
        if (responsesCollection) {
            await responsesCollection.insertOne({ id: responseId, surveyId, data: req.body, submittedAt: new Date().toISOString() });
        }
    } catch (e) {
        console.warn('Mongo save response failed:', e.message);
    }
    
    res.json({
        success: true,
        message: 'Response submitted successfully',
        responseId: responseId
    });
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
app.get('/survey/:id/responses', (req, res) => {
    const surveyId = req.params.id;
    const survey = surveys.get(surveyId);
    
    if (!survey) {
        return res.status(404).send('Survey not found');
    }
    
    // Extract questions from survey JSON for mapping
    const questions = extractQuestions(survey.json);
    const questionMap = new Map();
    questions.forEach(q => {
        questionMap.set(q.name, q);
    });
    
    // Debug: Log extracted questions
    console.log('\n=== RESPONSE PAGE DEBUG ===');
    console.log('Survey ID:', surveyId);
    console.log('Survey title:', survey.title);
    console.log('Extracted questions count:', questions.length);
    console.log('Extracted questions:', JSON.stringify(questions, null, 2));
    console.log('Question map keys:', Array.from(questionMap.keys()));
    console.log('First 1000 chars of survey JSON:', JSON.stringify(survey.json, null, 2).substring(0, 1000));
    console.log('===========================\n');
    
    const surveyResponses = Array.from(responses.values())
        .filter(r => r.surveyId === surveyId)
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
        .map(r => {
            // Debug: Log response data
            console.log('Response data keys:', Object.keys(r.data));
            console.log('Response data:', r.data);
            
            // Map response data to readable format
            const formattedData = {};
            const formattedAnswers = [];
            
            Object.keys(r.data).forEach(fieldName => {
                const question = questionMap.get(fieldName);
                console.log(`Mapping field "${fieldName}":`, {
                    foundQuestion: !!question,
                    questionName: question ? question.name : 'N/A',
                    questionTitle: question ? question.title : 'N/A'
                });
                
                const questionTitle = question ? question.title : fieldName;
                let answerValue = r.data[fieldName];
                
                // Format answer based on question type
                if (question && question.choices && Array.isArray(question.choices)) {
                    // For choice-based questions, show the choice text
                    const choice = question.choices.find(c => {
                        if (typeof c === 'string') {
                            return c === answerValue;
                        } else if (c.value !== undefined) {
                            return c.value === answerValue || c.value === String(answerValue);
                        } else {
                            return false;
                        }
                    });
                    
                    if (choice) {
                        if (typeof choice === 'string') {
                            answerValue = choice;
                        } else {
                            answerValue = choice.text || choice.value || answerValue;
                        }
                    }
                } else if (Array.isArray(answerValue)) {
                    // Handle multiple choice answers
                    if (question && question.choices) {
                        answerValue = answerValue.map(val => {
                            const choice = question.choices.find(c => {
                                if (typeof c === 'string') {
                                    return c === val;
                                } else if (c.value !== undefined) {
                                    return c.value === val || c.value === String(val);
                                }
                                return false;
                            });
                            return choice ? (typeof choice === 'string' ? choice : (choice.text || choice.value)) : val;
                        }).join(', ');
                    } else {
                        answerValue = answerValue.join(', ');
                    }
                }
                
                formattedData[questionTitle] = answerValue;
                formattedAnswers.push({
                    question: questionTitle,
                    answer: answerValue !== null && answerValue !== undefined ? String(answerValue) : '(No answer)',
                    fieldName: fieldName
                });
            });
            
            return {
                ...r,
                dataJSON: JSON.stringify(r.data, null, 2),
                formattedData: formattedData,
                formattedAnswers: formattedAnswers
            };
        });
    
    res.render('responses', {
        title: `Responses: ${survey.title || 'Survey'}`,
        survey: survey,
        responses: surveyResponses
    });
});

// Delete survey
app.delete('/api/survey/:id', (req, res) => {
    const surveyId = req.params.id;
    if (surveys.delete(surveyId)) {
        // Also delete associated responses
        Array.from(responses.entries()).forEach(([id, response]) => {
            if (response.surveyId === surveyId) {
                responses.delete(id);
            }
        });
        res.json({ success: true, message: 'Survey deleted' });
    } else {
        res.status(404).json({ error: 'Survey not found' });
    }
});

// Serve the dynamic form demo page
app.get('/dynamic-form', requireUser, (req, res) => {
    const username = (req.session && req.session.user && req.session.user.username) || '';
    res.render('dynamic-form', { username });
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

