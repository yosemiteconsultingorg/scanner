//Test updating the code deployed to Azure Function App (no code change, just adding this comment) : by Mohamed

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { OnBehalfOfCredential } from "@azure/identity"; // Import OBO Credential
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import { v4 as uuidv4 } from 'uuid';
import "isomorphic-fetch";
import { Readable } from "stream";

// --- Interfaces ---
interface SharepointFileItem {
    id: string;
    name: string;
    parentReference?: { driveId?: string; };
    '@microsoft.graph.downloadUrl'?: string;
    isCtv?: boolean;
}

interface ProcessSharepointFilesRequestBody {
    files: SharepointFileItem[];
}

// --- Constants & Helpers ---
const metadataTableName = "CreativeMetadata";
const resultsTableName = "AnalysisResults";
const partitionKey = "Creative";
const blobContainerName = "files-processing";

function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

// --- Main Function ---
export async function processSharepointFiles(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    // 1. Extract User Assertion Token from Header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        context.log("ERROR: Missing or invalid Authorization header.");
        return { status: 401, body: "Unauthorized: Missing or invalid Bearer token." };
    }
    const userAssertionToken = authHeader.substring(7); // Remove "Bearer " prefix

    // 2. Get Configuration for OBO Flow
    const tenantId = process.env.AZURE_TENANT_ID || "1dccbf7a-4960-4303-a2ad-89f695c62e97"; // Use hardcoded if not in env
    const clientId = process.env.AZURE_CLIENT_ID || "5e7495d1-4f14-4878-b01a-8da624d99677"; // Use hardcoded if not in env
    const clientSecret = process.env.APP_CLIENT_SECRET;

    if (!clientSecret) {
        context.log("ERROR: APP_CLIENT_SECRET environment variable is not set.");
        return { status: 500, body: "Server configuration error: Missing client secret." };
    }
    if (!tenantId || !clientId) {
         context.log("ERROR: AZURE_TENANT_ID or AZURE_CLIENT_ID missing.");
         return { status: 500, body: "Server configuration error: Missing tenant/client ID." };
    }

    // 3. Parse Request Body
    let body: ProcessSharepointFilesRequestBody;
    try {
        body = await request.json() as ProcessSharepointFilesRequestBody;
    } catch (e) {
        context.log("ERROR: Could not parse request body as JSON:", e);
        return { status: 400, body: "Invalid request body: Expected JSON array of files." };
    }

    if (!body || !Array.isArray(body.files) || body.files.length === 0) {
        return { status: 400, body: "Please pass a non-empty 'files' array in the request body." };
    }

    const receivedFiles = body.files;
    context.log(`Received request to process ${receivedFiles.length} Sharepoint files for user (token received).`);

    // 4. Initialize Clients (Blob, Table, Graph with OBO)
    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
    if (!connectionString) {
        context.log("ERROR: Azure Storage Connection String not found.");
        return { status: 500, body: "Server configuration error: Storage connection string missing." };
    }

    let graphClient: Client;
    let blobServiceClient: BlobServiceClient;
    let metadataTableClient: TableClient;
    let resultsTableClient: TableClient;

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        const blobServiceUrl = `https://${accountName}.blob.core.windows.net`;
        const tableServiceUrl = `https://${accountName}.table.core.windows.net`;
        const tableCredential = new AzureNamedKeyCredential(accountName, accountKey);

        blobServiceClient = new BlobServiceClient(blobServiceUrl, sharedKeyCredential);
        metadataTableClient = new TableClient(tableServiceUrl, metadataTableName, tableCredential);
        resultsTableClient = new TableClient(tableServiceUrl, resultsTableName, tableCredential);
        await Promise.all([
             metadataTableClient.createTable(),
             resultsTableClient.createTable()
        ]);

        // Initialize OBO Credential
        const oboCredential = new OnBehalfOfCredential({
            tenantId: tenantId,
            clientId: clientId,
            clientSecret: clientSecret,
            userAssertionToken: userAssertionToken,
        });

        // Initialize Graph Client with OBO Auth Provider
        const authProvider = new TokenCredentialAuthenticationProvider(oboCredential, {
            scopes: ["https://graph.microsoft.com/.default"], // Use default scopes for Graph
        });
        graphClient = Client.initWithMiddleware({ authProvider });
        context.log("Graph client initialized with On-Behalf-Of credential.");

    } catch (error) {
         context.log(`ERROR initializing clients or OBO credential: ${error instanceof Error ? error.message : String(error)}`);
         // Check for specific OBO errors if needed
         if (error.name === 'AuthenticationRequiredError' || error.message?.includes('AADSTS')) {
             return { status: 401, body: `Authentication error during OBO flow: ${error.message}` };
         }
         return { status: 500, body: "Server error during client/auth initialization." };
    }

    const containerClient = blobServiceClient.getContainerClient(blobContainerName);

    // 5. Process Files
    for (const file of receivedFiles) {
        context.log(`Processing Sharepoint file: ${file.name} (ID: ${file.id})`);
        let uniqueBlobName: string | undefined;

        try {
            // 1. Determine Download Stream (using authenticated graphClient)
            let downloadStream: ReadableStream | null = null;
            if (file['@microsoft.graph.downloadUrl']) {
                // We might still need to fetch this with the OBO token if it's short-lived
                context.log(`Attempting to fetch content using provided download URL for ${file.name}`);
                 try {
                     // Re-fetch using the authenticated client to ensure token validity
                     const driveItem = await graphClient.api(`/drives/${file.parentReference?.driveId}/items/${file.id}`).get();
                     const downloadUrlFromApi = driveItem['@microsoft.graph.downloadUrl'];
                     if (!downloadUrlFromApi) throw new Error('Could not retrieve download URL from Graph API');
                     const response = await graphClient.api(downloadUrlFromApi).getStream(); // Use graphClient to fetch stream
                     downloadStream = response as ReadableStream; // Cast might be needed depending on SDK version
                 } catch (fetchError) {
                     context.log(`WARN: Failed to fetch using provided/re-fetched download URL, falling back to item content API. Error: ${fetchError.message}`);
                     // Fallback to /content if downloadUrl fails or isn't present
                     if (!file.parentReference?.driveId) throw new Error("Drive ID missing, cannot fetch content.");
                     const response = await graphClient.api(`/drives/${file.parentReference.driveId}/items/${file.id}/content`).getStream();
                     downloadStream = response as ReadableStream;
                 }

            } else if (file.parentReference?.driveId && file.id) {
                 context.log(`Fetching content using Graph API content path for ${file.name}`);
                 const response = await graphClient.api(`/drives/${file.parentReference.driveId}/items/${file.id}/content`).getStream();
                 downloadStream = response as ReadableStream;
            } else {
                throw new Error(`Insufficient info to download file ${file.name}`);
            }

            if (downloadStream) {
                // 2. Generate unique blob name
                uniqueBlobName = `${uuidv4()}-${file.name}`;
                context.log(`Generated blob name for SP file ${file.name}: ${uniqueBlobName}`);

                // 3. Store metadata (isCtv flag)
                try {
                    await metadataTableClient.upsertEntity({ partitionKey, rowKey: uniqueBlobName, isCtv: file.isCtv ?? false }, "Replace");
                    context.log(`Stored isCtv metadata for ${uniqueBlobName}`);
                } catch (metaError) {
                     context.log(`WARN: Failed to store isCtv metadata for ${uniqueBlobName}: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
                }

                // 4. Upload stream to Blob Storage
                const blockBlobClient = containerClient.getBlockBlobClient(uniqueBlobName);
                context.log(`Uploading stream for ${file.name} to blob ${uniqueBlobName}...`);
                const nodeReadableStream = Readable.fromWeb(downloadStream as any); // Keep 'as any' for now

                await blockBlobClient.uploadStream(nodeReadableStream);
                context.log(`Successfully uploaded ${file.name} to ${uniqueBlobName}. Analysis will be triggered.`);

            } else {
                 throw new Error(`Could not obtain download stream for ${file.name}`);
            }

        } catch (fileError) {
             context.log(`ERROR processing file ${file.name}: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
             if (uniqueBlobName) {
                try {
                    const errorResult = {
                        blobName: uniqueBlobName, originalFileName: file.name, blobSize: 0, isCtv: file.isCtv ?? false,
                        validationChecks: [{ checkName: "Sharepoint Fetch/Upload", status: "Fail", message: fileError instanceof Error ? fileError.message : String(fileError) }],
                        status: 'Error'
                    };
                     const errorEntity = { partitionKey, rowKey: uniqueBlobName, status: 'Error', validationChecksData: JSON.stringify(errorResult.validationChecks) };
                     await resultsTableClient.upsertEntity(errorEntity, "Replace");
                     context.log(`Stored error status for ${uniqueBlobName}`);
                } catch (dbError) {
                     context.log(`ERROR storing error status for ${uniqueBlobName}: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
                }
             }
        }
    }

    return { status: 202, body: `Request accepted to process ${receivedFiles.length} Sharepoint files. Check results later.` };

}

app.http('processSharepointFiles', {
    methods: ['POST'],
    authLevel: 'anonymous', // Keep anonymous for now, auth is checked via token
    handler: processSharepointFiles
});
