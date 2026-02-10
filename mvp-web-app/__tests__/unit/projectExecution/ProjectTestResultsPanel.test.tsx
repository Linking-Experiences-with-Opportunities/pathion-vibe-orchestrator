import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTestResultsPanel } from '@/components/ProjectPageRevamped/ProjectTestResultsPanel';
import { runProjectTestCases } from '@/components/ProjectPageRevamped/projectActions';
import { mockProjectData, mockSuccessTestResults, mockFailedTestResults } from '../../fixtures/projectData';
import { toast } from 'sonner';

jest.mock('@/components/ProjectPageRevamped/projectActions');
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

describe('ProjectTestResultsPanel', () => {
  const defaultProps = {
    projectData: mockProjectData,
    activeTestTab: 'tests',
    setActiveTestTab: jest.fn(),
    files: {
      "calculator.py": "def add(a, b): return a + b\ndef multiply(a, b): return a * b",
      "test_calculator.py": mockProjectData.testFile.content
    },
    handleSubmitCode: jest.fn(),
    submissionLoading: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render test cases from project data', () => {
    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    expect(screen.getByText('Test Cases')).toBeInTheDocument();
    expect(screen.getByText('add')).toBeInTheDocument();
    expect(screen.getByText('multiply')).toBeInTheDocument();
  });

  it('should run all tests when Run All button is clicked', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: mockSuccessTestResults,
      stdout: 'test output',
      stderr: ''
    });

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    await waitFor(() => {
      expect(runProjectTestCases).toHaveBeenCalledWith(
        mockProjectData,
        defaultProps.files,
        -1,
        true,
        false,
        ''
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('🎉 All 2 tests passed!');
    });
  });

  it('should run individual test when test case is clicked', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: [mockSuccessTestResults[0]],
      stdout: 'test output',
      stderr: ''
    });

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    // First "Run" button is header (Run All); second is first test case row
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    expect(runButtons.length).toBeGreaterThan(1);
    fireEvent.click(runButtons[1]);

    await waitFor(() => {
      expect(runProjectTestCases).toHaveBeenCalledWith(
        mockProjectData,
        defaultProps.files,
        0,
        false,
        false,
        ''
      );
    });
  });

  it('should handle failed tests correctly', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: mockFailedTestResults,
      stdout: 'test output',
      stderr: ''
    });

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('1/2 tests passed');
    });
  });

  it('should disable buttons while running tests', async () => {
    (runProjectTestCases as jest.Mock).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        testResults: mockSuccessTestResults,
        stdout: 'test output',
        stderr: ''
      }), 100))
    );

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    // Button should be disabled while running
    expect(runAllButton).toBeDisabled();

    await waitFor(() => {
      expect(runAllButton).not.toBeDisabled();
    });
  });

  it('should handle submit action', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: mockSuccessTestResults,
      stdout: 'test output',
      stderr: ''
    });

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const submitButton = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(runProjectTestCases).toHaveBeenCalledWith(
        mockProjectData,
        defaultProps.files,
        -1,
        true,
        true, // Submit flag should be true
        '',
        undefined // editor signals when signalsTracker not provided
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('🎉 Submitted! All 2 tests passed!');
    });
  });

  it('should display test results after running', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: mockFailedTestResults,
      stdout: 'test output',
      stderr: ''
    });

    const { rerender } = render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    await waitFor(() => {
      expect(runProjectTestCases).toHaveBeenCalled();
    });

    // The component should have updated with test results
    // Check for visual indicators of pass/fail status
    const testCaseElements = screen.getAllByText(/add|multiply/);
    expect(testCaseElements).toHaveLength(2);
  });

  it('should show output tab content', async () => {
    (runProjectTestCases as jest.Mock).mockResolvedValue({
      testResults: mockSuccessTestResults,
      stdout: 'test output',
      stderr: ''
    });

    const { rerender } = render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    await waitFor(() => {
      expect(runProjectTestCases).toHaveBeenCalled();
    });

    // Switch to output tab by changing the activeTestTab prop
    rerender(<ProjectTestResultsPanel {...defaultProps} activeTestTab="output" />);

    // Output tab shows combined test result printed values
    expect(screen.getByText(/Test passed/)).toBeInTheDocument();
  });

  it('should handle errors gracefully', async () => {
    (runProjectTestCases as jest.Mock).mockRejectedValue(new Error('Test execution failed'));

    render(<ProjectTestResultsPanel {...defaultProps} />);
    
    const runButtons = screen.getAllByRole('button', { name: /^run$/i });
    const runAllButton = runButtons[0];
    fireEvent.click(runAllButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('There was a problem running all test cases.');
    });
  });

  it('should respect submission loading state', () => {
    const propsWithLoading = { ...defaultProps, submissionLoading: true };
    render(<ProjectTestResultsPanel {...propsWithLoading} />);
    
    // The submissionLoading prop is passed to TestCasesList to disable individual test buttons
    const testButtons = screen.getAllByRole('button');
    const individualRunButtons = testButtons.filter(btn => 
      btn.textContent === 'Run' && !btn.textContent.includes('all')
    );
    
    // Individual test buttons should be disabled during submission
    individualRunButtons.forEach(button => {
      expect(button).toBeDisabled();
    });
  });
});
