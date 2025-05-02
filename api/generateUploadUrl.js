import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';

// Helper function to parse connection string
function getAccountInfo(connectionString) {
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error("Could not parse AccountName or AccountKey from connection string");
  }
  return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const fileName = req.query.fileName;
  if (!fileName) {
    return res.status(400).json({ error: "Please pass a fileName on the query string" });
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    console.error("Azure Storage Connection String not found in environment variables.");
    return res.status(500).json({ error: "Server configuration error: Storage connection string missing." });
  }

  const containerName = "files-processing";

  try {
    const { accountName, accountKey } = getAccountInfo(connectionString);
    
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    );
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Generate a unique blob name to prevent overwrites
    const uniqueBlobName = `${uuidv4()}-${fileName}`;
    
    const blobClient = containerClient.getBlobClient(uniqueBlobName);

    // Generate SAS token for write permissions
    const startsOn = new Date();
    startsOn.setMinutes(startsOn.getMinutes() - 5); // 5 minutes in the past
    const expiresOn = new Date(startsOn);
    expiresOn.setHours(expiresOn.getHours() + 1); // 1 hour expiry

    const permissions = "racwd"; // Read, Add, Create, Write, Delete

    const sasToken = generateBlobSASQueryParameters({
      containerName,
      blobName: uniqueBlobName,
      permissions,
      startsOn,
      expiresOn,
    }, sharedKeyCredential);

    const sasUrl = `${blobClient.url}?${sasToken}`;

    // Return the SAS URL and the blob name to the client
    return res.status(200).json({
      uploadUrl: sasUrl,
      blobName: uniqueBlobName
    });

  } catch (error) {
    console.error("Error generating SAS URL:", error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
}
