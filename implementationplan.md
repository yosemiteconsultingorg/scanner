# Implementation Plan - Scanner Application

## 1. Overview

This document outlines the technical plan for building the Scanner application, a web-based tool for validating creative assets against Trade Desk specifications. It leverages direct Azure Blob Storage uploads for all files, Microsoft Sharepoint integration via Graph API, and a backend analysis engine.

## 2. Technology Stack

*   **Frontend:**
    *   Language: Typescript
    *   Framework: React (with Vite)
    *   Styling: CSS (as per `App.css`, `index.css`)
    *   Authentication: `msal-browser` (Microsoft Authentication Library for JS)
    *   Microsoft Graph Toolkit: `@microsoft/mgt-react` and `@microsoft/mgt-msal2-provider` for Sharepoint integration.
    *   Azure SDK: `@azure/storage-blob` (for direct browser uploads - currently using XHR in `App.tsx`)
    *   State Management: React Context API / `useState` (current approach)
*   **Backend:**
    *   Platform: Node.js
    *   Framework: Azure Functions (Typescript)
    *   Azure SDKs:
        *   `@azure/storage-blob`
        *   `@azure/data-tables`
        *   `@azure/identity` (for OBO credential)
    *   Microsoft Graph SDK: `@microsoft/microsoft-graph-client`
    *   File Analysis Libraries:
        *   Video/Audio: `fluent-ffmpeg`
        *   Images: `image-size`
        *   ZIP: `adm-zip`
    *   Metadata Storage: Azure Table Storage (`CreativeMetadata`, `AnalysisResults` tables)
*   **Infrastructure:**
    *   Azure Blob Storage: `files-processing` container.
    *   Azure Functions: HTTP and Blob triggers.
    *   Azure Active Directory: For Microsoft authentication.
    *   Azure Table Storage: For metadata and results.

## 3. Development Phases & Tasks

### Phase 1: Core Setup & Frontend Foundation

*   [x] **Task 1.1:** Initialize Frontend Project (Vite with React & Typescript).
    *   *Note: Project uses Vite.*
*   [x] **Task 1.2:** Set up basic UI layout (Header, upload area, results area).
    *   *Implemented in `App.tsx` and styled with `App.css`.*
*   [x] **Task 1.3:** Implement direct file upload component (multiple files).
    *   *Implemented in `src/components/FileUpload.tsx` and used in `App.tsx`.*
*   [x] **Task 1.4:** Set up Azure Blob Storage account.
    *   *Assumed done; backend functions reference `AzureWebJobsStorage_ConnectionString` and `files-processing` container.*
*   [x] **Task 1.5:** Set up Backend Project (Azure Functions project with Typescript).
    *   *Evident from `api/` directory structure and files.*
*   [x] **Task 1.6:** Implement Backend API endpoint (Azure Function - HTTP Trigger) to generate SAS tokens/URLs for direct blob uploads.
    *   *Implemented in `api/src/functions/generateUploadUrl.ts`.*
*   [x] **Task 1.7:** Integrate frontend uploader to use the SAS token endpoint and upload directly to Azure Blob Storage.
    *   *Implemented in `App.tsx` (`handleStartScan` and `uploadFileWithProgress`).*
*   [x] **Task 1.8:** Implement basic Azure Function triggered by Blob creation.
    *   *`api/src/functions/analyzeCreative.ts` is a blob-triggered function that performs full analysis.*
*   [x] **Task 1.9:** Implement UI to list selected/uploaded files and add the "Check against CTV Specs" checkbox for videos.
    *   *Implemented in `App.tsx`.*
*   [x] **Task 1.10:** Implement mechanism to pass/store the CTV designation alongside the upload request/blob metadata.
    *   *Implemented with `api/src/functions/setCreativeMetadata.ts` (Table Storage) and called from `App.tsx`.*

### Phase 2: Basic Analysis Engine & Results Display

*   [x] **Task 2.1:** Enhance Blob Trigger Function:
    *   Retrieve associated CTV designation (from Table Storage).
    *   Implement file type detection (using `file-type` library and extension fallback).
    *   Integrate `image-size` library for image dimension/type checks.
    *   Implement file size check.
    *   *All implemented in `api/src/functions/analyzeCreative.ts`.*
*   [x] **Task 2.2:** Define data structure for analysis results.
    *   *Interfaces `AnalysisResult`, `AnalysisData`, `ResultTableEntity` defined in frontend and backend.*
*   [x] **Task 2.3:** Implement backend endpoint/mechanism for frontend to get analysis results.
    *   *`api/src/functions/getAnalysisResult.ts` endpoint and polling logic in `App.tsx` (`pollForResult`).*
*   [x] **Task 2.4:** Implement frontend results display area showing basic pass/fail per file based on size/dimensions.
    *   *Implemented in `App.tsx` rendering `analysisResult` data.*
*   [x] **Task 2.5:** Implement Backend API endpoint (Azure Function - HTTP Trigger) to generate read-only SAS URLs for specific blobs (for previewing).
    *   *Implemented in `api/src/functions/getPreviewUrl.ts`.*
*   [x] **Task 2.6:** Implement frontend "Preview" button/link in results list and modal/panel to display previews.
    *   *Implemented in `App.tsx` with `handlePreviewClick` and modal display logic, including HTML5 backup image preview.*

### Phase 3: Advanced Analysis (Video, HTML5)

*   [x] **Task 3.1:** Integrate Video/Audio Analysis:
    *   Set up FFmpeg/FFprobe in the Azure Function environment (investigate custom container deployment).
        *   *Note: Code integration of `fluent-ffmpeg` is done in `analyzeCreative.ts`. Actual FFmpeg/FFprobe availability in Azure Function environment is a deployment concern noted in risks.*
    *   Integrate `fluent-ffmpeg` to extract duration, bitrate, frame rate, audio specs, resolution.
    *   Implement validation logic for Video/CTV specs based on user designation.
    *   *All implemented in `api/src/functions/analyzeCreative.ts` (`validateAudio`, `validateVideoOlv`, `validateVideoCtv`).*
*   [x] **Task 3.2:** Integrate HTML5 (ZIP) Analysis:
    *   Integrate ZIP library (`adm-zip`).
    *   Implement logic to check internal file count, sizes, presence of primary HTML, allowed file types.
    *   Implement check for `ad.size` meta tag within the primary HTML.
    *   Implement basic check for `clickTAG` variable usage.
    *   Identify and store reference to the static backup image within the ZIP (extracted to `extractedBackupBlobName` and used for preview).
    *   *All implemented in `api/src/functions/analyzeCreative.ts` (`validateHtml5`).*
*   [x] **Task 3.3:** Enhance results display to show detailed pass/fail checks for Video and HTML5.
    *   *`App.tsx` displays all `validationChecks` from the backend, which are detailed for all types.*

### Phase 4: Sharepoint Integration

*   [x] **Task 4.1:** Set up Azure AD App Registration for Microsoft Graph permissions.
    *   *Assumed done; `src/authConfig.ts` contains necessary client/tenant IDs and scopes.*
*   [x] **Task 4.2:** Integrate `msal-browser` into the frontend for user login/logout.
    *   *Implemented in `src/main.tsx` and `src/App.tsx`.*
*   [x] **Task 4.3:** Implement UI component for Sharepoint file picking (using Microsoft Graph Toolkit).
    *   *Implemented in `App.tsx` using MGT's `<FileList>` component and event listeners for selection.*
*   [x] **Task 4.4:** Implement backend endpoint/logic to receive selected Sharepoint file details.
    *   *`api/src/functions/processSharepointFiles.ts` HTTP POST endpoint.*
*   [x] **Task 4.5:** Implement backend logic (Azure Function) to fetch files from Sharepoint using Graph API (delegated OBO token).
    *   *Implemented in `api/src/functions/processSharepointFiles.ts`.*
*   [x] **Task 4.6:** Stream fetched Sharepoint files to Azure Blob Storage (triggering existing analysis function).
    *   *Implemented in `api/src/functions/processSharepointFiles.ts`. Also stores `isCtv` metadata and preliminary error status if SP fetch/upload fails.*

### Phase 5: Refinement & Deployment

*   [/] **Task 5.1:** Implement robust error handling and user feedback.
    *   *Some error handling exists in frontend and backend. This is an ongoing task.*
    *   [ ] Further improve UI feedback for errors.
    *   [ ] Add more comprehensive backend error logging/reporting.
*   [/] **Task 5.2:** Styling and UI polishing.
    *   *Base styling exists. UI is functional. This is subjective and ongoing.*
    *   [ ] Conduct UI/UX review and implement improvements.
*   [ ] **Task 5.3:** Implement Testing Strategy.
    *   **Unit Tests - Frontend (React):**
        *   [ ] `FileUpload.tsx`: Test file selection, name display, `onFilesSelected` callback.
        *   [ ] `App.tsx` (core logic):
            *   [ ] State updates for file selection (`handleFilesSelected`).
            *   [ ] CTV toggle logic (`handleCtvToggle`).
            *   [ ] Scan initiation logic (`handleStartScan` - mock API calls).
            *   [ ] Polling logic (`pollForResult` - mock API calls).
            *   [ ] Results rendering logic (given mock `analysisResult` data).
            *   [ ] Preview modal logic (`handlePreviewClick`, modal visibility).
            *   [ ] MSAL integration mocks (login/logout button states).
            *   [ ] Sharepoint file selection display.
    *   **Unit Tests - Backend (Azure Functions):**
        *   [ ] `generateUploadUrl.ts`: Test SAS URL generation logic, input validation.
        *   [ ] `setCreativeMetadata.ts`: Test Table Storage interaction, input validation.
        *   [ ] `analyzeCreative.ts`:
            *   [ ] Test `validateDisplay` with various inputs.
            *   [ ] Test `validateAudio` with mock ffprobe data.
            *   [ ] Test `validateVideoOlv` with mock ffprobe data.
            *   [ ] Test `validateVideoCtv` with mock ffprobe data.
            *   [ ] Test `validateHtml5` with mock zip data (using `adm-zip` in tests).
            *   [ ] Test file type detection logic.
            *   [ ] Test metadata retrieval from Table Storage (mocked).
            *   [ ] Test results storage in Table Storage (mocked).
        *   [ ] `getAnalysisResult.ts`: Test Table Storage interaction, result reconstruction.
        *   [ ] `getPreviewUrl.ts`: Test SAS URL generation for preview.
        *   [ ] `processSharepointFiles.ts`:
            *   [ ] Test OBO token handling (mocked).
            *   [ ] Test Graph API interaction for file fetching (mocked).
            *   [ ] Test Blob Storage upload (mocked).
            *   [ ] Test Table Storage interaction for metadata/error status.
    *   **Integration Tests:**
        *   [ ] Frontend `handleStartScan` to backend `generateUploadUrl` and `setCreativeMetadata` flow.
        *   [ ] Frontend polling (`pollForResult`) to backend `getAnalysisResult` flow.
        *   [ ] Backend `analyzeCreative` interaction with Azure Table Storage (live or emulated).
        *   [ ] Backend `processSharepointFiles` interaction with Graph API (requires careful setup or mocking for automated tests) and Azure Blob/Table Storage.
*   [ ] **Task 5.4:** Set up CI/CD pipeline (e.g., GitHub Actions to Azure Static Web Apps / Azure Functions).
    *   [ ] Include test execution steps in CI pipeline.
*   [/] **Task 5.5:** Perform End-to-End (E2E) Testing & Documentation.
    *   *PRD, README, VERCEL_DEPLOYMENT.md exist. Manual E2E testing is ongoing.*
    *   **E2E Test Scenarios (Manual or Automated with tools like Playwright/Cypress):**
        *   [ ] **E2E 1:** Direct Upload - Valid Display Image (JPG/PNG) - Full flow from upload to preview.
        *   [ ] **E2E 2:** Direct Upload - Valid Video OLV (MP4) - Full flow, check OLV specs.
        *   [ ] **E2E 3:** Direct Upload - Valid Video CTV (MP4) - Full flow, check CTV specs.
        *   [ ] **E2E 4:** Direct Upload - Valid HTML5 ZIP - Full flow, check HTML5 specs, preview backup.
        *   [ ] **E2E 5:** Direct Upload - Invalid File (e.g., oversized, wrong dimensions) - Verify correct "Fail" results.
        *   [ ] **E2E 6:** Direct Upload - Multiple files (mix of valid/invalid) - Verify all are processed and results shown.
        *   [ ] **E2E 7:** Sharepoint Integration - Login, select a file, start scan. Verify backend processing (manual check of logs/storage if frontend feedback is limited).
        *   [ ] **E2E 8:** Error Handling - Simulate upload failure (e.g., invalid SAS URL if possible to force, or network interruption) - Verify UI feedback.
        *   [ ] **E2E 9:** Error Handling - Simulate analysis error (e.g., malformed file that crashes a library if possible, or manually insert error record in Table) - Verify UI feedback.
    *   [ ] Update/create user documentation based on final features.
    *   [ ] Update/create user documentation.
    *   [ ] Update technical documentation.

## 4. Key Considerations & Risks

*   **FFmpeg on Azure Functions:** Running native binaries like FFmpeg/FFprobe on standard consumption plan Azure Functions can be tricky. May require deploying Functions via custom Docker containers. Needs early investigation (Phase 3.1).
    *   *Status: Code uses `fluent-ffmpeg`. Deployment solution for FFmpeg itself is still a risk.*
*   **Graph API Permissions:** Ensuring the correct delegated permissions are requested and consented to by users for Sharepoint access.
    *   *Status: Scopes are defined in `authConfig.ts`. Consent flow handled by MSAL.*
*   **Analysis Complexity:** Some Trade Desk specs might be nuanced and require deeper analysis than initially planned for V1.
    *   *Status: Current analysis covers many specs from PRD. Ongoing review against `Creative_Specifications-en.pdf` needed.*
*   **Scalability:** Ensure Azure Function plans and Blob Storage tiers can handle expected load.
    *   *Status: Current setup uses standard Azure services. Load testing would be beneficial.*
*   **Metadata Association:** Reliably linking the user's CTV choice to the file processed by the backend function needs a solid mechanism (Blob metadata or Table Storage).
    *   *Status: Implemented using Azure Table Storage (`CreativeMetadata` table).*
*   **Sharepoint File Processing Feedback:** The PRD mentions "Progress indication during upload/analysis for individual files and the overall batch." For Sharepoint files, the current implementation in `App.tsx` shows "Backend will process... Results will appear when ready (feature not fully implemented)."
    *   [ ] **Task (New):** Implement frontend polling or real-time updates for Sharepoint file analysis status. This would involve the `processSharepointFiles` function potentially creating initial "Processing" entries in the `AnalysisResults` table that the frontend can then poll, similar to direct uploads.
