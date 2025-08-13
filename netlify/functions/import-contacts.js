// File: netlify/functions/import-contacts.js
const { google } = require('googleapis');
const axios = require('axios');

// Helper function to map sheet columns to GHL fields
function mapRowToContact(row, headers) {
    // ... (rest of this function is unchanged) ...
}

exports.handler = async function (event, context) {
    // --- START DEBUGGING ---
    console.log("Type of GOOGLE_PRIVATE_KEY:", typeof process.env.GOOGLE_PRIVATE_KEY);
    console.log("Length of GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY?.length);
    console.log("Start of GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY?.substring(0, 40));
    // --- END DEBUGGING ---

    // Netlify functions only accept POST requests for this setup
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // ... (the rest of your code is unchanged) ...
    } catch (error) {
        // ... (the rest of your code is unchanged) ...
    }
};
