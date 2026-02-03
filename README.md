# Profile Manager UI

A modern, user-friendly web interface for managing profiles using MongoDB. Built to work alongside the [profile-mcp-server](../profile-mcp-server) for seamless MCP integration.

![Profile Manager Screenshot](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- 🔍 **Real-time Search** - Instantly search profiles by name, email, or role
- ➕ **Create Profiles** - Add new profiles with validation
- ✏️ **Edit Profiles** - Update existing profile information
- 🗑️ **Delete Profiles** - Remove profiles with confirmation
- 🎨 **Modern Dark Theme** - Glassmorphism design with smooth animations
- 📱 **Responsive** - Works on desktop and mobile devices

## Prerequisites

- Node.js 18+
- MongoDB running locally (or set `MONGODB_URI` environment variable)

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profiles` | List all profiles |
| GET | `/api/profiles/search?q=query` | Search profiles |
| POST | `/api/profiles` | Create a new profile |
| PUT | `/api/profiles/:id` | Update a profile |
| DELETE | `/api/profiles/:id` | Delete a profile |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection string |

## MCP Server Integration

This UI shares the same MongoDB database (`mcp_profiles`) as the profile-mcp-server. Any profiles created via MCP tools will appear in the UI and vice versa.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Design**: Dark theme with glassmorphism effects

## License

MIT
