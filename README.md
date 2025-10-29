# SurveyJS Form Builder

A form builder application using SurveyJS with Node.js, Express, and Nunjucks templating.

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```
   
   This will start a Node.js server at `http://localhost:8090`

3. **Open in Browser**
   - Open `http://localhost:8090` in your browser
   - The form builder will load with all dependencies

## Features

- 📝 **Form Builder** - Drag and drop interface to create surveys and forms
- 📱 **Live Preview** - See your form as you build it in real-time
- 📥 **JSON Export** - Export your form configuration as JSON (copy or download)
- 📤 **JSON Import** - Import previously exported JSON files to edit
- 💾 **Save Surveys** - Save surveys to the server for later use
- 📋 **Survey Management** - View and manage all your saved surveys
- 🎨 **Modern UI** - Built with Tailwind CSS
- 🚀 **Node.js Backend** - Express server with Nunjucks templating

## Project Structure

```
survey-app/
├── server.js           # Express server with Nunjucks
├── package.json        # npm dependencies
├── views/
│   └── index.html      # Nunjucks template
├── public/             # Static assets (if needed)
├── node_modules/       # Installed packages
└── README.md          # This file
```

## Technology Stack

- **Node.js** - Server runtime
- **Express** - Web framework
- **Nunjucks** - Templating engine
- **SurveyJS** - Form builder library (loaded via CDN)

## API Endpoints

- `GET /` - Main form builder page
- `POST /api/export` - Export survey JSON (optional, for future use)

## Development

- Templates auto-reload in development (watch mode enabled)
- Server runs on port 8090 (configurable via PORT env variable)

## License

MIT
