import token from '../src/token.js';

token("test-editor", ({ initialCode, title, expectedOutput }) => {
    //expectedOutput is the code that should be seen rendered in the iframe when the check button is clicked
    //(after cleaning both up from whitespace that could make a correct output test wrong)
    //if not present no check button is shown

    const editor = signal(null);
    const previewIframe = signal(null);
    const editorInstance = signal(null);
    const monacoLoaded = signal(false);

    // Helper function to trim whitespace
    function trimWhitespace(str) {
        const lines = str.trim().split('\n');
        const whitespace = lines.map(line => ({ whitespace: line.match(/^\s*/)[0].length, line }));
        const lastLineWhitespace = whitespace[whitespace.length - 1].whitespace;
        const newLines = whitespace.map(({ whitespace, line }) => line.slice(Math.min(whitespace, lastLineWhitespace)));
        return newLines.join('\n');
    }

    effect(() => {
        if (editorInstance.v && initialCode.v) {
            editorInstance.v.setValue(trimWhitespace(initialCode.v).trim());
        }
    });

    // Debounce function for editor updates
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Update preview function
    function updatePreview() {
        if (!editorInstance.v || !previewIframe.v) return;

        const userCode = editorInstance.v.getValue();

        // Construct the HTML for the iframe
        const iframeHtml = trimWhitespace(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Preview</title>
                <script>
                    // Capture all errors to console
                    window.addEventListener('error', function(event) {
                        window.parent.postMessage({
                            source: "iframe-console",
                            type: "error",
                            args: [event.message + " in " + (event.filename || "unknown file") + " line " + event.lineno]
                        }, "*");
                    });
                    
                    // Capture unhandled promise rejections
                    window.addEventListener('unhandledrejection', function(event) {
                        window.parent.postMessage({
                            source: "iframe-console",
                            type: "error",
                            args: ["Unhandled Promise Rejection: " + (event.reason || "Unknown reason")]
                        }, "*");
                    });
                    
                    // Override console methods before any code runs
                    (function() {
                        // Save original console methods
                        const _log = console.log;
                        const _warn = console.warn;
                        const _error = console.error;
                        const _info = console.info;
                        
                        // Override console methods
                        console.log = function() {
                            window.parent.postMessage({
                                source: "iframe-console",
                                type: "log",
                                args: Array.from(arguments).map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
                            }, "*");
                            _log.apply(console, arguments);
                        };
                        
                        console.warn = function() {
                            window.parent.postMessage({
                                source: "iframe-console",
                                type: "warn",
                                args: Array.from(arguments).map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
                            }, "*");
                            _warn.apply(console, arguments);
                        };
                        
                        console.error = function() {
                            window.parent.postMessage({
                                source: "iframe-console",
                                type: "error",
                                args: Array.from(arguments).map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
                            }, "*");
                            _error.apply(console, arguments);
                        };
                        
                        console.info = function() {
                            window.parent.postMessage({
                                source: "iframe-console",
                                type: "info",
                                args: Array.from(arguments).map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
                            }, "*");
                            _info.apply(console, arguments);
                        };
                    })();
                </script>
                <script type="importmap">{"imports":{"./token.js": "../src/token.js"}}</script>
                <style>
                    html, body {
                        height: 100%;
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    body {
                        display: flex;
                        flex-direction: column;
                        padding: 8px;
                    }
                </style>
            </head>
            <body>
                ${userCode}
            </body>
            </html>`).trim();

        // Update the iframe content
        previewIframe.v.srcdoc = iframeHtml;
    }

    const consoleEvent = computed.fromEvent(window, 'message');
    const consoleEventLog = signal([]);

    // Fix the console event handler to properly store messages
    effect(() => {
        const event = consoleEvent.v;
        if (event && event.data && event.data.source === "iframe-console") {
            // Extract the relevant properties
            console.log(event.data);

            const { type, args } = event.data;

            // Add to log with timestamp
            consoleEventLog.v = [...consoleEventLog.v, {
                type,
                message: args.join(' '),
                timestamp: new Date().toLocaleTimeString()
            }];

            // Limit log size to prevent memory issues
            if (consoleEventLog.v.length > 100) {
                consoleEventLog.v = consoleEventLog.v.slice(-100);
            }
        }
    });


    // Create debounced update function
    const debouncedUpdatePreview = debounce(updatePreview, 1000);

    // Initialize Monaco editor when elements are available
    effect(() => {
        const editorEl = editor.v;
        const iframeEl = previewIframe.v;

        if (editorEl && iframeEl && !monacoLoaded.v) {
            // Load Monaco
            if (!window.require) {
                // Add Monaco loader script
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs/loader.js';
                script.onload = () => initMonaco(editorEl);
                document.head.appendChild(script);
            } else {
                initMonaco(editorEl);
            }
        }
    });

    // Initialize Monaco
    function initMonaco(editorEl) {
        require.config({
            paths: {
                'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs'
            }
        });

        require(['vs/editor/editor.main'], function () {
            // Register custom language
            if (!monaco.languages.getLanguages().some(lang => lang.id === 'javascript-with-html')) {
                monaco.languages.register({ id: 'javascript-with-html' });

                // Set up custom syntax highlighting
                monaco.languages.setMonarchTokensProvider('javascript-with-html', {
                    defaultToken: 'invalid',
                    tokenPostfix: '.js',
                    keywords: [
                        'break', 'case', 'catch', 'class', 'continue', 'const',
                        'constructor', 'debugger', 'default', 'delete', 'do', 'else',
                        'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
                        'get', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null',
                        'return', 'set', 'super', 'switch', 'symbol', 'this', 'throw', 'true',
                        'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
                        'async', 'await', 'of'
                    ],
                    tokenizer: {
                        root: [
                            // HTML tagged template strings
                            [/html`/, { token: 'string.html.delimiter', next: '@html', nextEmbedded: 'html' }],
                            [/[a-z_$][\w$]*/, {
                                cases: {
                                    '@keywords': 'keyword',
                                    '@default': 'identifier'
                                }
                            }],
                            { include: '@whitespace' },
                            [/"([^"\\]|\\.)*$/, 'string.invalid'],
                            [/'([^'\\]|\\.)*$/, 'string.invalid'],
                            [/"/, 'string', '@string_double'],
                            [/'/, 'string', '@string_single'],
                            [/`/, 'string', '@string_backtick'],
                        ],
                        html: [
                            [/\${/, { token: 'delimiter.bracket', next: '@javascriptInSimpleState', nextEmbedded: '@pop' }],
                            [/`/, { token: 'string.html.delimiter', next: '@pop', nextEmbedded: '@pop' }]
                        ],
                        javascriptInSimpleState: [
                            [/}/, { token: 'delimiter.bracket', next: '@html', nextEmbedded: 'html' }],
                            { include: 'root' }
                        ],
                        whitespace: [
                            [/[ \t\r\n]+/, 'white'],
                            [/\/\*/, 'comment', '@comment'],
                            [/\/\/.*$/, 'comment'],
                        ],
                        comment: [
                            [/[^\/*]+/, 'comment'],
                            [/\*\//, 'comment', '@pop'],
                            [/[\/*]/, 'comment']
                        ],
                        string_double: [
                            [/[^\\"]+/, 'string'],
                            [/\\./, 'string.escape'],
                            [/"/, 'string', '@pop']
                        ],
                        string_single: [
                            [/[^\\']+/, 'string'],
                            [/\\./, 'string.escape'],
                            [/'/, 'string', '@pop']
                        ],
                        string_backtick: [
                            [/\${/, { token: 'delimiter.bracket', next: '@bracketCounting' }],
                            [/[^\\`$]+/, 'string'],
                            [/\\./, 'string.escape'],
                            [/`/, 'string', '@pop']
                        ],
                        bracketCounting: [
                            [/\{/, 'delimiter.bracket', '@bracketCounting'],
                            [/\}/, 'delimiter.bracket', '@pop'],
                            { include: 'root' }
                        ],
                    }
                });

                monaco.languages.setLanguageConfiguration('javascript-with-html', {
                    autoClosingPairs: [
                        { open: '{', close: '}' },
                        { open: '[', close: ']' },
                        { open: '(', close: ')' },
                        { open: '"', close: '"' },
                        { open: "'", close: "'" },
                        { open: '`', close: '`' }
                    ],
                    surroundingPairs: [
                        { open: '{', close: '}' },
                        { open: '[', close: ']' },
                        { open: '(', close: ')' },
                        { open: '"', close: '"' },
                        { open: "'", close: "'" },
                        { open: '`', close: '`' },
                        { open: '<', close: '>' }
                    ],

                    onEnterRules: [
                        {
                            beforeText: new RegExp(`<([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
                            afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
                            action: {
                                indentAction: monaco.languages.IndentAction.IndentOutdent
                            }
                        },
                        {
                            beforeText: new RegExp(`<(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
                            action: {
                                indentAction: monaco.languages.IndentAction.Indent
                            }
                        }
                    ]
                });
            }

            // Add HTML tag completion
            monaco.languages.registerCompletionItemProvider('javascript-with-html', {
                provideCompletionItems: function (model, position) {
                    const textUntilPosition = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column
                    });

                    // Only provide completions when typing HTML tags
                    const match = textUntilPosition.match(/<(\w*)$/);
                    if (!match) {
                        return { suggestions: [] };
                    }

                    const word = model.getWordUntilPosition(position);
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn
                    };

                    // List of common HTML tags
                    const commonTags = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'a', 'button', 'input', 'select', 'form', 'ul', 'li', 'br', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'footer', 'header', 'section', 'article', 'w'];

                    // Special tags that need different treatment
                    const voidTags = ['br', 'img', 'input'];

                    return {
                        suggestions: commonTags.map(tag => {
                            const isVoid = voidTags.includes(tag);

                            return {
                                label: tag, // Simple tag name as label
                                kind: monaco.languages.CompletionItemKind.Keyword, // Change to Keyword for better visibility
                                detail: isVoid ? "Self-closing tag" : "HTML tag",  // Add detail description
                                documentation: isVoid ? "Self-closing HTML element" : "HTML element with closing tag",
                                insertText: isVoid ?
                                    (tag === 'img' ? `${tag} src="$1" alt="$2">` :
                                        tag === 'input' ? `${tag} type="$1" placeholder="$2">` :
                                            `${tag}>`) :
                                    `${tag}>$0</${tag}>`,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                range: range
                            };
                        })
                    };
                }
            });

            // Add style fix for completions
            const styleElement = document.createElement('style');
            styleElement.textContent = `
                .monaco-editor .suggest-widget {
                    z-index: 10000 !important;
                }
                .monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-icon-label-description-container {
                    display: flex !important;
                }
                .monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-icon-label-description-container .monaco-icon-name-container {
                    visibility: visible !important;
                    display: inline-block !important;
                }
                .monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-icon-label-description-container .monaco-icon-label-description {
                    display: inline-block !important;
                    visibility: visible !important;
                }
            `;
            document.head.appendChild(styleElement);

            // Initialize the editor
            const instance = monaco.editor.create(editorEl, {
                value: trimWhitespace(initialCode.v).trim(),
                language: 'javascript-with-html',
                theme: 'vs-light',
                automaticLayout: true,
                minimap: { enabled: false },
                autoClosingBrackets: 'always',      // Ensures brackets/parentheses auto-closing
                autoClosingQuotes: 'always',        // Also handles quote pairs
                autoSurround: 'languageDefined',    // Controls text selection surrounding
                autoClosingOvertype: 'always',      // Overwrites the closing bracket/quote when typed
                autoIndent: 'full',                 // Better auto-indentation
                suggest: {
                    showIcons: true,
                    showStatusBar: true,
                    showInlineDetails: true,
                    preview: true,
                    maxVisibleSuggestions: 12
                }
            });

            // Store the editor instance
            editorInstance.v = instance;
            monacoLoaded.v = true;

            // Set up event listener for changes
            instance.onDidChangeModelContent(debouncedUpdatePreview);

            // Initial preview render
            updatePreview();
        });
    }

    const getIframeBody = () => {
        const iframeDoc = previewIframe.v.contentDocument || previewIframe.v.contentWindow.document;
        return iframeDoc.body;
    };

    const checkTask = () => {
        let iframeBody = getIframeBody();
        const scripts = iframeBody.querySelectorAll('script');
        scripts.forEach(script => script.remove());
        const unnamedElementRegex = /tok-[a-zA-Z0-9]+-[a-zA-Z0-9]+/g;
        const unnamedElementReplacement = 'tok';
        let actual = iframeBody.innerHTML.replace(unnamedElementRegex, unnamedElementReplacement).trim();
        actual = iframeBody.innerHTML.replace(/\s+/g, '').trim();

        if (!expectedOutput.v) { console.log("Actual:", actual); return; }

        let expectedArray;

        if (Array.isArray(expectedOutput.v)) {
            expectedArray = expectedOutput.v;
        } else {
            expectedArray = [expectedOutput.v];
        }

        expectedArray = expectedArray.map(expected => {
            expected = expected.replace(unnamedElementRegex, unnamedElementReplacement).trim();
            expected = expected.replace(/\s+/g, '').trim();
            return expected;
        });

        // Check if the output matches any of the expected outputs
        const isMatch = expectedArray.some(expected => actual === expected);

        if (isMatch) {
            alert("Task completed successfully!");
        } else {
            alert("Task not completed. Please check your code.");
        }
    };

    // Render component
    html`
        <!-- Editor Container with Drop Shadow -->
        <div class="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200">
            <!-- Header Bar -->
            <div class="bg-gray-800 text-white px-4 py-3 flex items-center justify-between">
                <h1 class="text-xl font-medium">${title}</h1>
                <div class="flex space-x-2 text-xs">
                    <button onclick=${checkTask} class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded transition-colors flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                        Check Task
                    </button>
                </div>
            </div>
            
            <!-- Main Editor Area -->
            <div class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                <!-- Editor Panel -->
                <div class="flex flex-col">
                    <div class="bg-gray-100 px-4 py-2 border-b border-gray-200 flex items-center">
                        <div class="flex items-center space-x-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                            <h2 class="font-medium text-gray-700">HTML + JS</h2>
                        </div>
                    </div>
                    <div class="flex-1">
                        <div :this=${editor} class="w-full h-[500px]"></div>
                    </div>
                </div>
                
                <!-- Preview Panel -->
                <div class="flex flex-col">
                    <div class="bg-gray-100 px-4 py-2 border-b border-gray-200 flex items-center">
                        <div class="flex items-center space-x-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                            </svg>
                            <h2 class="font-medium text-gray-700">Output</h2>
                        </div>
                    </div>
                    <div class="flex-1 bg-white">
                        <iframe :this=${previewIframe} title="Live Preview" class="w-full h-[500px]"></iframe>
                    </div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="px-4 py-2 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-xs text-gray-500">
                <div>
                    Auto-updates as you type
                </div>
                <div class="flex items-center space-x-2">
                    <span class="px-2 py-1 bg-green-100 text-green-800 rounded-full">Ready</span>
                </div>
            </div>
        </div>
        
        <!-- Additional Info Panel -->
        <w if=${expectedOutput}>
            <div class="mt-4 bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-700">
                <div class="flex">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>Complete the task then click "Check Task" to verify your solution.</p>
                </div>
            </div>
        </w>
    `;
});