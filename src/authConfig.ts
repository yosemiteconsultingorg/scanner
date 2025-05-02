import { Configuration, LogLevel } from "@azure/msal-browser";

// MSAL configuration
export const msalConfig: Configuration = {
    auth: {
        clientId: "5e7495d1-4f14-4878-b01a-8da624d99677", // Application (client) ID from Azure AD App Registration
        authority: "https://login.microsoftonline.com/1dccbf7a-4960-4303-a2ad-89f695c62e97", // Directory (tenant) ID
        redirectUri: window.location.origin, // Use the current origin as redirect URI (works for localhost and deployed app)
        postLogoutRedirectUri: window.location.origin, // Redirect here after logout
        navigateToLoginRequestUrl: false, // Avoids navigating away from the app for login
    },
    cache: {
        cacheLocation: "sessionStorage", // "localStorage" or "sessionStorage"
        storeAuthStateInCookie: false, // Set to true for environments where third-party cookies are blocked
    },
    system: {
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) {
                    return;
                }
                switch (level) {
                    case LogLevel.Error:
                        console.error(message);
                        return;
                    case LogLevel.Info:
                        // console.info(message); // Avoid too much noise
                        return;
                    case LogLevel.Verbose:
                        console.debug(message);
                        return;
                    case LogLevel.Warning:
                        console.warn(message);
                        return;
                    default:
                        return;
                }
            },
             logLevel: LogLevel.Warning // Adjust log level as needed (Verbose for debugging)
        }
    }
};

// Define the scopes required for Microsoft Graph API calls
// Ensure these match the permissions granted in the Azure AD App Registration
export const graphScopes = {
    loginRequest: [
        "openid",
        "profile",
        "User.Read", // Basic profile info
        "Files.Read", // Read user's files
        "Files.Read.All", // Read all files user can access
        "Sites.Read.All", // Read site collections user can access
        "api://5e7495d1-4f14-4878-b01a-8da624d99677/access_scanner_api" // Scope for backend API
        // Add "offline_access" if refresh tokens are needed and configured
    ]
};

// Optional: Define endpoints for MS Graph API calls
export const graphEndpoints = {
    graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
    // Add endpoints for file browsing/reading later
};
