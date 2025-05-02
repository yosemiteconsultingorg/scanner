import { NextRequest, NextResponse } from 'next/server';
import { BlobServiceClient, StorageSharedKeyCredential, BlobSASPermissions, generateBlobSASQueryParameters } from "@azure/storage-blob";
import { v4 as uuidv4 } from 'uuid';

// Helper function to parse connection string (basic implementation)
function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

export async function GET(request: NextRequest) {
    // Get the fileName from the URL parameters
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');
    
    if (!fileName) {
        return NextResponse.json({ error: "Please pass a fileName on the query string" }, { status: 400 });
    }

    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
        console.error("Azure Storage Connection String not found in environment variables.");
        return NextResponse.json({ error: "Server configuration error: Storage connection string missing." }, { status: 500 });
    }

    const containerName = "files-processing";

    try {
        const { accountName, accountKey } = getAccountInfo(connectionString);
        // Log parsed credentials (mask key partially)
        console.log(`Parsed Account Name: ${accountName}`);
        console.log(`Parsed Account Key (masked): ${accountKey.substring(0, 5)}...${accountKey.substring(accountKey.length - 5)}`);

        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${accountName}.blob.core.windows.net`,
            sharedKeyCredential
        );
        const containerClient = blobServiceClient.getContainerClient(containerName);

        // Generate a unique blob name to prevent overwrites
        const uniqueBlobName = `${uuidv4()}-${fileName}`;
        console.log(`Generated uniqueBlobName: ${uniqueBlobName}`);

        const blobClient = containerClient.getBlobClient(uniqueBlobName);

        // Generate SAS token for write permissions
        const startsOn = new Date();
        startsOn.setMinutes(startsOn.getMinutes() - 5); // 5 minutes in the past
        const expiresOn = new Date(startsOn);
        expiresOn.setHours(expiresOn.getHours() + 1); // 1 hour expiry

        const permissions = BlobSASPermissions.parse("racwd"); // Using broad permissions
        console.log(`Generating SAS with permissions: ${permissions.toString()}`);

        const sasToken = generateBlobSASQueryParameters({
            containerName: containerName,
            blobName: uniqueBlobName,
            permissions: permissions,
            startsOn: startsOn,
            expiresOn: expiresOn,
        }, sharedKeyCredential);

        const sasUrl = `${blobClient.url}?${sasToken}`;

        console.log(`Generated SAS URL (racwd) for ${uniqueBlobName}`);

        // Return the SAS URL and the blob name to the client
        return NextResponse.json({
            uploadUrl: sasUrl,
            blobName: uniqueBlobName
        });

    } catch (error) {
        console.error("Error generating SAS URL:", error);
        return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
    }
}

// By default, this file exports a GET handler
export const config = {
    runtime: 'edge',
};
