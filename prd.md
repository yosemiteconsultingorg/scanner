# Product Requirements Document (PRD) - Scanner Application

## 1. Introduction

Scanner is a web-based application designed to help users verify if their creative assets (images, videos, HTML5 bundles, etc.) meet the technical specifications required by The Trade Desk DSP. It aims to streamline the creative QA process by providing automated checks against the official Trade Desk guidelines.

## 2. Goals

*   Provide an easy-to-use interface for uploading or selecting creative assets.
*   Automate the validation of assets against The Trade Desk's technical specifications.
*   Support direct file uploads, including bulk uploads.
*   Integrate with Microsoft Sharepoint for scanning existing assets (including bulk selection).
*   Handle large file uploads efficiently, potentially leveraging Azure Blob Storage.
*   Present clear pass/fail results for each relevant specification check.
*   Reduce manual effort and potential errors in the creative QA process.

## 3. User Personas

*   **Ad Operations Specialist:** Needs to quickly verify creatives (often in batches) before trafficking campaigns.
*   **Creative Designer/Developer:** Needs to check if their assets meet requirements during the development phase.
*   **Account Manager:** May use it to assist clients or troubleshoot creative rejection issues.

## 4. Features

### 4.1 Core Scanning Engine

*   **Input:** Accept various creative file types (JPG, PNG, GIF, MP4, MOV, WebM, ZIP for HTML5, etc.).
*   **Analysis:**
    *   Detect creative type (Display, Video, HTML5, Audio, Native, etc.).
    *   **Video Type Designation:** For uploaded video files, prompt user to specify if the video is intended for CTV or standard Online Video (OLV) to apply the correct validation rules.
    *   Extract metadata: Dimensions, file size, duration, frame rate, bitrate, aspect ratio, audio specs, etc.
    *   For HTML5 (ZIP): Analyze internal structure, file count/size, primary HTML, `ad.size` meta tag, `clickTAG` implementation.
*   **Validation:** Compare extracted metadata against the rules defined in the Trade Desk `Creative_Specifications-en.pdf` for the determined creative type (and specified video type: CTV/OLV).
*   **Output:** Generate a detailed report showing pass/fail status for each checked specification per file.

### 4.2 File Input Methods

*   **Direct Upload:** Standard browser file upload input supporting single and multiple file selection.
*   **Sharepoint Integration:**
    *   Authenticate user via Microsoft Account (MSAL).
    *   Allow browsing/selecting single or multiple files from the user's Sharepoint sites/libraries (using Microsoft Graph API).
*   **Large File Handling (Azure):**
    *   Detect large files (threshold TBD, e.g., > 150MB).
    *   Initiate direct upload to Azure Blob Storage.
    *   Trigger backend analysis upon successful Azure upload.

### 4.3 User Interface

*   Clean, intuitive interface.
*   Clear options for selecting input source (Upload/Sharepoint).
*   Support for selecting multiple files for bulk processing.
*   **Post-Upload/Selection Confirmation:** Display a list of selected files before initiating the scan.
    *   For files identified as video, provide a clear option (e.g., checkbox/dropdown) next to each video to designate it as "Check against CTV Specs".
*   Progress indication during upload/analysis for individual files and the overall batch.
*   Well-formatted results display, clearly associating results with each file in a batch and highlighting issues.
*   **Creative Preview:** Allow users to preview uploaded assets (images, video, audio) directly within the application after scanning. For HTML5 assets, display the provided static backup image as the preview in V1.

## 5. Non-Functional Requirements

*   **Platform:** Web-based (Javascript).
*   **Security:** Secure handling of Microsoft credentials (MSAL/OAuth) and Azure credentials.
*   **Performance:** Reasonable processing time for analysis (especially for video). Handle large files and bulk uploads without crashing the browser or timing out unreasonably.
*   **Scalability:** Backend architecture should handle multiple concurrent users/scans (especially if using serverless functions).

## 6. Future Considerations (Out of Scope for V1)

*   Scanning DOOH or other less common types not fully detailed initially.
*   Deeper HTML5 analysis (e.g., validating specific JS interactions).
*   Integration with other storage providers.
*   Saving/sharing scan results.
*   User accounts/history.
