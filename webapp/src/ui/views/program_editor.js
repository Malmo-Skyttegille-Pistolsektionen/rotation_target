/**
 * WYSIWYG Program Editor
 * Allows users to create and edit shooting programs visually
 */

import { fetchAudios } from '../../apis/rest-client.js';
import { renderTimeline, TimelineType } from './timeline.js';

// State for the editor
let editorState = {
    program: null,
    isEditing: false,
    originalProgramId: null,
    audios: [], // Cache of available audios
    timelineMode: null, // null = auto, TimelineType.Default, or TimelineType.Field
    jsonError: null, // JSON validation error
};

/**
 * Initialize a new program with default values
 */
function createEmptyProgram() {
    return {
        id: null,
        title: "",
        description: "",
        readonly: false,
        series: []
    };
}

/**
 * Create an empty series
 */
function createEmptySeries() {
    return {
        name: "",
        optional: false,
        events: []
    };
}

/**
 * Create an empty event
 */
function createEmptyEvent() {
    return {
        duration: 1000,
        command: null, // Command is optional
        audio_ids: []
    };
}

/**
 * Open the editor with a program (for editing or creating new)
 */
export async function openProgramEditor(program = null) {
    editorState.isEditing = program !== null;
    editorState.originalProgramId = program ? program.id : null;
    editorState.program = program ? JSON.parse(JSON.stringify(program)) : createEmptyProgram();
    
    // Load audios if not already cached
    if (editorState.audios.length === 0) {
        try {
            const response = await fetchAudios();
            editorState.audios = response.audios || [];
        } catch (err) {
            console.error('Failed to load audios:', err);
            // Use mock data for testing when API is unavailable
            editorState.audios = [
                { id: 1, title: "1" },
                { id: 10, title: "10" },
                { id: 21, title: "Banan är öppen" },
                { id: 26, title: "Ladda!" },
                { id: 31, title: "Färdiga!" },
                { id: 33, title: "Eld!" },
                { id: 34, title: "Eld upphör!" },
                { id: 50, title: "Provserie" }
            ];
        }
    }
    
    renderEditor();
    document.getElementById('program-editor-modal').classList.remove('hidden');
}

/**
 * Close the editor
 */
export function closeProgramEditor() {
    document.getElementById('program-editor-modal').classList.add('hidden');
    editorState = {
        program: null,
        isEditing: false,
        originalProgramId: null,
        audios: [],
        timelineMode: null
    };
}

/**
 * Render the entire editor UI
 */
function renderEditor() {
    const container = document.getElementById('program-editor-content');
    const program = editorState.program;
    
    container.innerHTML = `
        <div class="editor-tabs">
            <button class="editor-tab active" data-tab="editor">Editor</button>
            <button class="editor-tab" data-tab="preview">Preview</button>
            <button class="editor-tab" data-tab="json">JSON</button>
        </div>
        <div class="editor-tab-content active" id="editor-tab-editor">
            <div class="editor-section">
                <h3>Program Details</h3>
                <div class="form-group">
                    <label>Title:</label>
                    <input type="text" id="program-title" value="${program.title}" placeholder="Program Title" />
                </div>
                <div class="form-group">
                    <label>Description:</label>
                    <input type="text" id="program-description" value="${program.description}" placeholder="Program Description" />
                </div>
                ${editorState.isEditing ? `
                <div class="form-group">
                    <label>ID:</label>
                    <input type="number" id="program-id" value="${program.id || ''}" placeholder="Program ID" />
                </div>
                ` : `
                <div class="form-group">
                    <label>ID:</label>
                    <input type="number" id="program-id" value="${program.id || ''}" placeholder="Auto-generated if empty" />
                </div>
                `}
                <div class="form-group checkbox-group">
                    <label>
                        <input type="checkbox" id="program-readonly" ${program.readonly ? 'checked' : ''} />
                        Read-only (prevents deletion/editing)
                    </label>
                </div>
            </div>
            
            <div class="editor-section">
                <h3>Series</h3>
                <div id="series-container"></div>
                <button id="add-series-btn" class="primary">+ Add Series</button>
            </div>
        </div>
        <div class="editor-tab-content" id="editor-tab-preview">
            <div class="preview-controls">
                <label for="editor-timeline-mode-select">Timeline Mode:</label>
                <select id="editor-timeline-mode-select">
                    <option value="auto">Auto</option>
                    <option value="default">Event-based</option>
                    <option value="field">Time-scaled</option>
                </select>
            </div>
            <div id="editor-timeline-preview" class="timeline-preview-container"></div>
        </div>
        <div class="editor-tab-content" id="editor-tab-json">
            <div class="json-editor-controls">
                <button id="format-json-btn" class="primary small">Format JSON</button>
                <span id="json-validation-status" class="json-validation-status"></span>
            </div>
            <div class="json-editor-wrapper">
                <div class="json-line-numbers" id="json-line-numbers"></div>
                <textarea id="json-editor-textarea" class="json-editor-textarea" spellcheck="false"></textarea>
            </div>
            <div id="json-error-message" class="json-error-message"></div>
        </div>
    `;
    
    renderAllSeries();
    renderTimelinePreview();
    attachEditorListeners();
    attachTabListeners();
}

/**
 * Render the timeline preview based on current program state
 */
function renderTimelinePreview() {
    const previewContainer = document.getElementById('editor-timeline-preview');
    const program = editorState.program;
    
    // Don't render if no series or events
    if (!program.series || program.series.length === 0) {
        previewContainer.innerHTML = '<p class="empty-message">Add series and events to see timeline preview</p>';
        return;
    }
    
    // Check if any series has events
    const hasEvents = program.series.some(series => series.events && series.events.length > 0);
    if (!hasEvents) {
        previewContainer.innerHTML = '<p class="empty-message">Add events to series to see timeline preview</p>';
        return;
    }
    
    // Determine timeline type based on mode selector
    let timelineType = editorState.timelineMode;
    
    // Render the timeline
    renderTimeline(previewContainer, program, timelineType);
}

/**
 * Attach tab switching listeners
 */
function attachTabListeners() {
    const tabs = document.querySelectorAll('.editor-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const targetTab = e.target.dataset.tab;
            
            // Check if switching away from JSON tab before removing active class
            const currentActiveTab = document.querySelector('.editor-tab.active');
            const switchingFromJson = currentActiveTab && currentActiveTab.dataset.tab === 'json' && targetTab !== 'json';
            
            // Remove active class from all tabs and contents
            document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.editor-tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            e.target.classList.add('active');
            document.getElementById(`editor-tab-${targetTab}`).classList.add('active');
            
            // If switching away from JSON tab, sync changes
            if (switchingFromJson) {
                syncJsonToProgram();
            }
            
            // If switching to preview tab, refresh the timeline
            if (targetTab === 'preview') {
                renderTimelinePreview();
            }
            
            // If switching to JSON tab, update JSON editor
            if (targetTab === 'json') {
                updateJsonEditor();
            }
        });
    });
}

/**
 * Render all series
 */
function renderAllSeries() {
    const container = document.getElementById('series-container');
    const program = editorState.program;
    
    if (program.series.length === 0) {
        container.innerHTML = '<p class="empty-message">No series added yet. Click "Add Series" to get started.</p>';
        return;
    }
    
    container.innerHTML = program.series.map((series, seriesIndex) => `
        <div class="series-item" data-series-index="${seriesIndex}">
            <div class="series-header">
                <h4>Series ${seriesIndex + 1}</h4>
                <button class="delete-btn small icon-only" data-action="delete-series" data-index="${seriesIndex}" title="Delete Series">
                    <img src="/icons/delete_24_regular.svg" alt="Delete" width="20" height="20" />
                </button>
            </div>
            <div class="form-group">
                <label>Name:</label>
                <input type="text" class="series-name" data-index="${seriesIndex}" value="${series.name}" placeholder="Series Name" />
            </div>
            <div class="form-group checkbox-group">
                <label>
                    <input type="checkbox" class="series-optional" data-index="${seriesIndex}" ${series.optional ? 'checked' : ''} />
                    Optional
                </label>
            </div>
            <div class="events-section">
                <h5>Events</h5>
                <div class="events-container" data-series-index="${seriesIndex}">
                    ${renderEvents(series.events, seriesIndex)}
                </div>
                <button class="primary small" data-action="add-event" data-series-index="${seriesIndex}">+ Add Event</button>
            </div>
        </div>
    `).join('');
}

/**
 * Render events for a series
 */
function renderEvents(events, seriesIndex) {
    if (events.length === 0) {
        return '<p class="empty-message">No events in this series.</p>';
    }
    
    return events.map((event, eventIndex) => `
        <div class="event-item" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" draggable="true">
            <div class="event-header">
                <span class="drag-handle">≡</span>
                <span>Event ${eventIndex + 1}</span>
                <button class="delete-btn small icon-only" data-action="delete-event" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Delete Event">
                    <img src="/icons/delete_24_regular.svg" alt="Delete" width="20" height="20" />
                </button>
            </div>
            <div class="event-fields">
                <div class="form-group inline">
                    <label>Duration (ms):</label>
                    <input type="number" class="event-duration" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" value="${event.duration}" min="0" step="100" />
                </div>
                <div class="form-group inline">
                    <label>Command:</label>
                    <div class="radio-group">
                        <label class="radio-label">
                            <input type="radio" name="command-${seriesIndex}-${eventIndex}" value="show" class="event-command" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" ${event.command === 'show' ? 'checked' : ''} />
                            Show
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="command-${seriesIndex}-${eventIndex}" value="hide" class="event-command" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" ${event.command === 'hide' ? 'checked' : ''} />
                            Hide
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="command-${seriesIndex}-${eventIndex}" value="" class="event-command" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" ${!event.command ? 'checked' : ''} />
                            No Change
                        </label>
                    </div>
                </div>
                <div class="form-group audio-ids-group inline">
                    <label>Audio IDs:</label>
                    <div class="audio-search-container">
                        <input type="text" class="audio-search-input" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" placeholder="Search audios by ID or title..." />
                        <div class="audio-suggestions" data-series-index="${seriesIndex}" data-event-index="${eventIndex}"></div>
                    </div>
                </div>
                <div class="selected-audios-container">
                    <div class="selected-audios" data-series-index="${seriesIndex}" data-event-index="${eventIndex}">
                        ${renderSelectedAudios(event.audio_ids || [], seriesIndex, eventIndex)}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Render selected audio IDs for an event
 */
function renderSelectedAudios(audioIds, seriesIndex, eventIndex) {
    if (audioIds.length === 0) {
        return '<p class="empty-message small">No audios selected</p>';
    }
    
    return audioIds.map((audioId, audioIndex) => {
        const audio = editorState.audios.find(a => a.id === audioId);
        const title = audio ? audio.title : 'Unknown';
        return `
            <div class="selected-audio-item" data-audio-index="${audioIndex}" draggable="true">
                <span class="drag-handle">≡</span>
                <span class="audio-label">${audioId} - ${title}</span>
                <button class="remove-audio-btn icon-only" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" data-audio-index="${audioIndex}" title="Delete Audio">
                    <img src="/icons/delete_24_regular.svg" alt="Delete" width="18" height="18" />
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Update the JSON editor with current program state
 */
function updateJsonEditor() {
    const textarea = document.getElementById('json-editor-textarea');
    if (textarea) {
        textarea.value = JSON.stringify(editorState.program, null, 2);
        updateLineNumbers();
        validateJson();
    }
}

/**
 * Update line numbers for JSON editor
 */
function updateLineNumbers() {
    const textarea = document.getElementById('json-editor-textarea');
    const lineNumbersDiv = document.getElementById('json-line-numbers');
    
    if (!textarea || !lineNumbersDiv) return;
    
    const lines = textarea.value.split('\n');
    const lineNumbersHtml = lines.map((_, index) => `<div>${index + 1}</div>`).join('');
    lineNumbersDiv.innerHTML = lineNumbersHtml;
}

/**
 * Validate JSON and update UI
 */
function validateJson() {
    const textarea = document.getElementById('json-editor-textarea');
    const statusElement = document.getElementById('json-validation-status');
    const errorElement = document.getElementById('json-error-message');
    
    if (!textarea) return;
    
    try {
        const parsed = JSON.parse(textarea.value);
        editorState.jsonError = null;
        statusElement.textContent = '✓ Valid JSON';
        statusElement.className = 'json-validation-status valid';
        errorElement.textContent = '';
        errorElement.style.display = 'none';
        return parsed;
    } catch (error) {
        editorState.jsonError = error.message;
        statusElement.textContent = '✗ Invalid JSON';
        statusElement.className = 'json-validation-status invalid';
        errorElement.textContent = `Error: ${error.message}`;
        errorElement.style.display = 'block';
        return null;
    }
}

/**
 * Format JSON in the editor
 */
function formatJson() {
    const textarea = document.getElementById('json-editor-textarea');
    if (!textarea) return;
    
    try {
        const parsed = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(parsed, null, 2);
        updateLineNumbers();
        validateJson();
    } catch (error) {
        // If JSON is invalid, validation will show the error
        validateJson();
    }
}

/**
 * Sync JSON changes back to program state
 */
function syncJsonToProgram() {
    const parsed = validateJson();
    if (parsed) {
        // Validate that the parsed object has the required program structure
        if (!('title' in parsed) || !('series' in parsed) || !Array.isArray(parsed.series)) {
            const errorElement = document.getElementById('json-error-message');
            const statusElement = document.getElementById('json-validation-status');
            statusElement.textContent = '✗ Invalid Program Structure';
            statusElement.className = 'json-validation-status invalid';
            errorElement.textContent = 'Error: Program must have "title" and "series" (array) properties';
            errorElement.style.display = 'block';
            return;
        }
        
        editorState.program = parsed;
        // Re-render other views to reflect changes
        renderAllSeries();
        renderTimelinePreview();
    }
}

/**
 * Attach event listeners to the editor
 */
function attachEditorListeners() {
    // Program details
    document.getElementById('program-title').addEventListener('input', (e) => {
        editorState.program.title = e.target.value;
    });
    
    document.getElementById('program-description').addEventListener('input', (e) => {
        editorState.program.description = e.target.value;
    });
    
    document.getElementById('program-id').addEventListener('input', (e) => {
        const value = e.target.value;
        if (value) {
            const id = parseInt(value);
            editorState.program.id = !isNaN(id) ? id : null;
        } else {
            editorState.program.id = null;
        }
    });
    
    document.getElementById('program-readonly').addEventListener('change', (e) => {
        editorState.program.readonly = e.target.checked;
    });
    
    // Timeline mode selector
    document.getElementById('editor-timeline-mode-select').addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode === 'auto') {
            editorState.timelineMode = null;
        } else if (mode === 'default') {
            editorState.timelineMode = TimelineType.Default;
        } else if (mode === 'field') {
            editorState.timelineMode = TimelineType.Field;
        }
        renderTimelinePreview();
    });
    
    // Add series button
    document.getElementById('add-series-btn').addEventListener('click', () => {
        editorState.program.series.push(createEmptySeries());
        renderAllSeries();
        renderTimelinePreview();
    });
    
    // Event delegation for series and events
    const seriesContainer = document.getElementById('series-container');
    
    seriesContainer.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset.action;
        
        if (action === 'delete-series') {
            const index = parseInt(target.dataset.index);
            if (confirm('Delete this series?')) {
                editorState.program.series.splice(index, 1);
                renderAllSeries();
                renderTimelinePreview();
            }
        } else if (action === 'add-event') {
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            editorState.program.series[seriesIndex].events.push(createEmptyEvent());
            renderAllSeries();
            renderTimelinePreview();
        } else if (action === 'delete-event') {
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            const eventIndex = parseInt(target.dataset.eventIndex);
            if (confirm('Delete this event?')) {
                editorState.program.series[seriesIndex].events.splice(eventIndex, 1);
                renderAllSeries();
                renderTimelinePreview();
            }
        }
    });
    
    seriesContainer.addEventListener('input', (e) => {
        const target = e.target;
        
        if (target.classList.contains('series-name')) {
            const index = parseInt(target.dataset.index);
            editorState.program.series[index].name = target.value;
            renderTimelinePreview();
        } else if (target.classList.contains('series-optional')) {
            const index = parseInt(target.dataset.index);
            editorState.program.series[index].optional = target.checked;
            renderTimelinePreview();
        } else if (target.classList.contains('event-duration')) {
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            const eventIndex = parseInt(target.dataset.eventIndex);
            const duration = parseInt(target.value);
            if (!isNaN(duration) && duration >= 0) {
                editorState.program.series[seriesIndex].events[eventIndex].duration = duration;
                renderTimelinePreview();
            }
        } else if (target.classList.contains('event-command')) {
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            const eventIndex = parseInt(target.dataset.eventIndex);
            const value = target.value;
            editorState.program.series[seriesIndex].events[eventIndex].command = value || null;
            renderTimelinePreview();
        } else if (target.classList.contains('audio-search-input')) {
            handleAudioSearch(target);
        }
    });
    
    // Handle audio selection from suggestions
    seriesContainer.addEventListener('click', (e) => {
        const target = e.target;
        
        // Handle audio suggestion click
        if (target.classList.contains('audio-suggestion-item')) {
            const audioId = parseInt(target.dataset.audioId);
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            const eventIndex = parseInt(target.dataset.eventIndex);
            addAudioToEvent(seriesIndex, eventIndex, audioId);
        }
        
        // Handle remove audio button
        if (target.classList.contains('remove-audio-btn')) {
            const seriesIndex = parseInt(target.dataset.seriesIndex);
            const eventIndex = parseInt(target.dataset.eventIndex);
            const audioIndex = parseInt(target.dataset.audioIndex);
            removeAudioFromEvent(seriesIndex, eventIndex, audioIndex);
        }
    });
    
    // Handle drag and drop for audio reordering
    seriesContainer.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('selected-audio-item')) {
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', e.target.innerHTML);
        }
        // Handle event item dragging
        if (e.target.classList.contains('event-item')) {
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', e.target.innerHTML);
        }
    });
    
    seriesContainer.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('selected-audio-item')) {
            e.target.classList.remove('dragging');
        }
        // Handle event item drag end
        if (e.target.classList.contains('event-item')) {
            e.target.classList.remove('dragging');
        }
    });
    
    seriesContainer.addEventListener('dragover', (e) => {
        // Handle audio item dragover
        if (e.target.closest('.selected-audio-item')) {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging.selected-audio-item');
            const targetElement = e.target.closest('.selected-audio-item');
            
            if (draggingElement && targetElement && draggingElement !== targetElement) {
                const container = targetElement.parentElement;
                const draggingIndex = Array.from(container.children).indexOf(draggingElement);
                const targetIndex = Array.from(container.children).indexOf(targetElement);
                
                if (draggingIndex < targetIndex) {
                    targetElement.after(draggingElement);
                } else {
                    targetElement.before(draggingElement);
                }
            }
        }
        
        // Handle event item dragover
        if (e.target.closest('.event-item')) {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging.event-item');
            const targetElement = e.target.closest('.event-item');
            
            if (draggingElement && targetElement && draggingElement !== targetElement) {
                // Make sure they're in the same series
                const draggingSeriesIndex = draggingElement.dataset.seriesIndex;
                const targetSeriesIndex = targetElement.dataset.seriesIndex;
                
                if (draggingSeriesIndex === targetSeriesIndex) {
                    const container = targetElement.parentElement;
                    const draggingIndex = Array.from(container.children).filter(el => el.classList.contains('event-item')).indexOf(draggingElement);
                    const targetIndex = Array.from(container.children).filter(el => el.classList.contains('event-item')).indexOf(targetElement);
                    
                    if (draggingIndex < targetIndex) {
                        targetElement.after(draggingElement);
                    } else {
                        targetElement.before(draggingElement);
                    }
                }
            }
        }
    });
    
    seriesContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggingAudio = document.querySelector('.dragging.selected-audio-item');
        const draggingEvent = document.querySelector('.dragging.event-item');
        
        // Handle audio drop
        if (draggingAudio) {
            const container = draggingAudio.parentElement;
            const seriesIndex = parseInt(container.dataset.seriesIndex);
            const eventIndex = parseInt(container.dataset.eventIndex);
            
            // Get new order of audio IDs
            const newOrder = Array.from(container.querySelectorAll('.selected-audio-item')).map(item => {
                const label = item.querySelector('.audio-label').textContent;
                return parseInt(label.split(' - ')[0]);
            });
            
            editorState.program.series[seriesIndex].events[eventIndex].audio_ids = newOrder;
            renderTimelinePreview();
        }
        
        // Handle event drop
        if (draggingEvent) {
            const seriesIndex = parseInt(draggingEvent.dataset.seriesIndex);
            const container = draggingEvent.parentElement;
            
            // Get new order of events
            const eventElements = Array.from(container.querySelectorAll('.event-item'));
            const newEventOrder = eventElements.map(el => {
                const oldEventIndex = parseInt(el.dataset.eventIndex);
                return editorState.program.series[seriesIndex].events[oldEventIndex];
            });
            
            // Update the events array with new order
            editorState.program.series[seriesIndex].events = newEventOrder;
            
            // Re-render to update indices
            renderAllSeries();
            renderTimelinePreview();
        }
    });
    
    // JSON editor event listeners
    const jsonTextarea = document.getElementById('json-editor-textarea');
    if (jsonTextarea) {
        // Update line numbers and validate on input
        jsonTextarea.addEventListener('input', () => {
            updateLineNumbers();
            validateJson();
        });
        
        // Sync scroll between textarea and line numbers
        jsonTextarea.addEventListener('scroll', () => {
            const lineNumbers = document.getElementById('json-line-numbers');
            if (lineNumbers) {
                lineNumbers.scrollTop = jsonTextarea.scrollTop;
            }
        });
        
        // Sync changes to program on blur (when user leaves the field)
        jsonTextarea.addEventListener('blur', () => {
            syncJsonToProgram();
        });
        
        // Handle tab key for indentation
        jsonTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = jsonTextarea.selectionStart;
                const end = jsonTextarea.selectionEnd;
                
                if (e.shiftKey) {
                    // Shift+Tab: Remove indentation
                    const textBefore = jsonTextarea.value.substring(0, start);
                    const lastLineStart = textBefore.lastIndexOf('\n') + 1;
                    const lineStart = jsonTextarea.value.substring(lastLineStart, start);
                    
                    if (lineStart.startsWith('  ')) {
                        jsonTextarea.value = jsonTextarea.value.substring(0, lastLineStart) + 
                                           lineStart.substring(2) + 
                                           jsonTextarea.value.substring(start);
                        jsonTextarea.selectionStart = jsonTextarea.selectionEnd = start - 2;
                    }
                } else {
                    // Tab: Add indentation
                    jsonTextarea.value = jsonTextarea.value.substring(0, start) + '  ' + jsonTextarea.value.substring(end);
                    jsonTextarea.selectionStart = jsonTextarea.selectionEnd = start + 2;
                }
                
                updateLineNumbers();
                validateJson();
            }
        });
    }
    
    // Format JSON button
    const formatBtn = document.getElementById('format-json-btn');
    if (formatBtn) {
        formatBtn.addEventListener('click', () => {
            formatJson(); // formatJson() internally calls validateJson()
        });
    }
}

/**
 * Handle audio search with fuzzy matching
 */
function handleAudioSearch(input) {
    const searchTerm = input.value.toLowerCase();
    const seriesIndex = parseInt(input.dataset.seriesIndex);
    const eventIndex = parseInt(input.dataset.eventIndex);
    const suggestionsContainer = document.querySelector(`.audio-suggestions[data-series-index="${seriesIndex}"][data-event-index="${eventIndex}"]`);
    
    if (!searchTerm) {
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.classList.remove('active');
        return;
    }
    
    // Get currently selected audio IDs for this event
    const selectedIds = editorState.program.series[seriesIndex].events[eventIndex].audio_ids || [];
    
    // Fuzzy search in audios
    const matches = editorState.audios.filter(audio => {
        if (selectedIds.includes(audio.id)) return false; // Don't show already selected
        
        const idStr = audio.id.toString();
        const titleLower = audio.title.toLowerCase();
        
        // Simple fuzzy matching: check if search term characters appear in order
        return idStr.includes(searchTerm) || titleLower.includes(searchTerm);
    }).slice(0, 10); // Limit to 10 suggestions
    
    if (matches.length === 0) {
        suggestionsContainer.innerHTML = '<div class="no-suggestions">No matches found</div>';
    } else {
        suggestionsContainer.innerHTML = matches.map(audio => `
            <div class="audio-suggestion-item" data-audio-id="${audio.id}" data-series-index="${seriesIndex}" data-event-index="${eventIndex}">
                ${audio.id} - ${audio.title}
            </div>
        `).join('');
    }
    
    suggestionsContainer.classList.add('active');
}

/**
 * Add an audio to an event
 */
function addAudioToEvent(seriesIndex, eventIndex, audioId) {
    const event = editorState.program.series[seriesIndex].events[eventIndex];
    if (!event.audio_ids) {
        event.audio_ids = [];
    }
    
    if (!event.audio_ids.includes(audioId)) {
        event.audio_ids.push(audioId);
        renderAllSeries();
        renderTimelinePreview();
    }
}

/**
 * Remove an audio from an event
 */
function removeAudioFromEvent(seriesIndex, eventIndex, audioIndex) {
    const event = editorState.program.series[seriesIndex].events[eventIndex];
    event.audio_ids.splice(audioIndex, 1);
    renderAllSeries();
    renderTimelinePreview();
}

/**
 * Save the program
 */
export function saveProgramFromEditor() {
    // If user is on JSON tab, sync changes before saving
    const activeTab = document.querySelector('.editor-tab.active');
    if (activeTab && activeTab.dataset.tab === 'json') {
        syncJsonToProgram();
    }
    
    const program = editorState.program;
    
    // Validation
    if (!program.title) {
        alert('Please enter a program title');
        return;
    }
    
    if (program.series.length === 0) {
        alert('Please add at least one series');
        return;
    }
    
    // Check that all series have names
    for (let i = 0; i < program.series.length; i++) {
        if (!program.series[i].name) {
            alert(`Please enter a name for Series ${i + 1}`);
            return;
        }
        if (program.series[i].events.length === 0) {
            alert(`Series ${i + 1} must have at least one event`);
            return;
        }
    }
    
    return {
        program: program,
        originalId: editorState.originalProgramId
    };
}

/**
 * Initialize the editor modal in the DOM
 * @param {Function} onSaveCallback - Callback function to handle program save
 */
export function initializeProgramEditorModal(onSaveCallback) {
    // Check if modal already exists
    if (document.getElementById('program-editor-modal')) {
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'program-editor-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
        <div class="modal-content large">
            <div class="modal-header">
                <h2 id="editor-title">Program Editor</h2>
                <button id="close-editor-btn" class="close-btn">×</button>
            </div>
            <div id="program-editor-content" class="modal-body"></div>
            <div class="modal-footer">
                <button id="cancel-editor-btn" class="secondary">Cancel</button>
                <button id="save-editor-btn" class="primary">Save Program</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Attach close and save listeners
    document.getElementById('close-editor-btn').addEventListener('click', closeProgramEditor);
    document.getElementById('cancel-editor-btn').addEventListener('click', closeProgramEditor);
    
    // Attach save listener if callback provided
    if (onSaveCallback) {
        document.getElementById('save-editor-btn').addEventListener('click', onSaveCallback);
    }
}
