//Test updating the code deployed to Azure Function App (no code change, just adding this comment) : by Mohamed

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// Helper function to parse connection string (basic implementation) - Reuse or move to shared location later
function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

const tableName = "CreativeMetadata";
const partitionKey = "Creative"; // Use a fixed partition key for this simple scenario

// Define expected request body structure
interface SetMetadataRequestBody {
    blobName: string;
    isCtv: boolean;
}

export async function setCreativeMetadata(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    let body: SetMetadataRequestBody;
    try {
        // Explicitly type the parsed JSON body
        body = await request.json() as SetMetadataRequestBody;
    } catch (e) {
        context.error("Could not parse request body as JSON:", e);
        return { status: 400, body: "Invalid request body: Expected JSON." };
    }

    // Validate the structure and types of the parsed body
    if (!body || typeof body.blobName !== 'string' || typeof body.isCtv !== 'boolean') {
        return { status: 400, body: "Please pass blobName (string) and isCtv (boolean) in the request body" };
    }

    const { blobName, isCtv } = body; // blobName here is in format [UUID]-[OriginalFileName].ext

    // Correctly extract the UUID part (the part before the first hyphen)
    const uuidPart = blobName.split('-')[0];
    
    if (!uuidPart || uuidPart.length !== 36) { // Basic check for UUID format (36 chars)
        context.error(`Could not extract valid UUID from blobName: ${blobName}. Extracted: '${uuidPart}'`);
        return { status: 400, body: "Invalid blobName format - cannot determine UUID." };
    }
    context.log(`Using UUID part as RowKey: ${uuidPart} (from original full blobName: ${blobName})`);

    const connectionString = process.env.AzureWebJobsStorage_ConnectionString; // Using the same storage account for tables
    if (!connectionString) {
        context.error("Azure Storage Connection String not found in environment variables.");
        return { status: 500, body: "Server configuration error: Storage connection string missing." };
    }

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        const credential = new AzureNamedKeyCredential(accountName, accountKey);
        // Note: For Tables, the endpoint is different from Blobs
        const tableClient = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, credential);

        // Ensure table exists (creates if not)
        await tableClient.createTable();

        const entity = {
            partitionKey: partitionKey,
            rowKey: uuidPart, // Use extracted UUID part as the RowKey
            isCtv: isCtv,
            originalFullBlobName: blobName // Store the original full blobName for reference if needed
        };

        // Upsert the entity (creates or updates if exists)
        await tableClient.upsertEntity(entity, "Merge"); // Merge strategy updates existing entity

        context.log(`Successfully stored metadata for RowKey (UUID): ${uuidPart}, isCtv: ${isCtv}, originalBlobName: ${blobName}`);
        return { status: 200, body: `Metadata stored for ${uuidPart}` };

    } catch (error) {
        context.error(`Error storing metadata for RowKey (UUID) ${uuidPart} (original blobName ${blobName}):`, error);
        return { status: 500, body: `Server error: ${error.message}` };
    }
}

app.http('setCreativeMetadata', {
    methods: ['POST'], // Use POST for sending data in the body
    authLevel: 'anonymous',
    handler: setCreativeMetadata
});
