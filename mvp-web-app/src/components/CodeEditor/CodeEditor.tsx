"use client";
import {Editor, useMonaco} from "@monaco-editor/react";
import React, {useEffect, useCallback, useMemo, useRef} from "react";
import {editor} from "monaco-editor";
import { createAutoSave } from "@/lib/utils/codePersistence";
import { EditorSignalsTracker } from "@/lib/editorSignals";
import { usePythonSyntax } from "@/hooks/usePythonSyntax";
import { logCodeAction } from "@/lib/actionLogger";

export type ProblemWindowTabOption = "Details" | "Solve" | "Problem" | "Test Cases"
export type ProblemWindowLanguageOption = "java" | "python" | "javascript"

interface CodeEditorProps {
    value?: string
    onChange?: (value: string | undefined, ev: editor.IModelContentChangedEvent) => void
    language: ProblemWindowLanguageOption
    autoSaveKey?: string
    autoSaveWaitTime?: number
    onAutoSave?: (code: string) => void
    readOnly?: boolean
    /** Optional editor signals tracker for copy/paste event tracking */
    signalsTracker?: EditorSignalsTracker
    /** Line number to highlight as the active debug step (1-based). Clears when undefined. */
    highlightLine?: number
    /** Line numbers that have breakpoints set (red dots in gutter). */
    breakpointLines?: number[]
    /** Called when user clicks the glyph margin to toggle a breakpoint. */
    onToggleBreakpoint?: (line: number) => void
}

const CodeEditor = ({onChange, value, language, autoSaveKey, autoSaveWaitTime = 400, onAutoSave, readOnly, signalsTracker, highlightLine, breakpointLines, onToggleBreakpoint}: CodeEditorProps) => {

    const monaco = useMonaco();
    const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);
    const debugDecorationsRef = useRef<string[]>([]);
    const breakpointDecorationsRef = useRef<string[]>([]);

    // Fast tree-sitter syntax parsing for Monaco markers (optimistic validation)
    const { parse: parseSyntax, isReady: parserReady } = usePythonSyntax();

    // Store onAutoSave in a ref to avoid recreating the debounced function when callback changes
    const onAutoSaveRef = useRef(onAutoSave);
    useEffect(() => {
        onAutoSaveRef.current = onAutoSave;
    }, [onAutoSave]);

    // Store onToggleBreakpoint in a ref so the mount callback doesn't go stale
    const onToggleBreakpointRef = useRef(onToggleBreakpoint);
    useEffect(() => {
        onToggleBreakpointRef.current = onToggleBreakpoint;
    }, [onToggleBreakpoint]);

    // Create memoized debounced save function - created ONCE and reused
    const debouncedSave = useMemo(() => {
        if (!autoSaveKey) return null;
        return createAutoSave(autoSaveWaitTime);
    }, [autoSaveKey, autoSaveWaitTime]);

    // Enhanced onChange handler with auto-save
    const handleChange = useCallback((value: string | undefined, ev: editor.IModelContentChangedEvent) => {
        onChange?.(value, ev);
        if (value && debouncedSave && autoSaveKey) {
            debouncedSave(autoSaveKey, value);
            onAutoSaveRef.current?.(value);
        }
    }, [onChange, autoSaveKey, debouncedSave]);

    // Handle value changes by updating the editor content
    useEffect(() => {
        if (editorRef.current && value !== undefined) {
            const currentValue = editorRef.current.getValue();
            if (currentValue !== value) {
                editorRef.current.setValue(value);
            }
        }
    }, [value]);

    // Lilo dark theme
    useEffect(() => {
        if (monaco) {
            monaco.editor.defineTheme('lilo-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'keyword', foreground: '3b82f6', fontStyle: 'bold' },
                    { token: 'identifier', foreground: 'd4d4d8' },
                    { token: 'type.identifier', foreground: '60a5fa' },
                    { token: 'string', foreground: 'a1a1aa' },
                    { token: 'number', foreground: 'eab308' },
                    { token: 'comment', foreground: '52525b', fontStyle: 'italic' },
                    { token: 'delimiter', foreground: '71717a' },
                ],
                colors: {
                    'editor.background': '#1e1e1e',
                    'editor.foreground': '#d4d4d8',
                    'editorLineNumber.foreground': '#52525b',
                    'editorLineNumber.activeForeground': '#a1a1aa',
                    'editorGutter.background': '#1e1e1e',
                    'editor.selectionBackground': '#3b82f633',
                    'editor.inactiveSelectionBackground': '#3b82f61a',
                    'editor.lineHighlightBackground': '#27272a',
                    'editor.lineHighlightBorder': '#00000000',
                    'editorCursor.foreground': '#3b82f6',
                    'scrollbarSlider.background': '#27272a80',
                    'scrollbarSlider.hoverBackground': '#3f3f46',
                    'scrollbarSlider.activeBackground': '#3b82f6',
                    'editorWidget.background': '#09090b',
                    'editorWidget.border': '#27272a',
                    'editorIndentGuide.background': '#27272a',
                    'editorIndentGuide.activeBackground': '#3f3f46',
                },
            });
            monaco.editor.setTheme('lilo-dark');
        }
    }, [monaco]);

    // Handle editor mount: copy/paste tracking + glyph margin click for breakpoints
    const handleEditorMount = useCallback((ed: editor.IStandaloneCodeEditor) => {
        editorRef.current = ed;

        // Paste tracking
        if (signalsTracker) {
            ed.onDidPaste((e) => {
                const model = ed.getModel();
                if (model && e.range) {
                    const pastedText = model.getValueInRange(e.range);
                    signalsTracker.recordPaste(pastedText.length);
                    logCodeAction("code_paste", "editor", { charCount: pastedText.length });
                }
                
            });
        }

        // Glyph margin click → toggle breakpoint
        ed.onMouseDown((e) => {
            if (
                e.target.type === monaco?.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                e.target.type === monaco?.editor.MouseTargetType.GUTTER_LINE_NUMBERS
            ) {
                const line = e.target.position?.lineNumber;
                if (line && onToggleBreakpointRef.current) {
                    onToggleBreakpointRef.current(line);
                }
            }
        });
    }, [signalsTracker, monaco]);

    // Copy event listener on the editor's DOM container
    useEffect(() => {
        if (!signalsTracker || !editorRef.current) return;

        const domNode = editorRef.current.getDomNode();
        if (!domNode) return;

        const handleCopy = () => {
            const ed = editorRef.current;
            if (!ed) return;
            const selection = ed.getSelection();
            const model = ed.getModel();
            if (selection && model && !selection.isEmpty()) {
                const selectedText = model.getValueInRange(selection);
                signalsTracker.recordCopyWithHash(selectedText);
                // Log to action tracker
                logCodeAction("code_copy", "editor", { charCount: selectedText.length });
            }
        };

        domNode.addEventListener('copy', handleCopy);
        return () => {
            domNode.removeEventListener('copy', handleCopy);
        };
    }, [signalsTracker]);

    // Debug line highlighting via deltaDecorations
    useEffect(() => {
        const ed = editorRef.current;
        if (!ed || !monaco) return;

        if (highlightLine == null) {
            debugDecorationsRef.current = ed.deltaDecorations(debugDecorationsRef.current, []);
            return;
        }

        debugDecorationsRef.current = ed.deltaDecorations(debugDecorationsRef.current, [
            {
                range: new monaco.Range(highlightLine, 1, highlightLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'debug-line-highlight',
                    glyphMarginClassName: 'debug-line-glyph',
                    overviewRuler: {
                        color: '#eab30880',
                        position: monaco.editor.OverviewRulerLane.Full,
                    },
                },
            },
        ]);

        ed.revealLineInCenterIfOutsideViewport(highlightLine);
    }, [highlightLine, monaco]);

    // Breakpoint decorations (red dots in glyph margin)
    useEffect(() => {
        const ed = editorRef.current;
        if (!ed || !monaco) return;

        const lines = breakpointLines ?? [];

        if (lines.length === 0) {
            breakpointDecorationsRef.current = ed.deltaDecorations(breakpointDecorationsRef.current, []);
            return;
        }

        const decorations = lines.map((line) => ({
            range: new monaco.Range(line, 1, line, 1),
            options: {
                isWholeLine: false,
                glyphMarginClassName: 'breakpoint-glyph',
                overviewRuler: {
                    color: '#ef444480',
                    position: monaco.editor.OverviewRulerLane.Left,
                },
            },
        }));

        breakpointDecorationsRef.current = ed.deltaDecorations(breakpointDecorationsRef.current, decorations);
    }, [breakpointLines, monaco]);

    // Set Monaco markers for syntax errors (tree-sitter - fast, optimistic)
    useEffect(() => {
        if (!monaco || !editorRef.current || !parserReady || language !== 'python') {
            return;
        }

        const model = editorRef.current.getModel();
        if (!model) return;

        const syntaxErrors = parseSyntax(value || '');

        if (syntaxErrors.length === 0) {
            monaco.editor.setModelMarkers(model, 'python-syntax', []);
            return;
        }

        const markers: editor.IMarkerData[] = syntaxErrors.map(err => {
            const startLine = err.line + 1;
            const startCol = err.column + 1;
            const endLine = (err.endLine ?? err.line) + 1;
            let endCol = (err.endColumn ?? err.column) + 1;
            if (startLine === endLine && startCol === endCol) {
                endCol = startCol + 1;
            }
            return {
                severity: monaco.MarkerSeverity.Error,
                message: err.message,
                startLineNumber: startLine,
                startColumn: startCol,
                endLineNumber: endLine,
                endColumn: endCol,
                source: 'python-syntax',
            };
        });

        monaco.editor.setModelMarkers(model, 'python-syntax', markers);
    }, [monaco, value, parseSyntax, parserReady, language]);

    return (
        <>
        {/* Debug + breakpoint styles for Monaco decorations */}
        <style>{`
            .debug-line-highlight {
                background-color: rgba(234, 179, 8, 0.15) !important;
                border-left: 3px solid #eab308 !important;
            }
            .debug-line-glyph {
                background-color: #eab308;
                border-radius: 50%;
                margin-left: 4px;
                width: 8px !important;
                height: 8px !important;
                margin-top: 8px;
            }
            .breakpoint-glyph {
                background-color: #ef4444;
                border-radius: 50%;
                width: 10px !important;
                height: 10px !important;
                margin-left: 3px;
                margin-top: 7px;
                cursor: pointer;
                box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
            }
        `}</style>
        <Editor
            height="100%"
            defaultLanguage={language}
            value={value}
            theme="lilo-dark"
            onChange={handleChange}
            onMount={handleEditorMount}
            options={{
                readOnly: readOnly || false,
                minimap: { enabled: false },
                fontSize: 14,
                lineHeight: 24,
                fontFamily: 'monospace',
                padding: { top: 16 },
                glyphMargin: true,
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 2,
                    verticalSliderSize: 8,
                    horizontalSliderSize: 2,
                    handleMouseWheel: true,
                    alwaysConsumeMouseWheel: false,
                },
            }}
        />
        </>
    )
}

export default CodeEditor;
