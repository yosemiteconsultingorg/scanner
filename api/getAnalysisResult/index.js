//Test updating the code deployed to Azure Function App (no code change, just adding this comment) : by Mohamed

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, AzureNamedKeyCredential, RestError } from "@azure/data-tables"; // Removed TableEntity

// --- Interfaces ---
// Structure expected by the frontend
interface ValidationCheck {
    checkName: string;
    status: 'Pass' | 'Fail' | 'Warn' | 'NotApplicable';
    message: string;
    value?: string | number;
    limit?: string | number;
}

interface AnalysisResult {
    blobName: string;
    originalFileName?: string;
    blobSize: number;
    isCtv: boolean;
    mimeType?: string;
    extension?: string;
    dimensions?: { width?: number; height?: number };
    validationChecks: ValidationCheck[];
    status: 'Processing' | 'Completed' | 'Error';
}

// Structure of the entity stored in the table
interface ResultTableEntity {
    partitionKey: string;
    rowKey: string;
    status: AnalysisResult['status'];
    validationChecksData: string; // JSON string of ValidationCheck[]
    originalFileName?: string;
    blobSize: number;
    mimeType?: string;
    extension?: string;
    isCtv: boolean;
    dimensionsData?: string; // JSON string of dimensions object
}


// Helper function to parse connection string
function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

const resultsTableName = "AnalysisResults";
const partitionKey = "Creative";

export async function getAnalysisResult(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    const encodedBlobNameFromQuery = request.query.get('blobName');
    if (!encodedBlobNameFromQuery) {
        return { status: 400, body: "Please pass a blobName on the query string" };
    }

    // URL-decode the blobName from the query string
    const decodedBlobName = decodeURIComponent(encodedBlobNameFromQuery);
    context.log(`Decoded blobName from query: ${decodedBlobName}`);

    // Extract the UUID part. Assumes UUID is before the first '-' if a hyphenated suffix exists,
    // or the whole name if no hyphenated suffix (like simple UUID.ext from original design).
    // This needs to be robust to handle both "UUID.ext" and "UUID-OriginalFilename.ext"
    let uuidPart = decodedBlobName;
    if (decodedBlobName.includes('-')) { // Indicates complex name like UUID-OriginalFilename.ext
        uuidPart = decodedBlobName.split('-')[0];
    } else if (decodedBlobName.includes('.')) { // Indicates simple name like UUID.ext
        uuidPart = decodedBlobName.substring(0, decodedBlobName.lastIndexOf('.'));
    } 
    // If neither, it might be just a UUID, or an unexpected format.
    // For robustness, add a check if uuidPart is a valid UUID, but for now, proceed.
    
    if (!uuidPart) {
        context.error(`Could not extract UUID part from decodedBlobName: ${decodedBlobName}`);
        return { status: 400, body: "Invalid blobName format in query." };
    }
    context.log(`Using UUID part as RowKey for query: ${uuidPart}`);


    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
    if (!connectionString) {
        context.log("ERROR: Azure Storage Connection String not found in environment variables.");
        return { status: 500, body: "Server configuration error: Storage connection string missing." };
    }

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        const credential = new AzureNamedKeyCredential(accountName, accountKey);
        const tableClient = new TableClient(`https://${accountName}.table.core.windows.net`, resultsTableName, credential);

        context.log(`Attempting to retrieve analysis result entity for RowKey (UUID): ${uuidPart}`);

        // Retrieve the entity using the specific interface for table structure, with uuidPart as RowKey
        const entity = await tableClient.getEntity<ResultTableEntity & { fullBlobName?: string }>(partitionKey, uuidPart);

        context.log(`Found entity for RowKey (UUID) ${uuidPart}. Reconstructing result object.`);

        // Reconstruct the AnalysisResult object for the frontend
        let validationChecks: ValidationCheck[] = [];
        try {
            validationChecks = JSON.parse(entity.validationChecksData || '[]'); // Parse checks, default to empty array
        } catch (parseError) {
            context.log(`ERROR parsing validationChecksData for RowKey (UUID) ${uuidPart}:`, parseError);
            validationChecks = [{ checkName: "Result Parsing", status: "Fail", message: "Could not parse validation checks data." }];
        }

        let dimensions: AnalysisResult['dimensions'];
        try {
            if (entity.dimensionsData) {
                dimensions = JSON.parse(entity.dimensionsData);
            }
        } catch (parseError) {
             context.log(`ERROR parsing dimensionsData for RowKey (UUID) ${uuidPart}:`, parseError);
             // Add error to checks?
        }


        const analysisResult: AnalysisResult = {
            blobName: entity.fullBlobName || entity.rowKey, // Prefer fullBlobName if stored, else fallback to RowKey (UUID)
            originalFileName: entity.originalFileName,
            blobSize: entity.blobSize,
            isCtv: entity.isCtv,
            mimeType: entity.mimeType,
            extension: entity.extension,
            dimensions: dimensions,
            validationChecks: validationChecks,
            status: entity.status || 'Error' // Default to Error if status somehow missing
        };

        context.log(`Reconstructed analysisResult object before sending:`, analysisResult); // Log before returning

        return {
            jsonBody: analysisResult // Return the reconstructed object
        };

    } catch (error: unknown) {
        if (error instanceof RestError && error.statusCode === 404) {
            context.warn(`Analysis result entity not found for RowKey (UUID): ${uuidPart}. (Original query blobName: ${encodedBlobNameFromQuery}). It might still be processing.`);
            return { status: 404, body: `Analysis result not found for ${encodedBlobNameFromQuery}.` };
        } else {
            let logMessage = `Error retrieving analysis result for RowKey (UUID) ${uuidPart} (Original query blobName: ${encodedBlobNameFromQuery}): `;
            if (error instanceof Error) { logMessage += error.message; } else { logMessage += String(error); }
            context.log(`ERROR: ${logMessage}`);
            return { status: 500, body: `Server error retrieving result for ${encodedBlobNameFromQuery}: ${logMessage}` };
        }
    }
}

app.http('getAnalysisResult', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: getAnalysisResult
});
