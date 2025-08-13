// File: netlify/functions/import-contacts.js
const { google } = require('googleapis');
const axios = require('axios');

// Helper function to map sheet columns to GHL fields
function mapRowToContact(row, headers) {
    const contact = {};
    headers.forEach((header, index) => {
        const key = header.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(?:^\w|[A-Z]|\b\w)/g, (word, idx) => idx === 0 ? word.toLowerCase() : word.toUpperCase()).replace(/\s+/g, '');
        if (row[index]) {
            contact[key] = row[index];
        }
    });
    return contact;
}

exports.handler = async function (event, context) {
    // Netlify functions only accept POST requests for this setup
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { locationId, sheetName } = body;

        // --- 1. VALIDATION ---
        if (!locationId || !sheetName) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing locationId or sheetName' }) };
        }
        const ghlApiKey = process.env.GHL_AGENCY_API_KEY;
        const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
        const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY; // Netlify handles newlines automatically

        if (!ghlApiKey || !googleClientEmail || !googlePrivateKey) {
            console.error("Server configuration error: Missing environment variables.");
            return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error.' }) };
        }
        
        // --- 2. AUTHENTICATE WITH GOOGLE SHEETS ---
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: googleClientEmail,
                private_key: googlePrivateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // --- 3. FIND THE SPREADSHEET AND READ DATA ---
        const spreadsheetId = 'YOUR_SPREADSHEET_ID'; // <-- IMPORTANT: REPLACE THIS
        const searchResponse = await sheets.spreadsheets.get({ spreadsheetId });

        const sheet = searchResponse.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet) {
            throw new Error(`Sheet with name "${sheetName}" not found in the spreadsheet.`);
        }

        const getRowsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:Z`,
        });

        const rows = getRowsResponse.data.values;
        if (!rows || rows.length < 2) {
            return { statusCode: 200, body: JSON.stringify({ message: 'No data to import from sheet.' }) };
        }

        // --- 4. PROCESS AND IMPORT TO GHL ---
        const headers = rows.shift();
        for (const row of rows) {
            const contactData = mapRowToContact(row, headers);
            if (!contactData.email && !contactData.phone) continue;

            contactData.locationId = locationId;
            contactData.source = `Google Sheet Import: ${sheetName}`;
            
            await axios.post('https://services.leadconnectorhq.com/contacts/upsert', contactData, {
                headers: {
                    'Authorization': `Bearer ${ghlApiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28',
                }
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Successfully processed ${rows.length} rows.` })
        };

    } catch (error) {
        console.error('Error in Netlify function:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An error occurred during import.', error: error.message })
        };
    }
};
