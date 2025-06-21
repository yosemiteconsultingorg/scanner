//Test updating the code deployed to Azure Function App (no code change, just adding this comment) : by Mohamed

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol } from "@azure/storage-blob";

// --- Constants & Helpers ---
const containerName = "files-processing"; // Only need the main container now

function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

// Helper to generate SAS URL (remains the same)
function generateSasUrl(
    blobServiceClient: BlobServiceClient,
    containerName: string,
    blobName: string,
    accountKey: string,
    permissions: string = "r", // Default to read
    expiresInMinutes: number = 5 // Short-lived URL
): string {
    const sharedKeyCredential = new StorageSharedKeyCredential(blobServiceClient.accountName, accountKey);
    const sasOptions = {
        containerName,
        blobName,
        startsOn: new Date(),
        expiresOn: new Date(new Date().valueOf() + expiresInMinutes * 60 * 1000),
        permissions: BlobSASPermissions.parse(permissions),
        protocol: SASProtocol.Https // Enforce HTTPS
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    return `${blobServiceClient.url}${containerName}/${blobName}?${sasToken}`;
}

// --- Main Function ---
export async function getPreviewUrl(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    // Get the blob name to generate the URL for (could be original or extracted backup)
    const blobName = request.query.get('blobName');
    if (!blobName) {
        return { status: 400, body: "Please pass a blobName on the query string" };
    }

    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
    if (!connectionString) {
        context.log("ERROR: Azure Storage Connection String not found.");
        return { status: 500, body: "Server configuration error: Storage connection string missing." };
    }

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        const blobServiceUrl = `https://${accountName}.blob.core.windows.net`;
        const blobServiceClient = new BlobServiceClient(blobServiceUrl, new StorageSharedKeyCredential(accountName, accountKey));

        // Directly generate SAS URL for the requested blob in the main container
        const sasUrl = generateSasUrl(blobServiceClient, containerName, blobName, accountKey);
        context.log(`Generated preview SAS URL for ${containerName}/${blobName}`);

        return {
            jsonBody: { previewUrl: sasUrl }
        };

    } catch (error) {
        context.log(`ERROR generating preview URL for ${blobName}: ${error instanceof Error ? error.message : String(error)}`);
        return { status: 500, body: "Server error generating preview URL." };
    }
}

app.http('getPreviewUrl', {
    methods: ['GET'],
    authLevel: 'anonymous', // Or 'function'/'user' if needed
    handler: getPreviewUrl
});
