// File: netlify/functions/import-contacts.js
const { google } = require('googleapis');
const axios = require('axios');

/**
 * Helper function to map spreadsheet row data to GHL contact fields.
 * It converts header names like "First Name" into camelCase keys like "firstName".
 * @param {string[]} row - An array of cell values for a single contact.
 * @param {string[]} headers - The header row from the spreadsheet.
 * @returns {object} A contact object ready for the GHL API.
 */
function mapRowToContact(row, headers) {
    const contact = {};
    headers.forEach((header, index) => {
        // This regex converts "First Name" to "firstName", "email" to "email", etc.
        const key = header.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(?:^\w|[A-Z]|\b\w)/g, (word, idx) => idx === 0 ? word.toLowerCase() : word.toUpperCase()).replace(/\s+/g, '');
        if (row[index]) {
            contact[key] = row[index];
        }
    });
    return contact;
}


/**
 * The main Netlify Function handler.
 * This function is triggered by a POST request from Pabbly.
 */
exports.handler = async function (event, context) {
    // Safety check: Only allow POST requests.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Safety check: Ensure the request body is not empty.
    if (!event.body) {
        console.error("Function was called with an empty body.");
        return { statusCode: 400, body: JSON.stringify({ message: "Request body is missing." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { locationId, sheetName } = body;

        // --- 1. VALIDATION ---
        if (!locationId || !sheetName) {
            console.error("Missing locationId or sheetName in parsed body. Body received was:", body);
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing locationId or sheetName in request body. Make sure the labels in Pabbly are correct.' }) };
        }
        
        const ghlApiKey = process.env.GHL_AGENCY_API_KEY;
        const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
        const googlePrivateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY;

        if (!ghlApiKey || !googleClientEmail || !googlePrivateKeyBase64) {
            console.error("Server configuration error: A required environment variable is missing in Netlify.");
            return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error.' }) };
        }

        // Decode the Base64 private key.
        const googlePrivateKey = Buffer.from(googlePrivateKeyBase64, 'base64').toString('utf8');
        
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
        const spreadsheetId = '1z-4C9DRTui1yeunkyCjxgiKIapoSt37aOkvWu53a2yc'; // <-- IMPORTANT: Make sure this is still correct!
        
        console.log(`Attempting to read sheet "${sheetName}" from spreadsheet ID "${spreadsheetId}"`);

        const getRowsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:Z`, // Reads all columns from row 1 to the end of the sheet.
        });

        const rows = getRowsResponse.data.values;
        if (!rows || rows.length < 2) {
            console.log(`Sheet "${sheetName}" is empty or has only a header row. No data to import.`);
            return { statusCode: 200, body: JSON.stringify({ message: 'No data to import from sheet.' }) };
        }

        // --- 4. PROCESS AND IMPORT TO GHL ---
        const headers = rows.shift(); // First row is the headers.
        console.log(`Found ${rows.length} contacts to import with headers:`, headers);

        let successCount = 0;
        let failureCount = 0;

        for (const row of rows) {
            const contactData = mapRowToContact(row, headers);
            
            // Skip rows that don't have an email or phone number.
            if (!contactData.email && !contactData.phone) {
                console.log('Skipping row, no email or phone:', row);
                continue;
            }

            contactData.locationId = locationId; // Add the locationId for the new sub-account.
            contactData.source = `Google Sheet Import: ${sheetName}`;
            
            try {
                await axios.post('https://services.leadconnectorhq.com/contacts/upsert', contactData, {
                    headers: {
                        'Authorization': `Bearer ${ghlApiKey}`,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28',
                    }
                });
                successCount++;
            } catch (err) {
                failureCount++;
                console.error("Error importing a single contact to GHL:", err.response?.data || err.message);
            }
        }

        const summaryMessage = `Import process finished. Successfully imported: ${successCount}. Failed: ${failureCount}.`;
        console.log(summaryMessage);
        
        return {
            statusCode: 200,
            body: JSON.stringify({ message: summaryMessage })
        };

    } catch (error) {
        // This will catch errors like "Sheet not found" or other Google API issues.
        console.error('A critical error occurred in the function:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An error occurred during import.', error: error.message })
        };
    }
};
