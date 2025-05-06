import { TableClient } from '@azure/data-tables';

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const blobName = req.query.blobName;
  if (!blobName) {
    return res.status(400).json({ error: "Please pass a blobName on the query string" });
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    console.error("Azure Storage Connection String not found in environment variables.");
    return res.status(500).json({ error: "Server configuration error: Storage connection string missing." });
  }

  try {
    // Create the TableClient
    const tableClient = TableClient.fromConnectionString(
      connectionString,
      'creativeAnalysis'
    );

    // Query the table for this blobName
    const entity = await tableClient.getEntity('analysis', blobName);
    
    if (!entity) {
      return res.status(404).json({ error: "Analysis result not found" });
    }

    // Process and return the entity
    const analysisResult = {
      blobName: entity.rowKey,
      originalFileName: entity.originalFileName,
      blobSize: entity.blobSize,
      isCtv: entity.isCtv,
      mimeType: entity.mimeType,
      extension: entity.extension,
      dimensions: entity.dimensions ? JSON.parse(entity.dimensions) : undefined,
      validationChecks: entity.validationChecks ? JSON.parse(entity.validationChecks) : [],
      status: entity.status,
      duration: entity.duration,
      bitrate: entity.bitrate,
      frameRate: entity.frameRate,
      html5Info: entity.html5Info ? JSON.parse(entity.html5Info) : undefined
    };

    return res.status(200).json(analysisResult);

  } catch (error) {
    console.error("Error retrieving analysis result:", error);
    
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Analysis result not found" });
    }
    
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
}
