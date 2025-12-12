/**
 * WYSIWYG Program Editor
 * Allows users to create and edit shooting programs visually
 */

import { fetchAudios } from '../../apis/rest-client.js';
import { renderTimeline, TimelineType } from './timeline.js';
import Prism from 'prismjs';
import 'prismjs/components/prism-json.js';
import 'prismjs/themes/prism.css';

// State for the editor
let editorState = {
    program: null,
    isEditing: false,
    originalProgramId: null,
    audios: [], // Cache of available audios
    timelineMode: null, // null = auto, TimelineType.Default, or TimelineType.Field
    collapsedSeries: new Set(), // Track which series are collapsed (used in both Form and Events views)
    jsonError: null, // JSON validation error
    selectedEvents: new Set(), // Track selected events for batch operations (format: "seriesIndex-eventIndex")
    timelineZoom: 1, // Zoom level for timeline editor (1 = default, 40px per second)
    timelineSelectedSeries: null, // Currently selected series in timeline view (null = show all)
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
        timelineMode: null,
        collapsedSeries: new Set(),
        selectedEvents: new Set(),
        timelineZoom: 1,
        timelineSelectedSeries: null
    };
    // Reset timeline listeners flag so they can be reattached for the next program
    window.timelineEditorListenersInitialized = false;
}

/**
 * Render the events-based view
 */
function renderEventsView() {
    const container = document.getElementById('events-view-container');
    const program = editorState.program;
    
    // Populate program details
    const titleInput = document.getElementById('events-program-title');
    const descInput = document.getElementById('events-program-description');
    const idInput = document.getElementById('events-program-id');
    const readonlyCheckbox = document.getElementById('events-program-readonly');
    
    if (titleInput) titleInput.value = program.title || '';
    if (descInput) descInput.value = program.description || '';
    if (idInput) idInput.value = program.id || '';
    if (readonlyCheckbox) readonlyCheckbox.checked = program.readonly || false;
    
    if (!program.series || program.series.length === 0) {
        container.innerHTML = '<p class="empty-message">No series added yet. Switch to Form tab to add series.</p>';
        return;
    }
    
    container.innerHTML = program.series.map((series, seriesIndex) => {
        const isCollapsed = editorState.collapsedSeries.has(seriesIndex);
        const totalEvents = series.events.length;
        const totalDuration = series.events.reduce((sum, event) => sum + event.duration, 0);
        
        return `
            <div class="events-view-series" data-series-index="${seriesIndex}" draggable="true" id="series-${seriesIndex}" title="Drag to reorder series">
                <div class="events-view-series-header ${isCollapsed ? 'collapsed' : ''}">
                    <button class="series-toggle-btn" data-series-index="${seriesIndex}" title="Toggle series">
                        <span class="toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
                    </button>
                    <div class="series-info">
                        <h4>${series.name || `Series ${seriesIndex + 1}`}${series.optional ? ' <span class="optional-badge">Optional</span>' : ''}</h4>
                        <span class="series-meta">${totalEvents} event${totalEvents !== 1 ? 's' : ''} • ${(totalDuration / 1000).toFixed(1)}s</span>
                    </div>
                    <div class="series-actions">
                        <button class="icon-btn" data-action="edit-series" data-series-index="${seriesIndex}" title="Edit Series">
                            <img src="/icons/edit_24_regular.svg" alt="Edit" width="20" height="20" />
                        </button>
                        <button class="icon-btn" data-action="duplicate-series" data-series-index="${seriesIndex}" title="Copy Series">
                            <img src="public/icons/copy_24_regular.svg" alt="Copy" width="20" height="20" />
                        </button>
                        <button class="icon-btn delete-btn" data-action="delete-series-events-view" data-series-index="${seriesIndex}" title="Delete Series">
                            <img src="/icons/delete_24_regular.svg" alt="Delete" width="20" height="20" />
                        </button>
                    </div>
                </div>
                ${!isCollapsed ? `
                <div class="events-view-list" data-series-index="${seriesIndex}">
                    ${series.events.length > 0 ? series.events.map((event, eventIndex) => {
                        const eventId = `${seriesIndex}-${eventIndex}`;
                        const isSelected = editorState.selectedEvents.has(eventId);
                        const audioTitles = (event.audio_ids || []).map(id => {
                            const audio = editorState.audios.find(a => a.id === id);
                            return audio ? audio.title : `ID ${id}`;
                        }).join(', ');
                        
                        return `
                            <div class="events-view-item ${isSelected ? 'selected' : ''}" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" data-event-id="${eventId}" draggable="true" title="Drag to reorder">
                                <div class="event-select">
                                    <div class="event-number">${eventIndex + 1}</div>
                                    <input type="checkbox" class="event-checkbox" data-event-id="${eventId}" ${isSelected ? 'checked' : ''} />
                                </div>
                                <div class="event-details">
                                    <div class="event-detail-row">
                                        <span>Duration: ${(event.duration / 1000).toFixed(1)}s</span>
                                        <span class="event-command-badge ${event.command || 'none'}">${event.command ? event.command.toUpperCase() : 'NO CHANGE'}</span>
                                        ${(event.audio_ids && event.audio_ids.length > 0) ? `
                                        <span class="audio-badge">♫ ${event.audio_ids.length}</span>
                                        ${event.audio_ids.map(id => {
                                            const audio = editorState.audios.find(a => a.id === id);
                                            const title = audio ? audio.title : `ID ${id}`;
                                            return `<span class="audio-title-badge" title="${title}">${title}</span>`;
                                        }).join('')}
                                        ` : ''}
                                    </div>
                                </div>
                                <div class="event-actions">
                                    <button class="icon-btn" data-action="edit-event" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Edit Event">
                                        <img src="public/icons/edit_24_regular.svg" alt="Edit" width="20" height="20" />
                                    </button>
                                    <button class="icon-btn" data-action="duplicate-event" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Copy Event">
                                        <img src="public/icons/copy_24_regular.svg" alt="Copy" width="20" height="20" />
                                    </button>
                                    <button class="icon-btn delete-btn" data-action="delete-event-events-view" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Delete Event">
                                        <img src="public/icons/delete_24_regular.svg" alt="Delete" width="20" height="20" />
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('') : '<p class="empty-message">No events in this series.</p>'}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Update batch delete button visibility and select-all checkbox state
    const selectedCount = editorState.selectedEvents.size;
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    const selectAllCheckbox = document.getElementById('select-all-events-checkbox');
    
    if (batchDeleteBtn) {
        batchDeleteBtn.style.display = selectedCount > 0 ? 'flex' : 'none';
    }
    
    // Update select-all checkbox state (all, none, or indeterminate)
    if (selectAllCheckbox) {
        const totalEvents = program.series.reduce((sum, series) => sum + series.events.length, 0);
        if (selectedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (selectedCount === totalEvents) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    }
    
    // Populate the "Go to series" dropdown
    const gotoSelect = document.getElementById('goto-series-select');
    if (gotoSelect) {
        gotoSelect.innerHTML = '<option value="">Go to series...</option>' + 
            program.series.map((series, index) => 
                `<option value="${index}">${series.name || `Series ${index + 1}`}</option>`
            ).join('');
    }
    
    // Update the summary
    const summaryEl = document.getElementById('events-view-summary');
    if (summaryEl) {
        summaryEl.textContent = `${program.series.length} series`;
    }
    
    attachEventsViewListeners();
}

/**
 * Render the entire editor UI
 */
function renderEditor() {
    const container = document.getElementById('program-editor-content');
    const program = editorState.program;
    
    container.innerHTML = `
        <div class="editor-tabs">
            <button class="editor-tab active" data-tab="editor">Form</button>
            <button class="editor-tab" data-tab="events">Events</button>
            <button class="editor-tab" data-tab="timeline">Timeline</button>
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
                <div class="series-controls">
                    <h3>Series</h3>
                    <div class="series-actions">
                        <select id="series-navigation" class="series-select hidden">
                            <option value="" disabled selected>Go to series...</option>
                        </select>
                        <button id="collapse-all-btn" class="secondary small" title="Collapse all series">Collapse All</button>
                        <button id="expand-all-btn" class="secondary small" title="Expand all series">Expand All</button>
                    </div>
                </div>
                <div id="series-container"></div>
                <button id="add-series-btn" class="primary">+ Add Series</button>
            </div>
        </div>
        <div class="editor-tab-content" id="editor-tab-events">
            <div class="events-view-program-details">
                <h3>Program Details</h3>
                <div class="form-group-inline">
                    <label>Title:</label>
                    <input type="text" id="events-program-title" placeholder="Program Title" />
                </div>
                <div class="form-group-inline">
                    <label>Description:</label>
                    <input type="text" id="events-program-description" placeholder="Program Description" />
                </div>
                ${editorState.isEditing ? `
                <div class="form-group-inline">
                    <label>ID:</label>
                    <input type="number" id="events-program-id" placeholder="Program ID" />
                </div>
                ` : `
                <div class="form-group-inline">
                    <label>ID:</label>
                    <input type="number" id="events-program-id" placeholder="Auto-generated if empty" />
                </div>
                `}
                <div class="checkbox-group">
                    <label>
                        <input type="checkbox" id="events-program-readonly" />
                        Read-only (prevents deletion/editing)
                    </label>
                </div>
            </div>
            <div class="events-view-header">
                <div class="events-view-header-left">
                    <input type="checkbox" id="select-all-events-checkbox" title="Select all / none" />
                    <h3 id="events-view-summary"></h3>
                    <button id="batch-delete-btn" class="icon-btn delete-btn" style="display: none;" title="Delete selected">
                        <img src="/icons/delete_24_regular.svg" alt="Delete" width="20" height="20" />
                    </button>
                </div>
                <div class="events-view-actions">
                    <select id="goto-series-select" class="goto-series-select">
                        <option value="">Go to series...</option>
                    </select>
                    <button id="expand-all-series-btn" class="secondary small">Expand All</button>
                    <button id="collapse-all-series-btn" class="secondary small">Collapse All</button>
                </div>
            </div>
            <div id="events-view-container"></div>
        </div>
        <div class="editor-tab-content" id="editor-tab-timeline">
            <div class="timeline-editor-container">
                <div class="timeline-editor-header">
                    <div class="timeline-editor-controls">
                        <select id="timeline-series-select" class="timeline-series-select">
                            <option value="">Select series...</option>
                        </select>
                        <button id="timeline-zoom-in" class="secondary small" title="Zoom In">+</button>
                        <button id="timeline-zoom-out" class="secondary small" title="Zoom Out">-</button>
                        <button id="timeline-zoom-fit" class="secondary small" title="Fit to Window">Fit</button>
                        <span id="timeline-info" class="timeline-info"></span>
                    </div>
                </div>
                <div id="timeline-editor-content" class="timeline-editor-content"></div>
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
                <pre id="json-highlight-preview" class="json-highlight-preview" aria-hidden="true"><code id="json-highlight-code"></code></pre>
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
            
            // If switching to events tab, render events view
            if (targetTab === 'events') {
                renderEventsView();
            }
            
            // If switching to timeline tab, render timeline editor
            if (targetTab === 'timeline') {
                attachTimelineEditorListeners(); // Attach listeners first time
                renderTimelineEditor();
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
    
    container.innerHTML = program.series.map((series, seriesIndex) => {
        const isCollapsed = editorState.collapsedSeries.has(seriesIndex);
        return `
        <div class="series-item ${isCollapsed ? 'collapsed' : ''}" data-series-index="${seriesIndex}" draggable="true">
            <div class="series-header">
                <button class="drag-handle-btn small icon-only" title="Drag to reorder">
                    <span class="drag-handle">≡</span>
                </button>
                <button class="collapse-toggle small icon-only" data-action="toggle-series" data-index="${seriesIndex}" title="${isCollapsed ? 'Expand' : 'Collapse'} Series">
                    <span class="collapse-icon">${isCollapsed ? '▸' : '▾'}</span>
                </button>
                <h4>Series ${seriesIndex + 1}${series.name ? ': ' + series.name : ''}</h4>
                <button class="context-menu-btn small icon-only" data-action="series-menu" data-index="${seriesIndex}" title="More options">
                    <span>⋮</span>
                </button>
            </div>
            <div class="series-content" style="${isCollapsed ? 'display: none;' : ''}">
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
        </div>
        `;
    }).join('');
    
    // Update series navigation dropdown
    updateSeriesNavigation();
}

/**
 * Update the series navigation dropdown
 */
function updateSeriesNavigation() {
    const seriesNav = document.getElementById('series-navigation');
    if (!seriesNav) return;
    
    const program = editorState.program;
    
    if (program.series.length === 0) {
        seriesNav.classList.add('hidden');
        return;
    }
    
    seriesNav.classList.remove('hidden');
    
    // Keep the default option and add series options
    seriesNav.innerHTML = '<option value="" disabled selected>Go to series...</option>';
    
    program.series.forEach((series, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `Series ${index + 1}${series.name ? ': ' + series.name : ''}`;
        seriesNav.appendChild(option);
    });
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
                <button class="drag-handle-btn small icon-only" title="Drag to reorder">
                    <span class="drag-handle">≡</span>
                </button>
                <span>Event ${eventIndex + 1}</span>
                <button class="context-menu-btn small icon-only" data-action="event-menu" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="More options">
                    <span>⋮</span>
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
 * Show context menu for series
 */
function showSeriesContextMenu(event, seriesIndex) {
    event.preventDefault();
    event.stopPropagation();
    
    // Remove any existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const program = editorState.program;
    const totalSeries = program.series.length;
    const isFirst = seriesIndex === 0;
    const isLast = seriesIndex === totalSeries - 1;
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <button data-action="move-series-top" data-index="${seriesIndex}" ${isFirst ? 'disabled' : ''}>Move to top</button>
        <button data-action="move-series-up" data-index="${seriesIndex}" ${isFirst ? 'disabled' : ''}>Move up</button>
        <button data-action="move-series-down" data-index="${seriesIndex}" ${isLast ? 'disabled' : ''}>Move down</button>
        <button data-action="move-series-bottom" data-index="${seriesIndex}" ${isLast ? 'disabled' : ''}>Move to bottom</button>
        <hr>
        <button data-action="duplicate-series" data-index="${seriesIndex}">Copy</button>
        <button data-action="delete-series-ctx" data-index="${seriesIndex}">Delete</button>
    `;
    
    // Position the menu
    const button = event.target.closest('button');
    const rect = button.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left}px`;
    
    document.body.appendChild(menu);
    
    // Close menu on click outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
    
    // Handle menu actions
    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const index = parseInt(e.target.dataset.index);
        
        if (action === 'move-series-top') {
            moveSeriesTo(index, 0);
        } else if (action === 'move-series-up') {
            moveSeriesTo(index, index - 1);
        } else if (action === 'move-series-down') {
            moveSeriesTo(index, index + 1);
        } else if (action === 'move-series-bottom') {
            moveSeriesTo(index, totalSeries - 1);
        } else if (action === 'duplicate-series') {
            duplicateSeries(index);
        } else if (action === 'delete-series-ctx') {
            if (confirm('Delete this series?')) {
                editorState.program.series.splice(index, 1);
                updateCollapsedSeriesAfterDeletion(index);
                renderAllSeries();
                renderTimelinePreview();
            }
        }
        
        menu.remove();
        document.removeEventListener('click', closeMenu);
    });
}

/**
 * Show context menu for event
 */
function showEventContextMenu(event, seriesIndex, eventIndex) {
    event.preventDefault();
    event.stopPropagation();
    
    // Remove any existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const series = editorState.program.series[seriesIndex];
    const totalEvents = series.events.length;
    const isFirst = eventIndex === 0;
    const isLast = eventIndex === totalEvents - 1;
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <button data-action="move-event-top" data-series="${seriesIndex}" data-event="${eventIndex}" ${isFirst ? 'disabled' : ''}>Move to top</button>
        <button data-action="move-event-up" data-series="${seriesIndex}" data-event="${eventIndex}" ${isFirst ? 'disabled' : ''}>Move up</button>
        <button data-action="move-event-down" data-series="${seriesIndex}" data-event="${eventIndex}" ${isLast ? 'disabled' : ''}>Move down</button>
        <button data-action="move-event-bottom" data-series="${seriesIndex}" data-event="${eventIndex}" ${isLast ? 'disabled' : ''}>Move to bottom</button>
        <hr>
        <button data-action="duplicate-event" data-series="${seriesIndex}" data-event="${eventIndex}">Copy</button>
        <button data-action="delete-event-ctx" data-series="${seriesIndex}" data-event="${eventIndex}">Delete</button>
    `;
    
    // Position the menu
    const button = event.target.closest('button');
    const rect = button.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left}px`;
    
    document.body.appendChild(menu);
    
    // Close menu on click outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
    
    // Handle menu actions
    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const sIndex = parseInt(e.target.dataset.series);
        const eIndex = parseInt(e.target.dataset.event);
        
        if (action === 'move-event-top') {
            moveEventTo(sIndex, eIndex, 0);
        } else if (action === 'move-event-up') {
            moveEventTo(sIndex, eIndex, eIndex - 1);
        } else if (action === 'move-event-down') {
            moveEventTo(sIndex, eIndex, eIndex + 1);
        } else if (action === 'move-event-bottom') {
            moveEventTo(sIndex, eIndex, totalEvents - 1);
        } else if (action === 'duplicate-event') {
            duplicateEvent(sIndex, eIndex);
        } else if (action === 'delete-event-ctx') {
            if (confirm('Delete this event?')) {
                editorState.program.series[sIndex].events.splice(eIndex, 1);
                renderAllSeries();
                renderTimelinePreview();
            }
        }
        
        menu.remove();
        document.removeEventListener('click', closeMenu);
    });
}

/**
 * Move series to a new position
 */
function moveSeriesTo(fromIndex, toIndex) {
    const series = editorState.program.series.splice(fromIndex, 1)[0];
    editorState.program.series.splice(toIndex, 0, series);
    
    // Update collapsed state
    const wasCollapsed = editorState.collapsedSeries.has(fromIndex);
    const newCollapsedSeries = new Set();
    editorState.collapsedSeries.forEach(index => {
        if (index === fromIndex) return; // Skip the moved item
        if (fromIndex < toIndex) {
            // Moving down
            if (index > fromIndex && index <= toIndex) {
                newCollapsedSeries.add(index - 1);
            } else {
                newCollapsedSeries.add(index);
            }
        } else {
            // Moving up
            if (index >= toIndex && index < fromIndex) {
                newCollapsedSeries.add(index + 1);
            } else {
                newCollapsedSeries.add(index);
            }
        }
    });
    if (wasCollapsed) {
        newCollapsedSeries.add(toIndex);
    }
    editorState.collapsedSeries = newCollapsedSeries;
    
    renderAllSeries();
    renderTimelinePreview();
}

/**
 * Move event to a new position
 */
function moveEventTo(seriesIndex, fromIndex, toIndex) {
    const series = editorState.program.series[seriesIndex];
    const event = series.events.splice(fromIndex, 1)[0];
    series.events.splice(toIndex, 0, event);
    
    renderAllSeries();
    renderTimelinePreview();
}

/**
 * Duplicate a series
 */
function duplicateSeries(index) {
    const series = editorState.program.series[index];
    const duplicate = JSON.parse(JSON.stringify(series));
    editorState.program.series.splice(index + 1, 0, duplicate);
    
    renderAllSeries();
    renderTimelinePreview();
}

/**
 * Duplicate an event
 */
function duplicateEvent(seriesIndex, eventIndex) {
    const series = editorState.program.series[seriesIndex];
    const event = series.events[eventIndex];
    const duplicate = JSON.parse(JSON.stringify(event));
    series.events.splice(eventIndex + 1, 0, duplicate);
    
    renderAllSeries();
    renderTimelinePreview();
}

/**
 * Update collapsed series indices after deletion
 */
function updateCollapsedSeriesAfterDeletion(deletedIndex) {
    const newCollapsedSeries = new Set();
    editorState.collapsedSeries.forEach(collapsedIndex => {
        if (collapsedIndex < deletedIndex) {
            newCollapsedSeries.add(collapsedIndex);
        } else if (collapsedIndex > deletedIndex) {
            newCollapsedSeries.add(collapsedIndex - 1);
        }
    });
    editorState.collapsedSeries = newCollapsedSeries;
}

/**
 * Update the JSON editor with current program state
 */
function updateJsonEditor() {
    const textarea = document.getElementById('json-editor-textarea');
    if (textarea) {
        textarea.value = JSON.stringify(editorState.program, null, 2);
        updateLineNumbers();
        highlightJson();
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
 * Highlight JSON syntax in the preview overlay using Prism.js
 */
function highlightJson() {
    const textarea = document.getElementById('json-editor-textarea');
    const codeElement = document.getElementById('json-highlight-code');
    
    if (!textarea || !codeElement) return;
    
    const json = textarea.value;
    
    // Use Prism.js to highlight JSON
    const highlighted = Prism.highlight(json, Prism.languages.json, 'json');
    codeElement.innerHTML = highlighted;
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
        highlightJson();
        validateJson();
    } catch (error) {
        // If JSON is invalid, validation will show the error
        highlightJson();
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
    
    // Collapse/Expand all buttons
    document.getElementById('collapse-all-btn').addEventListener('click', () => {
        editorState.program.series.forEach((_, index) => {
            editorState.collapsedSeries.add(index);
        });
        renderAllSeries();
    });
    
    document.getElementById('expand-all-btn').addEventListener('click', () => {
        editorState.collapsedSeries.clear();
        renderAllSeries();
    });
    
    // Series navigation dropdown
    document.getElementById('series-navigation').addEventListener('change', (e) => {
        const seriesIndex = parseInt(e.target.value);
        if (!isNaN(seriesIndex)) {
            // Scroll to the series
            const seriesItem = document.querySelector(`.series-item[data-series-index="${seriesIndex}"]`);
            if (seriesItem) {
                seriesItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Expand the series if it's collapsed
                if (editorState.collapsedSeries.has(seriesIndex)) {
                    editorState.collapsedSeries.delete(seriesIndex);
                    renderAllSeries();
                }
            }
            // Reset the dropdown
            e.target.value = '';
        }
    });
    
    // Event delegation for series and events
    const seriesContainer = document.getElementById('series-container');
    
    seriesContainer.addEventListener('click', (e) => {
        // Find the button element if we clicked on a child element
        const button = e.target.closest('button');
        if (!button) return;
        
        const action = button.dataset.action;
        
        if (action === 'toggle-series') {
            const index = parseInt(button.dataset.index);
            if (editorState.collapsedSeries.has(index)) {
                editorState.collapsedSeries.delete(index);
            } else {
                editorState.collapsedSeries.add(index);
            }
            renderAllSeries();
        } else if (action === 'series-menu') {
            const index = parseInt(button.dataset.index);
            showSeriesContextMenu(e, index);
        } else if (action === 'event-menu') {
            const seriesIndex = parseInt(button.getAttribute('data-series-index'));
            const eventIndex = parseInt(button.getAttribute('data-event-index'));
            showEventContextMenu(e, seriesIndex, eventIndex);
        } else if (action === 'delete-series') {
            const index = parseInt(button.dataset.index);
            if (confirm('Delete this series?')) {
                editorState.program.series.splice(index, 1);
                updateCollapsedSeriesAfterDeletion(index);
                renderAllSeries();
                renderTimelinePreview();
            }
        } else if (action === 'add-event') {
            const seriesIndex = parseInt(button.getAttribute('data-series-index'));
            editorState.program.series[seriesIndex].events.push(createEmptyEvent());
            renderAllSeries();
            renderTimelinePreview();
        } else if (action === 'delete-event') {
            const seriesIndex = parseInt(button.getAttribute('data-series-index'));
            const eventIndex = parseInt(button.getAttribute('data-event-index'));
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
            updateSeriesNavigation(); // Update dropdown when series name changes
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
        // Handle series item dragging
        if (e.target.classList.contains('series-item')) {
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
        // Handle series item drag end
        if (e.target.classList.contains('series-item')) {
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
        
        // Handle series item dragover
        if (e.target.closest('.series-item')) {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging.series-item');
            const targetElement = e.target.closest('.series-item');
            
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
    });
    
    seriesContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggingAudio = document.querySelector('.dragging.selected-audio-item');
        const draggingEvent = document.querySelector('.dragging.event-item');
        const draggingSeries = document.querySelector('.dragging.series-item');
        
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
        
        // Handle series drop
        if (draggingSeries) {
            const container = draggingSeries.parentElement;
            
            // Get new order of series
            const seriesElements = Array.from(container.querySelectorAll('.series-item'));
            const newSeriesOrder = seriesElements.map(el => {
                const oldSeriesIndex = parseInt(el.dataset.seriesIndex);
                return editorState.program.series[oldSeriesIndex];
            });
            
            // Update the series array with new order
            editorState.program.series = newSeriesOrder;
            
            // Re-render to update indices
            renderAllSeries();
            renderTimelinePreview();
        }
    });
    
    // JSON editor event listeners
    const jsonTextarea = document.getElementById('json-editor-textarea');
    if (jsonTextarea) {
        // Update line numbers, syntax highlighting, and validate on input
        jsonTextarea.addEventListener('input', () => {
            updateLineNumbers();
            highlightJson();
            validateJson();
        });
        
        // Sync scroll between textarea, line numbers, and highlight preview
        jsonTextarea.addEventListener('scroll', () => {
            const lineNumbers = document.getElementById('json-line-numbers');
            const highlightPreview = document.getElementById('json-highlight-preview');
            if (lineNumbers) {
                lineNumbers.scrollTop = jsonTextarea.scrollTop;
            }
            if (highlightPreview) {
                highlightPreview.scrollTop = jsonTextarea.scrollTop;
                highlightPreview.scrollLeft = jsonTextarea.scrollLeft;
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
 * Attach event listeners to the events view
 */
// Track if we've already initialized event listeners
if (!window.eventsViewListenersInitialized) {
    window.eventsViewListenersInitialized = false;
}

function attachEventsViewListeners() {
    // Only initialize listeners once - they use event delegation on persistent parents
    if (window.eventsViewListenersInitialized) return;
    window.eventsViewListenersInitialized = true;
    
    const container = document.getElementById('events-view-container');
    if (!container) return;
    
    // Program details listeners
    const titleInput = document.getElementById('events-program-title');
    const descInput = document.getElementById('events-program-description');
    const idInput = document.getElementById('events-program-id');
    const readonlyCheckbox = document.getElementById('events-program-readonly');
    
    if (titleInput) {
        titleInput.addEventListener('change', (e) => {
            editorState.program.title = e.target.value;
        });
    }
    
    if (descInput) {
        descInput.addEventListener('change', (e) => {
            editorState.program.description = e.target.value;
        });
    }
    
    if (idInput) {
        idInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            editorState.program.id = isNaN(value) ? null : value;
        });
    }
    
    if (readonlyCheckbox) {
        readonlyCheckbox.addEventListener('change', (e) => {
            editorState.program.readonly = e.target.checked;
        });
    }
    
    // Expand/Collapse all buttons
    const expandAllBtn = document.getElementById('expand-all-series-btn');
    const collapseAllBtn = document.getElementById('collapse-all-series-btn');
    
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            editorState.collapsedSeries.clear();
            renderEventsView();
        });
    }
    
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            editorState.program.series.forEach((_, index) => {
                editorState.collapsedSeries.add(index);
            });
            renderEventsView();
        });
    }
    
    // Go to series dropdown
    const gotoSelect = document.getElementById('goto-series-select');
    if (gotoSelect) {
        gotoSelect.addEventListener('change', (e) => {
            const seriesIndex = e.target.value;
            if (seriesIndex !== '') {
                const seriesElement = document.getElementById(`series-${seriesIndex}`);
                if (seriesElement) {
                    seriesElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Ensure the series is expanded
                    editorState.collapsedSeries.delete(parseInt(seriesIndex));
                    renderEventsView();
                }
                // Reset dropdown
                e.target.value = '';
            }
        });
    }
    
    // Three-dot menu toggles
    container.addEventListener('click', (e) => {
        const menuBtn = e.target.closest('.series-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            // Close all other menus
            document.querySelectorAll('.series-menu-dropdown').forEach(menu => {
                if (menu.parentElement !== menuBtn.parentElement) {
                    menu.classList.remove('show');
                }
            });
            // Toggle this menu
            const dropdown = menuBtn.parentElement.querySelector('.series-menu-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('show');
            }
            return;
        }
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.series-menu-container')) {
            document.querySelectorAll('.series-menu-dropdown').forEach(menu => {
                menu.classList.remove('show');
            });
        }
    });
    
    // Series toggle buttons
    container.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.series-toggle-btn');
        if (toggleBtn) {
            const seriesIndex = parseInt(toggleBtn.dataset.seriesIndex);
            if (editorState.collapsedSeries.has(seriesIndex)) {
                editorState.collapsedSeries.delete(seriesIndex);
            } else {
                editorState.collapsedSeries.add(seriesIndex);
            }
            renderEventsView();
            return;
        }
        
        // Handle action buttons
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const seriesIndex = parseInt(actionBtn.dataset.seriesIndex);
            const eventIndex = parseInt(actionBtn.dataset.eventIndex);
            
            if (action === 'add-event-to-series') {
                editorState.program.series[seriesIndex].events.push(createEmptyEvent());
                renderEventsView();
                renderTimelinePreview();
            } else if (action === 'delete-series-events-view') {
                if (confirm('Delete this series?')) {
                    editorState.program.series.splice(seriesIndex, 1);
                    // Update collapsed series indices
                    const newCollapsed = new Set();
                    editorState.collapsedSeries.forEach(idx => {
                        if (idx < seriesIndex) newCollapsed.add(idx);
                        else if (idx > seriesIndex) newCollapsed.add(idx - 1);
                    });
                    editorState.collapsedSeries = newCollapsed;
                    renderEventsView();
                    renderTimelinePreview();
                }
            } else if (action === 'edit-series') {
                openSeriesEditModal(seriesIndex);
            } else if (action === 'duplicate-series') {
                const clonedSeries = JSON.parse(JSON.stringify(editorState.program.series[seriesIndex]));
                clonedSeries.name = (clonedSeries.name || 'Series') + ' (Copy)';
                editorState.program.series.splice(seriesIndex + 1, 0, clonedSeries);
                renderEventsView();
                renderTimelinePreview();
            } else if (action === 'edit-event') {
                openEventEditModal(seriesIndex, eventIndex);
            } else if (action === 'duplicate-event') {
                const clonedEvent = JSON.parse(JSON.stringify(editorState.program.series[seriesIndex].events[eventIndex]));
                editorState.program.series[seriesIndex].events.splice(eventIndex + 1, 0, clonedEvent);
                renderEventsView();
                renderTimelinePreview();
            } else if (action === 'delete-event-events-view') {
                if (confirm('Delete this event?')) {
                    editorState.program.series[seriesIndex].events.splice(eventIndex, 1);
                    renderEventsView();
                    renderTimelinePreview();
                }
            }
        }
    });
    
    // Event checkboxes for batch selection
    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('event-checkbox')) {
            const eventId = e.target.dataset.eventId;
            if (e.target.checked) {
                editorState.selectedEvents.add(eventId);
            } else {
                editorState.selectedEvents.delete(eventId);
            }
            renderEventsView();
        }
        
    });
    
    // Select-all checkbox
    const selectAllCheckbox = document.getElementById('select-all-events-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked || e.target.indeterminate) {
                // Select all events
                editorState.selectedEvents.clear();
                editorState.program.series.forEach((series, seriesIdx) => {
                    series.events.forEach((event, eventIdx) => {
                        editorState.selectedEvents.add(`${seriesIdx}-${eventIdx}`);
                    });
                });
            } else {
                // Deselect all
                editorState.selectedEvents.clear();
            }
            renderEventsView();
        });
    }
    
    // Batch delete button
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', () => {
            if (confirm(`Delete ${editorState.selectedEvents.size} selected event(s)?`)) {
                // Convert selected event IDs to indices
                const toDelete = Array.from(editorState.selectedEvents).map(id => {
                    const [seriesIdx, eventIdx] = id.split('-').map(Number);
                    return { seriesIdx, eventIdx };
                });
                
                // Sort by series then event index in reverse to delete from end first.
                // This is crucial because deleting from the beginning would shift indices
                // of subsequent elements, causing us to delete wrong items.
                toDelete.sort((a, b) => {
                    if (a.seriesIdx !== b.seriesIdx) return b.seriesIdx - a.seriesIdx;
                    return b.eventIdx - a.eventIdx;
                });
                
                // Delete events
                toDelete.forEach(({ seriesIdx, eventIdx }) => {
                    if (editorState.program.series[seriesIdx] && 
                        editorState.program.series[seriesIdx].events[eventIdx]) {
                        editorState.program.series[seriesIdx].events.splice(eventIdx, 1);
                    }
                });
                
                editorState.selectedEvents.clear();
                renderEventsView();
                renderTimelinePreview();
            }
        });
    }
    
    // Drag and drop for event reordering
    container.addEventListener('dragstart', (e) => {
        // Don't allow dragging when clicking on interactive elements
        if (e.target.matches('input, button, select, a, .icon-btn, .menu-item')) {
            e.preventDefault();
            return;
        }
        
        const seriesItem = e.target.closest('.events-view-series');
        const eventItem = e.target.closest('.events-view-item');
        
        // Check if dragging an event (prioritize over series)
        if (eventItem) {
            eventItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', eventItem.dataset.eventId);
            return;
        }
        
        // Otherwise, handle series dragging
        if (seriesItem) {
            seriesItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'series-' + seriesItem.dataset.seriesIndex);
        }
    });
    
    container.addEventListener('dragend', (e) => {
        const seriesItem = e.target.closest('.events-view-series');
        const eventItem = e.target.closest('.events-view-item');
        
        if (seriesItem) {
            seriesItem.classList.remove('dragging');
        }
        if (eventItem) {
            eventItem.classList.remove('dragging');
        }
    });
    
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        
        // Check if dragging a series
        const draggingSeries = document.querySelector('.events-view-series.dragging');
        const targetSeries = e.target.closest('.events-view-series');
        
        if (draggingSeries && targetSeries && draggingSeries !== targetSeries) {
            const allSeries = Array.from(container.querySelectorAll('.events-view-series'));
            const draggingIndex = allSeries.indexOf(draggingSeries);
            const targetIndex = allSeries.indexOf(targetSeries);
            
            if (draggingIndex < targetIndex) {
                targetSeries.after(draggingSeries);
            } else {
                targetSeries.before(draggingSeries);
            }
            return;
        }
        
        // Otherwise, handle event dragging
        const draggingItem = document.querySelector('.events-view-item.dragging');
        const targetItem = e.target.closest('.events-view-item');
        
        if (draggingItem && targetItem && draggingItem !== targetItem) {
            const targetSeriesIndex = parseInt(targetItem.dataset.seriesIndex);
            const draggingSeriesIndex = parseInt(draggingItem.dataset.seriesIndex);
            
            // Only allow reordering within the same series
            if (targetSeriesIndex === draggingSeriesIndex) {
                const container = targetItem.parentElement;
                const allItems = Array.from(container.querySelectorAll('.events-view-item'));
                const draggingIndex = allItems.indexOf(draggingItem);
                const targetIndex = allItems.indexOf(targetItem);
                
                if (draggingIndex < targetIndex) {
                    targetItem.after(draggingItem);
                } else {
                    targetItem.before(draggingItem);
                }
            }
        }
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        
        // Check if dropping a series
        const draggingSeries = document.querySelector('.events-view-series.dragging');
        if (draggingSeries) {
            const allSeries = Array.from(container.querySelectorAll('.events-view-series'));
            const newSeriesOrder = allSeries.map(seriesElement => {
                const oldSeriesIndex = parseInt(seriesElement.dataset.seriesIndex);
                return editorState.program.series[oldSeriesIndex];
            });
            
            // Update the series array with new order
            editorState.program.series = newSeriesOrder;
            
            // Clear collapsed state and rebuild with new indices
            const wasCollapsed = Array.from(editorState.collapsedSeries);
            editorState.collapsedSeries.clear();
            wasCollapsed.forEach(oldIndex => {
                const series = newSeriesOrder[oldIndex];
                const newIndex = editorState.program.series.indexOf(series);
                if (newIndex !== -1) {
                    editorState.collapsedSeries.add(newIndex);
                }
            });
            
            // Re-render to update indices
            renderEventsView();
            renderTimelinePreview();
            return;
        }
        
        // Otherwise, handle event dropping
        const draggingItem = document.querySelector('.events-view-item.dragging');
        
        if (draggingItem) {
            const seriesIndex = parseInt(draggingItem.dataset.seriesIndex);
            const listContainer = draggingItem.parentElement;
            
            // Get new order of events
            const eventItems = Array.from(listContainer.querySelectorAll('.events-view-item'));
            const newEventOrder = eventItems.map(item => {
                const oldEventIndex = parseInt(item.dataset.eventIndex);
                return editorState.program.series[seriesIndex].events[oldEventIndex];
            });
            
            // Update the events array with new order
            editorState.program.series[seriesIndex].events = newEventOrder;
            
            // Re-render to update indices
            renderEventsView();
            renderTimelinePreview();
        }
    });
    
    // Keyboard navigation
    container.addEventListener('keydown', (e) => {
        const focusedItem = document.activeElement.closest('.events-view-item');
        if (!focusedItem) return;
        
        const seriesIndex = parseInt(focusedItem.dataset.seriesIndex);
        const eventIndex = parseInt(focusedItem.dataset.eventIndex);
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextItem = focusedItem.nextElementSibling;
            if (nextItem && nextItem.classList.contains('events-view-item')) {
                nextItem.focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevItem = focusedItem.previousElementSibling;
            if (prevItem && prevItem.classList.contains('events-view-item')) {
                prevItem.focus();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            openEventEditModal(seriesIndex, eventIndex);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            if (confirm('Delete this event?')) {
                editorState.program.series[seriesIndex].events.splice(eventIndex, 1);
                renderEventsView();
                renderTimelinePreview();
            }
        }
    });
    
    // Make event items focusable for keyboard navigation
    container.querySelectorAll('.events-view-item').forEach(item => {
        item.setAttribute('tabindex', '0');
    });
}

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Render the timeline-based editor view
 */
function renderTimelineEditor() {
    const container = document.getElementById('timeline-editor-content');
    const program = editorState.program;
    
    // Update series selector
    const seriesSelect = document.getElementById('timeline-series-select');
    if (seriesSelect) {
        seriesSelect.innerHTML = '<option value="">All Series</option>' + 
            program.series.map((series, index) => 
                `<option value="${index}" ${editorState.timelineSelectedSeries === index ? 'selected' : ''}>${escapeHtml(series.name || `Series ${index + 1}`)}</option>`
            ).join('');
    }
    
    if (!program.series || program.series.length === 0) {
        container.innerHTML = '<p class="empty-message">No series added yet. Switch to Form tab to add series.</p>';
        return;
    }
    
    // Determine which series to show
    const seriesToShow = editorState.timelineSelectedSeries !== null 
        ? [{ series: program.series[editorState.timelineSelectedSeries], index: editorState.timelineSelectedSeries }]
        : program.series.map((series, index) => ({ series, index }));
    
    // Calculate pixel per second based on zoom
    const pixelsPerSecond = 40 * editorState.timelineZoom;
    
    container.innerHTML = seriesToShow.map(({ series, index: seriesIndex }) => {
        if (!series.events || series.events.length === 0) {
            return `
                <div class="timeline-series-container" data-series-index="${seriesIndex}">
                    <div class="timeline-series-header">
                        <h4>${escapeHtml(series.name || `Series ${seriesIndex + 1}`)}${series.optional ? ' <span class="optional-badge">Optional</span>' : ''}</h4>
                    </div>
                    <p class="empty-message">No events in this series.</p>
                </div>
            `;
        }
        
        // Calculate cumulative timeline
        let cumulativeTime = 0;
        const eventsWithPositions = series.events.map((event, eventIndex) => {
            const startTime = cumulativeTime;
            cumulativeTime += event.duration;
            return { event, eventIndex, startTime, endTime: cumulativeTime };
        });
        
        const totalDuration = cumulativeTime;
        const totalDurationSeconds = Math.ceil(totalDuration / 1000);
        const timelineWidth = totalDurationSeconds * pixelsPerSecond;
        
        // Generate time markers (every second)
        const timeMarkers = [];
        for (let i = 0; i <= totalDurationSeconds; i++) {
            timeMarkers.push(i);
        }
        
        return `
            <div class="timeline-series-container" data-series-index="${seriesIndex}">
                <div class="timeline-series-header">
                    <h4>${escapeHtml(series.name || `Series ${seriesIndex + 1}`)}${series.optional ? ' <span class="optional-badge">Optional</span>' : ''}</h4>
                    <span class="series-meta">Total: ${(totalDuration / 1000).toFixed(1)}s</span>
                </div>
                <div class="timeline-track-container">
                    <div class="timeline-track" style="width: ${timelineWidth}px;">
                        ${eventsWithPositions.map(({ event, eventIndex, startTime, endTime }) => {
                            const startSeconds = startTime / 1000;
                            const durationSeconds = event.duration / 1000;
                            const leftPosition = startSeconds * pixelsPerSecond;
                            const width = durationSeconds * pixelsPerSecond;
                            
                            const eventId = `${seriesIndex}-${eventIndex}`;
                            const isSelected = editorState.selectedEvents.has(eventId);
                            
                            const audioTitles = (event.audio_ids || []).map(id => {
                                const audio = editorState.audios.find(a => a.id === id);
                                return audio ? escapeHtml(audio.title) : `ID ${id}`;
                            }).join(', ');
                            
                            let commandClass = 'no-command';
                            if (event.command === 'show') commandClass = 'show-command';
                            else if (event.command === 'hide') commandClass = 'hide-command';
                            
                            const tooltipText = `${event.command ? escapeHtml(event.command.toUpperCase()) : 'NO CHANGE'}: ${durationSeconds.toFixed(1)}s${audioTitles ? '\nAudios: ' + audioTitles : ''}`;
                            
                            return `
                                <div class="timeline-event ${commandClass} ${isSelected ? 'selected' : ''}" 
                                     data-series-index="${seriesIndex}" 
                                     data-event-index="${eventIndex}"
                                     data-event-id="${eventId}"
                                     style="left: ${leftPosition}px; width: ${width}px;"
                                     draggable="true"
                                     tabindex="0"
                                     title="${tooltipText}">
                                    <div class="timeline-event-header">
                                        <input type="checkbox" class="timeline-event-checkbox" data-event-id="${eventId}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation()" />
                                        <span class="timeline-event-number">${eventIndex + 1}</span>
                                    </div>
                                    <div class="timeline-event-body">
                                        <div class="timeline-event-duration">${durationSeconds.toFixed(1)}s</div>
                                        <div class="timeline-event-command">${event.command ? escapeHtml(event.command.toUpperCase()) : 'NO CHANGE'}</div>
                                        ${(event.audio_ids && event.audio_ids.length > 0) ? `<div class="timeline-event-audio">♫ ${event.audio_ids.length}</div>` : ''}
                                    </div>
                                    <div class="timeline-event-actions">
                                        <button class="timeline-event-action-btn" data-action="edit" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Edit" onclick="event.stopPropagation()">
                                            <img src="public/icons/edit_24_regular.svg" alt="Edit" width="16" height="16" />
                                        </button>
                                        <button class="timeline-event-action-btn" data-action="copy" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Copy" onclick="event.stopPropagation()">
                                            <img src="public/icons/copy_24_regular.svg" alt="Copy" width="16" height="16" />
                                        </button>
                                        <button class="timeline-event-action-btn delete" data-action="delete" data-series-index="${seriesIndex}" data-event-index="${eventIndex}" title="Delete" onclick="event.stopPropagation()">
                                            <img src="public/icons/delete_24_regular.svg" alt="Delete" width="16" height="16" />
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="timeline-axis" style="width: ${timelineWidth}px;">
                        ${timeMarkers.map(second => `
                            <div class="timeline-tick" style="left: ${second * pixelsPerSecond}px;">
                                <div class="timeline-tick-mark"></div>
                                <div class="timeline-tick-label">${second}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Update info display
    const infoEl = document.getElementById('timeline-info');
    if (infoEl) {
        const totalEvents = program.series.reduce((sum, series) => sum + series.events.length, 0);
        const selectedCount = editorState.selectedEvents.size;
        infoEl.textContent = selectedCount > 0 
            ? `${selectedCount} of ${totalEvents} events selected` 
            : `${totalEvents} events total`;
    }
    
}

/**
 * Attach event listeners to timeline editor
 */
// Track if we've already initialized timeline listeners
if (!window.timelineEditorListenersInitialized) {
    window.timelineEditorListenersInitialized = false;
}

function attachTimelineEditorListeners() {
    // Only initialize listeners once - they use event delegation on persistent parents
    if (window.timelineEditorListenersInitialized) return;
    window.timelineEditorListenersInitialized = true;
    
    // Get the persistent parent container for event delegation
    const timelineEditorContainer = document.getElementById('editor-tab-timeline');
    if (!timelineEditorContainer) return;
    
    // Use event delegation for series selector changes
    timelineEditorContainer.addEventListener('change', (e) => {
        if (e.target.id === 'timeline-series-select') {
            const value = e.target.value;
            editorState.timelineSelectedSeries = value === '' ? null : parseInt(value);
            renderTimelineEditor();
        }
    });
    
    // Use event delegation for zoom controls
    timelineEditorContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        if (btn.id === 'timeline-zoom-in') {
            editorState.timelineZoom = Math.min(3, editorState.timelineZoom * 1.2);
            renderTimelineEditor();
        } else if (btn.id === 'timeline-zoom-out') {
            editorState.timelineZoom = Math.max(0.3, editorState.timelineZoom / 1.2);
            renderTimelineEditor();
        } else if (btn.id === 'timeline-zoom-fit') {
            editorState.timelineZoom = 1;
            renderTimelineEditor();
        }
    });
    
    // Event selection via checkboxes - use event delegation on persistent parent
    timelineEditorContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('timeline-event-checkbox')) {
            const eventId = e.target.dataset.eventId;
            if (e.target.checked) {
                editorState.selectedEvents.add(eventId);
            } else {
                editorState.selectedEvents.delete(eventId);
            }
            renderTimelineEditor();
        }
    });
    
    // Event actions - use event delegation on persistent parent
    timelineEditorContainer.addEventListener('click', (e) => {
        // Handle action buttons (edit, copy, delete)
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const seriesIndex = parseInt(actionBtn.dataset.seriesIndex);
            const eventIndex = parseInt(actionBtn.dataset.eventIndex);
            
            if (action === 'edit') {
                openEventEditModal(seriesIndex, eventIndex);
            } else if (action === 'copy') {
                duplicateEvent(seriesIndex, eventIndex);
                renderTimelineEditor();
                renderTimelinePreview();
            } else if (action === 'delete') {
                if (confirm('Delete this event?')) {
                    editorState.program.series[seriesIndex].events.splice(eventIndex, 1);
                    renderTimelineEditor();
                    renderTimelinePreview();
                }
            }
            return; // Don't process event selection if we clicked an action button
        }
        
        // Click on event to select/deselect (only if not clicking checkbox or action button)
        const timelineEvent = e.target.closest('.timeline-event');
        if (timelineEvent && !e.target.closest('.timeline-event-checkbox')) {
            const eventId = timelineEvent.dataset.eventId;
            if (editorState.selectedEvents.has(eventId)) {
                editorState.selectedEvents.delete(eventId);
            } else {
                editorState.selectedEvents.add(eventId);
            }
            renderTimelineEditor();
        }
    });
    
    // Drag and drop for event reordering - use event delegation on persistent parent
    timelineEditorContainer.addEventListener('dragstart', (e) => {
        const timelineEvent = e.target.closest('.timeline-event');
        if (timelineEvent) {
            timelineEvent.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', timelineEvent.dataset.eventId);
        }
    });
    
    timelineEditorContainer.addEventListener('dragend', (e) => {
        const timelineEvent = e.target.closest('.timeline-event');
        if (timelineEvent) {
            timelineEvent.classList.remove('dragging');
        }
    });
    
    timelineEditorContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingItem = document.querySelector('.timeline-event.dragging');
        const targetItem = e.target.closest('.timeline-event');
        
        if (draggingItem && targetItem && draggingItem !== targetItem) {
            const targetSeriesIndex = parseInt(targetItem.dataset.seriesIndex);
            const draggingSeriesIndex = parseInt(draggingItem.dataset.seriesIndex);
            
            // Only allow reordering within the same series
            if (targetSeriesIndex === draggingSeriesIndex) {
                const container = targetItem.parentElement;
                const allItems = Array.from(container.querySelectorAll('.timeline-event'));
                const draggingIndex = allItems.indexOf(draggingItem);
                const targetIndex = allItems.indexOf(targetItem);
                
                if (draggingIndex < targetIndex) {
                    targetItem.after(draggingItem);
                } else {
                    targetItem.before(draggingItem);
                }
            }
        }
    });
    
    timelineEditorContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggingItem = document.querySelector('.timeline-event.dragging');
        
        if (draggingItem) {
            const seriesIndex = parseInt(draggingItem.dataset.seriesIndex);
            const trackContainer = draggingItem.parentElement;
            
            // Get new order of events
            const eventItems = Array.from(trackContainer.querySelectorAll('.timeline-event'));
            const newEventOrder = eventItems.map(item => {
                const oldEventIndex = parseInt(item.dataset.eventIndex);
                return editorState.program.series[seriesIndex].events[oldEventIndex];
            });
            
            // Update the events array with new order
            editorState.program.series[seriesIndex].events = newEventOrder;
            
            // Re-render to update indices and positions
            renderTimelineEditor();
            renderTimelinePreview();
        }
    });
    
    // Keyboard navigation - use event delegation on persistent parent
    timelineEditorContainer.addEventListener('keydown', (e) => {
        const focusedEvent = document.activeElement.closest('.timeline-event');
        if (!focusedEvent) return;
        
        const seriesIndex = parseInt(focusedEvent.dataset.seriesIndex);
        const eventIndex = parseInt(focusedEvent.dataset.eventIndex);
        
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextEvent = focusedEvent.nextElementSibling;
            if (nextEvent && nextEvent.classList.contains('timeline-event')) {
                nextEvent.focus();
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevEvent = focusedEvent.previousElementSibling;
            if (prevEvent && prevEvent.classList.contains('timeline-event')) {
                prevEvent.focus();
            }
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEventEditModal(seriesIndex, eventIndex);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            if (confirm('Delete this event?')) {
                editorState.program.series[seriesIndex].events.splice(eventIndex, 1);
                renderTimelineEditor();
                renderTimelinePreview();
            }
        } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            duplicateEvent(seriesIndex, eventIndex);
            renderTimelineEditor();
            renderTimelinePreview();
        }
    });
}

/**
 * Open modal to edit event details
 */
/**
 * Open modal to edit series details
 */
function openSeriesEditModal(seriesIndex) {
    const series = editorState.program.series[seriesIndex];
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Edit Series ${seriesIndex + 1}</h2>
                <button class="close-btn" id="close-series-modal">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group-inline">
                    <label>Name:</label>
                    <input type="text" id="series-modal-name" value="${series.name || ''}" placeholder="Series Name" />
                </div>
                <div class="form-group-inline">
                    <label>Optional:</label>
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="series-modal-optional" ${series.optional ? 'checked' : ''} />
                            <span>This series is optional</span>
                        </label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="secondary" id="cancel-series-modal">Cancel</button>
                <button class="primary" id="save-series-modal">Save</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Attach event listeners
    const closeBtn = modal.querySelector('#close-series-modal');
    const cancelBtn = modal.querySelector('#cancel-series-modal');
    const saveBtn = modal.querySelector('#save-series-modal');
    
    const closeModal = () => {
        document.body.removeChild(modal);
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    saveBtn.addEventListener('click', () => {
        const name = modal.querySelector('#series-modal-name').value;
        const optional = modal.querySelector('#series-modal-optional').checked;
        
        editorState.program.series[seriesIndex].name = name;
        editorState.program.series[seriesIndex].optional = optional;
        
        closeModal();
        renderEventsView();
        renderTimelinePreview();
    });
    
    // Focus the name input
    setTimeout(() => {
        modal.querySelector('#series-modal-name').focus();
    }, 100);
}

/**
 * Open modal to edit event details
 */
function openEventEditModal(seriesIndex, eventIndex) {
    const event = editorState.program.series[seriesIndex].events[eventIndex];
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Edit Event ${eventIndex + 1}</h2>
                <button class="close-btn" id="close-event-modal">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group-inline">
                    <label>Duration (ms):</label>
                    <input type="number" id="event-modal-duration" value="${event.duration}" min="0" step="100" />
                </div>
                <div class="form-group-inline">
                    <label>Command:</label>
                    <div class="radio-group-inline">
                        <label class="radio-label">
                            <input type="radio" name="event-modal-command" value="show" ${event.command === 'show' ? 'checked' : ''} />
                            Show
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="event-modal-command" value="hide" ${event.command === 'hide' ? 'checked' : ''} />
                            Hide
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="event-modal-command" value="" ${!event.command ? 'checked' : ''} />
                            No Change
                        </label>
                    </div>
                </div>
                <div class="form-group-inline">
                    <label>Audio IDs:</label>
                    <div class="audio-input-container">
                        <div class="audio-search-container">
                            <input type="text" id="event-modal-audio-search" class="audio-search-input" placeholder="Search audios by ID or title..." />
                            <div class="audio-suggestions" id="event-modal-audio-suggestions"></div>
                        </div>
                        <div class="selected-audios" id="event-modal-selected-audios">
                            ${renderSelectedAudiosForModal(event.audio_ids || [])}
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="secondary" id="cancel-event-modal">Cancel</button>
                <button class="primary" id="save-event-modal">Save</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Attach event listeners
    const closeBtn = modal.querySelector('#close-event-modal');
    const cancelBtn = modal.querySelector('#cancel-event-modal');
    const saveBtn = modal.querySelector('#save-event-modal');
    const audioSearch = modal.querySelector('#event-modal-audio-search');
    
    const closeModal = () => {
        document.body.removeChild(modal);
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    saveBtn.addEventListener('click', () => {
        const duration = parseInt(modal.querySelector('#event-modal-duration').value);
        const commandInput = modal.querySelector('input[name="event-modal-command"]:checked');
        const command = commandInput ? (commandInput.value || null) : null;
        
        editorState.program.series[seriesIndex].events[eventIndex].duration = duration;
        editorState.program.series[seriesIndex].events[eventIndex].command = command;
        
        closeModal();
        renderEventsView();
        renderTimelinePreview();
    });
    
    // Audio search functionality
    audioSearch.addEventListener('input', () => {
        handleAudioSearchInModal(audioSearch, event.audio_ids || []);
    });
    
    // Handle audio selection
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('audio-suggestion-item-modal')) {
            const audioId = parseInt(e.target.dataset.audioId);
            if (!event.audio_ids) event.audio_ids = [];
            if (!event.audio_ids.includes(audioId)) {
                event.audio_ids.push(audioId);
                modal.querySelector('#event-modal-selected-audios').innerHTML = renderSelectedAudiosForModal(event.audio_ids);
                audioSearch.value = '';
                modal.querySelector('#event-modal-audio-suggestions').innerHTML = '';
            }
        }
        
        if (e.target.classList.contains('remove-audio-btn-modal')) {
            const audioIndex = parseInt(e.target.dataset.audioIndex);
            event.audio_ids.splice(audioIndex, 1);
            modal.querySelector('#event-modal-selected-audios').innerHTML = renderSelectedAudiosForModal(event.audio_ids);
        }
    });
}

/**
 * Render selected audios for modal
 */
function renderSelectedAudiosForModal(audioIds) {
    if (audioIds.length === 0) {
        return '<p class="empty-message small">No audios selected</p>';
    }
    
    return audioIds.map((audioId, audioIndex) => {
        const audio = editorState.audios.find(a => a.id === audioId);
        const title = audio ? audio.title : 'Unknown';
        return `
            <div class="selected-audio-item">
                <span class="audio-label">${audioId} - ${title}</span>
                <button class="remove-audio-btn-modal icon-only" data-audio-index="${audioIndex}" title="Remove Audio">
                    <img src="/icons/delete_24_regular.svg" alt="Remove" width="18" height="18" />
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Handle audio search in modal
 */
function handleAudioSearchInModal(input, selectedIds) {
    const searchTerm = input.value.toLowerCase();
    const suggestionsContainer = document.getElementById('event-modal-audio-suggestions');
    
    if (!searchTerm) {
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.classList.remove('active');
        return;
    }
    
    // Fuzzy search in audios
    const matches = editorState.audios.filter(audio => {
        if (selectedIds.includes(audio.id)) return false;
        
        const idStr = audio.id.toString();
        const titleLower = audio.title.toLowerCase();
        
        return idStr.includes(searchTerm) || titleLower.includes(searchTerm);
    }).slice(0, 10);
    
    if (matches.length === 0) {
        suggestionsContainer.innerHTML = '<div class="no-suggestions">No matches found</div>';
    } else {
        suggestionsContainer.innerHTML = matches.map(audio => `
            <div class="audio-suggestion-item-modal" data-audio-id="${audio.id}">
                ${audio.id} - ${audio.title}
            </div>
        `).join('');
    }
    
    suggestionsContainer.classList.add('active');
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
