//Test updating the code deployed to Azure Function App (no code change, just adding this comment) : by Mohamed

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient, StorageSharedKeyCredential, BlobSASPermissions, generateBlobSASQueryParameters } from "@azure/storage-blob";
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

// Helper function to parse connection string (basic implementation)
function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

export async function generateUploadUrl(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    const fileName = request.query.get('fileName');
    if (!fileName) {
        return { status: 400, body: "Please pass a fileName on the query string" };
    }

    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
    if (!connectionString) {
        context.error("Azure Storage Connection String not found in environment variables.");
        return { status: 500, body: "Server configuration error: Storage connection string missing." };
    }

    const containerName = "files-processing"; // As provided by user

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        // Log parsed credentials (mask key partially)
        context.log(`Parsed Account Name: ${accountName}`);
        context.log(`Parsed Account Key (masked): ${accountKey.substring(0, 5)}...${accountKey.substring(accountKey.length - 5)}`);

        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${accountName}.blob.core.windows.net`,
            sharedKeyCredential
        );
        const containerClient = blobServiceClient.getContainerClient(containerName);

        // Generate a unique blob name to prevent overwrites
        const uniqueBlobName = `${uuidv4()}-${fileName}`;
        context.log(`Generated uniqueBlobName: ${uniqueBlobName}`); // Log blob name

        const blobClient = containerClient.getBlobClient(uniqueBlobName);

        // Generate SAS token for write permissions
        const startsOn = new Date();
        startsOn.setMinutes(startsOn.getMinutes() - 5); // 5 minutes in the past
        const expiresOn = new Date(startsOn);
        expiresOn.setHours(expiresOn.getHours() + 1); // 1 hour expiry

        const permissions = BlobSASPermissions.parse("racwd"); // Using broad permissions
        context.log(`Generating SAS with permissions: ${permissions.toString()}`); // Log permissions

        const sasToken = generateBlobSASQueryParameters({
            containerName: containerName,
            blobName: uniqueBlobName,
            permissions: permissions,
            startsOn: startsOn,
            expiresOn: expiresOn,
        }, sharedKeyCredential);

        const sasUrl = `${blobClient.url}?${sasToken}`;

        context.log(`Generated SAS URL (racwd) for ${uniqueBlobName}`);

        // Return the SAS URL and the blob name to the client
        return {
            status: 200, // Explicitly set status
            jsonBody: {
                uploadUrl: sasUrl,
                blobName: uniqueBlobName
            }
        };

    } catch (error) {
        context.error("Error generating SAS URL:", error);
        return { status: 500, body: `Server error: ${error.message}` };
    }
}

// Register the function with Azure Functions runtime
app.http('generateUploadUrl', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: generateUploadUrl
});
