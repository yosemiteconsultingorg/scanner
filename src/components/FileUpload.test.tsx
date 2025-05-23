import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileUpload from './FileUpload';
import { describe, it, expect, vi } from 'vitest';

describe('FileUpload Component', () => {
  it('renders the file input', () => {
    render(<FileUpload onFilesSelected={() => {}} />);
    const inputElement = screen.getByLabelText(/select files/i);
    expect(inputElement).toBeInTheDocument();
  });

  it('calls onFilesSelected with the selected files', async () => {
    const mockOnFilesSelected = vi.fn();
    render(<FileUpload onFilesSelected={mockOnFilesSelected} />);
    
    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    const inputElement = screen.getByLabelText(/select files/i) as HTMLInputElement;

    await userEvent.upload(inputElement, file);

    expect(mockOnFilesSelected).toHaveBeenCalledTimes(1);
    expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('displays the names of selected files', async () => {
    render(<FileUpload onFilesSelected={() => {}} />);
    
    const file1 = new File(['file1'], 'file1.txt', { type: 'text/plain' });
    const file2 = new File(['file2'], 'file2.jpg', { type: 'image/jpeg' });
    const inputElement = screen.getByLabelText(/select files/i) as HTMLInputElement;

    await userEvent.upload(inputElement, [file1, file2]);

    expect(screen.getByText('Selected:')).toBeInTheDocument(); // Changed "Selected files:" to "Selected:"
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    expect(screen.getByText('file2.jpg')).toBeInTheDocument();
  });

  // Test for no files selected initially
  it('shows "No files selected" when no files are chosen', () => {
    render(<FileUpload onFilesSelected={() => {}} />);
    expect(screen.getByText('No files selected')).toBeInTheDocument();
  });
});
