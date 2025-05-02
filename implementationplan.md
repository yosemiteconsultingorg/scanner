# Implementation Plan - Scanner Application

## 1. Overview

This document outlines the technical plan for building the Scanner application, a web-based tool for validating creative assets against Trade Desk specifications. It leverages direct Azure Blob Storage uploads for all files, Microsoft Sharepoint integration via Graph API, and a backend analysis engine.

## 2. Technology Stack

*   **Frontend:**
    *   Language: Javascript (ES6+) / Typescript (Recommended for type safety)
    *   Framework: React (Recommended for component-based UI, state management, and ecosystem)
    *   Styling: CSS Modules / Tailwind CSS / Styled Components (TBD based on preference)
    *   Authentication: `msal-browser` (Microsoft Authentication Library for JS)
    *   Azure SDK: `@azure/storage-blob` (for direct browser uploads)
    *   State Management: React Context API / Zustand / Redux Toolkit (TBD)
*   **Backend:**
    *   Platform: Node.js (LTS version)
    *   Framework: Azure Functions (Recommended for event-driven processing triggered by Blob storage, scalability, and integration)
    *   Language: Typescript (Recommended) / Javascript
    *   Azure SDKs:
        *   `@azure/storage-blob` (for accessing blobs for analysis, generating SAS URLs)
        *   `@azure/identity` (for managed identity/credentials)
    *   Microsoft Graph SDK: `@microsoft/microsoft-graph-client` (for Sharepoint access)
    *   File Analysis Libraries:
        *   Video/Audio: `fluent-ffmpeg` (requires FFmpeg/FFprobe installed on the Function App environment or container)
        *   Images: `image-size`
        *   ZIP: `adm-zip` or `jszip`
        *   HTML Parsing: `jsdom` (if needed for deep HTML5 analysis)
    *   Metadata Storage (Temporary): Azure Table Storage or Cosmos DB (for associating user choices like CTV designation with blob uploads).
*   **Infrastructure:**
    *   Azure Blob Storage: For all creative asset uploads.
    *   Azure Functions: To host backend API endpoints (SAS URL generation) and analysis logic (triggered by Blob uploads).
    *   Azure Active Directory: For Microsoft authentication.
    *   (Optional) Azure Static Web Apps: Convenient hosting for the React frontend, integrating with Azure Functions.
    *   (Optional) Azure Table Storage / Cosmos DB: For temporary metadata.

## 3. Development Phases & Tasks

### Phase 1: Core Setup & Frontend Foundation

*   [ ] **Task 1.1:** Initialize Frontend Project (e.g., `create-react-app` with Typescript).
*   [ ] **Task 1.2:** Set up basic UI layout (Header, upload area, results area).
*   [ ] **Task 1.3:** Implement direct file upload component (multiple files).
*   [ ] **Task 1.4:** Set up Azure Blob Storage account.
*   [ ] **Task 1.5:** Set up Backend Project (Azure Functions project with Typescript).
*   [ ] **Task 1.6:** Implement Backend API endpoint (Azure Function - HTTP Trigger) to generate SAS tokens/URLs for direct blob uploads.
*   [ ] **Task 1.7:** Integrate frontend uploader to use the SAS token endpoint and upload directly to Azure Blob Storage.
*   [ ] **Task 1.8:** Implement basic Azure Function triggered by Blob creation (logs file info for now).
*   [ ] **Task 1.9:** Implement UI to list selected/uploaded files and add the "Check against CTV Specs" checkbox for videos.
*   [ ] **Task 1.10:** Implement mechanism to pass/store the CTV designation alongside the upload request/blob metadata (e.g., via API call before upload or storing in Table Storage).

### Phase 2: Basic Analysis Engine & Results Display

*   [ ] **Task 2.1:** Enhance Blob Trigger Function:
    *   Retrieve associated CTV designation (from Blob metadata or Table Storage).
    *   Implement basic file type detection (based on extension/mime type).
    *   Integrate `image-size` library for image dimension/type checks.
    *   Implement file size check.
*   [ ] **Task 2.2:** Define data structure for analysis results.
*   [ ] **Task 2.3:** Implement backend endpoint/mechanism for frontend to get analysis results (e.g., polling status in Table Storage, SignalR/WebSockets).
*   [ ] **Task 2.4:** Implement frontend results display area showing basic pass/fail per file based on size/dimensions.
*   [ ] **Task 2.5:** Implement Backend API endpoint (Azure Function - HTTP Trigger) to generate read-only SAS URLs for specific blobs (for previewing).
*   [ ] **Task 2.6:** Implement frontend "Preview" button/link in results list and modal/panel to display previews (using `<img>`, `<video>`, `<audio>` tags with SAS URLs; display HTML5 backup image).

### Phase 3: Advanced Analysis (Video, HTML5)

*   [ ] **Task 3.1:** Integrate Video/Audio Analysis:
    *   Set up FFmpeg/FFprobe in the Azure Function environment (investigate custom container deployment).
    *   Integrate `fluent-ffmpeg` to extract duration, bitrate, frame rate, audio specs, resolution.
    *   Implement validation logic for Video/CTV specs based on user designation.
*   [ ] **Task 3.2:** Integrate HTML5 (ZIP) Analysis:
    *   Integrate ZIP library (`adm-zip`).
    *   Implement logic to check internal file count, sizes, presence of primary HTML, allowed file types.
    *   Implement check for `ad.size` meta tag within the primary HTML.
    *   Implement basic check for `clickTAG` variable usage.
    *   *V1*: Identify and store reference to the static backup image within the ZIP (for preview and validation).
*   [ ] **Task 3.3:** Enhance results display to show detailed pass/fail checks for Video and HTML5.

### Phase 4: Sharepoint Integration

*   [ ] **Task 4.1:** Set up Azure AD App Registration for Microsoft Graph permissions (Files.ReadWrite.All, Sites.Read.All - delegated).
*   [ ] **Task 4.2:** Integrate `msal-browser` into the frontend for user login/logout.
*   [ ] **Task 4.3:** Implement UI component for Sharepoint file picking (using Microsoft Graph API calls).
*   [ ] **Task 4.4:** Implement backend endpoint/logic to receive selected Sharepoint file details.
*   [ ] **Task 4.5:** Implement backend logic (Azure Function?) to fetch files from Sharepoint using Graph API (delegated token).
*   [ ] **Task 4.6:** Stream fetched Sharepoint files to Azure Blob Storage (triggering existing analysis function).

### Phase 5: Refinement & Deployment

*   [ ] **Task 5.1:** Implement robust error handling and user feedback.
*   [ ] **Task 5.2:** Styling and UI polishing.
*   [ ] **Task 5.3:** Add unit/integration tests.
*   [ ] **Task 5.4:** Set up CI/CD pipeline (e.g., GitHub Actions to Azure Static Web Apps / Azure Functions).
*   [ ] **Task 5.5:** Final testing and documentation.

## 4. Key Considerations & Risks

*   **FFmpeg on Azure Functions:** Running native binaries like FFmpeg/FFprobe on standard consumption plan Azure Functions can be tricky. May require deploying Functions via custom Docker containers. Needs early investigation (Phase 3.1).
*   **Graph API Permissions:** Ensuring the correct delegated permissions are requested and consented to by users for Sharepoint access.
*   **Analysis Complexity:** Some Trade Desk specs might be nuanced and require deeper analysis than initially planned for V1.
*   **Scalability:** Ensure Azure Function plans and Blob Storage tiers can handle expected load.
*   **Metadata Association:** Reliably linking the user's CTV choice to the file processed by the backend function needs a solid mechanism (Blob metadata or Table Storage).
