import React, { useState, useEffect, useRef } from 'react';
import FileUpload from './components/FileUpload';
import './App.css';
import logo from '/A Scanner Yosemite Logo.png'; // Import logo relative to public directory
import { useMsal, useIsAuthenticated } from "@azure/msal-react"; // Import MSAL hooks
import { InteractionStatus } from "@azure/msal-browser"; // Import InteractionStatus
import { graphScopes } from './authConfig'; // Import scopes
import { FileList } from '@microsoft/mgt-react'; // Re-import MGT FileList React component
import { Providers, ProviderState } from '@microsoft/mgt-element'; // Import MGT ProviderState
// Remove the direct component import: import '@microsoft/mgt-components';

// --- Interfaces ---
interface FileDetails {
  file?: File; // Make file optional
  sharepointFile?: any; // For Sharepoint files (structure TBD from Graph API)
  isCtv: boolean;
  uploadProgress: number;
  status: 'Pending' | 'Uploading' | 'Processing' | 'Completed' | 'Error';
  blobName?: string;
  analysisResult?: AnalysisResult;
}
interface ValidationCheck { checkName: string; status: 'Pass' | 'Fail' | 'Warn' | 'NotApplicable'; message: string; value?: string | number; limit?: string | number; }
interface Html5Info { primaryHtmlFile?: string; adSizeMeta?: string; clickTagDetected?: boolean; fileCount?: number; totalUncompressedSize?: number; backupImageFile?: string; extractedBackupBlobName?: string; } // Add extractedBackupBlobName
interface AnalysisResult { blobName: string; originalFileName?: string; blobSize: number; isCtv: boolean; mimeType?: string; extension?: string; dimensions?: { width?: number; height?: number }; validationChecks: ValidationCheck[]; status: 'Processing' | 'Completed' | 'Error'; duration?: number; bitrate?: number; frameRate?: number; html5Info?: Html5Info; }
interface PreviewState { url: string; type: 'image' | 'video' | 'audio' | 'html5-backup' | null; fileName: string; }


// --- Component ---
function App() {
  const [fileProcessingDetails, setFileProcessingDetails] = useState<FileDetails[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ url: '', type: null, fileName: '' });
  const [selectedSharepointFiles, setSelectedSharepointFiles] = useState<any[]>([]);
  const [mgtState, setMgtState] = useState<ProviderState>(ProviderState.Loading);

  const pollingIntervals = useRef<number[]>([]);
  const fileListRef = useRef<any>(null); // Ref for MGT FileList element

  // --- MSAL & MGT Hooks ---
  const { instance, inProgress, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = accounts[0];

  useEffect(() => {
    const updateState = () => setMgtState(Providers.globalProvider.state);
    Providers.onProviderUpdated(updateState);
    updateState();
    return () => Providers.removeProviderUpdatedListener(updateState);
  }, []);

  // Effect to attach event listener to MGT FileList for selection changes
  useEffect(() => {
    // Apply specific type assertion for the ref current value
    const fileListEl = fileListRef.current as HTMLElement & {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    };
    if (!fileListEl) return;

    // Handler for selection change event
    const handleSelectionChanged = (e: any) => { // Use 'any' for event type as CustomEvent might not have 'detail' typed correctly depending on context
        const selected = e.detail || []; // Assuming detail is the array of selected items
        setSelectedSharepointFiles(selected);
        setFileProcessingDetails([]); // Clear direct uploads if SP files are selected
        console.log('Sharepoint files selected via event listener:', selected);
    };

    // Handler for generic click events within the FileList container
    const handleGenericClick = (e: Event) => {
        // Inspect the clicked element to see if it's likely a file/folder link
        // MGT might render these as <a> tags or elements with specific roles/classes.
        // This is a heuristic approach.
        const targetElement = e.target as HTMLElement; // Use const as it's not reassigned
        // Check if the target or its parent is an anchor tag or has a role suggesting it's an item link
        // (We might need to inspect the rendered HTML in the browser dev tools to find the right selector)
        const linkElement = targetElement.closest('a, [role="listitem"] div[class*="listItem"]'); // Example selector, adjust as needed

        if (linkElement) {
            console.log("Likely file/folder link clicked within MGT FileList. Preventing default navigation.");
            e.preventDefault();
        }
    };

    // Attach listeners
    const selectionEventName = 'selectionChanged';
    const clickEventName = 'click'; // Use standard browser click event

    fileListEl.addEventListener(selectionEventName, handleSelectionChanged);
    fileListEl.addEventListener(clickEventName, handleGenericClick, true); // Use capture phase to potentially catch event earlier
    console.log(`Attached ${selectionEventName} and ${clickEventName} (capture) listeners to MGT FileList`);

    // Cleanup listeners on component unmount
    return () => {
      if (fileListEl) {
        fileListEl.removeEventListener(selectionEventName, handleSelectionChanged);
        fileListEl.removeEventListener(clickEventName, handleGenericClick, true); // Remove capture phase listener
        console.log(`Removed ${selectionEventName} and ${clickEventName} listeners from MGT FileList`);
      }
    };
  }, [fileListRef]); // Re-run if ref changes (shouldn't often)


  // --- Auth Handlers ---
  const handleLogin = () => { if (inProgress === InteractionStatus.None) { instance.loginRedirect({ scopes: graphScopes.loginRequest }).catch(e => console.error("Login failed:", e)); } };
  const handleLogout = () => { instance.logoutRedirect({ account: account }).catch(e => console.error("Logout failed:", e)); };

  // --- File Handlers ---
  const handleFilesSelected = (files: FileList) => {
    if (isScanning) return;
    const fileList = Array.from(files);
    const details: FileDetails[] = fileList.map(file => ({ file: file, isCtv: false, status: 'Pending', uploadProgress: 0 }));
    setFileProcessingDetails(details);
    setSelectedSharepointFiles([]); // Clear SP selection when direct uploading
    console.log('Files selected:', details);
  };

   const handleCtvToggle = (index: number) => {
     if (isScanning) return;
    // This only works for direct uploads currently
    setFileProcessingDetails(prevDetails => prevDetails.map((detail, i) => i === index ? { ...detail, isCtv: !detail.isCtv } : detail ));
    // TODO: Need similar logic for SP files if we list them before scanning
  };

  // --- Polling Logic ---
   const pollForResult = (blobName: string) => {
    console.log(`Polling for result: ${blobName}`);
    const intervalId: number = setInterval(async () => {
      try {
        const resultResponse = await fetch(`/api/getAnalysisResult?blobName=${encodeURIComponent(blobName)}`);
        if (resultResponse.ok) {
          const result: AnalysisResult = await resultResponse.json();
          console.log(`Received result for ${blobName}:`, result);
          if (result.status === 'Completed' || result.status === 'Error') {
            clearInterval(intervalId);
            pollingIntervals.current = pollingIntervals.current.filter(id => id !== intervalId);
            setFileProcessingDetails(prevDetails =>
              prevDetails.map((detail) =>
                detail.blobName === blobName ? { ...detail, status: result.status, analysisResult: { ...result, validationChecks: result.validationChecks || [] } } : detail
              )
            );
            checkIfAllDone();
          } else {
             setFileProcessingDetails(prevDetails =>
              prevDetails.map((detail) =>
                detail.blobName === blobName ? { ...detail, status: 'Processing' } : detail
              )
            );
          }
        } else if (resultResponse.status === 404) {
          console.log(`Result not ready for ${blobName}, continuing poll.`);
           setFileProcessingDetails(prevDetails =>
              prevDetails.map((detail) =>
                 detail.blobName === blobName ? { ...detail, status: 'Processing' } : detail
              )
            );
        } else {
          console.error(`Polling error for ${blobName}: ${resultResponse.statusText}`);
          clearInterval(intervalId);
          pollingIntervals.current = pollingIntervals.current.filter(id => id !== intervalId);
          setFileProcessingDetails(prevDetails =>
            prevDetails.map((detail) =>
              detail.blobName === blobName ? { ...detail, status: 'Error', analysisResult: { ...(detail.analysisResult || { blobName: detail.blobName || 'unknown', blobSize: detail.file?.size || 0, isCtv: detail.isCtv, status: 'Error'}), validationChecks: [...(detail.analysisResult?.validationChecks || []), { checkName: "Polling", status: "Fail", message: "Polling failed" }] } as AnalysisResult } : detail
            )
          );
           checkIfAllDone();
        }
      } catch (error) {
        console.error(`Polling exception for ${blobName}:`, error);
        clearInterval(intervalId);
        pollingIntervals.current = pollingIntervals.current.filter(id => id !== intervalId);
         setFileProcessingDetails(prevDetails =>
            prevDetails.map((detail) =>
              detail.blobName === blobName ? { ...detail, status: 'Error', analysisResult: { ...(detail.analysisResult || { blobName: detail.blobName || 'unknown', blobSize: detail.file?.size || 0, isCtv: detail.isCtv, status: 'Error'}), validationChecks: [...(detail.analysisResult?.validationChecks || []), { checkName: "Polling", status: "Fail", message: "Polling exception" }] } as AnalysisResult } : detail
            )
          );
        checkIfAllDone();
      }
    }, 5000);
    pollingIntervals.current.push(intervalId);
  };

  const checkIfAllDone = () => {
     setFileProcessingDetails(currentDetails => {
        // Only check direct uploads for now
        const allDirectDone = currentDetails.every(d => d.status === 'Completed' || d.status === 'Error');
        // TODO: Add check for SP files when their processing is implemented
        if (allDirectDone && selectedSharepointFiles.length === 0) { // Only stop scanning if direct uploads are done AND no SP files were selected initially
            console.log("All files processed.");
            setIsScanning(false);
            pollingIntervals.current.forEach(clearInterval);
            pollingIntervals.current = [];
        }
        return currentDetails;
     });
  };


  // --- Upload File with Progress ---
   const uploadFileWithProgress = (url: string, file: File, blobName: string): Promise<void> => {
      return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', url, true);
          xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
          xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                  const percentComplete = Math.round((event.loaded / event.total) * 100);
                  setFileProcessingDetails(prev => prev.map(d => d.blobName === blobName ? { ...d, uploadProgress: percentComplete } : d ));
              }
          };
          xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                   setFileProcessingDetails(prev => prev.map(d => d.blobName === blobName ? { ...d, uploadProgress: 100 } : d ));
                  resolve();
              } else { reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`)); }
          };
          xhr.onerror = () => { reject(new Error('Upload failed: Network error')); };
          xhr.send(file);
      });
  };


  // --- Upload and Scan Logic ---
  const handleStartScan = async () => {
    // Combine direct and SP files into a unified list for processing setup
    const directUploadItems: FileDetails[] = fileProcessingDetails.map(d => ({ ...d, status: 'Uploading', uploadProgress: 0, analysisResult: undefined }));
    const spItemsToProcess = [...selectedSharepointFiles]; // Copy the array

    if (directUploadItems.length === 0 && spItemsToProcess.length === 0 || isScanning) return;

    console.log("Starting scan process...");
    setIsScanning(true);
    setFileProcessingDetails(directUploadItems); // Update state for direct uploads
    setSelectedSharepointFiles([]); // Clear selection list

    pollingIntervals.current.forEach(clearInterval);
    pollingIntervals.current = [];

    // Process Direct Uploads
    for (const detail of directUploadItems) {
        const fileName = detail.file?.name || 'unknown_file';
        try {
            const sasResponse = await fetch(`/api/generateUploadUrl?fileName=${encodeURIComponent(fileName)}`);
            if (!sasResponse.ok) throw new Error(`SAS URL fetch failed: ${sasResponse.statusText}`);
            const { uploadUrl, blobName } = await sasResponse.json();

            // Update state with blobName before starting upload
            setFileProcessingDetails(prev => prev.map(d => d.file === detail.file ? { ...d, blobName: blobName } : d));

            const metadataResponse = await fetch('/api/setCreativeMetadata', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blobName: blobName, isCtv: detail.isCtv }),
            });
            if (!metadataResponse.ok) throw new Error(`Set metadata failed: ${metadataResponse.statusText}`);

            if (detail.file) {
                await uploadFileWithProgress(uploadUrl, detail.file, blobName);
                pollForResult(blobName);
            } else {
                 throw new Error("Missing file data for upload.");
            }

        } catch (error) {
            console.error(`Error during setup/upload for file ${fileName}:`, error);
            setFileProcessingDetails(prevDetails =>
                prevDetails.map(d =>
                    d.file === detail.file ? { ...d, status: 'Error', analysisResult: { blobName: d.blobName || 'unknown', blobSize: d.file?.size || 0, isCtv: d.isCtv, validationChecks: [{ checkName: "Upload/Setup", status: "Fail", message: error instanceof Error ? error.message : String(error) }], status: 'Error' } as AnalysisResult } : d
                )
            );
             checkIfAllDone();
        }
    }

     // Handle Sharepoint Files
     if (spItemsToProcess.length > 0) {
        console.log(`Sending ${spItemsToProcess.length} Sharepoint files to backend for processing.`);
        try {
            // Acquire token for the backend API scope silently
            const accessTokenRequest = {
                scopes: ["api://5e7495d1-4f14-4878-b01a-8da624d99677/access_scanner_api"],
                account: account // Ensure we use the current logged-in user's account
            };
            const accessTokenResponse = await instance.acquireTokenSilent(accessTokenRequest);
            const accessToken = accessTokenResponse.accessToken;
            console.log("Acquired backend API token successfully.");

            // Extract only necessary info (id, name) to send to backend
            const filesToProcess = spItemsToProcess.map(item => ({
                id: item.id, // Assuming MGT provides 'id' directly on the item
                name: item.name, // Assuming MGT provides 'name' directly
                parentReference: item.parentReference, // Pass driveId if available
                '@microsoft.graph.downloadUrl': item['@microsoft.graph.downloadUrl'], // Pass downloadUrl if available
                // TODO: Add isCtv flag if UI toggle is implemented for SP files
            }));

            const response = await fetch('/api/processSharepointFiles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}` // Send the acquired token
                },
                body: JSON.stringify({ files: filesToProcess })
            });

            if (!response.ok) {
                 const errorBody = await response.text();
                 throw new Error(`Backend failed to accept Sharepoint files: ${response.statusText} - ${errorBody}`);
            }

            console.log("Backend acknowledged Sharepoint file processing request.");
            alert(`Backend will process ${spItemsToProcess.length} Sharepoint file(s). Results will appear when ready (feature not fully implemented).`);
             if (directUploadItems.length === 0) {
                 setIsScanning(false);
             }

        } catch (error) {
             console.error("Error sending Sharepoint files to backend:", error);
             alert(`Error initiating Sharepoint file processing: ${error instanceof Error ? error.message : String(error)}`);
             if (directUploadItems.length === 0) {
                 setIsScanning(false);
             }
        }
     }


    console.log("Upload requests initiated for direct files.");
  };


   // --- Preview Logic ---
    const handlePreviewClick = async (blobName: string | undefined, mimeType: string | undefined, originalFileName: string) => {
       if (!blobName) { alert("Cannot preview: Blob name is missing."); return; }
       console.log(`Requesting preview URL for ${blobName}`);
       try {
           const response = await fetch(`/api/getPreviewUrl?blobName=${encodeURIComponent(blobName)}`);
           if (!response.ok) throw new Error(`Failed to get preview URL: ${response.statusText}`);
           const { previewUrl } = await response.json();
           let previewType: PreviewState['type'] = null;
           if (mimeType?.startsWith('image/')) {
               previewType = 'image';
           } else if (mimeType?.startsWith('video/')) {
               previewType = 'video';
           } else if (mimeType?.startsWith('audio/')) {
               previewType = 'audio';
           } else if (mimeType === 'application/zip') {
               // If the backend returned a URL for a zip, it must be the backup image
               previewType = 'image';
               console.log("Setting preview type to 'image' for HTML5 backup.");
           }

           if (previewType) {
               setPreview({ url: previewUrl, type: previewType, fileName: originalFileName });
           } else {
               alert(`Preview not available for this file type (${mimeType || 'unknown'}).`);
           }
       } catch (error) {
           console.error(`Error getting preview URL for ${blobName}:`, error);
           alert(`Could not load preview: ${error instanceof Error ? error.message : String(error)}`);
       }
   };

   const closePreview = () => { setPreview({ url: '', type: null, fileName: '' }); };


  // --- Cleanup polling on unmount ---
   useEffect(() => { return () => { pollingIntervals.current.forEach(clearInterval); }; }, []);

  // --- Helper: Check if file is video ---
   const isVideoFile = (fileName: string): boolean => {
    const videoExtensions = ['.mp4', '.mov', '.webm', '.mpg', '.mpeg', '.avi', '.flv', '.zip'];
    const lowerCaseName = fileName.toLowerCase();
    return videoExtensions.some(ext => lowerCaseName.endsWith(ext));
  };


  // --- Render ---
  return (
    <div className="App">
      <header className="App-header"> {/* Removed inline styles, use CSS file */}
        <img src={logo} alt="Scanner Logo" className="App-logo" />
        {/* Add Login/Logout Button */}
        <div className="header-actions">
            {isAuthenticated ? (
                <>
                    <span style={{ marginRight: '10px' }}>Welcome, {account?.name || account?.username || 'User'}!</span>
                    <button onClick={handleLogout}>Logout</button>
                </>
            ) : (
                <button onClick={handleLogin} disabled={inProgress !== InteractionStatus.None}>
                    Login for Sharepoint Access
                </button>
            )}
        </div>
      </header>
      <main>
        {/* Preview Modal */}
         {preview.type && (
            <div className="preview-modal" style={modalStyles.overlay} onClick={closePreview}>
                <div style={modalStyles.content} onClick={(e) => e.stopPropagation()}>
                    <h3>Preview: {preview.fileName}</h3>
                    {preview.type === 'image' && <img src={preview.url} alt="Preview" style={modalStyles.media} />}
                    {preview.type === 'video' && <video src={preview.url} controls style={modalStyles.media}></video>}
                    {preview.type === 'audio' && <audio src={preview.url} controls style={modalStyles.media}></audio>}
                    <button onClick={closePreview} style={{ marginTop: '15px' }}>Close</button>
                </div>
            </div>
        )}

        <section className="upload-area">
          <h2>Upload Files or Connect to Sharepoint</h2>
          <div style={{ marginBottom: '15px' }}>
              <FileUpload onFilesSelected={handleFilesSelected} />
          </div>

          {/* Conditionally render MGT FileList if authenticated and provider ready */}
          {isAuthenticated && mgtState === ProviderState.SignedIn && (
              <div style={{ border: '1px dashed #ccc', padding: '10px', marginTop: '15px' }}>
                  <h3>Select from Sharepoint:</h3>
                  {/* Use the React wrapper component again */}
                  <FileList
                      itemPath="/"
                      enableFileUpload={false}
                      pageSize={5}
                      // selectionChanged={handleSharepointFileSelect} // Prop removed, handled by useEffect
                      // itemClick={handleSharepointItemClick} // Prop removed, handled by useEffect
                      ref={fileListRef} // Attach the ref
                  />
                  {/* Display selected SP files */}
                  {selectedSharepointFiles.length > 0 && (
                       <div style={{ marginTop: '10px' }}>
                           <p>Selected Sharepoint Files:</p>
                           <ul>
                               {selectedSharepointFiles.map((file, index) => (
                                   <li key={index}>{file.name}</li>
                               ))}
                           </ul>
                       </div>
                  )}
              </div>
          )}
          {isAuthenticated && mgtState !== ProviderState.SignedIn && (
              <p>Loading Sharepoint access...</p>
          )}


          {/* Display list of files selected for upload (either direct or SP) */}
          {(fileProcessingDetails.length > 0 || selectedSharepointFiles.length > 0) && (
            <div className="file-list" style={{ marginTop: '20px' }}>
              <h3>Files to Scan:</h3>
              <ul>
                {/* List direct upload files */}
                {fileProcessingDetails.map((detail, index) => (
                  <li key={`direct-${index}`} style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <span>{detail.file?.name || 'Processing Sharepoint file...'}</span>
                      {detail.file && isVideoFile(detail.file.name) && !detail.file.name.toLowerCase().endsWith('.zip') && (
                        <label style={{ marginLeft: '15px' }}>
                          <input type="checkbox" checked={detail.isCtv} onChange={() => handleCtvToggle(index)} disabled={isScanning} /> Check as CTV
                        </label>
                      )}
                    </div>
                     <span style={{ marginLeft: '20px', fontStyle: 'italic' }}>
                         {detail.status}
                         {detail.status === 'Uploading' && ` (${detail.uploadProgress}%)`}
                     </span>
                  </li>
                ))}
                 {/* List selected SP files */}
                 {selectedSharepointFiles.map((file, index) => (
                     <li key={`sp-${index}`} style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                         <span>{file.name} (Sharepoint)</span>
                         <span style={{ marginLeft: '20px', fontStyle: 'italic' }}>Pending</span>
                     </li>
                 ))}
              </ul>
              <button onClick={handleStartScan} disabled={(fileProcessingDetails.length === 0 && selectedSharepointFiles.length === 0) || isScanning}>
                {isScanning ? 'Scanning...' : 'Start Scan'}
              </button>
            </div>
          )}
        </section>

        <section className="results-area">
          <h2>Scan Results</h2>
            {/* Results display logic now only depends on fileProcessingDetails */}
            {fileProcessingDetails.length > 0 && (
             <div className="results-list" style={{ marginTop: '20px' }}>
                {fileProcessingDetails.map((detail, index) => {
                    return detail.analysisResult && (
                        <div key={`${index}-result`} style={{ border: '1px solid #ccc', padding: '10px', marginBottom: '10px' }}>
                            <h4>{detail.file?.name || detail.analysisResult.originalFileName}</h4>
                            <p>Overall Status: {detail.analysisResult.status}</p>
                            <p>Type: {detail.analysisResult.mimeType || 'N/A'} | Size: {(detail.analysisResult.blobSize / 1024).toFixed(1)} KB
                               {detail.analysisResult.dimensions && ` | Dimensions: ${detail.analysisResult.dimensions.width}x${detail.analysisResult.dimensions.height}`}
                               {detail.analysisResult.duration !== undefined && ` | Duration: ${detail.analysisResult.duration.toFixed(1)}s`}
                               {detail.analysisResult.bitrate !== undefined && ` | Bitrate: ${detail.analysisResult.bitrate} kbps`}
                            </p>
                            {detail.analysisResult.html5Info && (
                                <div style={{ fontSize: '0.9em', color: '#555', marginTop: '5px' }}>
                                    HTML5 Info:
                                    Primary: {detail.analysisResult.html5Info.primaryHtmlFile || 'N/A'} |
                                    Ad Size: {detail.analysisResult.html5Info.adSizeMeta || 'N/A'} |
                                    ClickTag: {detail.analysisResult.html5Info.clickTagDetected ? 'Detected' : 'Not Detected'} |
                                    Files: {detail.analysisResult.html5Info.fileCount ?? 'N/A'} |
                                    Uncompressed: {detail.analysisResult.html5Info.totalUncompressedSize ? (detail.analysisResult.html5Info.totalUncompressedSize / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'} |
                                    Backup Img: {detail.analysisResult.html5Info.backupImageFile || 'N/A'}
                                </div>
                            )}
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                                <thead>
                                    <tr>
                                        <th style={tableStyles.th}>Check</th>
                                        <th style={tableStyles.th}>Status</th>
                                        <th style={tableStyles.th}>Details</th>
                                        <th style={tableStyles.th}>Value</th>
                                        <th style={tableStyles.th}>Limit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.analysisResult.validationChecks && Array.isArray(detail.analysisResult.validationChecks) && detail.analysisResult.validationChecks.length > 0 &&
                                        detail.analysisResult.validationChecks.map((check, checkIndex) => (
                                            <tr key={checkIndex}>
                                                <td style={tableStyles.td}>{check.checkName}</td>
                                                <td style={{ ...tableStyles.td, ...getStatusColor(check.status) }}>{check.status}</td>
                                                <td style={tableStyles.td}>{check.message}</td>
                                                <td style={tableStyles.td}>{check.value ?? '-'}</td>
                                                <td style={tableStyles.td}>{check.limit ?? '-'}</td>
                                            </tr>
                                        ))
                                    }
                                    {detail.analysisResult.validationChecks && Array.isArray(detail.analysisResult.validationChecks) && detail.analysisResult.validationChecks.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{...tableStyles.td, fontStyle: 'italic'}}>No specific validation issues found.</td>
                                        </tr>
                                    )}
                                    {(!detail.analysisResult.validationChecks || !Array.isArray(detail.analysisResult.validationChecks)) && (
                                        <tr>
                                            <td colSpan={5} style={{...tableStyles.td, color: 'red'}}>Error: Validation checks data missing or invalid.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {/* Corrected single Preview button */}
                            <button
                                onClick={() => {
                                    const isHtml5 = detail.analysisResult?.mimeType === 'application/zip';
                                    const backupBlobName = detail.analysisResult?.html5Info?.extractedBackupBlobName;
                                    const previewBlob = isHtml5 && backupBlobName ? backupBlobName : detail.blobName;
                                    // Determine preview mime type (image if backup exists, otherwise original)
                                    // TODO: Get actual mime type from backup image name if possible
                                    const previewMime = isHtml5 && backupBlobName ? 'image/jpeg' : detail.analysisResult?.mimeType; // Assume jpg/png for backup for now
                                    handlePreviewClick(previewBlob, previewMime, detail.file?.name || detail.analysisResult?.originalFileName || 'file');
                                }}
                                disabled={!detail.blobName || (detail.status !== 'Completed' && detail.status !== 'Error')}
                                style={{ marginTop: '10px' }}
                             >
                                Preview
                             </button>
                        </div>
                    )
                })}
             </div>
           )}
           {fileProcessingDetails.length === 0 && selectedSharepointFiles.length === 0 && <p>Upload files or select from Sharepoint to see results.</p>}
        </section>
      </main>
    </div>
  );
}

// --- Helper Styles ---
const modalStyles = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, } as React.CSSProperties,
    content: { background: '#fff', padding: '20px', borderRadius: '5px', maxWidth: '80%', maxHeight: '80%', overflow: 'auto', textAlign: 'center', } as React.CSSProperties,
    media: { maxWidth: '100%', maxHeight: '60vh', display: 'block', margin: '0 auto', } as React.CSSProperties,
};

const tableStyles = {
    th: { border: '1px solid #ddd', padding: '8px', textAlign: 'left', backgroundColor: '#f2f2f2' } as React.CSSProperties,
    td: { border: '1px solid #ddd', padding: '8px', textAlign: 'left' } as React.CSSProperties,
};

const getStatusColor = (status: ValidationCheck['status']): React.CSSProperties => {
    switch (status) {
        case 'Pass': return { color: 'green', fontWeight: 'bold' };
        case 'Fail': return { color: 'red', fontWeight: 'bold' };
        case 'Warn': return { color: 'orange', fontWeight: 'bold' };
        case 'NotApplicable': return { color: 'grey' };
        default: return {};
    }
};


export default App;
