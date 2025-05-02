// src/mgt.d.ts
import * as React from 'react';

// Extend the IntrinsicElements interface to include MGT components used directly as tags
declare global {
  namespace JSX {
    interface IntrinsicElements {
      // Define the mgt-file-list tag
      // Using 'any' for attributes is a common workaround when specific typings are complex or unavailable
      'mgt-file-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'item-path'?: string;
        'enable-file-upload'?: string; // Attributes are typically strings
        'page-size'?: string;
        // Add other kebab-case attributes if needed
      }, HTMLElement>;

      // Add other MGT tags here if you use them directly, e.g., 'mgt-login'
    }
  }
}

// Export empty object to make this file a module
export {};
