# Qwerty Story Organizer

A beautiful, minimalist story organization tool built with React and Vite.

## Features

- **Multiple Story Management**: Create and organize multiple stories in one workspace
- **Character Tracking**: Detailed character profiles with relationships
- **Relationship Mapping**: Visual relationship tracking between characters
- **Chapter Organization**: Structured chapter management
- **Note Taking**: Flexible note system for world-building
- **Database Integration**: Google Sheets integration for data persistence
- **Responsive Design**: Clean, dark theme interface

## Database Setup (Google Sheets Integration)

To enable data persistence, you need to set up Google Sheets API integration:

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Sheets API for your project

### 2. Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Web application**
4. Set **Authorized JavaScript origins**: `http://localhost:5173` (or your domain)
5. Set **Authorized redirect URIs**: `http://localhost:5173` (or your domain)
6. Note down the **Client ID**

### 3. Create Google Sheet

1. Create a new Google Sheet
2. Note down the **Spreadsheet ID** from the URL: `https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
3. Share the sheet with your Google account (ensure you have edit access)

### 4. Update Configuration

In `src/App.jsx`, update the `DB_CONFIG` object:

```javascript
const DB_CONFIG = {
  spreadsheetId: "YOUR_SPREADSHEET_ID", // Replace with your Google Sheet ID
  apiKey: "YOUR_API_KEY", // Replace with your Google API key
  clientId: "YOUR_CLIENT_ID", // Replace with your OAuth client ID
};
```

### 5. Add Google API Script

Add this script to your `index.html` before the app script:

```html
<script src="https://apis.google.com/js/api.js" async defer></script>
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd story-organizer
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Usage

### Creating Stories
- Click "New Story" to create a new story workspace
- Each story has its own characters, relationships, chapters, and notes

### Managing Characters
- Add characters with names, roles, bios, and colors
- Edit character details by clicking on them
- Delete characters using the delete button in the detail panel

### Tracking Relationships
- Create relationships between characters
- Add detailed descriptions of character interactions
- View relationship networks in the character detail panel

### Organizing Content
- Use Chapters for plot structure
- Use Notes for world-building details
- Switch between sections using the sidebar navigation

### Database Features
- Connect to Google Sheets using the "Connect to Google Sheets" button
- Data auto-saves every 1 second of inactivity
- Manual save/load options available
- Disconnect to work locally without cloud sync

## Project Structure

```
src/
├── App.jsx          # Main application component
├── main.jsx         # Application entry point
└── assets/
    ├── react.svg    # React logo
    └── vite.svg     # Vite logo

public/
└── vite.svg         # Vite favicon
```

## Technologies

- **React** - UI framework
- **Vite** - Build tool and dev server
- **Google Sheets API** - Data persistence
- **CSS-in-JS** - Styling

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues related to Google Sheets integration, ensure:
- Your Google Cloud project has the Sheets API enabled
- Your OAuth credentials are properly configured
- You have edit access to the target Google Sheet
- Your browser allows third-party cookies for Google authentication