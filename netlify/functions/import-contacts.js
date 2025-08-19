// File: netlify/functions/import-contacts.js
const { google } = require('googleapis');
const axios = require('axios');

/**
 * ✅ Define your custom mapping here
 * Key = Google Sheet column header
 * Value = GHL API field name
 */
const CUSTOM_FIELD_MAPPING = {
    "First Name": "firstName",
    "Last Name": "lastName",
    "Email": "email",
    "Phone": "phone",
    "Company": "companyName",
    "Notes": "notes"
};

/**
 * ✅ Maps Google Sheet row data using custom mapping
 */
function mapRowToContact(row, headers) {
    const contact = {};

    headers.forEach((header, index) => {
        const ghlField = CUSTOM_FIELD_MAPPING[header];
        if (ghlField && row[index]) {
            contact[ghlField] = row[index];
        }
    });

    return contact;
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!event.body) {
        console.error("Function was called with an empty body.");
        return { statusCode: 400, body: JSON.stringify({ message: "Request body is missing." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { locationId, sheetName } = body;

        if (!locationId || !sheetName) {
            console.error("Missing locationId or sheetName:", body);
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing locationId or sheetName in request body.' }) };
        }

        const ghlApiKey = process.env.GHL_API_KEY;
        const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
        const googlePrivateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY;

        if (!ghlApiKey || !googleClientEmail || !googlePrivateKeyBase64) {
            console.error("Missing environment variables.");
            return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error.' }) };
        }

        const googlePrivateKey = Buffer.from(googlePrivateKeyBase64, 'base64').toString('utf8');

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: googleClientEmail,
                private_key: googlePrivateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const spreadsheetId = '1z-4C9DRTui1yeunkyCjxgiKIapoSt37aOkvWu53a2yc'; // 👈 Replace with your Sheet ID
        console.log(`Reading sheet "${sheetName}" from spreadsheet ID "${spreadsheetId}"`);

        const getRowsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:Z`,
        });

        const rows = getRowsResponse.data.values;
        if (!rows || rows.length < 2) {
            console.log(`Sheet "${sheetName}" has no data.`);
            return { statusCode: 200, body: JSON.stringify({ message: 'No data to import.' }) };
        }

        const headers = rows.shift();
        console.log(`Found ${rows.length} contacts. Headers:`, headers);

        let successCount = 0;
        let failureCount = 0;

        for (const row of rows) {
            const contactData = mapRowToContact(row, headers);

            if (!contactData.email && !contactData.phone) {
                console.log('Skipping row (no email/phone):', row);
                continue;
            }

            // ✅ Final payload for GHL API
            const payload = {
                locationId,
                ...contactData,
                source: `Google Sheet Import: ${sheetName}`
            };

            console.log("📤 Sending contact payload:", JSON.stringify(payload, null, 2));

            try {
                const response = await axios.post(
                    'https://rest.gohighlevel.com/v2/contacts',
                    payload,
                    {
                        headers: {
                            'Authorization': `Api-Key ${ghlApiKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                console.log("✅ GHL API response:", response.data);
                successCount++;
            } catch (err) {
                failureCount++;
                console.error("❌ Error importing contact:", err.response?.data || err.message);
            }
        }

        const summary = `Finished import. Success: ${successCount}, Failed: ${failureCount}`;
        console.log(summary);

        return { statusCode: 200, body: JSON.stringify({ message: summary }) };

    } catch (error) {
        console.error('Critical error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ message: 'Error during import.', error: error.message }) };
    }
};
