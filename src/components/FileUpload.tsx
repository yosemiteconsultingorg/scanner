import React, { useState, ChangeEvent } from 'react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void; // Changed from FileList to File[]
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected }) => {
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const filesArray = Array.from(event.target.files); // Convert FileList to File[]
      const names = filesArray.map(file => file.name);
      setSelectedFileNames(names);
      onFilesSelected(filesArray); // Pass the File[] up to the parent
    } else {
      setSelectedFileNames([]);
      onFilesSelected([]); // Pass empty array if no files or selection cancelled
    }
  };

  return (
    <div>
      <label htmlFor="file-upload">Select Files:</label>
      <input
        id="file-upload"
        type="file"
        multiple // Allow multiple file selection
        onChange={handleFileChange}
        style={{ display: 'block', marginTop: '10px' }}
      />
      {selectedFileNames.length > 0 ? (
        <div style={{ marginTop: '10px' }}>
          <p>Selected:</p>
          <ul>
            {selectedFileNames.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ marginTop: '10px' }}>
          <p>No files selected</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
