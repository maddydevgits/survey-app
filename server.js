const express = require('express');
const nunjucks = require('nunjucks');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8091;

// In-memory storage (can be replaced with database)
const surveys = new Map(); // Store survey definitions
const responses = new Map(); // Store survey responses

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

// Serve static files (CSS, JS, images, etc.) - after API routes
app.use(express.static('public'));

// Routes - page routes
app.get('/', (req, res) => {
    res.render('index', {
        title: 'SurveyJS Form Builder',
        pageTitle: 'SurveyJS Form Builder'
    });
});

// List all surveys
app.get('/surveys', (req, res) => {
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
app.post('/api/survey/save', (req, res) => {
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
    
    res.json({
        success: true,
        surveyId: surveyId,
        message: 'Survey saved successfully'
    });
});

// Submit survey response
app.post('/api/survey/:id/respond', (req, res) => {
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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SurveyJS Form Builder running on http://localhost:${PORT}`);
    console.log(`📝 Build beautiful surveys and forms with ease`);
    console.log(`✅ API Routes registered:`);
    console.log(`   - GET /api/surveys/list`);
    console.log(`   - GET /api/survey/:id/export`);
    console.log(`   - POST /api/survey/save`);
});

