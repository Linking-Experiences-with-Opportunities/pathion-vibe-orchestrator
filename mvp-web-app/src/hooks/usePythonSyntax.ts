"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Represents a syntax error found in Python code
 */
export interface PythonSyntaxError {
  /** 1-based line number where the error occurs */
  line: number;
  /** 0-based column number where the error starts */
  column: number;
  /** Optional end line number (for multi-line errors) */
  endLine?: number;
  /** Optional end column number */
  endColumn?: number;
  /** Human-readable error message */
  message: string;
  /** Type of syntax error */
  type: 'MISSING' | 'ERROR' | 'UNEXPECTED';
}

export type SyntaxParserStatus = 'initializing' | 'ready' | 'error';

interface UsePythonSyntaxOptions {
  /** Base URL for tree-sitter WASM files (default: '/tree-sitter/') */
  wasmBaseUrl?: string;
  /** Whether to auto-initialize the parser on mount (default: true) */
  autoInit?: boolean;
}

interface UsePythonSyntaxResult {
  /** Parse code and check for syntax errors */
  parse: (code: string) => PythonSyntaxError[];
  /** Whether the parser is ready to use */
  isReady: boolean;
  /** Current initialization status */
  status: SyntaxParserStatus;
  /** Manually initialize the parser */
  initialize: () => Promise<void>;
}

/**
 * React hook for fast Python syntax parsing using tree-sitter
 *
 * **Purpose**: Optimistic validation for Monaco editor markers (red squigglies).
 * Provides instant feedback while typing, but is NOT authoritative.
 *
 * **Two-stage validation architecture**:
 * 1. Tree-sitter (this hook) - Fast, optimistic, for UI markers only
 * 2. CPython ast.parse (useCanonicalSyntaxCheck) - Slow, authoritative, for execution gating
 *
 * This hook does NOT gate execution. Use useCanonicalSyntaxCheck for that.
 *
 * @example
 * ```tsx
 * const { parse, isReady } = usePythonSyntax();
 *
 * // Get errors for Monaco markers
 * const errors = parse(userCode);
 * const markers = errors.map(err => ({
 *   severity: monaco.MarkerSeverity.Error,
 *   startLineNumber: err.line + 1,  // Tree-sitter 0-based → Monaco 1-based
 *   startColumn: err.column + 1,
 *   endLineNumber: (err.endLine ?? err.line) + 1,
 *   endColumn: (err.endColumn ?? err.column) + 1,
 *   message: err.message,
 * }));
 * ```
 */
export function usePythonSyntax(options: UsePythonSyntaxOptions = {}): UsePythonSyntaxResult {
  const {
    wasmBaseUrl = '/tree-sitter/',
    autoInit = true,
  } = options;

  const [status, setStatus] = useState<SyntaxParserStatus>('initializing');
  const parserRef = useRef<any | null>(null);
  const pythonLanguageRef = useRef<any | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  /**
   * Initialize tree-sitter parser and load Python grammar
   */
  const initialize = useCallback(async () => {
    // Return existing initialization promise if already initializing
    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    // Already initialized
    if (status === 'ready') {
      return Promise.resolve();
    }

    const initPromise = (async () => {
      try {
        setStatus('initializing');
        console.log('[usePythonSyntax] Initializing tree-sitter parser...');

        // Dynamically import tree-sitter (Parser and Language are named exports)
        const TreeSitter = await import('web-tree-sitter');
        const { Parser, Language } = TreeSitter;

        console.log('[usePythonSyntax] TreeSitter module loaded');

        // Initialize tree-sitter WASM
        // Library requests "web-tree-sitter.wasm"; we serve "tree-sitter.wasm" from public/tree-sitter/
        await Parser.init({
          locateFile(scriptName: string) {
            const fileName =
              scriptName === "web-tree-sitter.wasm" ? "tree-sitter.wasm" : scriptName;
            const url = `${wasmBaseUrl}${fileName}`;
            console.log('[usePythonSyntax] Loading WASM file:', url);
            return url;
          },
        });

        console.log('[usePythonSyntax] Parser.init complete');

        // Create parser instance
        const parser = new Parser();
        parserRef.current = parser;
        console.log('[usePythonSyntax] Parser instance created');

        // Load Python language grammar
        const pythonWasmUrl = `${wasmBaseUrl}tree-sitter-python.wasm`;
        console.log('[usePythonSyntax] Loading Python grammar from:', pythonWasmUrl);
        const Python = await Language.load(pythonWasmUrl);
        pythonLanguageRef.current = Python;
        console.log('[usePythonSyntax] Python grammar loaded');

        // Set language on parser
        parser.setLanguage(Python);

        setStatus('ready');
        console.log('[usePythonSyntax] Parser ready');
      } catch (error) {
        console.error('[usePythonSyntax] Initialization failed:', error);
        setStatus('error');
        throw error;
      } finally {
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = initPromise;
    return initPromise;
  }, [wasmBaseUrl, status]);

  /**
   * Parse Python code and extract syntax errors
   */
  const parse = useCallback((code: string): PythonSyntaxError[] => {
    // Handle empty code
    if (!code || code.trim().length === 0) {
      return [];
    }

    // Parser not ready
    if (!parserRef.current || status !== 'ready') {
      console.warn('[usePythonSyntax] Parser not ready. Call initialize() first.');
      return [];
    }

    try {
      // Parse the code
      const tree = parserRef.current.parse(code);
      const errors: PythonSyntaxError[] = [];

      // Helper function to extract errors from nodes
      const extractErrors = (node: any) => {
        // Handle isMissing: some bindings expose it as a function, others as a boolean
        const isMissing = typeof node.isMissing === 'function'
          ? node.isMissing()
          : Boolean(node.isMissing);

        if (node.type === 'ERROR' || isMissing) {
          const errorType = isMissing ? 'MISSING' :
            node.type === 'ERROR' ? 'ERROR' : 'UNEXPECTED';

          // Generate helpful error message
          let message = 'Syntax error';
          if (isMissing) {
            message = `Missing ${node.type}`;
          } else if (node.parent) {
            // Try to provide context from parent node
            const parentType = node.parent.type;
            message = `Unexpected syntax in ${parentType}`;
          }

          // Add text preview if available
          const text = node.text;
          if (text && text.length > 0 && text.length < 50) {
            message += `: "${text}"`;
          }

          errors.push({
            line: node.startPosition.row + 1, // tree-sitter uses 0-based rows, Monaco uses 1-based
            column: node.startPosition.column, // tree-sitter uses 0-based columns
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            message,
            type: errorType,
          });
        }

        // Recursively check children
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            extractErrors(child);
          }
        }
      };

      // Start extraction from root
      extractErrors(tree.rootNode);

      return errors;
    } catch (error) {
      console.error('[usePythonSyntax] Parse error:', error);
      return [];
    }
  }, [status]);

  // Auto-initialize on mount if enabled
  useEffect(() => {
    if (autoInit && status === 'initializing') {
      initialize().catch(err => {
        console.error('[usePythonSyntax] Auto-initialization failed:', err);
      });
    }
  }, [autoInit, initialize, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (parserRef.current) {
        parserRef.current.delete();
        parserRef.current = null;
      }
      /*
      if (pythonLanguageRef.current) {
        // web-tree-sitter Language objects do not have a delete method
        // pythonLanguageRef.current.delete();
        pythonLanguageRef.current = null;
      }
      */
    };
  }, []);

  return {
    parse,
    isReady: status === 'ready',
    status,
    initialize,
  };
}
