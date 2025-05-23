# User Flow - Scanner Application

This document outlines the typical user journeys for scanning creative assets.

## Flow 1: Scanning via Direct Upload (Single or Bulk)

1.  **User visits the Scanner application** in their web browser.
2.  **User selects the "Upload Files" option.**
3.  **User selects one or more creative asset files** from their local machine using the browser's file input.
4.  **Application lists the selected files** in the browser interface.
    *   For each file identified as a video (based on extension like .mp4, .mov, .webm), a checkbox/dropdown appears: "[ ] Check against CTV Specs".
5.  **User reviews the list and designates any relevant videos for CTV checks** using the provided UI controls.
6.  **User clicks the "Start Scan" button.**
7.  **Application requests secure upload URLs** from the backend API for each selected file (associating the CTV designation metadata if applicable).
8.  **Application (frontend Javascript) uploads each file directly to Azure Blob Storage** using the provided URLs via browser APIs (e.g., Fetch API with PUT).
9.  **Application displays progress** for uploads in the browser. Upload completion triggers backend analysis via Azure events (e.g., BlobCreated trigger).
10. **Backend performs analysis:**
    *   Triggered by file arrival in Azure Storage.
    *   Retrieves associated metadata (like CTV designation).
    *   For each file:
        *   Determines creative type.
        *   Extracts metadata.
        *   Applies validation rules based on creative type and designation.
11. **Application displays the results** in the browser (polling the backend or via WebSocket for status updates):
    *   Shows a summary report for the batch.
    *   Lists each file with its overall status (Pass/Fail/Warnings).
    *   Allows expanding details for each file to see which specific checks passed or failed.
    *   Provides a "Preview" option next to each file (for images, video, audio, and HTML5 backup image) which opens the preview in a modal/panel using a secure SAS URL generated by the backend.

## Flow 2: Scanning via Sharepoint (Single or Bulk)

1.  **User visits the Scanner application** in their web browser.
2.  **User selects the "Scan from Sharepoint" option.**
3.  **If not already authenticated, user is redirected via the browser to Microsoft login** (using MSAL.js).
4.  **Upon successful authentication, the application displays a Sharepoint file picker interface** within the browser page (using Microsoft Graph API).
5.  **User navigates their Sharepoint sites/libraries and selects one or more creative asset files** using the picker interface.
6.  **User confirms selection.**
7.  **Application lists the selected files** in the browser interface.
    *   For each file identified as a video, a checkbox/dropdown appears: "[ ] Check against CTV Specs".
8.  **User reviews the list and designates any relevant videos for CTV checks.**
9.  **User clicks the "Start Scan" button.**
10. **Backend receives the list of selected Sharepoint files and their designations.**
11. **Backend fetches files from Sharepoint** using the Graph API (using user's delegated permissions).
12. **Backend streams each fetched file directly to Azure Blob Storage** (associating CTV designation). This triggers the same analysis process as direct uploads.
13. **Backend performs analysis** (as in step 10 of Flow 1, triggered by file arrival in Azure).
14. **Application displays the results** in the browser (as in step 11 of Flow 1, including the "Preview" option).

## Common Elements

*   **Browser-Based:** All user interaction occurs within a standard web browser.
*   **Error Handling:** Clear feedback is provided in the browser interface for upload failures, authentication issues, analysis errors, etc.
*   **Results Display:** Consistent format for showing pass/fail status and detailed checks within the web page.
*   **Metadata Association:** A backend mechanism (e.g., temporary database record or Azure Blob metadata) associates the user's CTV designation choice with the file during processing.
