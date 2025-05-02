import React, { useState, ChangeEvent } from 'react';

interface FileUploadProps {
  onFilesSelected: (files: FileList) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected }) => {
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files = event.target.files;
      const names = Array.from(files).map(file => file.name);
      setSelectedFileNames(names);
      onFilesSelected(files); // Pass the FileList up to the parent
    } else {
      setSelectedFileNames([]);
      // Handle case where files might be null if selection is cancelled
      // Depending on desired behavior, might need to pass null or empty list up
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
      {selectedFileNames.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <p>Selected:</p>
          <ul>
            {selectedFileNames.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
